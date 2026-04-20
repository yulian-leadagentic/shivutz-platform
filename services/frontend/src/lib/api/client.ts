export const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

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

/** Attempt a silent token refresh. Returns new access token on success, null on failure. */
async function tryRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
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
  }
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
    if (Array.isArray(b.detail) && b.detail.length > 0) {
      const first = b.detail[0] as Record<string, unknown>;
      if (typeof first?.msg === 'string') return first.msg;
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
