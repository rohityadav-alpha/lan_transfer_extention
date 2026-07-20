/**
 * LAN File Transfer — Popup Controller
 * Orchestrates the entire send/receive flow using:
 *  - ws-signaling-client.js for signaling
 *  - webrtc-handler.js for peer connections
 *  - file-chunker.js for streaming file data
 *  - code-generator.js for room codes
 */

// ═══════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════
const CONFIG = {
  // Cloud signaling server URL (wss:// for production)
  // Leave empty '' to use local mode (requires running local signaling server)
  SIGNALING_URL: 'wss://lan-transfer-extention.onrender.com',

  // ICE servers for NAT traversal (STUN discovers public IP, TURN relays when direct fails)
  ICE_SERVERS: [
    // STUN servers (free, discovers public IP)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    // TURN servers — Metered.ca
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: 'e8dd65c5d2bc1e5fc9cbf131',
      credential: '4/sYLzOBz++pAALg'
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65c5d2bc1e5fc9cbf131',
      credential: '4/sYLzOBz++pAALg'
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: 'e8dd65c5d2bc1e5fc9cbf131',
      credential: '4/sYLzOBz++pAALg'
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: 'e8dd65c5d2bc1e5fc9cbf131',
      credential: '4/sYLzOBz++pAALg'
    },
    // TURN fallback — OpenRelay (free public TURN)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};
const SIGNALING_PORT = 3000;
const CHUNK_SIZE = 64 * 1024; // 64 KB
const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * 34; // radius=34 from SVG

// ═══════════════════════════════════════════════════════
// Inline modules (Chrome extension can't use ES modules in popup)
// ═══════════════════════════════════════════════════════

// ─── Code Generator ────────────────────────────────────
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomCode() {
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARSET[arr[i] % CODE_CHARSET.length];
  return code;
}

// ─── File Chunker ──────────────────────────────────────
function readSlice(file, start, end) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file.slice(start, end));
  });
}

// ─── WebRTC Backpressure Constants ─────────────────────
const BUFFER_HIGH = 1 * 1024 * 1024;
const BUFFER_LOW = 256 * 1024;

// ═══════════════════════════════════════════════════════
// DOM References
// ═══════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);

const screens = {
  home: $('screen-home'),
  send: $('screen-send'),
  receive: $('screen-receive'),
};

// ═══════════════════════════════════════════════════════
// Screen Navigation
// ═══════════════════════════════════════════════════════
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

$('btn-go-send').onclick = () => showScreen('send');
$('btn-go-receive').onclick = () => showScreen('receive');
$('back-from-send').onclick = () => resetSendState();
$('back-from-receive').onclick = () => resetReceiveState();

// ═══════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSec / 1024 ** 2).toFixed(1) + ' MB/s';
}

function formatETA(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return Math.ceil(seconds) + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + Math.ceil(seconds % 60) + 's';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
}

function setProgressRing(ringEl, pct) {
  const offset = PROGRESS_RING_CIRCUMFERENCE * (1 - pct);
  ringEl.style.strokeDashoffset = offset;
}

function setConnDot(dotEl, state) {
  dotEl.classList.remove('connected', 'connecting');
  if (state === 'connected') dotEl.classList.add('connected');
  else if (state === 'connecting') dotEl.classList.add('connecting');
  dotEl.title = state.charAt(0).toUpperCase() + state.slice(1);
}

function showError(title, message, onRetry, onDismiss) {
  $('error-title').textContent = title;
  $('error-message').textContent = message;
  $('error-overlay').classList.remove('hidden');
  $('error-retry').onclick = () => {
    $('error-overlay').classList.add('hidden');
    if (onRetry) onRetry();
  };
  $('error-dismiss').onclick = () => {
    $('error-overlay').classList.add('hidden');
    if (onDismiss) onDismiss();
  };
}

// ═══════════════════════════════════════════════════════
// Speed / ETA Tracker
// ═══════════════════════════════════════════════════════
class TransferTracker {
  constructor() {
    this.startTime = Date.now();
    this.samples = []; // { time, bytes }
    this.totalBytes = 0;
    this.fileSize = 0;
  }

