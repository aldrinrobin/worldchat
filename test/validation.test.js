const test = require('node:test');
const assert = require('node:assert');

// We isolate the validation logic to test it unit-style
function validateName(name) {
  if (typeof name !== 'string') return { valid: false, error: 'Name must be a string' };

  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 20) {
    return { valid: false, error: 'Name must be 2-20 characters' };
  }

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

function filterBadWords(text, badWords = ['spam', 'scam']) {
  let filtered = text;
  badWords.forEach(word => {
    const regex = new RegExp(word, 'gi');
    filtered = filtered.replace(regex, '***');
  });
  return filtered;
}

test('Name validation', async (t) => {
  await t.test('accepts valid alphanumeric names', () => {
    const res = validateName('Alice_123');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.name, 'Alice_123');
  });

  await t.test('accepts names with spaces and hyphens', () => {
    const res = validateName('John-Doe Smith');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.name, 'John-Doe Smith');
  });

  await t.test('trims whitespace', () => {
    const res = validateName('   Aldrin   ');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.name, 'Aldrin');
  });

  await t.test('rejects names shorter than 2 chars', () => {
    const res = validateName('A');
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /2-20 characters/);
  });

  await t.test('rejects names longer than 20 chars', () => {
    const res = validateName('A'.repeat(21));
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /2-20 characters/);
  });

  await t.test('rejects names with special/XSS characters', () => {
    const res = validateName('<script>');
    assert.strictEqual(res.valid, false);
  });

  await t.test('rejects non-string names', () => {
    const res = validateName(12345);
    assert.strictEqual(res.valid, false);
  });
});

test('Message validation', async (t) => {
  await t.test('accepts valid message', () => {
    const res = validateMessage('Hello world!');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.message, 'Hello world!');
  });

  await t.test('rejects empty or whitespace-only messages', () => {
    const res1 = validateMessage('');
    assert.strictEqual(res1.valid, false);

    const res2 = validateMessage('   \n\t  ');
    assert.strictEqual(res2.valid, false);
  });

  await t.test('rejects messages longer than 500 characters', () => {
    const longMsg = 'a'.repeat(501);
    const res = validateMessage(longMsg);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /too long/);
  });

  await t.test('rejects non-string messages', () => {
    const res = validateMessage({ text: 'hi' });
    assert.strictEqual(res.valid, false);
  });
});

test('Bad word filter', async (t) => {
  await t.test('masks bad words case-insensitively', () => {
    const result = filterBadWords('This is SPAM and a Scam alert');
    assert.strictEqual(result, 'This is *** and a *** alert');
  });

  await t.test('leaves clean messages untouched', () => {
    const result = filterBadWords('Hello everyone, hope you are having a nice day!');
    assert.strictEqual(result, 'Hello everyone, hope you are having a nice day!');
  });
});
