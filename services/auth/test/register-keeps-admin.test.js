// POST /auth/register on a phone that already has a user: a platform
// admin who registers a contractor, corporation or provider stays an
// admin. Everyone else takes the role of the entity just registered,
// as before.
//
// Real route, real otp.js. Fake MySQL pool and Redis.
//
// Run: JWT_SECRET=test node test/register-keeps-admin.test.js
//   (needs express, bcryptjs, jsonwebtoken, uuid from the service's
//   node_modules)

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const http    = require('http');
const path    = require('path');
const jwt     = require('jsonwebtoken');
const express = require('express');

const SRC = path.join(__dirname, '..', 'src');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; process.stdout.write(`ok    ${name}\n`); return; }
  failed += 1;
  process.stdout.write(`FAIL  ${name}${detail === undefined ? '' : `  (${JSON.stringify(detail)})`}\n`);
}

console.log = console.warn = console.error = () => {};

function stub(rel, exports) {
  const id = require.resolve(path.join(SRC, rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

let storedRole = null;
const updates = [];
stub('db.js', {
  initDb: async () => {},
  getPool: () => ({
    query: async (sql, params = []) => {
      if (/FROM sms_otp/.test(sql)) return [[{ otp_id: 'otp-1' }]];
      if (/SELECT id, role FROM users WHERE phone/.test(sql)) return [storedRole ? [{ id: 'u-1', role: storedRole }] : []];
      if (/^UPDATE users SET org_id/.test(sql)) { updates.push(params); storedRole = params[2]; return [{ affectedRows: 1 }]; }
      if (/SELECT full_name FROM users/.test(sql)) return [[{ full_name: 'בודק' }]];
      if (/INSERT INTO refresh_tokens/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE users SET last_login_at/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO users/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`fake db: unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 100)}`);
    },
  }),
});
stub('redis.js', { incr: async () => 1, expire: async () => 1, ttl: async () => 600, del: async () => 1, setex: async () => 'OK' });

function post(server, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      port: server.address().port, method: 'POST', path: '/auth/register',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

const register = (server, role) => post(server, {
  phone: '0525000000', full_name: 'בודק', role, org_id: `org-${role}`, org_type: role, include_tokens: true,
});

async function run() {
  const app = express();
  app.use(express.json());
  app.use('/', require(path.join(SRC, 'routes', 'auth.js')));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  // ── an admin registers a provider ─────────────────────────────────
  storedRole = 'admin';
  let r = await register(server, 'service_provider');
  check('admin registers a provider: 200', r.status === 200, r.json);
  check('users.role is written back as admin, not service_provider', updates.at(-1)[2] === 'admin' && storedRole === 'admin', updates.at(-1));
  check('the entity link is still written', updates.at(-1)[0] === 'org-service_provider' && updates.at(-1)[1] === 'service_provider', updates.at(-1));
  const claims = jwt.decode(r.json.access_token);
  check('the token says admin and carries the new entity',
    claims.role === 'admin' && claims.entity_type === 'service_provider' && claims.entity_id === 'org-service_provider', claims);
  check('the answer says admin', r.json.role === 'admin', r.json);

  r = await register(server, 'contractor');
  check('a second registration by the same admin keeps admin too', storedRole === 'admin' && jwt.decode(r.json.access_token).role === 'admin', storedRole);

  // ── anyone else: unchanged, the last registration's role ───────────
  storedRole = 'contractor';
  r = await register(server, 'corporation');
  check('a contractor registering a corporation becomes corporation, as before',
    storedRole === 'corporation' && r.json.role === 'corporation' && jwt.decode(r.json.access_token).role === 'corporation', storedRole);

  server.close();
  process.stdout.write(`[register-keeps-admin] ${failed ? 'FAIL' : 'pass'}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => { process.stdout.write(`${err.stack}\n`); process.exit(1); });
