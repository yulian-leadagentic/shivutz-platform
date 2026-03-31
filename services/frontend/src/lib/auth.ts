import Cookies from 'js-cookie';

const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';

export function saveTokens(access: string, refresh: string) {
  Cookies.set(ACCESS_KEY, access, { expires: 1 / 96, sameSite: 'lax' }); // 15 min
  Cookies.set(REFRESH_KEY, refresh, { expires: 7, sameSite: 'lax' });
}

export function clearTokens() {
  Cookies.remove(ACCESS_KEY);
  Cookies.remove(REFRESH_KEY);
}

export function getAccessToken() {
  return Cookies.get(ACCESS_KEY);
}

export function isLoggedIn() {
  return !!getAccessToken();
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Pad base64 if needed
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getRoleFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return (payload.role as string) ?? null;
}
