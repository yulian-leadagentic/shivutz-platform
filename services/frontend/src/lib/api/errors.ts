// Central api-error → Hebrew mapper.
//
// Every backend service that follows the P0-1 contract now returns:
//   { error: '<stable_code>', message: '<hebrew display text>', ... }
// The frontend's job is:
//   1. Prefer the server-supplied `message` when it exists (backends
//      own the wording and can localize/version it without a FE deploy).
//   2. Fall back to a per-code map for endpoints that predate the
//      contract, or when the response body is missing / opaque.
//   3. Fall back to a sane generic default — NEVER surface a raw code
//      like `internal_error` or an English/technical string.
//
// Duplicating this in per-page `otpError` / `otpErrorMsg` helpers is
// exactly what caused the "שגיאה בשליחת הקוד" surprise (a new backend
// code the pages didn't know about). Use `mapApiError` everywhere the
// UI shows an error string.

// Stable machine codes → Hebrew fallback. Kept alphabetized so a new
// code lookup is O(log n) for the reader.
const CODE_TO_HE: Record<string, string> = {
  // ── generic ────────────────────────────────────────────────
  internal_error:        'קרתה תקלה, נסה שוב עוד רגע',
  bad_request:           'הבקשה לא תקינה. בדוק את השדות ונסה שוב',
  unauthorized:          'לא מורשה. יש להיכנס למערכת',
  forbidden:             'הפעולה אינה מותרת לחשבון זה',
  not_found:             'לא נמצא',
  service_unavailable:   'השירות זמנית לא זמין. נסה שוב עוד רגע',
  rate_limited:          'יותר מדי בקשות, נסה שוב עוד רגע',
  network_error:         'בעיה בחיבור לרשת. בדוק את החיבור ונסה שוב',

  // ── auth / OTP (P0-1) ──────────────────────────────────────
  phone_required:        'יש להזין מספר טלפון',
  invalid_phone:         'מספר טלפון לא תקין. יש להזין מספר ישראלי בפורמט 05XXXXXXXX',
  invalid_purpose:       'בקשה לא תקינה',
  missing_fields:        'חסר מידע בבקשה',
  wrong_code:            'קוד לא נכון. נסה שנית',
  max_attempts:          'יותר מדי ניסיונות שגויים. בקש קוד חדש',
  otp_expired:           'הקוד פג תוקף. שלח קוד חדש',
  otp_expired_or_not_found: 'הקוד פג תוקף. שלח קוד חדש',
  no_recent_otp:         'לא נמצא קוד תקף — בקש קוד חדש',
  user_not_found:        'מספר הטלפון לא רשום במערכת',
  use_phone_login:       'חשבון זה מחייב כניסה עם SMS / WhatsApp',
  phone_not_verified:    'אימות הטלפון פג תוקף. חזור לשלב הראשון',
  already_registered:    'מספר הטלפון כבר רשום. אנא התחבר',
  company_blocked:       'החברה רשומה במצב לא פעיל ברשם החברות',
};

export const DEFAULT_MESSAGE = 'קרתה תקלה, נסה שוב';

// ── server error shape (P0-1) ─────────────────────────────────
export interface ApiErrorPayload {
  error?:   string;                 // machine code
  message?: string;                 // Hebrew display
  detail?:  string | ApiErrorPayload;
  code?:    string;                 // some legacy shapes
  status?:  number;
  retryAfter?: number;
  remaining?:  number;
}

// Turn any thrown/caught error from `apiFetch` into a Hebrew string.
// Accepts:
//   - Error whose `.message` is a code (legacy apiFetch behaviour)
//   - Error whose `.message` is already Hebrew (server sent .message)
//   - Raw response body object with { error, message, ... }
//   - null / undefined / anything else → DEFAULT_MESSAGE
export function mapApiError(err: unknown): string {
  const payload = normalize(err);

  // 1) Prefer server-supplied Hebrew message when present
  if (payload.message && looksHebrew(payload.message)) return payload.message;

  // 2) Look up by machine code
  const code = payload.error || payload.code;
  if (code && CODE_TO_HE[code]) return CODE_TO_HE[code];

  // 3) Fall back to the message even if it's not Hebrew — better than a
  //    raw code, and the caller can still catch English leaks in QA.
  if (payload.message) return payload.message;

  // 4) Absolute last resort
  return DEFAULT_MESSAGE;
}

function normalize(err: unknown): ApiErrorPayload {
  if (!err) return {};
  if (typeof err === 'string')                          return { error: err };
  if (err instanceof Error) {
    // Errors thrown by apiFetch have their message set to a code OR a
    // Hebrew string — either way, try both interpretations.
    const m = err.message.trim();
    if (CODE_TO_HE[m])       return { error: m };
    if (looksHebrew(m))      return { message: m };
    // Some callers stash the parsed body on `.cause`
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') return cause as ApiErrorPayload;
    return { error: m };
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    // Nested { detail: {...} } from FastAPI
    if (o.detail && typeof o.detail === 'object') {
      return { ...(o.detail as ApiErrorPayload), ...(o as ApiErrorPayload) };
    }
    return o as ApiErrorPayload;
  }
  return {};
}

function looksHebrew(s: string): boolean {
  // Any Hebrew char in the string qualifies. RTL text often mixes
  // digits/punctuation, so we don't require the string to be majority
  // Hebrew — just to contain at least one Hebrew letter.
  return /[֐-׿]/.test(s);
}
