# 💬 Secret Chat — แอปสุ่มจับคู่แชทลับ

แอปแชทที่เน้นความเป็นส่วนตัว: ล็อกอินด้วย LINE แต่ทุกบัญชีจะถูกแปลงเป็นชื่อนามแฝงอัตโนมัติ ไม่มีการเปิดเผยตัวตนในห้องแชท

---

## 🏗 โครงสร้างโปรเจ็กต์

```
secret-chat-app/
├── server.js                # Entry point
├── src/
│   ├── config.js            # โหลด env vars
│   ├── redisClient.js       # Redis singleton
│   ├── lineAuth.js          # LINE Login OAuth2 flow + session JWT
│   ├── anonymousProfile.js  # สุ่มชื่อนามแฝง + hash LINE ID → App ID
│   ├── matchmaking.js       # Atomic Redis queue + สถิติจริง
│   ├── privateRoom.js       # ห้องแชทลับด้วยรหัส 6 หลัก
│   └── chatSocket.js        # Socket.io event handlers ทั้งหมด
└── public/
    ├── index.html           # หน้าหลัก (landing + สุ่มจับคู่)
    ├── chat.html            # หน้าห้องแชท
    ├── css/
    │   ├── main.css         # Global styles + theme
    │   └── chat.css         # Chat room styles
    ├── js/
    │   ├── main.js          # Logic หน้าหลัก
    │   └── chat.js          # Logic ห้องแชท
    └── img/
        └── line-icon.svg
```

---

## 🚀 เริ่มต้นใช้งาน

### 1. ติดตั้ง dependencies

```bash
npm install
```

### 2. ตั้งค่า Environment Variables

```bash
cp .env.example .env
```

เปิดไฟล์ `.env` และกรอกข้อมูลให้ครบ:

```
PORT=3000
APP_BASE_URL=http://localhost:3000
REDIS_URL=redis://127.0.0.1:6379
LINE_CHANNEL_ID=YOUR_CHANNEL_ID
LINE_CHANNEL_SECRET=YOUR_CHANNEL_SECRET
LINE_CALLBACK_URL=http://localhost:3000/auth/line/callback
JWT_SECRET=<random 64-char string>
USER_ID_HASH_SALT=<random 64-char string>
```

### 3. ตั้งค่า LINE Login Channel

1. ไปที่ [LINE Developers Console](https://developers.line.biz/console/)
2. สร้าง Provider → สร้าง Channel ประเภท **LINE Login**
3. ใน Callback URL ให้ใส่: `http://localhost:3000/auth/line/callback`
   (ตอน production เปลี่ยนเป็น domain จริง)
4. คัดลอก **Channel ID** และ **Channel Secret** ใส่ `.env`

### 4. เริ่ม Redis

```bash
# ถ้ามี Redis ใน local
redis-server

# หรือใช้ Docker
docker run -p 6379:6379 redis:alpine
```

### 5. รันแอป

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

เปิด browser ที่ `http://localhost:3000`

---

## 🌐 Deploy ไป Production

### Recommended Stack
- **Server**: [Railway](https://railway.app) / [Render](https://render.com) / VPS
- **Redis**: [Upstash](https://upstash.com) (free tier) / Redis Cloud

### Checklist ก่อน deploy

- [ ] เปลี่ยน `APP_BASE_URL` เป็น domain จริง เช่น `https://secretchat.example.com`
- [ ] เปลี่ยน `LINE_CALLBACK_URL` ให้ตรงกับ domain จริง
- [ ] อัปเดต Callback URL ใน LINE Developers Console ด้วย
- [ ] ตรวจสอบว่า `JWT_SECRET` และ `USER_ID_HASH_SALT` เป็น random string ยาวพอ (อย่างน้อย 64 chars)
- [ ] เปิด HTTPS (LINE Login บังคับ HTTPS ใน production)

---

## 🔐 สถาปัตยกรรมความเป็นส่วนตัว

```
LINE User ID  →  SHA-256(id + SALT)  →  App_User_ID  →  codename สุ่ม
(ของ LINE)        (one-way hash)         (ของเรา)         (โชว์ในแชท)
```

- **ไม่เก็บ**: ชื่อจริง, รูปโปรไฟล์, อีเมล, เบอร์โทร
- **เก็บแค่**: App_User_ID (ซึ่ง reverse กลับเป็น LINE ID ไม่ได้) + codename สุ่ม
- **ข้อความแชท**: ไม่ถูกบันทึกลงฐานข้อมูลเลย — ผ่าน Socket.io memory เท่านั้น และหายไปเมื่อออกจากห้อง

---

## 🔄 Flow การจับคู่

```
User A กด "สุ่มจับคู่"
    │
    ├── Redis: เช็คคิวว่ามีคนที่ filter ตรงกันไหม? (atomic Lua script)
    │
    ├── มีคู่ → สร้าง Room ID → join Socket.io room → redirect ทั้งคู่ไป /chat.html
    │
    └── ไม่มีคู่ → เข้าคิวรอ → โชว์สถานะ "กำลังหาคู่ + จำนวนคนในคิว" จริง ๆ
```

**ไม่มีบอทสวมรอย** — ถ้าจับคู่ไม่ได้ ระบบโชว์สถานะคิวตรงไปตรงมา ไม่มีการปั้นตัวเลขหรือจำลองพฤติกรรมคน

---

## 📡 Socket.io Events Reference

| Event (Client → Server) | Payload | คำอธิบาย |
|---|---|---|
| `find_match` | `{ gender, want }` | เริ่มค้นหาคู่ |
| `cancel_search` | — | ยกเลิกการค้นหา |
| `create_private_room` | — | สร้างห้องลับ |
| `join_private_room` | `{ code }` | เข้าห้องด้วยรหัส 6 หลัก |
| `chat_message` | `{ roomId, text }` | ส่งข้อความ |
| `typing` | `{ roomId, isTyping }` | สถานะพิมพ์ |
| `leave_room` | `{ roomId }` | ออกจากห้อง |

| Event (Server → Client) | Payload | คำอธิบาย |
|---|---|---|
| `stats` | `{ onlineCount, matchesToday }` | สถิติตอน connect |
| `online_count` | `{ count }` | อัปเดต online ทุก 5 วินาที |
| `your_profile` | `{ codename }` | ชื่อนามแฝงของตัวเอง |
| `searching` | `{ queueSize }` | เข้าคิวสำเร็จ พร้อมจำนวนคนรออยู่ |
| `match_found` | `{ roomId, partnerCodename }` | เจอคู่แล้ว |
| `search_cancelled` | — | ยืนยันยกเลิก |
| `private_room_created` | `{ code, roomId }` | ได้รหัสห้องใหม่ |
| `private_room_joined` | `{ roomId }` | มีคนเข้าร่วมห้องแล้ว |
| `chat_message` | `{ text, senderCodename, ts }` | รับข้อความ |
| `typing` | `{ isTyping }` | สถานะพิมพ์ของคู่ |
| `partner_left` | — | คู่สนทนาออกจากห้องแล้ว |
| `error_message` | `{ message }` | error message |
