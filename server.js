require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const path = require('path');

const app = express();
const httpServer = createServer(app);

// Environment variables with defaults
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '5');
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '5000');
const RATE_LIMIT_MUTE_MS = parseInt(process.env.RATE_LIMIT_MUTE_MS || '30000');
const MAX_CONNECTIONS_PER_IP = parseInt(process.env.MAX_CONNECTIONS_PER_IP || '5');
const MAX_SOCKET_PAYLOAD = parseInt(process.env.MAX_SOCKET_PAYLOAD || '2048');

// Security: Helmet with strict CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', users: users.size, messages: messageHistory.length });
});

// Socket.IO setup with security
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: MAX_SOCKET_PAYLOAD,
  pingTimeout: 60000,
  pingInterval: 25000
});

// In-memory storage
const messageHistory = []; // Last 50 messages
const users = new Map(); // socketId -> { name, joinedAt }
const ipConnections = new Map(); // ip -> Set of socket ids
const rateLimitMap = new Map(); // socketId -> { count, windowStart, mutedUntil }

// Simple bad word filter (configurable)
const BAD_WORDS = ['spam', 'scam']; // Add more as needed
function filterBadWords(text) {
  let filtered = text;
  BAD_WORDS.forEach(word => {
    const regex = new RegExp(word, 'gi');
    filtered = filtered.replace(regex, '***');
  });
  return filtered;
}

// Validation functions
function validateName(name) {
  if (typeof name !== 'string') return { valid: false, error: 'Name must be a string' };

  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 20) {
    return { valid: false, error: 'Name must be 2-20 characters' };
  }

  // Only allow letters, numbers, spaces, underscores, hyphens
  if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) {
    return { valid: false, error: 'Name can only contain letters, numbers, spaces, underscores, and hyphens' };
  }

  return { valid: true, name: trimmed };
}

function validateMessage(message) {
  if (typeof message !== 'string') return { valid: false, error: 'Message must be a string' };

  const trimmed = message.trim();
  if (trimmed.length < 1) {
    return { valid: false, error: 'Message cannot be empty' };
  }

  if (trimmed.length > 500) {
    return { valid: false, error: 'Message is too long (max 500 characters)' };
  }

  return { valid: true, message: trimmed };
}

function isNameTaken(name, excludeSocketId = null) {
  for (const [socketId, user] of users.entries()) {
    if (socketId !== excludeSocketId && user.name.toLowerCase() === name.toLowerCase()) {
      return true;
    }
  }
  return false;
}

// Rate limiting logic
function checkRateLimit(socketId) {
  const now = Date.now();
  const limit = rateLimitMap.get(socketId);

  if (!limit) {
    rateLimitMap.set(socketId, {
      count: 1,
      windowStart: now,
      mutedUntil: null
    });
    return { allowed: true };
  }

  // Check if user is muted
  if (limit.mutedUntil && now < limit.mutedUntil) {
    return {
      allowed: false,
      reason: 'muted',
      remainingMs: limit.mutedUntil - now
    };
  }

  // Clear mute if expired
  if (limit.mutedUntil && now >= limit.mutedUntil) {
    limit.mutedUntil = null;
    limit.count = 0;
  }

  // Reset window if expired
  if (now - limit.windowStart > RATE_LIMIT_WINDOW_MS) {
    limit.count = 1;
    limit.windowStart = now;
    return { allowed: true };
  }

  // Increment count
  limit.count++;

  // Check if exceeded
  if (limit.count > RATE_LIMIT_MAX) {
    // Mute the user
    limit.mutedUntil = now + RATE_LIMIT_MUTE_MS;
    return {
      allowed: false,
      reason: 'rate_limit',
      mutedFor: RATE_LIMIT_MUTE_MS
    };
  }

  return { allowed: true, remaining: RATE_LIMIT_MAX - limit.count };
}

// Get client IP (handles proxies)
function getClientIp(socket) {
  return socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || socket.handshake.address;
}