  reset(fileSize) {
    this.startTime = Date.now();
    this.samples = [];
    this.totalBytes = 0;
    this.fileSize = fileSize;
  }

  addBytes(count) {
    this.totalBytes += count;
    const now = Date.now();
    this.samples.push({ time: now, bytes: this.totalBytes });
    // Keep only last 5 seconds of samples
    const cutoff = now - 5000;
    this.samples = this.samples.filter((s) => s.time >= cutoff);
  }

  getSpeed() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.time - first.time) / 1000;
    if (dt <= 0) return 0;
    return (last.bytes - first.bytes) / dt;
  }

  getETA() {
    const speed = this.getSpeed();
    if (speed <= 0) return Infinity;
    return (this.fileSize - this.totalBytes) / speed;
  }

  getProgress() {
    if (this.fileSize <= 0) return 0;
    return this.totalBytes / this.fileSize;
  }
}

// ═══════════════════════════════════════════════════════
// ─── SEND SIDE ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════
let sendState = {
  file: null,
  text: '',
  ws: null,
  roomCode: null,
  peers: {}, // receiverId -> { pc, channel }
  tracker: new TransferTracker(),
  cancelled: false,
};

// ─── Helper: enable/disable Generate Room Code button ───
function updateSendButtonState() {
  const hasFile = !!sendState.file;
  const hasText = $('send-text-content').value.trim().length > 0;
  $('btn-create-room').disabled = !(hasFile || hasText);
}

// File selection
const dropZone = $('drop-zone');
const fileInput = $('file-input');

// On desktop, clicking the overlay input opens file picker directly.
// On mobile, tapping the overlay input opens file picker natively.
// No need for dropZone.onclick = () => fileInput.click() anymore.
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFileSelect(e.dataTransfer.files[0]); });
fileInput.onchange = () => handleFileSelect(fileInput.files[0]);

function handleFileSelect(file) {
  if (!file) return;
  sendState.file = file;
  $('file-name').textContent = file.name;
  $('file-size').textContent = formatSize(file.size);
  $('file-info').classList.remove('hidden');
  $('drop-label').textContent = file.name;
  updateSendButtonState();
}

$('file-remove').onclick = (e) => {
  e.stopPropagation();
  sendState.file = null;
  $('file-info').classList.add('hidden');
  $('drop-label').textContent = 'Tap or drag a file here';
  fileInput.value = '';
  updateSendButtonState();
};

// Text input handling
$('send-text-content').oninput = () => {
  const len = $('send-text-content').value.length;
  $('send-char-count').textContent = len === 1 ? '1 character' : `${len.toLocaleString()} characters`;
  updateSendButtonState();
};

// Create room (unified: file + text)
$('btn-create-room').onclick = async () => {
  const text = $('send-text-content').value.trim();
  sendState.text = text;
  if (!sendState.file && !sendState.text) return;

  const code = generateRoomCode();
  sendState.roomCode = code;
  sendState.cancelled = false;

  // Switch to waiting step
  $('send-step-file').classList.add('hidden');
  $('send-step-waiting').classList.remove('hidden');
  $('room-code').textContent = code;

  // Get local IP from signaling server (only in local mode)
  if (!CONFIG.SIGNALING_URL) {
    try {
      const res = await fetch(`http://localhost:${SIGNALING_PORT}/my-ip`);
      const data = await res.json();
      $('server-ip').textContent = data.ip;
    } catch {
      $('server-ip').textContent = 'Start signaling server first!';
      showError(
        'Server Not Running',
        'Please start the signaling server with "npm start" in the extension directory, then try again.',
        () => $('btn-create-room').click(),
        () => resetSendState()
      );
      return;
    }
  }

  // Build unified fileMeta
  const hasFile = !!sendState.file;
  const hasText = !!sendState.text;
  const fileMeta = { hasFile, hasText };
  if (hasFile) {
    fileMeta.name = sendState.file.name;
    fileMeta.size = sendState.file.size;
    fileMeta.totalChunks = Math.ceil(sendState.file.size / CHUNK_SIZE);
    fileMeta.mimeType = sendState.file.type || 'application/octet-stream';
  }
  if (hasText) {
    fileMeta.textLength = sendState.text.length;
  }

  // Connect to signaling server via WebSocket
  try {
    const wsUrl = CONFIG.SIGNALING_URL || `ws://localhost:${SIGNALING_PORT}`;
    const ws = new WebSocket(wsUrl);
    sendState.ws = ws;

    setConnDot($('send-conn-dot'), 'connecting');

    ws.onopen = () => {
      setConnDot($('send-conn-dot'), 'connected');
      // Create room
      ws.send(JSON.stringify({
        type: 'create-room',
        code,
        fileMeta,
      }));
    };

    ws.onmessage = (event) => handleSenderMessage(JSON.parse(event.data));

    ws.onerror = () => {
      setConnDot($('send-conn-dot'), 'disconnected');
    };

    ws.onclose = () => {
      setConnDot($('send-conn-dot'), 'disconnected');
    };
  } catch (e) {
    showError('Connection Failed', e.message, () => $('btn-create-room').click(), () => resetSendState());
  }
};

