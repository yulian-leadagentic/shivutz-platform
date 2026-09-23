// R30 §9 — single source of truth for client-side email validation.
//
// Backend authority is pydantic EmailStr (ads.py, providers.py, etc.);
// this file only exists so the browser can catch the obvious typos
// before the request round-trips, and so the visitor sees a Hebrew
// message next to the field instead of the browser's English tooltip.
//
// Pattern: one non-space non-@ chunk, `@`, another chunk with at
// least one dot, another chunk. Matches the same shape the register
// pages already used inline; extracted here so the three registration
// flows and any future form share one rule.

export const EMAIL_ERROR_INVALID =
  'כתובת אימייל לא תקינה — לדוגמה name@company.co.il';
export const EMAIL_ERROR_REQUIRED = 'כתובת אימייל היא שדה חובה';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface EmailCheck {
  valid: boolean;
  /** Hebrew message for the failure case. `null` on valid. */
  message: string | null;
  /** Trimmed value the caller should send to the server. `null` on invalid. */
  normalized: string | null;
}

export function checkEmail(
  raw: string | null | undefined,
  { required = true }: { required?: boolean } = {},
): EmailCheck {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    return {
      valid: !required,
      message: required ? EMAIL_ERROR_REQUIRED : null,
      normalized: required ? null : '',
    };
  }
  if (!EMAIL_RE.test(trimmed)) {
    return { valid: false, message: EMAIL_ERROR_INVALID, normalized: null };
  }
  return { valid: true, message: null, normalized: trimmed };
}
