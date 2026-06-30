const { nanoid } = require('nanoid');
const redis = require('./redisClient');

const WAITING_LIST_KEY = 'matchmaking:waiting_list';
const WAITING_LOOKUP_KEY = 'matchmaking:waiting_by_socket'; // socketId -> entry JSON
const ONLINE_SET_KEY = 'stats:online_sockets';
const MATCHES_TOTAL_KEY = 'stats:matches_total';

/**
 * เข้าคิว หรือจับคู่ทันทีถ้ามีคนที่ตรงเงื่อนไขรออยู่แล้ว — ทำแบบ atomic ด้วย Lua
 * เพื่อกันปัญหา race condition เวลามีคนกดสุ่มพร้อมกันหลายคนในเวลาเดียวกัน
 *
 * Compatibility rule: a กับ b แมตช์กันได้ถ้า
 *   (a.want === 'any' || a.want === b.gender) AND (b.want === 'any' || b.want === a.gender)
 */
redis.defineCommand('matchJoin', {
  numberOfKeys: 2,
  lua: `
    local listKey = KEYS[1]
    local lookupKey = KEYS[2]
    local self = cjson.decode(ARGV[1])

    local pool = redis.call('LRANGE', listKey, 0, -1)
    for i, raw in ipairs(pool) do
      local cand = cjson.decode(raw)
      local selfWantOk = (self.want == 'any') or (self.want == cand.gender)
      local candWantOk = (cand.want == 'any') or (cand.want == self.gender)
      if selfWantOk and candWantOk then
        redis.call('LREM', listKey, 1, raw)
        redis.call('HDEL', lookupKey, cand.socketId)
        return raw
      end
    end

    redis.call('RPUSH', listKey, ARGV[1])
    redis.call('HSET', lookupKey, self.socketId, ARGV[1])
    return false
  `,
});

/** ออกจากคิว (ผู้ใช้กดยกเลิก หรือ disconnect ขณะกำลังรออยู่) */
redis.defineCommand('matchLeave', {
  numberOfKeys: 2,
  lua: `
    local listKey = KEYS[1]
    local lookupKey = KEYS[2]
    local socketId = ARGV[1]

    local raw = redis.call('HGET', lookupKey, socketId)
    if raw then
      redis.call('LREM', listKey, 1, raw)
      redis.call('HDEL', lookupKey, socketId)
    end
    return raw
  `,
});

/**
 * พยายามจับคู่ให้ entry นี้ ถ้าไม่เจอจะเข้าคิวรอ
 * @returns {Promise<object|null>} entry ของคู่ที่แมตช์ได้ หรือ null ถ้าต้องรอ
 */
async function findOrQueue({ socketId, appUserId, codename, gender, want }) {
  const entry = { socketId, appUserId, codename, gender, want, joinedAt: Date.now() };
  const result = await redis.matchJoin(WAITING_LIST_KEY, WAITING_LOOKUP_KEY, JSON.stringify(entry));
  return result ? JSON.parse(result) : null;
}

/** เรียกตอนผู้ใช้ยกเลิกการค้นหา หรือหลุดการเชื่อมต่อระหว่างรอคู่ */
async function leaveQueue(socketId) {
  await redis.matchLeave(WAITING_LIST_KEY, WAITING_LOOKUP_KEY, socketId);
}

/** จำนวนคนที่กำลังรอจับคู่อยู่จริง ๆ (ใช้โชว์สถานะคิวแบบตรงไปตรงมา) */
async function getQueueSize() {
  return redis.llen(WAITING_LIST_KEY);
}

/** สร้าง room id แบบสุ่มสำหรับคู่ที่แมตช์กันได้ */
function createRoomId() {
  return `room_${nanoid(12)}`;
}

// ---------- สถิติ: ของจริงทั้งหมด ไม่มีการปั้นตัวเลข ----------

async function markOnline(socketId) {
  await redis.sadd(ONLINE_SET_KEY, socketId);
}

async function markOffline(socketId) {
  await redis.srem(ONLINE_SET_KEY, socketId);
}

async function getOnlineCount() {
  return redis.scard(ONLINE_SET_KEY);
}

async function incrementMatchCount() {
  return redis.incr(MATCHES_TOTAL_KEY);
}

async function getMatchCountToday() {
  const v = await redis.get(MATCHES_TOTAL_KEY);
  return Number(v || 0);
}

module.exports = {
  findOrQueue,
  leaveQueue,
  getQueueSize,
  createRoomId,
  markOnline,
  markOffline,
  getOnlineCount,
  incrementMatchCount,
  getMatchCountToday,
};