function handleSenderMessage(msg) {
  switch (msg.type) {
    case 'room-created':
      updateSendStatus('Waiting for receiver to connect...', 'info');
      break;

    case 'receiver-joined':
      updateSendStatus('Receiver connected! Setting up transfer...', 'info');
      initiatePeerConnection(msg.receiverId);
      break;

    case 'answer':
      handleReceiverAnswer(msg.receiverId, msg.sdp);
      break;

    case 'ice':
      handleSenderIce(msg.from, msg.candidate);
      break;

    case 'receiver-left':
      cleanupPeer(msg.receiverId);
      break;

    case 'error':
      showError('Signaling Error', msg.message, null, () => resetSendState());
      break;
  }
}

async function initiatePeerConnection(receiverId) {
  const iceConfig = CONFIG.SIGNALING_URL
    ? { iceServers: CONFIG.ICE_SERVERS, iceTransportPolicy: 'all' }
    : { iceServers: [] };
  const pc = new RTCPeerConnection(iceConfig);
  const channel = pc.createDataChannel('fileTransfer', { ordered: true });
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = BUFFER_LOW;

  sendState.peers[receiverId] = { pc, channel, iceRestartAttempted: false };

  pc.onicecandidate = (e) => {
    if (e.candidate && sendState.ws && sendState.ws.readyState === WebSocket.OPEN) {
      sendState.ws.send(JSON.stringify({
        type: 'ice',
        code: sendState.roomCode,
        from: 'sender',
        to: receiverId,
        candidate: e.candidate,
      }));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC Sender] Connection state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      const peer = sendState.peers[receiverId];
      if (peer && !peer.iceRestartAttempted) {
        // Try ICE restart once before giving up
        console.log('[WebRTC Sender] Attempting ICE restart...');
        peer.iceRestartAttempted = true;
        pc.restartIce();
      } else {
        showError('Connection Failed', 'WebRTC connection to receiver failed. Make sure both devices are on the same network or try again.', null, () => resetSendState());
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC Sender] ICE state:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'disconnected') {
      // Give it a few seconds to recover before treating as failure
      setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected') {
          console.log('[WebRTC Sender] ICE still disconnected, attempting restart...');
          pc.restartIce();
        }
      }, 3000);
    }
  };

  pc.onicegatheringstatechange = () => {
    console.log('[WebRTC Sender] ICE gathering:', pc.iceGatheringState);
  };

  channel.onopen = async () => {
    updateSendStatus('Connected! Sending...', 'success');

    // 1. Send text first if present
    if (sendState.text) {
      channel.send(JSON.stringify({ type: 'text-data', text: sendState.text }));
    }

    // 2. Send file if present (sendFileOverChannel sends 'done' internally)
    if (sendState.file) {
      await sendFileOverChannel(channel, receiverId);
    } else {
      // Text-only: send completion signal and show done UI
      channel.send(JSON.stringify({ type: 'done' }));
      $('send-step-waiting').classList.add('hidden');
      $('send-step-done').classList.remove('hidden');
      $('done-send-details').textContent =
        `${sendState.text.length.toLocaleString()} characters sent successfully.`;
      try {
        const runtime = (typeof browser !== 'undefined' ? browser : chrome).runtime;
        runtime.sendMessage({ type: 'transfer-complete', fileName: 'Text clipboard' });
      } catch (_) { }
    }
  };

  channel.onerror = (e) => {
    // Silently warn for standard teardowns, as WebRTC triggers errors on close events
    console.warn('DataChannel state event:', e);
  };

  // Create and send offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  sendState.ws.send(JSON.stringify({
    type: 'offer',
    code: sendState.roomCode,
    receiverId,
    sdp: { type: offer.type, sdp: offer.sdp },
  }));
}

