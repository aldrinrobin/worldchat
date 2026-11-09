const test = require('node:test');
const assert = require('node:assert');
const { io: ioClient } = require('socket.io-client');
const { createServer } = require('http');
const express = require('express');
const { Server } = require('socket.io');

// Minimal server setup for integration tests
function createTestServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const users = new Map();
  const messageHistory = [];
  const rateLimitMap = new Map();

  const RATE_LIMIT_MAX = 5;
  const RATE_LIMIT_WINDOW_MS = 1000;
  const RATE_LIMIT_MUTE_MS = 2000;

  io.on('connection', (socket) => {
    socket.on('join', (data) => {
      const name = (data?.name || '').trim();
      if (name.length < 2 || name.length > 20 || !/^[a-zA-Z0-9 _-]+$/.test(name)) {
        return socket.emit('join_error', { message: 'Invalid name' });
      }
      for (const user of users.values()) {
        if (user.name.toLowerCase() === name.toLowerCase()) {
          return socket.emit('join_error', { message: 'Name taken' });
        }
      }
      users.set(socket.id, { name });
      socket.emit('join_success', { name, history: messageHistory });
      io.emit('user_list', { count: users.size, users: Array.from(users.values()).map(u => u.name) });
      socket.on('disconnect', () => {
        users.delete(socket.id);
        io.emit('user_list', { count: users.size, users: Array.from(users.values()).map(u => u.name) });
      });
    });

    socket.on('chat_message', (data) => {
      const user = users.get(socket.id);
      if (!user) return;

      const now = Date.now();
      const limit = rateLimitMap.get(socket.id);
      if (limit?.mutedUntil && now < limit.mutedUntil) {
        return socket.emit('rate_limit', { message: 'Muted' });
      }

      rateLimitMap.set(socket.id, {
        count: (limit?.count || 0) + 1,
        windowStart: limit?.windowStart || now,
        mutedUntil: limit?.mutedUntil
      });

      const newLimit = rateLimitMap.get(socket.id);
      if (now - newLimit.windowStart < RATE_LIMIT_WINDOW_MS && newLimit.count > RATE_LIMIT_MAX) {
        newLimit.mutedUntil = now + RATE_LIMIT_MUTE_MS;
        return socket.emit('rate_limit', { message: 'Too fast' });
      }

      if (now - newLimit.windowStart > RATE_LIMIT_WINDOW_MS) {
        newLimit.count = 1;
        newLimit.windowStart = now;
      }

      const message = (data?.message || '').trim();
      if (!message || message.length > 500) return;

      const msg = { id: Date.now(), name: user.name, message, timestamp: Date.now() };
      messageHistory.push(msg);
      io.emit('message', msg);
    });
  });

  return { httpServer, io };
}

test('Integration: Two clients can chat in real-time', { timeout: 10000 }, async () => {
  const { httpServer } = createTestServer();

  const port = await new Promise(resolve => {
    httpServer.listen(0, () => resolve(httpServer.address().port));
  });

  const url = `http://localhost:${port}`;
  const client1 = ioClient(url, { transports: ['websocket'] });
  const client2 = ioClient(url, { transports: ['websocket'] });

  try {
    // Client 1 joins
    await new Promise((resolve, reject) => {
      client1.emit('join', { name: 'Alice' });
      client1.on('join_success', resolve);
      client1.on('join_error', reject);
    });

    // Client 2 joins
    await new Promise((resolve, reject) => {
      client2.emit('join', { name: 'Bob' });
      client2.on('join_success', resolve);
      client2.on('join_error', reject);
    });

    // Client 1 sends message, Client 2 receives it
    const received = await new Promise(resolve => {
      client2.on('message', msg => {
        if (msg.name === 'Alice' && msg.message === 'Hello Bob!') {
          resolve(msg);
        }
      });
      client1.emit('chat_message', { message: 'Hello Bob!' });
    });

    assert.strictEqual(received.message, 'Hello Bob!');
    assert.strictEqual(received.name, 'Alice');

  } finally {
    client1.disconnect();
    client2.disconnect();
    await new Promise(resolve => httpServer.close(resolve));
  }
});

test('Integration: Duplicate name is rejected', { timeout: 10000 }, async () => {
  const { httpServer } = createTestServer();

  const port = await new Promise(resolve => {
    httpServer.listen(0, () => resolve(httpServer.address().port));
  });

  const url = `http://localhost:${port}`;
  const client1 = ioClient(url, { transports: ['websocket'] });
  const client2 = ioClient(url, { transports: ['websocket'] });

  try {
    await new Promise(resolve => {
      client1.emit('join', { name: 'Alice' });
      client1.on('join_success', resolve);
    });

    const error = await new Promise(resolve => {
      client2.emit('join', { name: 'Alice' });
      client2.on('join_error', resolve);
    });

    assert.strictEqual(error.message, 'Name taken');

  } finally {
    client1.disconnect();
    client2.disconnect();
    await new Promise(resolve => httpServer.close(resolve));
  }
});

test('Integration: XSS payload in name is rejected', { timeout: 10000 }, async () => {
  const { httpServer } = createTestServer();

  const port = await new Promise(resolve => {
    httpServer.listen(0, () => resolve(httpServer.address().port));
  });

  const url = `http://localhost:${port}`;
  const client = ioClient(url, { transports: ['websocket'] });

  try {
    const error = await new Promise(resolve => {
      client.emit('join', { name: '<script>alert(1)</script>' });
      client.on('join_error', resolve);
    });

    assert.strictEqual(error.message, 'Invalid name');

  } finally {
    client.disconnect();
    await new Promise(resolve => httpServer.close(resolve));
  }
});

test('Integration: Rate limiting triggers on rapid messages', { timeout: 10000 }, async () => {
  const { httpServer } = createTestServer();

  const port = await new Promise(resolve => {
    httpServer.listen(0, () => resolve(httpServer.address().port));
  });

  const url = `http://localhost:${port}`;
  const client = ioClient(url, { transports: ['websocket'] });

  try {
    await new Promise(resolve => {
      client.emit('join', { name: 'Spammer' });
      client.on('join_success', resolve);
    });

    const rateLimitEvent = await new Promise(resolve => {
      client.on('rate_limit', resolve);
      // Send 7 messages rapidly
      for (let i = 0; i < 7; i++) {
        client.emit('chat_message', { message: `Spam ${i}` });
      }
    });

    assert.ok(rateLimitEvent);

  } finally {
    client.disconnect();
    await new Promise(resolve => httpServer.close(resolve));
  }
});
