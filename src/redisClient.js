const Redis = require('ioredis');
const config = require('./config');

// ใช้ client เดียวกันทั้งแอป (matchmaking, profile, stats)
const redis = new Redis(config.redisUrl, {
  // อย่าให้แอปทั้งตัวล้มถ้า Redis ยังต่อไม่ติดตอน boot ครั้งแรก
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[redis] เชื่อมต่อสำเร็จ');
});

module.exports = redis;
