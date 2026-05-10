// `||` (not `??`) so that an empty-string build arg also falls back —
// docker-compose used to leak NEXT_PUBLIC_API_URL='' into the bundle,
// which produced relative `/auth/...` fetches that 404'd on port 3008.
export const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

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
async function extractErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as unknown;
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const errObj = b.error;
    if (errObj && typeof errObj === 'object') {
      const e = errObj as Record<string, unknown>;
      if (typeof e.message === 'string') return e.message;
      if (typeof e.code === 'string')    return e.code;
    }
    if (typeof errObj === 'string') return errObj;
    if (typeof b.detail === 'string') return b.detail;
    // FastAPI HTTPException(detail={...}) serializes as `{"detail": {code, message, ...}}`.
    if (b.detail && typeof b.detail === 'object' && !Array.isArray(b.detail)) {
      const d = b.detail as Record<string, unknown>;
      if (typeof d.message === 'string') return d.message;
      if (typeof d.code    === 'string') return d.code;
    }
    if (Array.isArray(b.detail) && b.detail.length > 0) {
      const first = b.detail[0] as Record<string, unknown>;
      if (typeof first?.msg === 'string') {
        return translatePydanticMessage(first.msg, first.loc);
      }
    }
  }
  return res.statusText;
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
        if (!retry.ok) throw new Error(await extractErrorMessage(retry));
        if (retry.status === 204) return undefined as T;
        return retry.json() as Promise<T>;
      }
    }
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(await extractErrorMessage(res));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
