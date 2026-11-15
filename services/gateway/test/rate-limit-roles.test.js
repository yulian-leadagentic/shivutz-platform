// R37 Part 5 item 1 (D8) · a service provider gets the ceiling a
// contractor and a corporation get.
//
// The limiter looks the caller's role up in a table and falls back to
// the anonymous ceiling when the role is not listed. `service_provider`
// was not listed, so a logged-in provider browsed on the anonymous
// budget (60 a minute) while a contractor had 200.
//
// The limiter is exercised as the gateway calls it. Redis is replaced
// by an in-memory counter; nothing else is faked.
// Run: node test/rate-limit-roles.test.js

const Module = require('module');

class FakeRedis {
  constructor() { this.counts = new Map(); }
  async incr(key) { const n = (this.counts.get(key) || 0) + 1; this.counts.set(key, n); return n; }
  async expire() { return 1; }
}
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'ioredis') return FakeRedis;
  return realLoad.call(this, request, ...rest);
};

for (const name of ['RATE_LIMIT_ANON', 'RATE_LIMIT_USER', 'RATE_LIMIT_ADMIN',
  'RATE_LIMIT_TELEMETRY_ANON', 'RATE_LIMIT_TELEMETRY_USER']) delete process.env[name];

const { rateLimiter } = require('../src/rateLimit');

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) { passed += 1; console.log(`ok    ${label}`); }
  else      { failed += 1; console.log(`FAIL  ${label}${extra ? `  [${extra}]` : ''}`); }
}

let caller = 0;
// How many requests in one minute get through for this role on this
// path, counted on a caller nobody else shares a bucket with.
async function allowed(role, url = '/api/marketplace') {
  caller += 1;
  const headers = role ? { 'x-user-role': role, 'x-user-id': `u-${caller}` } : {};
  let ok = 0;
  for (let i = 0; i < 700; i += 1) {
    const req = { method: 'GET', path: '/', originalUrl: url, headers, ip: `10.0.0.${caller}`, socket: {} };
    const res = { status() { return this; }, setHeader() { return this; }, json() { return this; } };
    if (await rateLimiter(req, res)) break;
    ok += 1;
  }
  return ok;
}

(async () => {
  const contractor  = await allowed('contractor');
  const corporation = await allowed('corporation');
  const provider    = await allowed('service_provider');
  const anon        = await allowed(null);

  check('a contractor gets 200 a minute', contractor === 200, String(contractor));
  check('a corporation gets 200 a minute', corporation === 200, String(corporation));
  check('a service provider gets the same 200', provider === 200, String(provider));
  check('an anonymous caller gets 60', anon === 60, String(anon));
  check('a provider is no longer on the anonymous ceiling', provider > anon);

  const teleContractor = await allowed('contractor', '/api/events/batch');
  const teleProvider   = await allowed('service_provider', '/api/events/batch');
  check('telemetry: a provider gets what a contractor gets', teleProvider === teleContractor && teleProvider === 400,
    `${teleProvider} vs ${teleContractor}`);

  // What made the gap possible in the first place. Pinned so the next
  // role added to the system is added to the table too, on purpose.
  check('a role the table does not list still falls back to the anonymous ceiling',
    (await allowed('some_new_role')) === 60);

  console.log(`[rate-limit-roles] ${failed ? 'FAIL' : 'pass'}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
