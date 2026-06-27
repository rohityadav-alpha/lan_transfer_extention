const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

// ─── Configuration ──────────────────────────────────────
const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RECEIVERS_PER_ROOM = 5;
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// ─── HTTP Server (health + IP discovery) ────────────────
const app = express();
app.use(express.json());

// CORS middleware for HTTP endpoints
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: Object.keys(rooms).length,
    uptime: process.uptime(),
  });
});

app.get('/my-ip', (req, res) => {
  res.json({ ip: getLocalIp() });
});

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

// ─── Room Management ────────────────────────────────────
const rooms = {};

/**
 * Room structure:
 * {
 *   code: string,
 *   sender: WebSocket | null,
 *   receivers: Map<receiverId, WebSocket>,
 *   createdAt: number,
 *   lastActivity: number,
 *   fileMeta: object | null,
 * }
 */

function createRoom(code, senderWs) {
  const now = Date.now();
  rooms[code] = {
    code,
    sender: senderWs,
    receivers: new Map(),
    createdAt: now,
    lastActivity: now,
    fileMeta: null,
  };
  return rooms[code];
}

function getRoom(code) {
  const room = rooms[code];
  if (room) room.lastActivity = Date.now();
  return room || null;
}

function destroyRoom(code) {
  const room = rooms[code];
  if (!room) return;
  // Close all receiver connections
  for (const [, ws] of room.receivers) {
    sendWs(ws, { type: 'room-closed', code });
    ws.close(1000, 'Room closed');
  }
  delete rooms[code];
  console.log(`🗑  Room ${code} destroyed`);
}

// Periodic cleanup of expired rooms
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    if (now - rooms[code].lastActivity > ROOM_TTL_MS) {
      console.log(`⏰ Room ${code} expired (TTL)`);
      destroyRoom(code);
    }
  }
}, CLEANUP_INTERVAL_MS);

// ─── WebSocket Server ───────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function sendWs(ws, data) {
  if (ws && ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  let clientRole = null;   // 'sender' | 'receiver'
  let clientRoom = null;   // room code
  let clientId = null;     // receiver ID (only for receivers)

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendWs(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const { type } = msg;

    switch (type) {
      // ── Sender creates a room ───────────────────
      case 'create-room': {
        const { code, fileMeta } = msg;
        if (!code || typeof code !== 'string') {
          sendWs(ws, { type: 'error', message: 'Missing room code' });
          return;
        }
        if (rooms[code]) {
          sendWs(ws, { type: 'error', message: 'Room code already in use' });
          return;
        }
        const room = createRoom(code, ws);
        room.fileMeta = fileMeta || null;
        clientRole = 'sender';
        clientRoom = code;
        sendWs(ws, { type: 'room-created', code });
        console.log(`📦 Room ${code} created by sender`);
        break;
      }

      // ── Receiver joins a room ───────────────────
      case 'join-room': {
        const { code, receiverId } = msg;
        const room = getRoom(code);
        if (!room) {
          sendWs(ws, { type: 'error', message: 'Room not found' });
          return;
        }
        if (room.receivers.size >= MAX_RECEIVERS_PER_ROOM) {
          sendWs(ws, { type: 'error', message: 'Room is full' });
          return;
        }
        room.receivers.set(receiverId, ws);
        clientRole = 'receiver';
        clientRoom = code;
        clientId = receiverId;

        // Notify the sender
        sendWs(room.sender, {
          type: 'receiver-joined',
          receiverId,
        });

        // Send file metadata to receiver
        sendWs(ws, {
          type: 'room-joined',
          code,
          fileMeta: room.fileMeta,
        });
        console.log(`🔗 Receiver ${receiverId} joined room ${code}`);
        break;
      }

      // ── SDP Offer (sender → server → receiver) ──
      case 'offer': {
        const { code, receiverId, sdp } = msg;
        const room = getRoom(code);
        if (!room) return;
        const receiverWs = room.receivers.get(receiverId);
        sendWs(receiverWs, { type: 'offer', sdp });
        break;
      }

      // ── SDP Answer (receiver → server → sender) ─
      case 'answer': {
        const { code, receiverId, sdp } = msg;
        const room = getRoom(code);
        if (!room) return;
        sendWs(room.sender, { type: 'answer', receiverId, sdp });
        break;
      }

      // ── ICE candidate relay ─────────────────────
      case 'ice': {
        const { code, from, to, candidate } = msg;
        const room = getRoom(code);
        if (!room) return;

        if (to === 'sender') {
          // Receiver → Sender
          sendWs(room.sender, { type: 'ice', from, candidate });
        } else {
          // Sender → Receiver
          const receiverWs = room.receivers.get(to);
          sendWs(receiverWs, { type: 'ice', from: 'sender', candidate });
        }
        break;
      }

      default:
        sendWs(ws, { type: 'error', message: `Unknown message type: ${type}` });
    }
  });

  ws.on('close', () => {
    if (!clientRoom) return;
    const room = rooms[clientRoom];
    if (!room) return;

    if (clientRole === 'sender') {
      console.log(`📤 Sender disconnected from room ${clientRoom}`);
      destroyRoom(clientRoom);
    } else if (clientRole === 'receiver' && clientId) {
      room.receivers.delete(clientId);
      sendWs(room.sender, {
        type: 'receiver-left',
        receiverId: clientId,
      });
      console.log(`📥 Receiver ${clientId} left room ${clientRoom}`);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

// ─── Start Server ───────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║     LAN File Transfer — Signaling Server   ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  Local:    http://localhost:${PORT}            ║`);
  console.log(`║  Network:  http://${ip}:${PORT}       ║`);
  console.log('║                                            ║');
  console.log('║  Share the Network IP with receivers.      ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
});

// ─── Graceful Shutdown ──────────────────────────────────
function shutdown() {
  console.log('\n🛑 Shutting down...');
  for (const code of Object.keys(rooms)) {
    destroyRoom(code);
  }
  wss.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
  // Force exit after 3 seconds
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
