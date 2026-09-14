// U8 §3b — regression tests for the two mapApiError defects the
// prompt reviewed by hand. Node's built-in test runner; per the
// house convention (see returnTo.test.mjs) the pure logic is
// MIRRORED here because there's no TS bundler wired for tests.
// When editing services/frontend/src/lib/api/errors.ts, keep the
// duplicated functions below in sync.
//
// Run:
//   node --test services/frontend/tests/errorsMapApiError.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal CODE_TO_HE slice (just enough for the tests) ────────────
const CODE_TO_HE = {
  seat_limit:            'הגעת למכסת המשתמשים במסלול שלך',
  corp_housing_only:     'תאגיד יכול לפרסם דיור בלבד. קטגוריות נוספות זמינות לספקי שירותים.',
  internal_error:        'קרתה תקלה, נסה שוב עוד רגע',
};
const DEFAULT_MESSAGE = 'קרתה תקלה, נסה שוב עוד רגע';

// ── Mirrored logic from errors.ts ───────────────────────────────────
function looksHebrew(s) {
  if (!s || typeof s !== 'string') return false;
  // any Hebrew codepoint counts; the real helper uses the same range
  return /[֐-׿]/.test(s);
}

function fastApiValidationMessage(detail) {
  if (!Array.isArray(detail) || detail.length === 0) return '';
  const first = detail[0];
  const msg = typeof first?.msg === 'string' ? first.msg : '';
  if (!msg) return '';
  const loc = Array.isArray(first?.loc) ? first.loc.slice(1) : [];
  const field = loc.map((s) => String(s)).join('.');
  return field ? `${field}: ${msg}` : msg;
}

function normalize(err) {
  if (!err) return {};
  if (typeof err === 'string') return { error: err };
  if (err instanceof Error) {
    const m = err.message.trim();
    if (CODE_TO_HE[m])  return { error: m };
    if (looksHebrew(m)) return { message: m };
    const cause = err.cause;
    if (cause && typeof cause === 'object') return cause;
    return { error: m, message: m };
  }
  if (typeof err === 'object') {
    const o = err;
    if (Array.isArray(o.detail)) {
      const message = fastApiValidationMessage(o.detail);
      if (message) return { message };
    }
    if (o.detail && typeof o.detail === 'object' && !Array.isArray(o.detail)) {
      return { ...o.detail, ...o };
    }
    return o;
  }
  return {};
}

function mapApiError(err) {
  const payload = normalize(err);
  if (payload.message && looksHebrew(payload.message)) return payload.message;
  const code = payload.error || payload.code;
  if (code && CODE_TO_HE[code]) return CODE_TO_HE[code];
  if (payload.message) return payload.message;
  return DEFAULT_MESSAGE;
}

// ── Defect (a) — FastAPI 422 detail-is-array ────────────────────────

test('FastAPI 422 with field name → "field: msg"', () => {
  const payload = {
    detail: [
      { loc: ['body', 'phone'], msg: 'value is not a valid phone', type: 'value_error' },
    ],
  };
  assert.equal(mapApiError(payload), 'phone: value is not a valid phone');
});

test('FastAPI 422 with no `loc` → bare msg', () => {
  const payload = { detail: [{ msg: 'value is not a valid phone' }] };
  assert.equal(mapApiError(payload), 'value is not a valid phone');
});

test('FastAPI 422 with nested loc → dotted field path', () => {
  const payload = {
    detail: [
      { loc: ['body', 'owner', 'email'], msg: 'value is not a valid email' },
    ],
  };
  assert.equal(mapApiError(payload), 'owner.email: value is not a valid email');
});

test('empty detail array → falls through to DEFAULT', () => {
  // no `error`, no `message`, no `code` on the payload → default.
  assert.equal(mapApiError({ detail: [] }), DEFAULT_MESSAGE);
});

// ── Defect (b) — Error whose message is neither a code nor Hebrew ───

test('Error with unknown English message reaches step 3 (not DEFAULT)', () => {
  const err = new Error('Custom failure from a legacy backend');
  // Before U8 §3, this dropped to DEFAULT_MESSAGE.
  assert.equal(
    mapApiError(err),
    'Custom failure from a legacy backend',
  );
});

test('Error with a KNOWN code still wins by code lookup', () => {
  const err = new Error('seat_limit');
  assert.equal(mapApiError(err), 'הגעת למכסת המשתמשים במסלול שלך');
});

test('Error with Hebrew message returned as-is', () => {
  const err = new Error('קרתה תקלה בשליחה');
  assert.equal(mapApiError(err), 'קרתה תקלה בשליחה');
});

// ── Sanity — the fixes did not regress the happy paths ──────────────

test('object { detail: {code} } (HTTPException(detail={})) still resolves', () => {
  const payload = { detail: { code: 'corp_housing_only' } };
  assert.equal(
    mapApiError(payload),
    'תאגיד יכול לפרסם דיור בלבד. קטגוריות נוספות זמינות לספקי שירותים.',
  );
});

test('plain string body treated as code', () => {
  assert.equal(mapApiError('seat_limit'), 'הגעת למכסת המשתמשים במסלול שלך');
});

test('null / undefined → DEFAULT', () => {
  assert.equal(mapApiError(null),      DEFAULT_MESSAGE);
  assert.equal(mapApiError(undefined), DEFAULT_MESSAGE);
});