async function handleReceiverAnswer(receiverId, sdp) {
  const peer = sendState.peers[receiverId];
  if (!peer) return;
  await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: sdp.sdp }));
  // Flush queued ICE candidates
  if (peer._iceQueue) {
    for (const c of peer._iceQueue) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn(e); }
    }
    peer._iceQueue = [];
  }
}

async function handleSenderIce(from, candidate) {
  // 'from' is the receiverId
  const peer = sendState.peers[from];
  if (!peer) return;
  if (peer.pc.remoteDescription) {
    try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn(e); }
  } else {
    if (!peer._iceQueue) peer._iceQueue = [];
    peer._iceQueue.push(candidate);
  }
}

async function sendFileOverChannel(channel, receiverId) {
  const file = sendState.file;
  if (!file) return;

  sendState.tracker.reset(file.size);
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // Show transfer UI
  $('send-transfer-info').classList.remove('hidden');

  // Send metadata
  channel.send(JSON.stringify({
    type: 'meta',
    name: file.name,
    size: file.size,
    totalChunks,
    mimeType: file.type || 'application/octet-stream',
  }));

  // Stream chunks with backpressure
  for (let i = 0; i < totalChunks; i++) {
    if (sendState.cancelled) {
      channel.send(JSON.stringify({ type: 'cancelled' }));
      return;
    }

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = await readSlice(file, start, end);

    // Backpressure: wait if buffer is full
    if (channel.bufferedAmount >= BUFFER_HIGH) {
      await new Promise((resolve) => {
        const onLow = () => {
          channel.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        channel.addEventListener('bufferedamountlow', onLow);
      });
    }

    channel.send(chunk);
    sendState.tracker.addBytes(chunk.byteLength);

    // Update UI
    const pct = (i + 1) / totalChunks;
    updateSendProgress(pct);
  }

  // Send completion signal
  channel.send(JSON.stringify({ type: 'done' }));

  // Show completion
  $('send-step-waiting').classList.add('hidden');
  $('send-step-done').classList.remove('hidden');
  $('done-send-details').textContent = `${file.name} (${formatSize(file.size)}) sent successfully.`;

  // Notify service worker
  try {
    chrome.runtime.sendMessage({ type: 'transfer-complete', fileName: file.name });
  } catch (_) { }
}

function updateSendProgress(pct) {
  const pctInt = Math.round(pct * 100);
  setProgressRing($('send-progress-ring'), pct);
  $('send-pct').textContent = pctInt + '%';
  $('send-speed').textContent = formatSpeed(sendState.tracker.getSpeed());
  $('send-eta').textContent = formatETA(sendState.tracker.getETA());
  $('send-sent').textContent = formatSize(sendState.tracker.totalBytes);
}

function updateSendStatus(msg, variant) {
  const el = $('send-status');
  el.className = `status-badge status-${variant}`;
  el.querySelector('span').textContent = msg;
}

function cleanupPeer(receiverId) {
  const peer = sendState.peers[receiverId];
  if (peer) {
    try { peer.channel.close(); } catch (_) { }
    try { peer.pc.close(); } catch (_) { }
    delete sendState.peers[receiverId];
  }
}

$('copy-code').onclick = () => {
  const code = $('room-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = $('copy-code');
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00C896" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }, 2000);
  });
};

$('btn-cancel-send').onclick = () => {
  sendState.cancelled = true;
  resetSendState();
};

$('btn-send-another').onclick = () => resetSendState();

