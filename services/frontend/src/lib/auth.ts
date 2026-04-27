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

/** Display name derived from full_name → email → phone (whichever is set). */
export function getDisplayName(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return (payload.full_name as string) ?? (payload.email as string) ?? (payload.phone as string) ?? null;
}

/** The user's role within the currently selected entity (owner/admin/operator/viewer). */
export function getMembershipRole(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return (payload.membership_role as string) ?? null;
}

/** Returns true when the JWT has no entity context yet (entity selection required). */
export function needsEntitySelection(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  return !payload.entity_id;
}

export function getEntityId(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return (payload.entity_id as string) ?? null;
}

export function getEntityType(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return (payload.entity_type as string) ?? null;
}
