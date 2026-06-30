const { nanoid } = require('nanoid');
const redis = require('./redisClient');

const CODE_TTL_SECONDS = 10 * 60; // โค้ดมีอายุ 10 นาที ถ้ายังไม่มีใครมาเข้าร่วม

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 100000-999999
}

/** สร้างห้องแชทลับใหม่ พร้อมรหัส 6 หลักให้เอาไปแชร์ */
async function createPrivateRoom() {
  let code;
  let key;

  // กันรหัสชนของห้องที่ยังไม่หมดอายุ (โอกาสน้อยมาก แต่เช็กไว้ให้ชัวร์)
  do {
    code = generateSixDigitCode();
    key = `room_code:${code}`;
  } while (await redis.exists(key));

  const roomId = `room_${nanoid(12)}`;
  await redis.setex(key, CODE_TTL_SECONDS, roomId);

  return { code, roomId };
}

/**
 * ใช้รหัส 6 หลักเข้าห้อง — ใช้ได้ครั้งเดียวเท่านั้น (ลบโค้ดทิ้งทันทีที่มีคนเข้าร่วมสำเร็จ)
 * เพื่อให้เป็นห้องส่วนตัวจริง ๆ ระหว่างสองคนที่ตั้งใจแชร์โค้ดกันเอง
 */
async function joinPrivateRoom(code) {
  const key = `room_code:${code}`;
  const roomId = await redis.get(key);
  if (!roomId) return null;

  await redis.del(key);
  return roomId;
}

module.exports = { createPrivateRoom, joinPrivateRoom };