// Socket.IO connection handler
io.on('connection', (socket) => {
  const clientIp = getClientIp(socket);

  // Connection limit per IP
  if (!ipConnections.has(clientIp)) {
    ipConnections.set(clientIp, new Set());
  }

  const ipSockets = ipConnections.get(clientIp);
  if (ipSockets.size >= MAX_CONNECTIONS_PER_IP) {
    socket.emit('error_msg', { message: 'Too many connections from your IP' });
    socket.disconnect(true);
    return;
  }

  ipSockets.add(socket.id);

  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id} from ${clientIp}`);

  // Handle user join
  socket.on('join', (data) => {
    try {
      // Validate payload size
      if (JSON.stringify(data).length > MAX_SOCKET_PAYLOAD) {
        socket.emit('join_error', { message: 'Payload too large' });
        return;
      }

      const { name } = data || {};
      const validation = validateName(name);

      if (!validation.valid) {
        socket.emit('join_error', { message: validation.error });
        return;
      }

      const validatedName = validation.name;

      // Check if name is taken
      if (isNameTaken(validatedName)) {
        socket.emit('join_error', { message: 'This name is already taken. Please choose another.' });
        return;
      }

      // Register user
      users.set(socket.id, {
        name: validatedName,
        joinedAt: Date.now()
      });

      // Send success and message history
      socket.emit('join_success', {
        name: validatedName,
        history: messageHistory
      });

      // Send updated user list to everyone
      broadcastUserList();

      // Broadcast join notification
      const joinMsg = createSystemMessage(`${validatedName} joined`);
      io.emit('message', joinMsg);
      addToHistory(joinMsg);

      console.log(`[${new Date().toISOString()}] User joined: ${validatedName} (${socket.id})`);

    } catch (error) {
      console.error('Error in join handler:', error);
      socket.emit('join_error', { message: 'An error occurred. Please try again.' });
    }
  });

  // Handle chat message
  socket.on('chat_message', (data) => {
    try {
      // Check if user is registered
      const user = users.get(socket.id);
      if (!user) {
        socket.emit('error_msg', { message: 'You must join first' });
        return;
      }

      // Validate payload size
      if (JSON.stringify(data).length > MAX_SOCKET_PAYLOAD) {
        socket.emit('error_msg', { message: 'Message too large' });
        return;
      }

      // Rate limiting
      const rateCheck = checkRateLimit(socket.id);
      if (!rateCheck.allowed) {
        if (rateCheck.reason === 'muted') {
          const seconds = Math.ceil(rateCheck.remainingMs / 1000);
          socket.emit('rate_limit', {
            message: `You are muted for ${seconds} more seconds due to spamming`
          });
        } else if (rateCheck.reason === 'rate_limit') {
          const seconds = Math.ceil(rateCheck.mutedFor / 1000);
          socket.emit('rate_limit', {
            message: `Too many messages! You are muted for ${seconds} seconds.`
          });
        }
        return;
      }

      const { message } = data || {};
      const validation = validateMessage(message);

      if (!validation.valid) {
        socket.emit('error_msg', { message: validation.error });
        return;
      }

      const validatedMessage = validation.message;
      const filteredMessage = filterBadWords(validatedMessage);

      // Create message object - SECURITY: use server-side name, never trust client
      const msg = {
        id: `${Date.now()}-${socket.id}`,
        name: user.name,
        message: filteredMessage,
        timestamp: Date.now(),
        type: 'user'
      };

      // Broadcast to all clients
      io.emit('message', msg);
      addToHistory(msg);

    } catch (error) {
      console.error('Error in chat_message handler:', error);
      socket.emit('error_msg', { message: 'Failed to send message' });
    }
  });

  // Handle report
  socket.on('report', (data) => {
    try {
      const reporter = users.get(socket.id);
      if (!reporter) return;

      const { messageId, reason } = data || {};
      console.log(`[REPORT] User "${reporter.name}" reported message ${messageId}: ${reason}`);

      socket.emit('report_success', { message: 'Report submitted. Thank you.' });
    } catch (error) {
      console.error('Error in report handler:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);

    if (user) {
      const leaveMsg = createSystemMessage(`${user.name} left`);
      io.emit('message', leaveMsg);
      addToHistory(leaveMsg);

      console.log(`[${new Date().toISOString()}] User left: ${user.name} (${socket.id})`);

      users.delete(socket.id);
      broadcastUserList();
    }

    // Clean up IP tracking
    if (ipSockets) {
      ipSockets.delete(socket.id);
      if (ipSockets.size === 0) {
        ipConnections.delete(clientIp);
      }
    }

    // Clean up rate limit map
    rateLimitMap.delete(socket.id);
  });
});

// Helper functions
function createSystemMessage(text) {
  return {
    id: `system-${Date.now()}`,
    message: text,
    timestamp: Date.now(),
    type: 'system'
  };
}

function addToHistory(message) {
  messageHistory.push(message);
  if (messageHistory.length > 50) {
    messageHistory.shift(); // Keep only last 50
  }
}

function broadcastUserList() {
  const userList = Array.from(users.values()).map(u => u.name);
  io.emit('user_list', {
    count: users.size,
    users: userList
  });
}

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 World Chat server running on port ${PORT}`);
  console.log(`   Environment: ${NODE_ENV}`);
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`   Visit: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
