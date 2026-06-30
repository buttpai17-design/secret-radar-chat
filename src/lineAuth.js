const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');

const config = require('./config');
const { deriveAppUserId, getOrCreateProfile } = require('./anonymousProfile');

const router = express.Router();

const LINE_AUTH_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';

/**
 * STEP 1: ผู้ใช้กดปุ่ม "เข้าสู่ระบบด้วย LINE"
 * -> เด้งไปหน้า authorize ของ LINE พร้อม state กัน CSRF
 */
router.get('/auth/line', (req, res) => {
  const state = nanoid(16);

  // เก็บ state ไว้ใน httpOnly cookie ชั่วคราว เพื่อมาตรวจตอน callback
  res.cookie('line_oauth_state', state, {
    httpOnly: true,
    maxAge: 5 * 60 * 1000, // 5 นาที
    sameSite: 'lax',
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.line.channelId,
    redirect_uri: config.line.callbackUrl,
    state,
    // ขอแค่ profile + openid ตามนโยบาย — ไม่ขอ email หรือเบอร์โทร
    scope: 'profile openid',
  });

  res.redirect(`${LINE_AUTH_URL}?${params.toString()}`);
});

/**
 * STEP 2: LINE ส่ง code กลับมาที่ callback นี้
 * -> แลก code เป็น access_token -> ดึงโปรไฟล์ -> map เป็น App_User_ID
 * -> สร้าง/ดึง anonymous profile -> ออก session cookie (JWT)
 */
router.get('/auth/line/callback', async (req, res) => {
  const { code, state } = req.query;
  const savedState = req.cookies.line_oauth_state;

  res.clearCookie('line_oauth_state');

  if (!code || !state || state !== savedState) {
    return res.status(400).send('การเข้าสู่ระบบไม่ถูกต้อง หรือ session หมดเวลา กรุณาลองใหม่');
  }

  try {
    // แลก authorization code เป็น access token
    const tokenRes = await axios.post(
      LINE_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.line.callbackUrl,
        client_id: config.line.channelId,
        client_secret: config.line.channelSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenRes.data;

    // ดึงโปรไฟล์จาก LINE — เราจะใช้แค่ userId เท่านั้น ไม่เก็บ displayName/pictureUrl
    const profileRes = await axios.get(LINE_PROFILE_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const lineUserId = profileRes.data.userId;
    const appUserId = deriveAppUserId(lineUserId);

    // สร้าง anonymous profile (codename) ถ้ายังไม่มี
    await getOrCreateProfile(appUserId);

    // ออก session เป็น JWT ที่มีแค่ appUserId — ไม่มีข้อมูล LINE หลุดเข้าไปในระบบแชทเลย
    const sessionToken = jwt.sign({ appUserId }, config.jwtSecret, { expiresIn: '7d' });

    res.cookie('session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect('/');
  } catch (err) {
    console.error('[line-auth] login failed:', err.response?.data || err.message);
    res.status(500).send('เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

/** Middleware: แปลง session cookie -> req.appUserId (ถ้ามี) */
function attachSession(req, res, next) {
  const token = req.cookies.session;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.appUserId = payload.appUserId;
  } catch (err) {
    // token หมดอายุหรือไม่ถูกต้อง — ปล่อยให้ผ่านแบบไม่ login
    res.clearCookie('session');
  }
  next();
}

/** ใช้ตอน socket handshake เพื่อยืนยันตัวตนจาก cookie เดียวกัน */
function verifySessionToken(token) {
  return jwt.verify(token, config.jwtSecret); // throws ถ้า invalid
}

module.exports = { router, attachSession, verifySessionToken };
