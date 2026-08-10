// Shared helpers for seed + reset.
// Staging guard, HTTP wrapper, auth flow.

const KNOWN_STAGING_HOSTS = [
  'gateway-staging-3a12.up.railway.app',   // per docs/ENVIRONMENTS.md
];

/** Return the gateway base URL after enforcing the staging guard.
 *  Fails LOUD if the URL doesn't match a known staging host — the
 *  worst possible outcome here is seeding production, so we refuse
 *  to trust "just override the env if you know what you're doing".
 *  Explicit staging or bust. */
export function requireStagingGateway() {
  const url = process.env.GATEWAY_URL
    || 'https://gateway-staging-3a12.up.railway.app';
  let host;
  try { host = new URL(url).host; }
  catch { throw new Error(`GATEWAY_URL "${url}" is not a valid URL`); }
  if (!KNOWN_STAGING_HOSTS.includes(host)) {
    throw new Error(
      `\n*** REFUSING TO RUN ***\n` +
      `GATEWAY_URL host "${host}" is not a known staging host.\n` +
      `Allowed: ${KNOWN_STAGING_HOSTS.join(', ')}\n` +
      `To seed a different environment, add the host to KNOWN_STAGING_HOSTS in lib.mjs.\n` +
      `production must NEVER be added here.\n`
    );
  }
  return url.replace(/\/+$/, '');
}

/** Master OTP for staging bypass. Falls back to the doc'd default. */
export const MASTER_OTP = process.env.MASTER_OTP || '999999';

/** POST helper — throws a readable error on non-2xx. */
export async function post(base, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, body: json, raw: text };
}

/** GET helper — same shape. */
export async function get(base, path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, body: json, raw: text };
}

/** Send-OTP + verify-OTP for the register purpose. Staging bypasses
 *  SMS via MASTER_OTP so the code we send is always known.
 *  Returns the normalized phone (with country code). */
export async function verifyRegisterOtp(base, phone) {
  const send = await post(base, '/api/auth/send-otp', { phone, purpose: 'register' });
  if (!send.ok) throw new Error(`send-otp failed ${send.status}: ${send.raw.slice(0, 200)}`);
  const normPhone = send.body?.phone ?? phone;
  const verify = await post(base, '/api/auth/verify-otp',
    { phone: normPhone, code: MASTER_OTP, purpose: 'register' });
  if (!verify.ok) throw new Error(`verify-otp failed ${verify.status}: ${verify.raw.slice(0, 200)}`);
  return normPhone;
}

/** Full login: send-otp('login') + login/otp → access_token + refresh_token.
 *  Handles the "single membership" path AND the multi-membership path
 *  (by calling /auth/select-entity for the caller-specified entity). */
export async function loginAs(base, phone, entityId, entityType) {
  const send = await post(base, '/api/auth/send-otp', { phone, purpose: 'login' });
  if (!send.ok) throw new Error(`send-otp(login) failed ${send.status}: ${send.raw.slice(0, 200)}`);
  const normPhone = send.body?.phone ?? phone;
  const login = await post(base, '/api/auth/login/otp', { phone: normPhone, code: MASTER_OTP });
  if (!login.ok) throw new Error(`login/otp failed ${login.status}: ${login.raw.slice(0, 200)}`);
  let token = login.body?.access_token;
  if (login.body?.needs_entity_selection && entityId && entityType) {
    // Re-issue JWT scoped to the requested entity.
    const pick = await post(base, '/api/auth/select-entity',
      { entity_id: entityId, entity_type: entityType },
      { Authorization: `Bearer ${token}` });
    if (!pick.ok) throw new Error(`select-entity failed ${pick.status}: ${pick.raw.slice(0, 200)}`);
    token = pick.body?.access_token;
  }
  if (!token) throw new Error(`no access_token after login for ${phone}`);
  return token;
}

/** Small pause between requests so we don't overwhelm auth's OTP
 *  rate limiter (3 per phone per 10 minutes). Each fixture uses a
 *  UNIQUE phone so the per-phone limit is never hit — but 20ms
 *  between requests still keeps the server happy. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
