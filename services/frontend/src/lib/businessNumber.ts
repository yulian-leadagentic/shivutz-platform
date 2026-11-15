// R34 P2 — client-side check for a ח.פ / ע.מ, the mirror of
// services/user-org/app/integrations/israeli_id.py.
//
// The server is the authority. This exists so a mistyped digit is
// caught next to the field, in Hebrew, before the request round-trips.
// If the two ever disagree the server wins, so keep them identical:
// tests/businessNumber.test.mjs and the server's test_israeli_id.py
// pin the same cases on purpose.
//
// The rule: 8 or 9 digits, left-padded to 9, then the check digit that
// ת.ז, ע.מ and ח.פ all share. Eight digits are accepted because a
// number that starts with a zero is routinely typed without it.

import { CODE_TO_HE } from './api/errors';

export const BUSINESS_NUMBER_ERROR_REQUIRED = 'ח.פ / ע.מ הוא שדה חובה';
export const BUSINESS_NUMBER_ERROR_FORMAT   = 'ח.פ / ע.מ חייב להיות 9 ספרות';
export const BUSINESS_NUMBER_ERROR_INVALID  = CODE_TO_HE.invalid_business_number
  ?? 'מספר ח.פ / ע.מ אינו תקין. בדקו את הספרות.';

export interface BusinessNumberCheck {
  valid: boolean;
  /** Hebrew message for the failure case. `null` on valid. */
  message: string | null;
  /** The 9-digit form to send to the server. `null` on invalid. */
  normalized: string | null;
}

export function isValidIsraeliId(value: string): boolean {
  if (!/^\d{1,9}$/.test(value)) return false;
  const digits = value.padStart(9, '0');
  // All zeros satisfies the checksum (0 mod 10 is 0) and is the
  // placeholder people type to get past a required field.
  if (digits === '000000000') return false;
  let total = 0;
  for (let i = 0; i < 9; i += 1) {
    let n = Number(digits[i]) * (i % 2 === 0 ? 1 : 2);
    if (n > 9) n -= 9;
    total += n;
  }
  return total % 10 === 0;
}

export function checkBusinessNumber(raw: string | null | undefined): BusinessNumberCheck {
  const value = (raw ?? '').trim();
  if (value.length === 0) {
    return { valid: false, message: BUSINESS_NUMBER_ERROR_REQUIRED, normalized: null };
  }
  if (!/^\d{8,9}$/.test(value)) {
    return { valid: false, message: BUSINESS_NUMBER_ERROR_FORMAT, normalized: null };
  }
  if (!isValidIsraeliId(value)) {
    return { valid: false, message: BUSINESS_NUMBER_ERROR_INVALID, normalized: null };
  }
  return { valid: true, message: null, normalized: value.padStart(9, '0') };
}
