// R33 A1 · x-user-is-admin is the gateway's word, never the caller's.
//
// Backends now ask "is this a platform admin" by reading
// x-user-is-admin instead of x-user-role, because x-user-role carries
// the entity the user is acting as and an admin who picked an entity
// stopped looking like an admin. That makes two things load-bearing:
//
//   1. the header is set from the JWT's role and nothing else, and is
//      REMOVED for every caller who is not an admin
//   2. a caller cannot send it: it is stripped at ingress
//
// and one more, about the paths themselves:
//
//   3. an admin-only path is never treated as public, so the role
//      guard cannot be skipped by a "GET is public" prefix rule
//
// Same shape as forged-identity-headers.test.js: built-ins only, the
// real modules, and a comment-aware check that index.js still uses
// them. Run: node test/admin-identity-header.test.js

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { CLIENT_FORBIDDEN_HEADERS, stripIdentityHeaders } = require('../src/stripIdentityHeaders');
const { ADMIN_ONLY, isAdminOnlyPath, attachUserHeaders } = require('../src/identityHeaders');

const ADMIN_WITH_CORP = {
  sub: 'u-admin', role: 'admin',
  entity_type: 'corporation', entity_id: 'corp-1', membership_role: 'owner',
};
const ADMIN_PLAIN   = { sub: 'u-admin', role: 'admin' };
const CORP_USER     = { sub: 'u-corp', role: 'corporation', entity_type: 'corporation', entity_id: 'corp-2' };
const CONTRACTOR    = { sub: 'u-con',  role: 'contractor',  entity_type: 'contractor',  entity_id: 'con-1' };

// A stand-in for one request through the gateway: the real ingress
// strip, then the real projection for whoever the token says this is
// (null = no token), then echo what a downstream service would read.
function buildServer(userFor) {
  return http.createServer((req, res) => {
    stripIdentityHeaders(req.headers);
    const user = userFor(req);
    if (user) attachUserHeaders(req.headers, user);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      is_admin: req.headers['x-user-is-admin'] ?? null,
      role:     req.headers['x-user-role'] ?? null,
    }));
  });
}

function get(server, headers) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    http.get({ port, path: '/api/marketplace/admin/categories', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function run() {
  const failures = [];
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };

  // ── 1. the projection ────────────────────────────────────────────
  let h = attachUserHeaders({}, ADMIN_WITH_CORP);
  expect(h['x-user-is-admin'] === '1', 'admin acting as a corporation did not get x-user-is-admin');
  expect(h['x-user-role'] === 'corporation',
    'x-user-role changed meaning: an admin acting as a corporation must still read as corporation');
  expect(h['x-entity-id'] === 'corp-1' && h['x-entity-type'] === 'corporation',
    'entity context was lost for an admin acting as a corporation');

  h = attachUserHeaders({}, ADMIN_PLAIN);
  expect(h['x-user-is-admin'] === '1' && h['x-user-role'] === 'admin',
    'admin with no entity context lost its admin headers');

  for (const [name, user] of [['corporation', CORP_USER], ['contractor', CONTRACTOR]]) {
    h = attachUserHeaders({}, user);
    expect(!('x-user-is-admin' in h), `${name} user was given x-user-is-admin`);
    // A value already sitting on the request must not survive.
    h = attachUserHeaders({ 'x-user-is-admin': '1' }, user);
    expect(!('x-user-is-admin' in h),
      `x-user-is-admin was left in place for a ${name} user: the header must be deleted, not just not set`);
  }
  for (const role of ['Admin', 'ADMIN', 'administrator', '', undefined, null, 1, true]) {
    h = attachUserHeaders({}, { sub: 'u', role, entity_type: 'corporation', entity_id: 'c' });
    expect(!('x-user-is-admin' in h), `role ${JSON.stringify(role)} was treated as admin`);
  }
  // entity_type 'admin' is not a way in: only users.role decides.
  h = attachUserHeaders({}, { sub: 'u', role: 'contractor', entity_type: 'admin', entity_id: 'x' });
  expect(!('x-user-is-admin' in h), 'entity_type "admin" produced x-user-is-admin');

  // ── 2. a caller cannot send it ───────────────────────────────────
  expect(CLIENT_FORBIDDEN_HEADERS.includes('x-user-is-admin'),
    'x-user-is-admin is not in CLIENT_FORBIDDEN_HEADERS');

  const cases = [
    ['no token, forged header',            null,           null],
    ['corporation token, forged header',   CORP_USER,      null],
    ['contractor token, forged header',    CONTRACTOR,     null],
    ['admin token',                        ADMIN_WITH_CORP, '1'],
  ];
  for (const [name, user, want] of cases) {
    const server = buildServer(() => user).listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const seen = await get(server, { 'x-user-is-admin': '1', 'X-User-Is-Admin': '1' });
      expect(seen.is_admin === want,
        `${name}: downstream saw x-user-is-admin=${JSON.stringify(seen.is_admin)}, expected ${JSON.stringify(want)}`);
    } finally {
      server.close();
    }
  }

  // ── 3. admin-only paths ──────────────────────────────────────────
  for (const url of ['/api/admin', '/api/admin/ads', '/api/marketplace/admin',
                     '/api/marketplace/admin/categories', '/api/marketplace/admin/tiers/x']) {
    expect(isAdminOnlyPath(url), `${url} is not admin-only`);
  }
  // The plan catalog is public (the sign-up page shows it to visitors).
  // It used to sit under the admin prefix; it must never go back there.
  for (const url of ['/api/marketplace', '/api/marketplace/categories', '/api/marketplace/my/subscriptions',
                     '/api/marketplace/subscriptions/catalog',
                     '/api/search', '/api/organizations/providers/me']) {
    expect(!isAdminOnlyPath(url), `${url} became admin-only`);
  }
  expect(ADMIN_ONLY.length >= 2, 'ADMIN_ONLY looks truncated');

  // ── 4. index.js still uses all of it ─────────────────────────────
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  const live = src.split('\n').map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*'));
  const has = (re) => live.some((l) => re.test(l));

  expect(has(/require\(['"]\.\/identityHeaders['"]\)/), 'src/index.js no longer requires ./identityHeaders');
  expect(live.filter((l) => /attachUserHeaders\(\s*req\.headers\s*,\s*user\s*\)/.test(l)).length === 2,
    'src/index.js should call attachUserHeaders(req.headers, user) on both the private and the public-but-logged-in path');
  expect(!has(/function attachUserHeaders/),
    'src/index.js defines its own attachUserHeaders again: the tested one is no longer the one in use');
  expect(has(/const adminOnly = isAdminOnlyPath\(url\)/), 'src/index.js no longer computes adminOnly from isAdminOnlyPath');
  expect(has(/const isPublic = !adminOnly && \(/),
    'isPublic no longer excludes admin-only paths: GET /api/marketplace/admin/* would be public again');
  expect(has(/if \(adminOnly && user\.role !== 'admin'\)/),
    'the role guard for admin-only paths is gone from src/index.js');

  if (failures.length) {
    console.error('[admin-identity-header] FAIL');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('[admin-identity-header] pass — set from the JWT only, stripped at ingress, admin paths never public');
}

run().catch((e) => { console.error(e); process.exit(1); });
