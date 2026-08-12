// `||` (not `??`) so that an empty-string build arg also falls back —
// docker-compose used to leak NEXT_PUBLIC_API_URL='' into the bundle,
// which produced relative `/auth/...` fetches that 404'd on port 3008.
import { mapApiError, type ApiErrorPayload } from './errors';

export const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

/**
 * Turn a server-stored file URL into something the browser can fetch.
 *
 * Uploaded-document rows store `file_url` as a path-only string starting
 * with `/api/...` so the same DB rows work across dev/staging/prod. The
 * browser however is sitting on the FRONTEND origin (e.g. localhost:3008
 * in dev), not the gateway origin (localhost:3000). A raw `<a href>` with
 * `/api/uploads/...` would 404 against the frontend dev server.
 *
 * Strategy: pull the origin off BASE (which already points at the gateway)
 * and stitch it onto the stored path. URLs that are already absolute
 * (http://, https://, blob:) are returned unchanged.
 *
 * Externally-hosted URLs the backend may store (e.g. Cloudinary or a
 * "קישור חיצוני" the user pasted) come back as-is.
 */
export function fileHref(file_url: string | null | undefined): string {
  if (!file_url) return '';
  if (/^(https?:|blob:|data:)/i.test(file_url)) return file_url;
  if (!file_url.startsWith('/')) return file_url;
  try {
    // BASE typically ends in `/api`; strip it to get the bare origin
    // (the file_url itself already carries `/api/uploads/...`).
    const origin = new URL(BASE).origin;
    return `${origin}${file_url}`;
  } catch {
    return file_url;
  }
}

export function getToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((r) => r.startsWith('access_token='))
    ?.split('=')[1];
}

export function getRefreshToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((r) => r.startsWith('refresh_token='))
    ?.split('=')[1];
}

// In-flight refresh promise — shared across parallel apiFetch calls.
// The refresh token is single-use (the auth service revokes it on first
// use), so without serialization, parallel 401s would each try to
// refresh, only one would succeed, and the others would fail with a
// "token revoked" 401 and bounce the user to /login. By caching the
// promise we ensure only one network call to /auth/refresh, and every
// caller sees the same result.
let refreshInFlight: Promise<string | null> | null = null;

/** Attempt a silent token refresh. Returns new access token on success, null on failure. */
async function tryRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refresh = getRefreshToken();
  if (!refresh) return null;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { access_token: string; refresh_token?: string };
      const { saveTokens } = await import('../auth');
      saveTokens(data.access_token, data.refresh_token ?? refresh);
      return data.access_token;
    } catch {
      return null;
    } finally {
      // Clear after a short delay so a retry-after-401 in the same tick
      // can still piggy-back on the result, but a brand-new refresh need
      // doesn't get stuck on a stale promise.
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();
  return refreshInFlight;
}

// Field-name → Hebrew label for the most-touched API payloads.
// Surfaced when a Pydantic / FastAPI validation error names a field
// the user shouldn't have to read in English.
const DEFAULT_FIELD_HE: Record<string, string> = {
  visa_valid_until:        'תאריך תוקף ויזה',
  visa_expiry_date:        'תאריך תוקף ויזה',
  start_date:              'תאריך התחלה',
  end_date:                'תאריך סיום',
  project_start_date:      'תאריך תחילת פרויקט',
  full_name:               'שם מלא',
  first_name:              'שם פרטי',
  last_name:               'שם משפחה',
  phone:                   'טלפון',
  email:                   'אימייל',
  profession_type:         'מקצוע',
  origin_country:          'מדינת מוצא',
  region:                  'אזור',
  experience_range:        'טווח ניסיון',
  quantity:                'כמות',
  business_number:         'מספר ע.מ / ח.פ',
  company_name_he:         'שם חברה',
};

/**
 * Best-effort translation of common Pydantic / FastAPI validation
 * error patterns into Hebrew. Default English messages
 * ("Input should be a valid date or datetime, invalid character in
 * year") leak through to end users on a Hebrew-only UI; this maps
 * the most common ones we hit to a clean Hebrew sentence + the
 * field name when we can pull it out of the `loc` array. Anything
 * we don't recognize falls back to the original — still English,
 * but at least not silently dropped.
 */
