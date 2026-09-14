// U8 §4a — regression tests for checkIsraeliPhone.
//
// House convention (see returnTo.test.mjs / errorsMapApiError.test.mjs):
// mirror the pure logic here because there's no TS bundler for tests.
// When editing services/frontend/src/lib/phone.ts, keep the mirror
// below in sync.
//
// Run:
//   node --test services/frontend/tests/phone.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

const PHONE_ERROR_INVALID  = 'invalid';
const PHONE_ERROR_REQUIRED = 'required';

const COSMETIC_CHARS = /[\s\-()]/g;

function checkIsraeliPhone(raw) {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return { valid: false, message: PHONE_ERROR_REQUIRED, normalized: null };
  const stripped = trimmed.replace(COSMETIC_CHARS, '');
  if (!/^\+?\d+$/.test(stripped)) return { valid: false, message: PHONE_ERROR_INVALID, normalized: null };
  const digits = stripped.replace(/^\+/, '');
  if (digits.startsWith('972') && digits.length === 12) return { valid: true, message: null, normalized: '+' + digits };
  if (digits.startsWith('0')   && digits.length === 10) return { valid: true, message: null, normalized: digits };
  return { valid: false, message: PHONE_ERROR_INVALID, normalized: null };
}

// ── The screenshot bug: Hebrew letters used to sneak past ────────

test('0525267879גגג → INVALID (Hebrew letters not allowed)', () => {
  const r = checkIsraeliPhone('0525267879גגג');
  assert.equal(r.valid, false);
  assert.equal(r.normalized, null);
  assert.equal(r.message, PHONE_ERROR_INVALID);
});

test('emoji / punctuation in middle → INVALID', () => {
  assert.equal(checkIsraeliPhone('052.526.7879').valid, false);
  assert.equal(checkIsraeliPhone('052/5267879').valid, false);
  assert.equal(checkIsraeliPhone('052😀5267879').valid, false);
});

// ── Real-user typing shapes: cosmetic formatting is fine ─────────

test('dashes accepted and normalized', () => {
  const r = checkIsraeliPhone('052-526-7879');
  assert.equal(r.valid, true);
  assert.equal(r.normalized, '0525267879');
});

test('spaces accepted and normalized', () => {
  const r = checkIsraeliPhone('052 526 7879');
  assert.equal(r.valid, true);
  assert.equal(r.normalized, '0525267879');
});

test('parentheses accepted and normalized', () => {
  const r = checkIsraeliPhone('(052) 5267879');
  assert.equal(r.valid, true);
  assert.equal(r.normalized, '0525267879');
});

test('bare 10-digit form kept as-is', () => {
  const r = checkIsraeliPhone('0525267879');
  assert.equal(r.valid, true);
  assert.equal(r.normalized, '0525267879');
});

test('+972 form kept with + prefix', () => {
  const r = checkIsraeliPhone('+972525267879');
  assert.equal(r.valid, true);
  assert.equal(r.normalized, '+972525267879');
});

test('+972 with cosmetic hyphens normalizes correctly', () => {
  const r = checkIsraeliPhone('+972-52-526-7879');
  assert.equal(r.valid, true);
  assert.equal(r.normalized, '+972525267879');
});

// ── Wrong shape → INVALID ────────────────────────────────────────

test('too-short number rejected', () => {
  assert.equal(checkIsraeliPhone('052526').valid, false);
});

test('too-long number rejected', () => {
  assert.equal(checkIsraeliPhone('05252678799').valid, false);
});

test('non-Israeli prefix rejected (report screenshot: 089…)', () => {
  const r = checkIsraeliPhone('08976567654');
  assert.equal(r.valid, false);
  assert.equal(r.normalized, null);
});

// ── Empty / whitespace → REQUIRED ────────────────────────────────

test('empty string → REQUIRED', () => {
  const r = checkIsraeliPhone('');
  assert.equal(r.valid, false);
  assert.equal(r.message, PHONE_ERROR_REQUIRED);
});

test('whitespace-only → REQUIRED', () => {
  assert.equal(checkIsraeliPhone('   ').message, PHONE_ERROR_REQUIRED);
});

test('null / undefined → REQUIRED', () => {
  assert.equal(checkIsraeliPhone(null).message,      PHONE_ERROR_REQUIRED);
  assert.equal(checkIsraeliPhone(undefined).message, PHONE_ERROR_REQUIRED);
});
