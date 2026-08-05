// O1 — tests for the returnTo helper. Node's built-in test runner:
//   node --test services/frontend/tests/returnTo.test.mjs
//
// The frontend has no bundler/jest setup, so we can't import the TS
// module directly. Instead this file MIRRORS the pure logic of
// sanitizeReturnTo + a jsdom-free sessionStorage stub for the
// read/write/clear round-trip. When editing
// services/frontend/src/features/prospect/returnTo.ts, keep the
// duplicated function below in sync.

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Duplicate: sanitizeReturnTo (mirrors returnTo.ts) ────────────────
function sanitizeReturnTo(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('/')) return null;
  const second = trimmed.charAt(1);
  if (second === '/' || second === '\\') return null;
  const lowerPrefix = trimmed.slice(0, 8).toLowerCase();
  if (lowerPrefix.startsWith('/%2f') || lowerPrefix.startsWith('/%5c')) return null;
  if (/[\x00-\x1f]/.test(trimmed)) return null;
  if (/^\/[a-z]+:/i.test(trimmed)) return null;
  return trimmed;
}

// ── Duplicate: sessionStorage-backed helpers (mirrors returnTo.ts) ──
// Uses a Map-backed storage so tests run in Node without jsdom.
function makeHelpers(storage) {
  const KEY = 'return_to';
  const TTL_MS = 30 * 60_000;
  function write(path) {
    const safe = sanitizeReturnTo(path);
    if (!safe) return;
    storage.set(KEY, JSON.stringify({
      path: safe,
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    }));
  }
  function read() {
    const raw = storage.get(KEY);
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!parsed || typeof parsed.path !== 'string') return null;
    if (new Date(parsed.expires_at).getTime() < Date.now()) {
      storage.delete(KEY);
      return null;
    }
    return sanitizeReturnTo(parsed.path);
  }
  function clear() { storage.delete(KEY); }
  function resolve(fromQuery, fallback) {
    const fromUrl = sanitizeReturnTo(fromQuery);
    if (fromUrl) return fromUrl;
    const fromStore = read();
    if (fromStore) return fromStore;
    return fallback;
  }
  return { write, read, clear, resolve };
}

// ── sanitizeReturnTo: open-redirect guard ────────────────────────────

test('sanitizeReturnTo accepts the RevealModal payload', () => {
  assert.equal(sanitizeReturnTo('/?reveal=abc123'), '/?reveal=abc123');
});

test('sanitizeReturnTo accepts other internal paths', () => {
  assert.equal(sanitizeReturnTo('/contractor/dashboard'), '/contractor/dashboard');
  assert.equal(sanitizeReturnTo('/marketplace/xyz'), '/marketplace/xyz');
});

test('sanitizeReturnTo rejects external URLs', () => {
  // The acceptance criterion — a crafted external must be rejected.
  assert.equal(sanitizeReturnTo('https://evil.com'), null);
  assert.equal(sanitizeReturnTo('http://evil.com/reveal'), null);
  assert.equal(sanitizeReturnTo('javascript:alert(1)'), null);
  assert.equal(sanitizeReturnTo('data:text/html,<script>'), null);
});

test('sanitizeReturnTo rejects protocol-relative URLs', () => {
  assert.equal(sanitizeReturnTo('//evil.com/reveal'), null);
  assert.equal(sanitizeReturnTo('/\\evil.com/reveal'), null);
});

test('sanitizeReturnTo rejects percent-encoded slash evasions', () => {
  assert.equal(sanitizeReturnTo('/%2Fevil.com'), null);
  assert.equal(sanitizeReturnTo('/%5Cevil.com'), null);
});

test('sanitizeReturnTo rejects nested scheme prefixes', () => {
  assert.equal(sanitizeReturnTo('/javascript:alert(1)'), null);
  assert.equal(sanitizeReturnTo('/http://evil.com'), null);
});