function resetSendState() {
  // Close WebSocket
  if (sendState.ws) {
    try { sendState.ws.close(); } catch (_) { }
    sendState.ws = null;
  }
  // Close peer connections
  for (const id of Object.keys(sendState.peers)) {
    cleanupPeer(id);
  }
  sendState.file = null;
  sendState.text = '';
  sendState.roomCode = null;
  sendState.cancelled = false;

  // Reset UI
  $('send-step-file').classList.remove('hidden');
  $('send-step-waiting').classList.add('hidden');
  $('send-step-done').classList.add('hidden');
  $('send-transfer-info').classList.add('hidden');
  $('file-info').classList.add('hidden');
  $('drop-label').textContent = 'Tap or drag a file here';
  $('send-text-content').value = '';
  $('send-char-count').textContent = '0 characters';
  $('btn-create-room').disabled = true;
  fileInput.value = '';
  setConnDot($('send-conn-dot'), 'disconnected');
  setProgressRing($('send-progress-ring'), 0);
  $('send-pct').textContent = '0%';

  showScreen('home');
}

// ═══════════════════════════════════════════════════════
// ─── RECEIVE SIDE ──────────────────────────────────────
// ═══════════════════════════════════════════════════════
let recvState = {
  ws: null,
  pc: null,
  channel: null,
  receiverId: null,
  fileMeta: null,
  chunks: [],
  tracker: new TransferTracker(),
  cancelled: false,
};

$('btn-join-room').onclick = async () => {
  const code = $('code-input').value.trim().toUpperCase();
  const senderIp = $('sender-ip').value.trim();

  if (!CONFIG.SIGNALING_URL && !senderIp) {
    showError('Missing IP', 'Please enter the sender\'s IP address.', null, null);
    return;
  }
  if (!code || code.length < 4) {
    showError('Invalid Code', 'Please enter a valid room code (6 characters).', null, null);
    return;
  }

  recvState.cancelled = false;
  recvState.receiverId = 'recv_' + Math.random().toString(36).substr(2, 8);

  // Switch to transfer step
  $('recv-step-join').classList.add('hidden');
  $('recv-step-transfer').classList.remove('hidden');
  updateRecvStatus('Connecting to sender...', 'info');
  setConnDot($('recv-conn-dot'), 'connecting');

  try {
    const wsUrl = CONFIG.SIGNALING_URL || `ws://${senderIp}:${SIGNALING_PORT}`;
    const ws = new WebSocket(wsUrl);
    recvState.ws = ws;

    ws.onopen = () => {
      setConnDot($('recv-conn-dot'), 'connected');
      ws.send(JSON.stringify({
        type: 'join-room',
        code,
        receiverId: recvState.receiverId,
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleReceiverMessage(msg, code, senderIp);
    };

    ws.onerror = () => {
      setConnDot($('recv-conn-dot'), 'disconnected');
      const errorMsg = CONFIG.SIGNALING_URL
        ? 'Could not connect to cloud signaling server. Check your internet.'
        : `Could not connect to ${senderIp}:${SIGNALING_PORT}. Make sure the signaling server is running.`;
      showError(
        'Connection Failed',
        errorMsg,
        () => $('btn-join-room').click(),
        () => resetReceiveState()
      );
    };

    ws.onclose = () => {
      setConnDot($('recv-conn-dot'), 'disconnected');
    };
  } catch (e) {
    showError('Connection Error', e.message, () => $('btn-join-room').click(), () => resetReceiveState());
  }
};

function handleReceiverMessage(msg, code, senderIp) {
  switch (msg.type) {
    case 'room-joined': {
      // Store fileMeta for type detection later
      recvState.fileMeta = msg.fileMeta || null;
      const meta = recvState.fileMeta;
      if (meta && meta.hasFile) {
        updateRecvStatus('Joined room. Waiting for file transfer...', 'info');
        $('recv-file-info').classList.remove('hidden');
        $('recv-file-name').textContent = meta.name || 'File';
        $('recv-file-size').textContent = formatSize(meta.size || 0);
      } else if (meta && meta.hasText) {
        updateRecvStatus('Joined room. Waiting for text...', 'info');
        $('recv-file-info').classList.add('hidden');
      } else {
        updateRecvStatus('Joined room. Waiting for transfer...', 'info');
      }
      break;
    }

    case 'offer':
      handleOffer(msg.sdp, code);
      break;

    case 'ice':
      handleReceiverIceCandidate(msg.candidate);
      break;

    case 'room-closed':
      showError('Room Closed', 'The sender has closed the room.', null, () => resetReceiveState());
      break;

    case 'error':
      showError('Error', msg.message, null, () => resetReceiveState());
      break;
  }
}

async function handleOffer(sdp, code) {
  const iceConfig = CONFIG.SIGNALING_URL
    ? { iceServers: CONFIG.ICE_SERVERS, iceTransportPolicy: 'all' }
    : { iceServers: [] };
  const pc = new RTCPeerConnection(iceConfig);
  recvState.pc = pc;
  recvState._iceQueue = [];
  recvState._iceRestartAttempted = false;

  pc.onicecandidate = (e) => {
    if (e.candidate && recvState.ws && recvState.ws.readyState === WebSocket.OPEN) {
      recvState.ws.send(JSON.stringify({
        type: 'ice',
        code,
        from: recvState.receiverId,
        to: 'sender',
        candidate: e.candidate,
      }));
    }
  };

  pc.ondatachannel = (e) => {
    recvState.channel = e.channel;
    e.channel.binaryType = 'arraybuffer';
    e.channel.onmessage = handleDataMessage;
    e.channel.onopen = () => {
      updateRecvStatus('Connected! Waiting for file data...', 'success');
    };
    e.channel.onerror = (err) => {
      // Silently warn for standard teardowns, as WebRTC triggers errors on close events
      console.warn('DataChannel state event:', err);
    };
  };

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', pc.connectionState);
    if (pc.connectionState === 'failed') {
      if (!recvState._iceRestartAttempted) {
        console.log('[WebRTC Receiver] Attempting ICE restart...');
        recvState._iceRestartAttempted = true;
        pc.restartIce();
      } else {
        showError('Connection Failed', 'WebRTC connection failed. Make sure both devices are on the same network or try again.', null, () => resetReceiveState());
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'disconnected') {
      setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected') {
          console.log('[WebRTC Receiver] ICE still disconnected, attempting restart...');
          pc.restartIce();
        }
      }, 3000);
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription({ type: sdp.type, sdp: sdp.sdp }));

  // Flush queued ICE candidates
  if (recvState._iceQueue) {
    for (const c of recvState._iceQueue) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn(e); }
    }
    recvState._iceQueue = [];
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  recvState.ws.send(JSON.stringify({
    type: 'answer',
    code,
    receiverId: recvState.receiverId,
    sdp: { type: answer.type, sdp: answer.sdp },
  }));
}

