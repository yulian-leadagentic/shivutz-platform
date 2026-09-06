// Shared helpers for seed + reset.
// Staging guard, HTTP wrapper, auth flow.

const KNOWN_STAGING_HOSTS = [
  'gateway-staging-3a12.up.railway.app',   // canonical staging (docs/ENVIRONMENTS.md)
  // pivot-staging (docs/PIVOT_STAGING_SETUP.md). Different Railway env
  // + separate DB from canonical staging. The frontend acts as a
  // functional gateway proxy (Next rewrites /api/* to the pivot
  // gateway internally), so pointing GATEWAY_URL at the frontend host
  // works — the seed doesn't need the raw gateway URL of that env.
  'frontend-pivot-staging.up.railway.app',
  // Staging aliases exposed by CLAUDE.md — the same "Staging" Railway
  // env served through the frontend container, which proxies /api/*
  // to the internal gateway. Adding both custom domains so
  // GATEWAY_URL=https://staging.buildupai.net (the URL a QA session
  // is already logged into) works without a separate flag.
  'staging.buildupai.net',
  'staging.tagidai.co',
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
 *  Returns the normalized phone (with country code).
 *
 *  RATE LIMITS (learned the hard way): the auth service caps
 *    · 3 OTPs per phone per 10-minute window
 *    · 10 OTPs per IP  per 10-minute window   ← THIS is the killer for seed
 *  On rate_limited we wait for the retryAfter the server tells us and
 *  try once more, up to `retriesLeft`. Zero retries left → throw (loud).
 *  The previous "swallow rate_limited silently" masked total corp-create
 *  failure — every downstream POST /organizations/corporations then
 *  400'd with phone_not_verified because verify never happened.
 */
export async function verifyRegisterOtp(base, phone, retriesLeft = 2) {
  const send = await post(base, '/api/auth/send-otp', { phone, purpose: 'register' });
  if (send.status === 429 || /rate_limited/i.test(send.raw)) {
    if (retriesLeft <= 0) {
      throw new Error(`send-otp rate_limited for ${phone} after retries; ${send.raw.slice(0, 200)}`);
    }
    const wait = Math.min(605, Math.max(30, (send.body?.retryAfter ?? 60) + 5));
    console.log(`  … rate_limited on ${phone}; waiting ${wait}s and retrying (${retriesLeft} left)`);
    await sleep(wait * 1000);
    return verifyRegisterOtp(base, phone, retriesLeft - 1);
  }
  if (!send.ok) throw new Error(`send-otp failed ${send.status}: ${send.raw.slice(0, 200)}`);
  const normPhone = send.body?.phone ?? phone;
  const verify = await post(base, '/api/auth/verify-otp',
    { phone: normPhone, code: MASTER_OTP, purpose: 'register' });
  if (!verify.ok) throw new Error(`verify-otp failed ${verify.status}: ${verify.raw.slice(0, 200)}`);
  return normPhone;
}

/** Full login: send-otp('login') + login/otp → access_token + refresh_token.
 *  Handles the "single membership" path AND the multi-membership path
 *  (by calling /auth/select-entity for the caller-specified entity).
 *
 *  Retries on rate_limited (same 10/IP/10-min ceiling as verifyRegisterOtp).
 *  Without this, seeding 10 corp phones back-to-back exhausts the IP quota
 *  after ~5 and the remaining logins fail — leaving the corps unable to
 *  post ads. */
export async function loginAs(base, phone, entityId, entityType, retriesLeft = 2) {
  const send = await post(base, '/api/auth/send-otp', { phone, purpose: 'login' });
  if (send.status === 429 || /rate_limited/i.test(send.raw)) {
    if (retriesLeft <= 0) {
      throw new Error(`send-otp(login) rate_limited for ${phone} after retries; ${send.raw.slice(0, 200)}`);
    }
    const wait = Math.min(605, Math.max(30, (send.body?.retryAfter ?? 60) + 5));
    console.log(`  … login rate_limited on ${phone}; waiting ${wait}s and retrying (${retriesLeft} left)`);
    await sleep(wait * 1000);
    return loginAs(base, phone, entityId, entityType, retriesLeft - 1);
  }
  if (!send.ok) throw new Error(`send-otp(login) failed ${send.status}: ${send.raw.slice(0, 200)}`);
  const normPhone = send.body?.phone ?? phone;
  const login = await post(base, '/api/auth/login/otp', { phone: normPhone, code: MASTER_OTP });
  if (!login.ok) throw new Error(`login/otp failed ${login.status}: ${login.raw.slice(0, 200)}`);
  let token = login.body?.access_token;

  // Auto-select the requested entity when the auth service demands
  // it. Two callers hit this branch:
  //  1. seedContractor pre-existing → corpRow.id is null on the
  //     seed's second/third run. The old code required both
  //     entityId AND entityType before calling select-entity, so
  //     when id was null it silently skipped, `token` stayed the
  //     bootstrap-only value (or undefined), and the throw below
  //     killed the whole per-corp branch. That's the direct cause
  //     of corps 5 + 13 producing zero ads on rerun.
  //  2. Anyone calling loginAs with only entityType (no id) —
  //     which is the natural API for "log in as a corporation
  //     without knowing the row id upfront".
  // Fix: when needs_entity_selection is true and we know
  // entityType, look up memberships with the bootstrap token,
  // find the first matching one, call select-entity with the
  // discovered id.
  if (login.body?.needs_entity_selection && entityType) {
    if (!token) throw new Error(`login/otp needs_entity_selection but no bootstrap token for ${phone}`);
    let resolvedId = entityId;
    if (!resolvedId) {
      const m = await get(base, '/api/auth/memberships',
        { Authorization: `Bearer ${token}` });
      const list = Array.isArray(m.body?.memberships) ? m.body.memberships : [];
      const match = list.find((x) => x.entity_type === entityType);
      resolvedId = match?.entity_id;
      if (!resolvedId) {
        throw new Error(`login/otp needs_entity_selection but no ${entityType} membership on ${phone}`);
      }
    }
    const pick = await post(base, '/api/auth/select-entity',
      { entity_id: resolvedId, entity_type: entityType },
      { Authorization: `Bearer ${token}` });
    if (!pick.ok) throw new Error(`select-entity failed ${pick.status}: ${pick.raw.slice(0, 200)}`);
    token = pick.body?.access_token;
  }
  // {prospect:true} bodies are a real auth-service response: the
  // phone hasn't completed registration as a user (may have been
  // touched by a contractor-intent OTP send that never verified).
  // login/otp returns 200 with a `prospect` marker instead of a
  // token. Surface that shape so the caller can see WHY there was
  // no token, not just that there wasn't one.
  if (!token) {
    if (login.body?.prospect) {
      throw new Error(`login returned prospect state for ${phone} (intent=${login.body?.intent}); phone needs registration completion before login can issue a token`);
    }
    throw new Error(`no access_token after login for ${phone}; body=${JSON.stringify(login.body)?.slice(0, 200)}`);
  }
  return token;
}

/** Small pause between requests so we don't overwhelm auth's OTP
 *  rate limiter (3 per phone per 10 minutes). Each fixture uses a
 *  UNIQUE phone so the per-phone limit is never hit — but 20ms
 *  between requests still keeps the server happy. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
