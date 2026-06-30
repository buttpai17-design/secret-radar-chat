require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) {
    console.warn(`[config] ⚠️  ยังไม่ได้ตั้งค่า ${name} ใน .env — บางฟีเจอร์อาจทำงานไม่ได้`);
  }
  return value;
}

module.exports = {
  port: process.env.PORT || 3000,
  appBaseUrl: required('APP_BASE_URL', 'http://localhost:3000'),

  redisUrl: required('REDIS_URL', 'redis://127.0.0.1:6379'),

  line: {
    channelId: required('LINE_CHANNEL_ID'),
    channelSecret: required('LINE_CHANNEL_SECRET'),
    callbackUrl: required('LINE_CALLBACK_URL', 'http://localhost:3000/auth/line/callback'),
  },

  jwtSecret: required('JWT_SECRET', 'dev_only_secret_change_me'),
  userIdHashSalt: required('USER_ID_HASH_SALT', 'dev_only_salt_change_me'),
};
