/* ================================================
   SECRET CHAT — ห้องแชท (chat.js)
   ================================================ */

const roomId           = sessionStorage.getItem('roomId');
const partnerCodename  = sessionStorage.getItem('partnerCodename') || 'คู่สนทนา';
const myCodename       = sessionStorage.getItem('myCodename') || 'คุณ';

let socket = null;
let typingTimer = null;
let isTyping = false;
let partnerLeft = false;

// -------- Bootstrap --------
(function init() {
  if (!roomId) {
    window.location.href = '/';
    return;
  }

  document.getElementById('partnerName').textContent =
    partnerCodename || 'รอคู่สนทนา...';

  connectSocket();
  setupInput();
})();

// -------- Socket --------
function connectSocket() {
  socket = io({ transports: ['websocket'] });

  socket.on('connect', () => {
    addSystemMessage('🔒 เชื่อมต่อสำเร็จ การสนทนานี้เข้ารหัสและลบทิ้งเมื่อออกจากห้อง');
  });

  socket.on('online_count', ({ count }) => {
    document.getElementById('headerOnline').textContent =
      `${count.toLocaleString()} คนออนไลน์`;
  });

  socket.on('chat_message', ({ text, senderCodename, ts }) => {
    addMessage({ text, senderCodename, ts, mine: false });
    hideTyping();
  });

  socket.on('typing', ({ isTyping: partnerIsTyping }) => {
    if (partnerIsTyping) {
      showTyping();
    } else {
      hideTyping();
    }
  });

  socket.on('partner_left', () => {
    partnerLeft = true;
    addSystemMessage('😢 คู่สนทนาออกจากห้องแล้ว');
    showDisconnectedOverlay();
  });

  socket.on('disconnect', () => {
    if (!partnerLeft) {
      addSystemMessage('⚡️ การเชื่อมต่อขาดหายชั่วคราว...');
    }
  });
}

// -------- Messaging --------
function sendMessage() {
  const input = document.getElementById('msgInput');
  const text  = input.value.trim();
  if (!text || !socket || partnerLeft) return;

  socket.emit('chat_message', { roomId, text });

  addMessage({ text, senderCodename: myCodename, ts: Date.now(), mine: true });

  input.value = '';
  autoResize(input);
  clearTyping();
}

function addMessage({ text, senderCodename, ts, mine }) {
  const messages = document.getElementById('messages');
  const systemMsg = document.getElementById('systemMsg');

  const msgEl = document.createElement('div');
  msgEl.className = `msg ${mine ? 'mine' : 'theirs'}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  meta.textContent = `${senderCodename} · ${time}`;

  msgEl.appendChild(bubble);
  msgEl.appendChild(meta);
  messages.appendChild(msgEl);

  scrollToBottom();
}

function addSystemMessage(text) {
  const messages = document.getElementById('messages');
  const el = document.createElement('div');
  el.className = 'system-msg';
  el.textContent = text;
  messages.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  const wrap = document.getElementById('messagesWrap');
  wrap.scrollTop = wrap.scrollHeight;
}

// -------- Typing indicator --------
function setupInput() {
  const input = document.getElementById('msgInput');

  input.addEventListener('input', () => {
    autoResize(input);

    if (!isTyping) {
      isTyping = true;
      socket?.emit('typing', { roomId, isTyping: true });
    }

    clearTimeout(typingTimer);
    typingTimer = setTimeout(clearTyping, 1800);
  });

  input.addEventListener('keydown', (e) => {
    // Shift+Enter = ขึ้นบรรทัดใหม่, Enter เฉยๆ = ส่งข้อความ
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function clearTyping() {
  if (isTyping) {
    isTyping = false;
    socket?.emit('typing', { roomId, isTyping: false });
  }
  clearTimeout(typingTimer);
}

function showTyping() {
  document.getElementById('typingIndicator').classList.remove('hidden');
  document.getElementById('partnerName').style.opacity = '0.5';
}
function hideTyping() {
  document.getElementById('typingIndicator').classList.add('hidden');
  document.getElementById('partnerName').style.opacity = '1';
}

// -------- Auto-resize textarea --------
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

// -------- Leave room --------
function leaveRoom() {
  if (!partnerLeft && socket) {
    socket.emit('leave_room', { roomId });
  }
  sessionStorage.removeItem('roomId');
  sessionStorage.removeItem('partnerCodename');
  window.location.href = '/';
}

// -------- Disconnected overlay --------
function showDisconnectedOverlay() {
  document.getElementById('disconnectedOverlay').classList.remove('hidden');
  document.getElementById('inputBar').style.opacity = '0.4';
  document.getElementById('inputBar').style.pointerEvents = 'none';
}
