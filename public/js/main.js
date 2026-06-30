/* ================================================
   SECRET CHAT — หน้าหลัก (main.js)
   ================================================ */

let socket = null;
let isLoggedIn = false;
let gender = 'male';      // เพศตัวเอง (ค่า default)
let want   = 'any';       // อยากคุยกับเพศไหน
let state  = 'idle';      // idle | searching | in_room

// -------- Bootstrap --------
(async function init() {
  const res = await fetch('/api/me');
  const data = await res.json();
  isLoggedIn = data.loggedIn;

  if (!isLoggedIn) {
    document.getElementById('loginOverlay').classList.remove('hidden');
    return;
  }

  connectSocket();
  setupSegmentControls('genderSelf', (val) => { gender = val; });
  setupSegmentControls('genderWant', (val) => { want = val; });
})();

// -------- Socket --------
function connectSocket() {
  socket = io({ transports: ['websocket'] });

  socket.on('connect', () => console.log('[socket] connected:', socket.id));
  socket.on('disconnect', () => console.log('[socket] disconnected'));

  socket.on('stats', ({ onlineCount, matchesToday }) => {
    document.getElementById('onlineCount').textContent =
      `${onlineCount.toLocaleString()} คนออนไลน์`;
    document.getElementById('matchesToday').textContent =
      `แมตช์สำเร็จวันนี้แล้ว ${matchesToday.toLocaleString()} คู่`;
  });

  socket.on('online_count', ({ count }) => {
    document.getElementById('onlineCount').textContent =
      `${count.toLocaleString()} คนออนไลน์`;
  });

  socket.on('your_profile', ({ codename }) => {
    sessionStorage.setItem('myCodename', codename);
    const el = document.getElementById('nicknameDisplay');
    if (el) el.textContent = codename;
  });

  // ---- Matchmaking events ----
  socket.on('searching', ({ queueSize }) => {
    state = 'searching';
    showSearchingState(queueSize);
  });

  socket.on('search_cancelled', () => {
    state = 'idle';
    showIdleState();
  });

  socket.on('match_found', ({ roomId, partnerCodename }) => {
    state = 'in_room';
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('partnerCodename', partnerCodename);
    window.location.href = '/chat.html';
  });

  // ---- Private room events ----
  socket.on('private_room_created', ({ code, roomId }) => {
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('partnerCodename', '');
    showToast(`รหัสห้องของคุณคือ: ${code} — รอคู่สนทนามาเข้าร่วม`, 6000);
    // อยู่หน้าเดิมก่อน รอ event 'private_room_joined' ค่อย redirect
  });

  socket.on('private_room_joined', ({ roomId }) => {
    sessionStorage.setItem('roomId', roomId);
    window.location.href = '/chat.html';
  });

  socket.on('error_message', ({ message }) => {
    showToast(message);
  });
}

// -------- Actions --------
function handleMainButton() {
  if (!isLoggedIn) {
    document.getElementById('loginOverlay').classList.remove('hidden');
    return;
  }
  if (state === 'idle') {
    startSearch();
  }
}

function startSearch() {
  if (!socket) return;
  state = 'searching';
  showSearchingState(null);
  socket.emit('find_match', { gender, want });
}

function cancelSearch() {
  if (!socket) return;
  socket.emit('cancel_search');
}

function createPrivateRoom() {
  if (!socket) return;
  socket.emit('create_private_room');
}

function joinPrivateRoom() {
  const code = document.getElementById('codeInput').value.trim();
  if (code.length !== 6 || !/^\d{6}$/.test(code)) {
    showToast('กรุณากรอกรหัส 6 หลักให้ครบ');
    return;
  }
  if (!socket) return;
  socket.emit('join_private_room', { code });
}

// -------- UI State helpers --------
function showIdleState() {
  document.getElementById('matchingStatusText').textContent = 'พร้อมจับคู่';
  document.getElementById('queueText').classList.add('hidden');
  document.getElementById('cancelBtn').classList.add('hidden');
  document.getElementById('filtersBlock').classList.remove('hidden');
  document.getElementById('ctaBtn').disabled = false;
  document.getElementById('ctaLabel').textContent = 'หาเพื่อนใหม่';
}

function showSearchingState(queueSize) {
  document.getElementById('matchingStatusText').textContent = 'กำลังจับคู่';
  document.getElementById('filtersBlock').classList.add('hidden');
  document.getElementById('ctaBtn').disabled = true;
  document.getElementById('ctaLabel').textContent = 'กำลังค้นหา...';

  const queueEl = document.getElementById('queueText');
  queueEl.classList.remove('hidden');
  document.getElementById('cancelBtn').classList.remove('hidden');

  if (queueSize !== null) {
    queueEl.textContent = `มีคนรออยู่ในคิว ${queueSize} คน — รอสักครู่`;
  } else {
    queueEl.textContent = 'กำลังค้นหาคู่สนทนา...';
  }
}

// -------- Segment Control --------
function setupSegmentControls(groupId, onChange) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.seg').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.val);
    });
  });
}

// -------- Toast --------
function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  void el.offsetWidth; // reflow ให้ transition ทำงาน
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, duration);
}
