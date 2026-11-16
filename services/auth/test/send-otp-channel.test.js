// POST /auth/send-otp carries the channel the user picked on the login
// screen to the notification service, and answers with the channel the
// code really went out on.
//
// Real route, real otp.js (generation, hashing, rate limit). Fake MySQL
// pool, fake Redis, fake notification service (global fetch).
//
// Run: node test/send-otp-channel.test.js   (needs express, bcryptjs,
// jsonwebtoken, uuid from the service's node_modules)

const http   = require('http');
const path   = require('path');
const bcrypt = require('bcryptjs');
const express = require('express');

const SRC = path.join(__dirname, '..', 'src');

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; process.stdout.write(`ok    ${name}\n`); return; }
  failed += 1;
  process.stdout.write(`FAIL  ${name}${detail === undefined ? '' : `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}\n`);
}

const logs = [];
console.log = console.warn = console.error = (...args) => { logs.push(args.map(String).join(' ')); };

function stub(rel, exports) {
  const id = require.resolve(path.join(SRC, rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

// ── fake MySQL: records every statement ───────────────────────────
const queries = [];
const otpRows = [];
stub('db.js', {
  initDb: async () => {},
  getPool: () => ({
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/INSERT INTO sms_otp/.test(sql)) {
        const [otpId, phone, code, purpose] = params;
        otpRows.push({ otpId, phone, code, purpose });
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE sms_otp/.test(sql)) return [{ affectedRows: 0 }];
      throw new Error(`fake db: unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 100)}`);
    },
  }),
});

// ── fake Redis: just enough for the rate limit ────────────────────
const counters = new Map();
stub('redis.js', {
  incr:   async (k) => { counters.set(k, (counters.get(k) || 0) + 1); return counters.get(k); },
  expire: async () => 1,
  ttl:    async () => 600,
  del:    async (k) => { counters.delete(k); return 1; },
});
const resetRateLimit = () => counters.clear();

// ── fake notification service ─────────────────────────────────────
const notifCalls = [];
let notifAnswer = null; // (body) => Response
global.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  notifCalls.push({ url: String(url), body });
  if (notifAnswer) return notifAnswer(body);
  return new Response(JSON.stringify({ sent: true, channel: body.channel || 'sms', messageId: 'm-1' }), { status: 200 });
};
const answers = (status, json) => () => new Response(JSON.stringify(json), { status });

function post(server, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      port: server.address().port, method: 'POST', path: '/auth/send-otp',
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

async function send(server, body) {
  const before = { notif: notifCalls.length, otp: otpRows.length, q: queries.length };
  const res = await post(server, body);
  return { ...res, notif: notifCalls.slice(before.notif), otp: otpRows.slice(before.otp), queries: queries.slice(before.q) };
}

async function run() {
  process.env.NOTIF_SERVICE_URL = 'http://notification.test:3006';
  const app = express();
  app.use(express.json());
  app.use('/', require(path.join(SRC, 'routes', 'auth.js')));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  // ── 1. no channel given: SMS, as the registration screens send it ──
  let r = await send(server, { phone: '050-123-4567', purpose: 'register' });
  check('no channel: 200, sent, normalised phone', r.status === 200 && r.json.sent === true && r.json.phone === '+972501234567', r.json);
  check('no channel: notification is asked for SMS', r.notif.length === 1 && r.notif[0].body.channel === 'sms', r.notif);
  check('no channel: the answer says sms', r.json.channel === 'sms', r.json);
  check('notification gets phone, code and channel, and nothing else',
    JSON.stringify(Object.keys(r.notif[0].body).sort()) === JSON.stringify(['channel', 'code', 'phone'])
    && r.notif[0].url === 'http://notification.test:3006/internal/otp', r.notif[0]);
  check('the code sent is the one stored, hashed, for this phone and purpose',
    r.otp.length === 1 && r.otp[0].phone === '+972501234567' && r.otp[0].purpose === 'register'
    && /^\d{6}$/.test(r.notif[0].body.code) && r.otp[0].code !== r.notif[0].body.code
    && await bcrypt.compare(r.notif[0].body.code, r.otp[0].code), r.otp);
  check('auth no longer reads users.whatsapp_opt_in', !r.queries.some((q) => /whatsapp_opt_in/.test(q.sql)), r.queries.map((q) => q.sql));
  check('the only statements are the existing two on sms_otp',
    r.queries.length === 2 && /UPDATE sms_otp/.test(r.queries[0].sql) && /INSERT INTO sms_otp/.test(r.queries[1].sql), r.queries.map((q) => q.sql));

  r = await send(server, { phone: '0501234567', purpose: 'login', channel: 'sms' });
  check("channel 'sms': SMS", r.status === 200 && r.notif[0].body.channel === 'sms' && r.json.channel === 'sms', r.json);

  // ── 2. WhatsApp chosen ─────────────────────────────────────────────
  resetRateLimit();
  r = await send(server, { phone: '0501234567', purpose: 'login', channel: 'whatsapp' });
  check("channel 'whatsapp': notification is asked for WhatsApp", r.notif.length === 1 && r.notif[0].body.channel === 'whatsapp', r.notif);
  check("notification sent it on WhatsApp: the answer says whatsapp", r.status === 200 && r.json.channel === 'whatsapp', r.json);

  notifAnswer = answers(200, { sent: true, channel: 'sms', messageId: 'sms-9' });
  r = await send(server, { phone: '0501234567', purpose: 'login', channel: 'whatsapp' });
  check('WhatsApp chosen but notification fell back to SMS: the answer says sms, not whatsapp',
    r.status === 200 && r.notif[0].body.channel === 'whatsapp' && r.json.channel === 'sms', r.json);

  // ── 3. notification did not confirm ────────────────────────────────
  resetRateLimit();
  notifAnswer = answers(500, { error: 'otp_send_failed' });
  r = await send(server, { phone: '0501234567', purpose: 'login', channel: 'whatsapp' });
  check('notification answers 500: still 200 sent (unchanged), channel null', r.status === 200 && r.json.sent === true && r.json.channel === null, r.json);
  notifAnswer = () => { throw new TypeError('fetch failed'); };
  r = await send(server, { phone: '0501234567', purpose: 'login' });
  check('notification unreachable: still 200 sent (unchanged), channel null', r.status === 200 && r.json.sent === true && r.json.channel === null, r.json);
  notifAnswer = answers(200, { sent: true, channel: 'carrier-pigeon' });
  r = await send(server, { phone: '0501234567', purpose: 'login' });
  check('a channel notification should never report is not passed on', r.status === 200 && r.json.channel === null, r.json);
  notifAnswer = null;

  // ── 4. bad input ───────────────────────────────────────────────────
  resetRateLimit();
  r = await send(server, { phone: '0501234567', purpose: 'login', channel: 'fax' });
  check('unknown channel: 400 invalid_channel with a Hebrew message', r.status === 400 && r.json.error === 'invalid_channel' && /[֐-׿]/.test(r.json.message), r.json);
  check('unknown channel: no code generated, nothing sent, no rate-limit slot used',
    r.otp.length === 0 && r.notif.length === 0 && counters.size === 0, { otp: r.otp.length, notif: r.notif.length, counters: [...counters] });
  r = await send(server, { purpose: 'login', channel: 'whatsapp' });
  check('missing phone is still phone_required', r.status === 400 && r.json.error === 'phone_required', r.json);
  r = await send(server, { phone: '0501234567', purpose: 'nope', channel: 'whatsapp' });
  check('bad purpose is still invalid_purpose', r.status === 400 && r.json.error === 'invalid_purpose', r.json);

  // ── 5. the rate limit is untouched ─────────────────────────────────
  resetRateLimit();
  for (let i = 0; i < 3; i += 1) await send(server, { phone: '0501234567', purpose: 'login', channel: i % 2 ? 'sms' : 'whatsapp' });
  r = await send(server, { phone: '0501234567', purpose: 'login', channel: 'sms' });
  check('the 4th send in 10 minutes is 429 whichever channel each one used', r.status === 429 && r.json.error === 'rate_limited' && r.notif.length === 0 && r.otp.length === 0, r.json);

  server.close();
  process.stdout.write(`[send-otp-channel] ${failed ? 'FAIL' : 'pass'}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => { process.stdout.write(`${err.stack}\n`); process.exit(1); });