function translatePydanticMessage(msg: string, loc?: unknown): string {
  const fieldKey = Array.isArray(loc) && loc.length > 0
    ? String(loc[loc.length - 1])
    : '';
  const fieldHe = DEFAULT_FIELD_HE[fieldKey] ?? fieldKey;
  const lower = msg.toLowerCase();

  if (lower.includes('valid date') || lower.includes('valid datetime') || lower.includes('invalid character in year')) {
    return fieldHe ? `תאריך לא תקין בשדה "${fieldHe}". יש להשתמש בפורמט YYYY-MM-DD או DD/MM/YYYY.` : 'תאריך לא תקין. יש להשתמש בפורמט YYYY-MM-DD או DD/MM/YYYY.';
  }
  if (lower.includes('field required') || lower.includes('missing')) {
    return fieldHe ? `שדה חובה חסר: ${fieldHe}` : 'שדה חובה חסר';
  }
  if (lower.includes('valid email')) {
    return 'כתובת אימייל לא תקינה';
  }
  if (lower.includes('valid integer') || lower.includes('valid number')) {
    return fieldHe ? `ערך מספרי לא תקין בשדה "${fieldHe}"` : 'ערך מספרי לא תקין';
  }
  if (lower.includes('string should have at least')) {
    return fieldHe ? `הערך בשדה "${fieldHe}" קצר מדי` : 'הערך קצר מדי';
  }
  if (lower.includes('string should have at most')) {
    return fieldHe ? `הערך בשדה "${fieldHe}" ארוך מדי` : 'הערך ארוך מדי';
  }
  return msg;
}

/**
 * Extract a human-readable error message from an API response body.
 *
 * Target (unified) shape: { error: { code, message, details? } }
 * Legacy shapes tolerated during rollout:
 *   { error: "string" }               (Node services, gateway)
 *   { detail: "string" }              (old FastAPI)
 *   { detail: [{ msg, loc, ... }] }   (FastAPI validation errors)
 */
// Parse a non-2xx response body into a shape mapApiError understands.
// Kept small: pass the WHOLE body through when we can, so the central
// mapper sees `message` + `error`/`code` together and can prefer the
// server's Hebrew string.
async function extractErrorPayload(res: Response): Promise<ApiErrorPayload & { _raw: string }> {
  const body = await res.json().catch(() => null) as unknown;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;

    // P0-1 shape from Node services: { error: code, message: hebrew, ... }
    if (typeof b.error === 'string' || typeof b.message === 'string') {
      return { ...b as ApiErrorPayload, _raw: (b.message as string) || (b.error as string) || res.statusText };
    }
    // Node legacy: { error: { message, code } }
    if (b.error && typeof b.error === 'object') {
      const e = b.error as Record<string, unknown>;
      return { ...e, error: e.code as string, message: e.message as string, _raw: (e.message as string) || (e.code as string) || res.statusText };
    }
    // FastAPI: { detail: "..." } OR { detail: {message, code} } OR { detail: [{msg, loc, ...}] }
    // For dict detail (e.g. reveal-paywall's {code, tier, used, limit}),
    // spread the whole payload so downstream can read the extra fields
    // via err.cause — otherwise tier/used/limit would be lost.
    if (typeof b.detail === 'string') return { error: b.detail as string, _raw: b.detail as string };
    if (b.detail && typeof b.detail === 'object' && !Array.isArray(b.detail)) {
      const d = b.detail as Record<string, unknown>;
      return { ...d, error: d.code as string, message: d.message as string, _raw: (d.message as string) || (d.code as string) || res.statusText };
    }
    if (Array.isArray(b.detail) && b.detail.length > 0) {
      const first = b.detail[0] as Record<string, unknown>;
      if (typeof first?.msg === 'string') {
        const translated = translatePydanticMessage(first.msg, first.loc);
        return { message: translated, _raw: translated };
      }
    }
  }
  return { _raw: res.statusText };
}

/**
 * Translate raw backend error strings (SQL, internal codes, network
 * messages) into plain-Hebrew sentences a user can act on. Pydantic
 * messages are already handled in translatePydanticMessage above —
 * this layer catches everything else that leaks through.
 *
 * Strategy: regex/keyword matches against known patterns. Anything
 * unrecognized is returned unchanged so we don't accidentally hide
 * useful diagnostics during development.
 */
