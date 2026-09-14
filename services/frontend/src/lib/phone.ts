// H11 §3.2 — single source of truth for Israeli phone validation.
//
// Multiple call sites (login/page.tsx, AdInquiryModal.tsx,
// billing/page.tsx) each had their own client-side check — the
// login page's was "not empty" (too loose, would fire an
// invalid number all the way to the SMS gateway); the modal +
// billing used `length < 9` (both false-negative and
// false-positive: rejects legitimate short-typed digits, accepts
// bogus 9-char strings). Now: the exact rule the backend's
// otp.js:normalisePhone uses.
//
// Backend rule (services/auth/src/otp.js:20-22):
//   digits.startsWith('972') && digits.length === 12   → +972XXXXXXXXX
//   digits.startsWith('0')   && digits.length === 10   → 0XXXXXXXXX
//
// Import the copy from lib/api/errors.ts so a rewording of
// invalid_phone in the shared table flows to every caller
// without a code hunt.
import { CODE_TO_HE } from './api/errors';

export const PHONE_ERROR_INVALID  = CODE_TO_HE.invalid_phone
  ?? 'מספר טלפון לא תקין. יש להזין מספר ישראלי בפורמט 05XXXXXXXX';
export const PHONE_ERROR_REQUIRED = CODE_TO_HE.phone_required
  ?? 'יש להזין מספר טלפון';

export interface PhoneCheck {
  valid:   boolean;
  /** Localized Hebrew message for the failure case. `null` on valid. */
  message: string | null;
  /**
   * U8 §4a — canonical form of a valid phone. Callers MUST send THIS
   * to the server, not the raw text. `null` on invalid.
   *
   *   05XXXXXXXX   (10-digit local form, kept for the SMS provider)
   *   +972XXXXXXXXX (international form)
   *
   * Design note: we intentionally return the local `05XXXXXXXX`
   * shape unchanged for legacy backends that regex on it. The
   * backend's `normalisePhone` (services/auth/src/otp.js) accepts
   * both.
   */
  normalized: string | null;
}

// U8 §4a — characters the input may legitimately contain around the
// digits. Everything else (letters, punctuation, control chars) is
// forbidden from the START — the old validator stripped these out
// with `replace(/\D/g, '')` BEFORE the length check, so
// `0525267879גגג` passed as valid then the caller sent the raw text
// with the Hebrew letters straight to the SMS gateway. The
// backend's normalisePhone shares the same permissiveness, so a
// server-side re-validate wouldn't have saved us either.
const COSMETIC_CHARS = /[\s\-()]/g;

/** Same rule the backend applies. Returns `{valid, message, normalized}`
 *  so callers can (a) show `PHONE_ERROR_REQUIRED` for a blank field vs
 *  `PHONE_ERROR_INVALID` for a malformed one, and (b) send the
 *  canonical form to the server instead of the raw text. */
export function checkIsraeliPhone(raw: string | null | undefined): PhoneCheck {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    return { valid: false, message: PHONE_ERROR_REQUIRED, normalized: null };
  }
  // U8 §4a — strip ONLY cosmetic formatting (spaces, dashes,
  // parentheses). What remains MUST be digits, with an optional
  // leading `+`. Anything else — Hebrew letters, dots, slashes,
  // emoji — makes the input invalid up front.
  const stripped = trimmed.replace(COSMETIC_CHARS, '');
  if (!/^\+?\d+$/.test(stripped)) {
    return { valid: false, message: PHONE_ERROR_INVALID, normalized: null };
  }
  const digits = stripped.replace(/^\+/, '');
  if (digits.startsWith('972') && digits.length === 12) {
    return { valid: true, message: null, normalized: '+' + digits };
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return { valid: true, message: null, normalized: digits };
  }
  return { valid: false, message: PHONE_ERROR_INVALID, normalized: null };
}
