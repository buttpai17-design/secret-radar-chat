const crypto = require('crypto');
const redis = require('./redisClient');
const config = require('./config');

// คลังคำคุณศัพท์/คำนามไว้สุ่มเป็นชื่อเล่นในแชท — ไม่มีข้อมูลจริงของผู้ใช้ปนอยู่เลย
const ADJECTIVES = [
  'นักเดินทาง', 'แมวเหงา', 'ดาวตก', 'สายลม', 'นักฝัน',
  'ผู้มาเยือน', 'แสงจันทร์', 'นักเล่าเรื่อง', 'คนเก็บฝน', 'ใบไม้ลอย',
];
const NOUNS = ['ราตรี', 'ยามดึก', 'สายฝน', 'เที่ยงคืน', 'ปริศนา'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** สุ่มชื่อเล่นไม่เปิดเผยตัวตน เช่น "นักเดินทางราตรี #4821" */
function generateCodename() {
  const adj = ADJECTIVES[randomInt(0, ADJECTIVES.length - 1)];
  const noun = NOUNS[randomInt(0, NOUNS.length - 1)];
  const num = randomInt(1000, 9999);
  return `${adj}${noun} #${num}`;
}

/**
 * แปลง LINE User ID ให้เป็น App_User_ID แบบ one-way hash
 * เพื่อไม่ให้สามารถย้อนกลับไปหา LINE ID ตัวจริงได้จากฐานข้อมูลของเรา
 */
function deriveAppUserId(lineUserId) {
  return crypto
    .createHash('sha256')
    .update(`${lineUserId}:${config.userIdHashSalt}`)
    .digest('hex');
}

/**
 * ดึงโปรไฟล์ไม่เปิดเผยตัวตนของผู้ใช้ ถ้ายังไม่มีให้สร้างใหม่ (ครั้งแรกที่ล็อกอิน)
 * เก็บแค่ codename — ไม่เก็บชื่อจริง รูปโปรไฟล์ หรือข้อมูล LINE ใด ๆ
 */
async function getOrCreateProfile(appUserId) {
  const key = `profile:${appUserId}`;
  const existing = await redis.hgetall(key);

  if (existing && existing.codename) {
    return existing;
  }

  const profile = {
    codename: generateCodename(),
    createdAt: Date.now().toString(),
  };
  await redis.hset(key, profile);
  return profile;
}

module.exports = {
  generateCodename,
  deriveAppUserId,
  getOrCreateProfile,
};