function friendlyError(raw: string): string {
  if (!raw) return 'אירעה שגיאה. נסה שוב';
  const m = raw;

  // ── MySQL / SQL constraint violations ──────────────────────────────
  // "Duplicate entry '0123456789' for key 'business_number'"
  if (/duplicate entry/i.test(m)) {
    if (/business_number|tax_id|company_id/i.test(m)) return 'מספר ע.מ / ח.פ זה כבר רשום במערכת';
    if (/email/i.test(m))                              return 'כתובת אימייל זו כבר רשומה במערכת';
    if (/phone/i.test(m))                              return 'מספר טלפון זה כבר רשום במערכת';
    return 'הערך שהזנת כבר קיים במערכת';
  }
  if (/foreign key constraint|cannot add or update a child row/i.test(m)) {
    return 'הפעולה אינה אפשרית — קיימים פריטים תלויים';
  }
  if (/cannot delete or update a parent row/i.test(m)) {
    return 'לא ניתן למחוק — קיימים פריטים שתלויים בערך זה';
  }

  // Auth/OTP codes (user_not_found, already_registered, phone_not_verified,
  // rate_limited, etc.) are NOT translated here — the login + register
  // pages each have their own mapper that adds context-specific hints
  // ("חזור לשלב הראשון", inline register CTA, etc.). Passing the raw
  // code lets those handlers continue to specialize. The truly generic
  // codes below have no per-page specialization, so are safe to translate.
  if (m === 'forbidden')                  return 'אין לך הרשאה לבצע פעולה זו';

  // ── Network / infra ──────────────────────────────────────────────
  if (/networkerror|failed to fetch|load failed/i.test(m)) return 'תקלת רשת. בדוק את החיבור ונסה שוב';
  if (/timeout|timed out/i.test(m))                        return 'הפעולה ארכה יותר מדי. נסה שוב';
  if (/server error|internal server error/i.test(m))       return 'תקלה בשרת. נסה שוב בעוד מספר רגעים';

  // ── Pure English fallbacks that occasionally leak ────────────────
  if (m === 'Unauthorized') return 'נדרשת התחברות';
  if (m === 'Not Found' || m === 'not_found') return 'הפריט לא נמצא';

  return raw;
}

// Central error-to-Hebrew pipeline: parse body → try SQL/network
// pattern matching (friendlyError catches things the backend can't
// pre-tag, like MySQL duplicate-entry errors) → fall through to the
// mapApiError code lookup → generic default. mapApiError itself
// prefers a server-supplied `message` when present, so P0-1 responses
// display verbatim without touching the frontend map.
async function toHebrewAndPayload(res: Response): Promise<{ hebrew: string; payload: ApiErrorPayload & { status: number } }> {
  const payload = await extractErrorPayload(res);
  const friendly = friendlyError(payload._raw);
  const hebrew = (friendly !== payload._raw && /[֐-׿]/.test(friendly))
    ? friendly
    : mapApiError(payload);
  return { hebrew, payload: { ...payload, status: res.status } };
}

// Custom Error whose `.cause` carries the structured server payload
// (status, code, and any extra fields like tier/used/limit). Callers
// that just read `.message` continue to work; callers that need
// structured detail (paywall gating, quota surfacing) read `.cause`.
export class ApiError extends Error {
  cause: ApiErrorPayload & { status: number };
  constructor(hebrew: string, payload: ApiErrorPayload & { status: number }) {
    super(hebrew);
    this.name = 'ApiError';
    this.cause = payload;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (res.status === 401 && typeof window !== 'undefined') {
    const newToken = await tryRefresh();
    if (newToken) {
      const retryHeaders: HeadersInit = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newToken}`,
        ...(options.headers as Record<string, string> | undefined),
      };
      const retry = await fetch(`${BASE}${path}`, { ...options, headers: retryHeaders });
      if (retry.status !== 401) {
        if (!retry.ok) {
          const { hebrew, payload } = await toHebrewAndPayload(retry);
          throw new ApiError(hebrew, payload);
        }
        if (retry.status === 204) return undefined as T;
        return retry.json() as Promise<T>;
      }
    }
    window.location.href = '/login';
    throw new ApiError('Unauthorized', { error: 'unauthorized', status: 401 });
  }
  if (!res.ok) {
    const { hebrew, payload } = await toHebrewAndPayload(res);
    throw new ApiError(hebrew, payload);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