test('sanitizeReturnTo rejects empty / whitespace / non-strings', () => {
  assert.equal(sanitizeReturnTo(null), null);
  assert.equal(sanitizeReturnTo(undefined), null);
  assert.equal(sanitizeReturnTo(''), null);
  assert.equal(sanitizeReturnTo('   '), null);
  assert.equal(sanitizeReturnTo(42), null);
});

test('sanitizeReturnTo rejects control characters', () => {
  assert.equal(sanitizeReturnTo('/foo\nbar'), null);
  assert.equal(sanitizeReturnTo('/foo\0bar'), null);
});

// ── sessionStorage round-trip (acceptance scenario #2) ───────────────

test('write→read survives — refresh scenario', () => {
  const storage = new Map();
  const h = makeHelpers(storage);
  h.write('/?reveal=abc123');
  // Simulating a page refresh: fresh helpers on the same storage.
  const h2 = makeHelpers(storage);
  assert.equal(h2.read(), '/?reveal=abc123');
});

test('read returns null after clear', () => {
  const storage = new Map();
  const h = makeHelpers(storage);
  h.write('/?reveal=abc123');
  h.clear();
  assert.equal(h.read(), null);
});

test('write rejects external URL — never lands in storage', () => {
  const storage = new Map();
  const h = makeHelpers(storage);
  h.write('https://evil.com');
  assert.equal(storage.size, 0);
  assert.equal(h.read(), null);
});

// ── resolve: URL preferred, sessionStorage fallback (OTP-fail case) ──

test('resolve prefers URL param when present', () => {
  const storage = new Map();
  const h = makeHelpers(storage);
  h.write('/?reveal=STORED');
  assert.equal(
    h.resolve('/?reveal=URL', '/contractor/dashboard'),
    '/?reveal=URL',
    'URL param must win over sessionStorage',
  );
});

test('resolve falls back to sessionStorage when URL missing — OTP-fail case', () => {
  // Scenario: user hit /register/contractor?returnTo=/?reveal=abc,
  // OTP failed and their retry lost the URL param somehow. On success
  // the redirect resolves via sessionStorage — they still land on the ad.
  const storage = new Map();
  const h = makeHelpers(storage);
  h.write('/?reveal=abc123');
  assert.equal(
    h.resolve(null, '/contractor/dashboard'),
    '/?reveal=abc123',
  );
});

test('resolve returns fallback when neither URL nor storage has value', () => {
  // Scenario: /register/contractor with no returnTo → normal flow to
  // dashboard, no crash.
  const storage = new Map();
  const h = makeHelpers(storage);
  assert.equal(
    h.resolve(null, '/contractor/dashboard'),
    '/contractor/dashboard',
  );
});

test('resolve rejects URL param that is external, then falls back', () => {
  // Belt+braces: URL param is external, sessionStorage has a valid
  // internal path. resolve() must reject the URL, fall through to
  // storage, and yield the safe path.
  const storage = new Map();
  const h = makeHelpers(storage);
  h.write('/?reveal=abc123');
  assert.equal(
    h.resolve('https://evil.com', '/contractor/dashboard'),
    '/?reveal=abc123',
  );
});

test('resolve returns fallback when both URL and storage are external/invalid', () => {
  const storage = new Map();
  // Storage got poked with an external path directly (simulating an
  // attacker bypassing write()'s sanitize). read() re-validates.
  storage.set('return_to', JSON.stringify({
    path: 'https://evil.com',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }));
  const h = makeHelpers(storage);
  assert.equal(
    h.resolve('//evil.net', '/contractor/dashboard'),
    '/contractor/dashboard',
  );
});

test('read expires stale entries', () => {
  const storage = new Map();
  storage.set('return_to', JSON.stringify({
    path: '/?reveal=abc',
    expires_at: new Date(Date.now() - 1000).toISOString(),
  }));
  const h = makeHelpers(storage);
  assert.equal(h.read(), null);
  assert.equal(storage.size, 0, 'expired entry must be evicted on read');
});
