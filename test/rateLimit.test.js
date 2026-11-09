const test = require('node:test');
const assert = require('node:assert');

// Rate limiting class/function to test
class RateLimiter {
  constructor(maxRequests = 5, windowMs = 5000, muteMs = 30000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.muteMs = muteMs;
    this.map = new Map();
  }

  check(id, now = Date.now()) {
    const limit = this.map.get(id);

    if (!limit) {
      this.map.set(id, {
        count: 1,
        windowStart: now,
        mutedUntil: null
      });
      return { allowed: true };
    }

    if (limit.mutedUntil && now < limit.mutedUntil) {
      return {
        allowed: false,
        reason: 'muted',
        remainingMs: limit.mutedUntil - now
      };
    }

    if (limit.mutedUntil && now >= limit.mutedUntil) {
      limit.mutedUntil = null;
      limit.count = 0;
    }

    if (now - limit.windowStart > this.windowMs) {
      limit.count = 1;
      limit.windowStart = now;
      return { allowed: true };
    }

    limit.count++;

    if (limit.count > this.maxRequests) {
      limit.mutedUntil = now + this.muteMs;
      return {
        allowed: false,
        reason: 'rate_limit',
        mutedFor: this.muteMs
      };
    }

    return { allowed: true, remaining: this.maxRequests - limit.count };
  }
}

test('Rate limiter', async (t) => {
  await t.test('allows up to 5 messages in 5 seconds', () => {
    const limiter = new RateLimiter(5, 5000, 30000);
    const baseTime = 100000;

    for (let i = 1; i <= 5; i++) {
      const res = limiter.check('user1', baseTime + i * 100);
      assert.strictEqual(res.allowed, true, `Message ${i} should be allowed`);
    }
  });

  await t.test('blocks and mutes on 6th message', () => {
    const limiter = new RateLimiter(5, 5000, 30000);
    const baseTime = 100000;

    for (let i = 1; i <= 5; i++) {
      limiter.check('user1', baseTime + i * 100);
    }

    const res = limiter.check('user1', baseTime + 600);
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason, 'rate_limit');
    assert.strictEqual(res.mutedFor, 30000);
  });

  await t.test('keeps user muted until mute time expires', () => {
    const limiter = new RateLimiter(5, 5000, 30000);
    const baseTime = 100000;

    for (let i = 1; i <= 6; i++) {
      limiter.check('user1', baseTime + i * 100);
    }

    // Try at 15s into 30s mute
    const resMuted = limiter.check('user1', baseTime + 15000);
    assert.strictEqual(resMuted.allowed, false);
    assert.strictEqual(resMuted.reason, 'muted');

    // Try at 31s after mute started
    const resUnmuted = limiter.check('user1', baseTime + 31000);
    assert.strictEqual(resUnmuted.allowed, true);
  });

  await t.test('resets count after window expires without violating limit', () => {
    const limiter = new RateLimiter(5, 5000, 30000);
    const baseTime = 100000;

    for (let i = 1; i <= 4; i++) {
      limiter.check('user1', baseTime + i * 100);
    }

    // Next message after 6 seconds (window reset)
    const res = limiter.check('user1', baseTime + 6000);
    assert.strictEqual(res.allowed, true);
  });
});
