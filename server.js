const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./src/config');
const { router: lineAuthRouter, attachSession } = require('./src/lineAuth');
const { registerChatSocket } = require('./src/chatSocket');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cookieParser());
app.use(express.json());
app.use(attachSession);

app.use(lineAuthRouter);
app.use(express.static(path.join(__dirname, 'public')));

// ดักหน้าแรกสุด (/) เพื่อส่งไฟล์ index.html ไปแสดงผลหน้าเว็บจริง
app.get('/', (req, res) => {
  // หากผู้ใช้ล็อกอินค้างไว้แล้ว ให้ข้ามไปหน้าห้องแชทสุ่มโดยอัตโนมัติ
  if (req.appUserId) {
    return res.redirect('/chat.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// บอกฝั่ง frontend ว่า login อยู่หรือยัง (ใช้ตัดสินใจว่าจะโชว์ปุ่ม LINE Login หรือเข้าหน้าหลักเลย)
app.get('/api/me', (req, res) => {
  if (!req.appUserId) {
    return res.json({ loggedIn: false });
  }
  res.json({ loggedIn: true });
});

app.get('/chat.html', (req, res) => {
  if (!req.appUserId) {
    return res.redirect('/auth/line');
  }
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

registerChatSocket(io);

server.listen(config.port, () => {
  console.log(`🚀 Secret Chat server กำลังรันอยู่ที่ http://localhost:${config.port}`);
});