async function handleReceiverIceCandidate(candidate) {
  if (recvState.pc && recvState.pc.remoteDescription) {
    try { await recvState.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn(e); }
  } else {
    if (!recvState._iceQueue) recvState._iceQueue = [];
    recvState._iceQueue.push(candidate);
  }
}

function handleDataMessage(event) {
  if (typeof event.data === 'string') {
    const msg = JSON.parse(event.data);
    if (msg.type === 'text-data') {
      // Save received text — will display on done screen
      recvState.receivedText = msg.text;
    } else if (msg.type === 'meta') {
      recvState.fileMeta = msg;
      recvState.chunks = [];
      recvState.tracker.reset(msg.size);

      // Show file info
      $('recv-file-info').classList.remove('hidden');
      $('recv-file-name').textContent = msg.name;
      $('recv-file-size').textContent = formatSize(msg.size);
      $('recv-transfer-info').classList.remove('hidden');

      updateRecvStatus(`Receiving: ${msg.name}`, 'success');
    } else if (msg.type === 'done') {
      finishReceive();
    } else if (msg.type === 'cancelled') {
      showError('Transfer Cancelled', 'The sender cancelled the transfer.', null, () => resetReceiveState());
    }
  } else {
    // Binary data — file chunk
    recvState.chunks.push(event.data);
    recvState.tracker.addBytes(event.data.byteLength);
    updateRecvProgress();
  }
}

