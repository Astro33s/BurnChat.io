// ============================================================
//  BurnChat v2.5.5 — ephemeral, zero-log chat rooms
//  No database. No logs. No traces. Messages live in RAM only.
//  Compatible with Node 12+
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ── Config ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const ROOM_ID_LENGTH = 8;
const MAX_MESSAGES = 100;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_IMAGE_SIZE = 500000;   // 500KB max base64 image (after client compression)
const MAX_USERNAME_LENGTH = 24;
const MAX_USERS_PER_ROOM = 50;
const CLEANUP_DELAY_MS = 30000;
const ROOM_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_BURST = 10;
const RATE_LIMIT_REFILL = 5;
const ADMIN_PASSWORD = process.env.ADMIN_PASS || 'changeme123';

// ── Room ID generator (URL-safe, no ambiguous chars) ─────────
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function generateRoomId() {
  const bytes = crypto.randomBytes(ROOM_ID_LENGTH);
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return id;
}

// ── Zero-logging Express ─────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

const httpServer = http.createServer(app);

// ── Socket.IO ────────────────────────────────────────────────
const io = new Server(httpServer, {
  maxHttpBufferSize: 600000,
  pingInterval: 10000,
  pingTimeout: 5000,
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
});

// ── In-memory state ──────────────────────────────────────────
const rooms = new Map();

// ── Stats (aggregate only, no PII, persisted to file) ────────
var STATS_FILE = path.join(__dirname, '.burnchat-stats.json');

var defaultStats = {
  startedAt: Date.now(),
  roomsCreated: 0,
  roomsBurned: 0,
  roomsExpired: 0,
  roomsAutoburned: 0,
  roomsCleaned: 0,
  totalMessages: 0,
  totalImages: 0,
  totalConnections: 0,
  totalDisconnections: 0,
  passwordsSet: 0,
  peakActiveRooms: 0,
  peakActiveUsers: 0,
  burnCount: 0,
};

// Load saved stats or start fresh
var stats;
try {
  var saved = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  stats = {};
  Object.keys(defaultStats).forEach(function(k) {
    stats[k] = (typeof saved[k] === 'number') ? saved[k] : defaultStats[k];
  });
  // Keep original startedAt if it exists
  stats.startedAt = saved.startedAt || defaultStats.startedAt;
} catch(e) {
  stats = Object.assign({}, defaultStats);
}

function saveStats() {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats)); } catch(e) {}
}

// Save stats every 30 seconds and on exit
setInterval(saveStats, 30000);
process.on('SIGTERM', function() { saveStats(); process.exit(0); });
process.on('SIGINT', function() { saveStats(); process.exit(0); });

let burnCount = stats.burnCount || 0;

// ── Rate limiter (token bucket per socket) ───────────────────
class RateLimiter {
  constructor(max, rate) {
    this.tokens = max || RATE_LIMIT_BURST;
    this.max = max || RATE_LIMIT_BURST;
    this.rate = rate || RATE_LIMIT_REFILL;
    this.lastRefill = Date.now();
  }
  consume() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.max, this.tokens + elapsed * this.rate);
    this.lastRefill = now;
    if (this.tokens >= 1) { this.tokens--; return true; }
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createRoom(id, password) {
  const room = {
    id: id,
    users: new Map(),
    messages: [],
    password: password || null,
    autoBurn: false,
    createdAt: Date.now(),
    cleanupTimer: null,
    expiryTimer: null,
  };
  room.expiryTimer = setTimeout(function() { burnRoom(id, 'expired'); }, ROOM_MAX_AGE_MS);
  rooms.set(id, room);
  stats.roomsCreated++;
  if (rooms.size > stats.peakActiveRooms) stats.peakActiveRooms = rooms.size;
  return room;
}

function burnRoom(roomId, reason) {
  const room = rooms.get(roomId);
  if (!room) return;

  burnCount++;
  stats.burnCount = burnCount;
  if (reason === 'expired') stats.roomsExpired++;
  else if (reason === 'auto-burned') { stats.roomsAutoburned++; stats.roomsBurned++; }
  else stats.roomsBurned++;
  io.to(roomId).emit('room-burned', { reason: reason || 'burned', burnCount: burnCount });

  // Force-disconnect all sockets — handle both Socket.IO v4 and v2 APIs
  const adapterRoom = io.sockets.adapter.rooms.get
    ? io.sockets.adapter.rooms.get(roomId)
    : io.sockets.adapter.rooms[roomId];

  if (adapterRoom) {
    const sids = adapterRoom.sockets
      ? Object.keys(adapterRoom.sockets)
      : Array.from(adapterRoom);

    sids.forEach(function(sid) {
      const s = io.sockets.sockets.get
        ? io.sockets.sockets.get(sid)
        : io.sockets.sockets[sid];
      if (s) {
        s.leave(roomId);
        s.disconnect(true);
      }
    });
  }

  clearTimeout(room.cleanupTimer);
  clearTimeout(room.expiryTimer);
  room.messages.length = 0;
  room.users.clear();
  rooms.delete(roomId);
}

