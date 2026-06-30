const cookie = require('cookie');
const { verifySessionToken } = require('./lineAuth');
const { getOrCreateProfile } = require('./anonymousProfile');
const matchmaking = require('./matchmaking');
const privateRoom = require('./privateRoom');

const VALID_GENDERS = new Set(['male', 'female', 'any']);

/** ดึง appUserId จาก session cookie ตอน handshake — ถ้าไม่ login ตัด connection ทิ้ง */
function authenticateSocket(socket, next) {
  const rawCookie = socket.handshake.headers.cookie || '';
  const parsed = cookie.parse(rawCookie);
  const token = parsed.session;

  if (!token) {
    return next(new Error('auth_required'));
  }

  try {
    const { appUserId } = verifySessionToken(token);
    socket.appUserId = appUserId;
    next();
  } catch (err) {
    next(new Error('auth_required'));
  }
}

function broadcastOnlineCount(io) {
  matchmaking.getOnlineCount().then((count) => {
    io.emit('online_count', { count });
  });
}

function registerChatSocket(io) {
  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    const profile = await getOrCreateProfile(socket.appUserId);
    socket.codename = profile.codename;
    socket.currentRoom = null;
    socket.inQueue = false;

    await matchmaking.markOnline(socket.id);
    broadcastOnlineCount(io);

    // ส่งสถิติจริงให้ตอน connect (สถิติสะสม ไม่ใช่ตัวเลขปั้น)
    const [onlineCount, matchesToday] = await Promise.all([
      matchmaking.getOnlineCount(),
      matchmaking.getMatchCountToday(),
    ]);
    socket.emit('stats', { onlineCount, matchesToday });
    socket.emit('your_profile', { codename: socket.codename });

    // ---------- สุ่มจับคู่ ----------
    socket.on('find_match', async ({ gender, want }) => {
      if (!VALID_GENDERS.has(gender) || !VALID_GENDERS.has(want)) {
        return socket.emit('error_message', { message: 'ข้อมูลตัวกรองไม่ถูกต้อง' });
      }
      if (socket.currentRoom) {
        return socket.emit('error_message', { message: 'คุณกำลังอยู่ในห้องแชทอยู่แล้ว' });
      }

      socket.inQueue = true;
      const partnerEntry = await matchmaking.findOrQueue({
        socketId: socket.id,
        appUserId: socket.appUserId,
        codename: socket.codename,
        gender,
        want,
      });

      if (!partnerEntry) {
        // ยังไม่เจอคู่ — บอกสถานะคิวตรงไปตรงมา (ไม่มีการสวมรอยด้วยบอท)
        const queueSize = await matchmaking.getQueueSize();
        return socket.emit('searching', { queueSize });
      }

      // เจอคู่แล้ว — สร้างห้องและจับทั้งสอง socket เข้าห้องเดียวกัน
      const partnerSocket = io.sockets.sockets.get(partnerEntry.socketId);
      if (!partnerSocket || !partnerSocket.connected) {
        // คู่ที่เจอหลุดการเชื่อมต่อไปพอดี — กลับไปเข้าคิวใหม่
        const queueSize = await matchmaking.getQueueSize();
        return socket.emit('searching', { queueSize });
      }

      const roomId = matchmaking.createRoomId();
      socket.join(roomId);
      partnerSocket.join(roomId);

      socket.currentRoom = roomId;
      partnerSocket.currentRoom = roomId;
      socket.inQueue = false;
      partnerSocket.inQueue = false;

      await matchmaking.incrementMatchCount();

      socket.emit('match_found', { roomId, partnerCodename: partnerSocket.codename });
      partnerSocket.emit('match_found', { roomId, partnerCodename: socket.codename });
    });

    socket.on('cancel_search', async () => {
      socket.inQueue = false;
      await matchmaking.leaveQueue(socket.id);
      socket.emit('search_cancelled');
    });

    // ---------- ห้องแชทลับด้วยรหัส 6 หลัก ----------
    socket.on('create_private_room', async () => {
      const { code, roomId } = await privateRoom.createPrivateRoom();
      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.emit('private_room_created', { code, roomId });
    });

    socket.on('join_private_room', async ({ code }) => {
      const roomId = await privateRoom.joinPrivateRoom(code);
      if (!roomId) {
        return socket.emit('error_message', { message: 'รหัสไม่ถูกต้อง หรือหมดอายุแล้ว' });
      }
      socket.join(roomId);
      socket.currentRoom = roomId;

      // แจ้งทุกคนในห้อง (ฝั่งที่สร้างห้องไว้ก่อน) ว่ามีคนเข้าร่วมแล้ว
      io.to(roomId).emit('private_room_joined', { roomId });
    });

    // ---------- แชทจริงระหว่างคู่ ----------
    socket.on('chat_message', ({ roomId, text }) => {
      if (!roomId || socket.currentRoom !== roomId || !text?.trim()) return;
      const safeText = String(text).slice(0, 2000); // กันข้อความยาวเกินไป
      socket.to(roomId).emit('chat_message', {
        text: safeText,
        senderCodename: socket.codename,
        ts: Date.now(),
      });
    });

    // สถานะ "กำลังพิมพ์" — ส่งต่อสถานะจริงของคู่สนทนาเท่านั้น ไม่มีการจำลองเพื่อหลอกว่าเป็นคนพิมพ์
    socket.on('typing', ({ roomId, isTyping }) => {
      if (!roomId || socket.currentRoom !== roomId) return;
      socket.to(roomId).emit('typing', { isTyping: Boolean(isTyping) });
    });

    socket.on('leave_room', ({ roomId }) => {
      if (!roomId || socket.currentRoom !== roomId) return;
      socket.to(roomId).emit('partner_left');
      socket.leave(roomId);
      socket.currentRoom = null;
    });

    socket.on('disconnect', async () => {
      await matchmaking.markOffline(socket.id);
      if (socket.inQueue) {
        await matchmaking.leaveQueue(socket.id);
      }
      if (socket.currentRoom) {
        socket.to(socket.currentRoom).emit('partner_left');
      }
      broadcastOnlineCount(io);
    });
  });

  // อัปเดตจำนวนคนออนไลน์เป็นระยะ (ของจริงล้วน ๆ จาก Redis SCARD)
  setInterval(() => broadcastOnlineCount(io), 5000);
}

module.exports = { registerChatSocket };