// ─── Finish receiving: handle file and/or text ─────────────────────
function finishReceive() {
  const hasFile = recvState.chunks && recvState.chunks.length > 0;
  const hasText = !!recvState.receivedText;

  $('recv-step-transfer').classList.add('hidden');
  $('recv-step-done').classList.remove('hidden');

  if (hasFile) {
    assembleAndDownload();
  }
  if (hasText) {
    $('recv-done-text').classList.remove('hidden');
    $('recv-text-content').textContent = recvState.receivedText;
  }
  if (!hasFile && !hasText) {
    // Fallback: show generic done
    $('recv-done-file').classList.remove('hidden');
    $('done-recv-details').textContent = 'Transfer complete.';
  }

  // Notify service worker
  try {
    const runtime = (typeof browser !== 'undefined' ? browser : chrome).runtime;
    runtime.sendMessage({
      type: 'transfer-complete',
      fileName: hasFile ? (recvState.fileMeta?.name || 'file') : 'Text clipboard',
    });
  } catch (_) { }
}

function updateRecvProgress() {
  const pct = recvState.tracker.getProgress();
  const pctInt = Math.round(pct * 100);
  setProgressRing($('recv-progress-ring'), pct);
  $('recv-pct').textContent = pctInt + '%';
  $('recv-speed').textContent = formatSpeed(recvState.tracker.getSpeed());
  $('recv-eta').textContent = formatETA(recvState.tracker.getETA());
  $('recv-received').textContent = formatSize(recvState.tracker.totalBytes);
}

function assembleAndDownload() {
  const blob = new Blob(recvState.chunks);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = recvState.fileMeta ? recvState.fileMeta.name : 'download.bin';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  // Show file done card
  $('recv-done-file').classList.remove('hidden');
  const meta = recvState.fileMeta;
  $('done-recv-details').textContent = `${meta ? meta.name : 'File'} (${meta ? formatSize(meta.size) : '—'}) downloaded successfully.`;
}

function updateRecvStatus(msg, variant) {
  const el = $('recv-status');
  el.className = `status-badge status-${variant}`;
  el.querySelector('span').textContent = msg;
}

$('btn-cancel-recv').onclick = () => {
  recvState.cancelled = true;
  resetReceiveState();
};

$('btn-receive-another').onclick = () => resetReceiveState();

// Copy received text to clipboard
$('btn-copy-text').onclick = () => {
  const text = recvState.receivedText || $('recv-text-content').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = $('btn-copy-text');
    const originalText = btn.querySelector('span') ? btn.querySelector('span').textContent : btn.textContent;
    // Show "Copied!" feedback safely without innerHTML
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy to Clipboard';
      btn.classList.remove('copied');
    }, 2000);
  });
};


function resetReceiveState() {
  if (recvState.ws) {
    try { recvState.ws.close(); } catch (_) { }
    recvState.ws = null;
  }
  if (recvState.channel) {
    try { recvState.channel.close(); } catch (_) { }
    recvState.channel = null;
  }
  if (recvState.pc) {
    try { recvState.pc.close(); } catch (_) { }
    recvState.pc = null;
  }
  recvState.fileMeta = null;
  recvState.chunks = [];
  recvState.cancelled = false;
  recvState._iceQueue = [];
  recvState.receivedText = null;

  // Reset UI
  $('recv-step-join').classList.remove('hidden');
  $('recv-step-transfer').classList.add('hidden');
  $('recv-step-done').classList.add('hidden');
  $('recv-done-file').classList.add('hidden');
  $('recv-done-text').classList.add('hidden');
  $('recv-transfer-info').classList.add('hidden');
  $('recv-file-info').classList.add('hidden');
  setConnDot($('recv-conn-dot'), 'disconnected');
  setProgressRing($('recv-progress-ring'), 0);
  $('recv-pct').textContent = '0%';

  showScreen('home');
}

// ═══════════════════════════════════════════════════════
// Cloud Mode: Hide IP fields when cloud signaling is active
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  if (CONFIG.SIGNALING_URL) {
    // Hide IP card on sender screen
    const ipCard = document.querySelector('.ip-card');
    if (ipCard) ipCard.classList.add('hidden');

    // Hide Sender IP input group on receiver screen
    const ipInput = $('sender-ip');
    if (ipInput) {
      const group = ipInput.closest('.input-group');
      if (group) group.classList.add('hidden');
    }
  }
});
// Auto-uppercase room code input
$('code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
