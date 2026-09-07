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
}

/** Same rule the backend applies. Returns `{valid, message}` so the
 *  caller can decide whether to show `PHONE_ERROR_REQUIRED` for a
 *  blank field vs `PHONE_ERROR_INVALID` for a malformed one. */
export function checkIsraeliPhone(raw: string | null | undefined): PhoneCheck {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return { valid: false, message: PHONE_ERROR_REQUIRED };
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length === 12) return { valid: true, message: null };
  if (digits.startsWith('0')   && digits.length === 10) return { valid: true, message: null };
  return { valid: false, message: PHONE_ERROR_INVALID };
}