function scheduleCleanup(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(function() {
    if (room.users.size === 0) {
      clearTimeout(room.expiryTimer);
      room.messages.length = 0;
      rooms.delete(roomId);
      stats.roomsCleaned++;
    }
  }, CLEANUP_DELAY_MS);
}

function cancelCleanup(roomId) {
  const room = rooms.get(roomId);
  if (room && room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
}

// ── Routes ───────────────────────────────────────────────────
var ROOM_NAME_REGEX = /^[a-z0-9\-]{2,32}$/;
var RESERVED_PATHS = ['new', 'blog', 'admin-burnchat', 'socket.io'];

app.get('/new', function(req, res) {
  var customName = (req.query.name || '').trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
  if (customName && ROOM_NAME_REGEX.test(customName) && RESERVED_PATHS.indexOf(customName) === -1) {
    // Check if name is already taken
    if (rooms.has(customName)) {
      return res.redirect('/?taken=' + encodeURIComponent(customName));
    }
    res.redirect('/' + customName);
  } else {
    res.redirect('/' + generateRoomId());
  }
});

// Room page — matches any valid room name that isn't a reserved path
app.get('/:roomId', function(req, res, next) {
  var roomId = req.params.roomId.toLowerCase();
  if (RESERVED_PATHS.indexOf(roomId) !== -1) return next();
  if (!ROOM_NAME_REGEX.test(roomId)) return res.status(404).send('Invalid room');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// Admin panel
app.get('/admin-burnchat', function(_req, res) {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Public burn count (no auth needed, just a number)
app.get('/api/burn-count', function(_req, res) {
  res.json({ burnCount: burnCount });
});

app.get('/admin-burnchat/api/stats', function(req, res) {
  var pw = req.query.pw || '';
  if (pw !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'wrong password' });
  }

  // Count active users across all rooms
  var activeUsers = 0;
  rooms.forEach(function(r) { activeUsers += r.users.size; });

  res.json({
    uptime: Date.now() - stats.startedAt,
    activeRooms: rooms.size,
    activeUsers: activeUsers,
    roomsCreated: stats.roomsCreated,
    roomsBurned: stats.roomsBurned,
    roomsExpired: stats.roomsExpired,
    roomsAutoburned: stats.roomsAutoburned,
    roomsCleaned: stats.roomsCleaned,
    totalMessages: stats.totalMessages,
    totalImages: stats.totalImages,
    totalConnections: stats.totalConnections,
    totalDisconnections: stats.totalDisconnections,
    passwordsSet: stats.passwordsSet,
    peakActiveRooms: stats.peakActiveRooms,
    peakActiveUsers: stats.peakActiveUsers,
  });
});

app.post('/admin-burnchat/api/reset', function(req, res) {
  var pw = req.query.pw || '';
  if (pw !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'wrong password' });
  }
  Object.keys(defaultStats).forEach(function(k) { stats[k] = defaultStats[k]; });
  stats.startedAt = Date.now();
  burnCount = 0;
  saveStats();
  res.json({ ok: true });
});

// Blog routes
app.get('/blog', function(_req, res) {
  res.sendFile(path.join(__dirname, 'public', 'blog', 'index.html'));
});

app.get('/blog/', function(_req, res) {
  res.sendFile(path.join(__dirname, 'public', 'blog', 'index.html'));
});

app.get('/blog/:slug', function(req, res) {
  const slug = req.params.slug.replace(/[^a-z0-9\-]/g, '');
  const filePath = path.join(__dirname, 'public', 'blog', slug + '.html');
  res.sendFile(filePath, function(err) {
    if (err) res.status(404).send('Post not found');
  });
});

// ── Socket.IO events ─────────────────────────────────────────
const rateLimiters = new Map();

io.on('connection', function(socket) {
  let currentRoomId = null;
  rateLimiters.set(socket.id, new RateLimiter());
  stats.totalConnections++;

  socket.on('join-room', function(data) {
    const roomId = data.roomId;
    const username = data.username;
    const password = data.password || '';

    if (typeof roomId !== 'string' || !/^[a-z0-9\-]{2,32}$/.test(roomId)) return;
    if (typeof username !== 'string') return;

    const safeName = escapeHtml(username.trim().slice(0, MAX_USERNAME_LENGTH)) || 'anon';

    let room = rooms.get(roomId);
    if (!room) room = createRoom(roomId);

    // Password check
    if (room.password && room.password !== password) {
      socket.emit('password-required', { roomId: roomId });
      return;
    }

    if (room.users.size >= MAX_USERS_PER_ROOM) {
      socket.emit('error-msg', { message: 'Room is full' });
      return;
    }

    cancelCleanup(roomId);

    currentRoomId = roomId;
    socket.join(roomId);
    room.users.set(socket.id, { name: safeName });

    // Track peak active users
    var totalUsers = 0;
    rooms.forEach(function(r) { totalUsers += r.users.size; });
    if (totalUsers > stats.peakActiveUsers) stats.peakActiveUsers = totalUsers;

    socket.emit('room-joined', {
      roomId: roomId,
      username: safeName,
      messages: room.messages,
      users: Array.from(room.users.values()).map(function(u) { return u.name; }),
      userCount: room.users.size,
      hasPassword: !!room.password,
      autoBurn: room.autoBurn,
      burnCount: burnCount,
    });

    socket.to(roomId).emit('user-joined', {
      username: safeName,
      userCount: room.users.size,
    });
  });

  // Set or change room password
  socket.on('set-password', function(data) {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    var pw = (data.password || '').trim();
    if (typeof pw !== 'string' || pw.length > 64) return;

    var user = room.users.get(socket.id);
    if (!user) return;

    if (pw.length === 0) {
      room.password = null;
      io.to(currentRoomId).emit('password-changed', {
        username: user.name,
        action: 'removed',
      });
    } else {
      room.password = pw;
      stats.passwordsSet++;
      io.to(currentRoomId).emit('password-changed', {
        username: user.name,
        action: 'set',
      });
    }
  });

  // Toggle auto-burn (burn room when last user leaves)
  socket.on('set-autoburn', function(data) {
    if (!currentRoomId) return;
    var room = rooms.get(currentRoomId);
    if (!room) return;

    var user = room.users.get(socket.id);
    if (!user) return;

    room.autoBurn = !!data.enabled;
    io.to(currentRoomId).emit('autoburn-changed', {
      username: user.name,
      enabled: room.autoBurn,
    });
  });

  socket.on('chat-message', function(data) {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const limiter = rateLimiters.get(socket.id);
    if (!limiter || !limiter.consume()) {
      socket.emit('error-msg', { message: 'Slow down!' });
      return;
    }

    const message = data.message;
    if (typeof message !== 'string' || message.trim().length === 0) return;
    const safeMessage = escapeHtml(message.trim().slice(0, MAX_MESSAGE_LENGTH));
    const user = room.users.get(socket.id);
    if (!user) return;

    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: user.name,
      message: safeMessage,
      timestamp: Date.now(),
    };

    room.messages.push(msg);
    if (room.messages.length > MAX_MESSAGES) room.messages.shift();

    io.to(currentRoomId).emit('chat-message', msg);
    stats.totalMessages++;
  });

  socket.on('chat-image', function(data) {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const limiter = rateLimiters.get(socket.id);
    if (!limiter || !limiter.consume()) {
      socket.emit('error-msg', { message: 'Slow down!' });
      return;
    }

    var imageData = data.image;
    if (typeof imageData !== 'string') return;
    if (!imageData.match(/^data:image\/(jpeg|png|webp|gif);base64,/)) return;
    if (imageData.length > MAX_IMAGE_SIZE) {
      socket.emit('error-msg', { message: 'Image too large' });
      return;
    }

    var user = room.users.get(socket.id);
    if (!user) return;

    var msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: user.name,
      image: imageData,
      timestamp: Date.now(),
    };

    room.messages.push(msg);
    if (room.messages.length > MAX_MESSAGES) room.messages.shift();

    io.to(currentRoomId).emit('chat-image', msg);
    stats.totalImages++;
  });

  socket.on('burn-room', function() {
    if (!currentRoomId) return;
    burnRoom(currentRoomId, 'burned');
  });

  socket.on('disconnect', function() {
    rateLimiters.delete(socket.id);
    stats.totalDisconnections++;
    if (!currentRoomId) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    room.users.delete(socket.id);

    if (room.users.size === 0) {
      if (room.autoBurn) {
        burnRoom(currentRoomId, 'auto-burned');
      } else {
        scheduleCleanup(currentRoomId);
      }
    } else if (user) {
      io.to(currentRoomId).emit('user-left', {
        username: user.name,
        userCount: room.users.size,
      });
    }
  });
});

// ── Start ────────────────────────────────────────────────────
httpServer.listen(PORT, '127.0.0.1', function() {
  console.log('BurnChat running on port ' + PORT);
});
