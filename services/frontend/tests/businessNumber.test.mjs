// R34 P2 — regression tests for checkBusinessNumber.
//
// House convention (see phone.test.mjs / returnTo.test.mjs): mirror the
// pure logic here because there is no TS bundler for tests. When
// editing services/frontend/src/lib/businessNumber.ts, keep the mirror
// below in sync — and keep both in sync with the server's
// services/user-org/app/integrations/test_israeli_id.py, which pins
// the same cases. The server is the authority; this check is UX.
//
// Run:
//   node --test services/frontend/tests/businessNumber.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

const REQUIRED = 'required';
const FORMAT   = 'format';
const INVALID  = 'invalid';

function isValidIsraeliId(value) {
  if (!/^\d{1,9}$/.test(value)) return false;
  const digits = value.padStart(9, '0');
  if (digits === '000000000') return false;
  let total = 0;
  for (let i = 0; i < 9; i += 1) {
    let n = Number(digits[i]) * (i % 2 === 0 ? 1 : 2);
    if (n > 9) n -= 9;
    total += n;
  }
  return total % 10 === 0;
}

function checkBusinessNumber(raw) {
  const value = (raw ?? '').trim();
  if (value.length === 0) return { valid: false, message: REQUIRED, normalized: null };
  if (!/^\d{8,9}$/.test(value)) return { valid: false, message: FORMAT, normalized: null };
  if (!isValidIsraeliId(value)) return { valid: false, message: INVALID, normalized: null };
  return { valid: true, message: null, normalized: value.padStart(9, '0') };
}

// ── the checksum itself ──────────────────────────────────────────

test('known valid personal id and company number', () => {
  assert.equal(isValidIsraeliId('123456782'), true);
  assert.equal(isValidIsraeliId('514000009'), true);
});

test('off by one digit → invalid', () => {
  assert.equal(isValidIsraeliId('123456783'), false);
  assert.equal(isValidIsraeliId('123456781'), false);
  assert.equal(isValidIsraeliId('123466782'), false);
});

test('all zeros → invalid, although 0 mod 10 is 0', () => {
  assert.equal(isValidIsraeliId('000000000'), false);
  assert.equal(isValidIsraeliId('00000000'), false);
  assert.equal(isValidIsraeliId('0'), false);
});

test('non-digits and over-long input → invalid', () => {
  assert.equal(isValidIsraeliId('12345678a'), false);
  assert.equal(isValidIsraeliId(''), false);
  assert.equal(isValidIsraeliId('12-345-678'), false);
  assert.equal(isValidIsraeliId('1234567890'), false);
});

// ── what a person types into the provider form ───────────────────

test('valid nine digits pass unchanged', () => {
  assert.deepEqual(checkBusinessNumber('123456782'), { valid: true, message: null, normalized: '123456782' });
});

test('surrounding whitespace is ignored', () => {
  assert.equal(checkBusinessNumber('  123456782 ').normalized, '123456782');
});

test('eight digits are padded with a leading zero', () => {
  assert.deepEqual(checkBusinessNumber('12345674'), { valid: true, message: null, normalized: '012345674' });
});

test('eight digits that fail once padded are rejected', () => {
  assert.equal(checkBusinessNumber('12345675').message, INVALID);
});

test('padded and unpadded spellings canonicalise to one value', () => {
  assert.equal(checkBusinessNumber('12345674').normalized, checkBusinessNumber('012345674').normalized);
});

test('empty, blank, null → REQUIRED', () => {
  assert.equal(checkBusinessNumber('').message, REQUIRED);
  assert.equal(checkBusinessNumber('   ').message, REQUIRED);
  assert.equal(checkBusinessNumber(null).message, REQUIRED);
  assert.equal(checkBusinessNumber(undefined).message, REQUIRED);
});

test('wrong length is a FORMAT error, not a checksum error', () => {
  assert.equal(checkBusinessNumber('12345').message, FORMAT);
  assert.equal(checkBusinessNumber('1234567').message, FORMAT);
  assert.equal(checkBusinessNumber('1234567890').message, FORMAT);
});

test('letters → FORMAT', () => {
  assert.equal(checkBusinessNumber('12345678a').message, FORMAT);
});

test('all zeros rejected at both lengths', () => {
  assert.equal(checkBusinessNumber('000000000').message, INVALID);
  assert.equal(checkBusinessNumber('00000000').message, INVALID);
});

test('off by one → INVALID', () => {
  assert.equal(checkBusinessNumber('123456783').message, INVALID);
});
