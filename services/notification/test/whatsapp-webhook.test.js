// R35 §2 · the Meta webhook: handshake, signature, dedup, statuses.
//
// The route is public. Three things stand between it and anyone who
// finds the URL, and each has its own section below:
//   * the GET handshake only answers the verify token we chose
//   * a POST is processed only if X-Hub-Signature-256 matches an HMAC
//     of the exact bytes received, keyed with the app secret
//   * a wamid is processed once, however many times Meta delivers it
//
// The app is built the way src/index.js builds it (the last section
// checks index.js still does), with real express and the real router,
// handler, dispatcher and Meta sender behind it. Only the database,
// the SMS provider and the network are fakes.
//
// Run: node test/whatsapp-webhook.test.js

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  check, finish, captureLogs, stubModule, load, fakeDb, fakeNetwork, settle, request, SRC,
} = require('./helpers');

const APP_SECRET   = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';
const NUMBER_ID    = '100000000000001';
process.env.WHATSAPP_APP_SECRET      = APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN    = VERIFY_TOKEN;
process.env.WHATSAPP_ACCESS_TOKEN    = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = NUMBER_ID;
process.env.USER_ORG_SERVICE_URL     = 'http://user-org.test:3002';
process.env.FRONTEND_URL             = 'https://staging.example.test';

const logs = captureLogs();
const db  = fakeDb();
const net = fakeNetwork();
const smsSent = [];
stubModule('db.js', { getPool: () => db.pool, initDb: async () => {} });
stubModule('sms/index.js', {
  sendSms: async (phone, message) => { smsSent.push({ phone, message }); return { messageId: `sms-${smsSent.length}`, provider: 'stub' }; },
});

const app = express();
app.use('/webhooks/whatsapp', express.raw({ type: 'application/json' }), load('routes/whatsappWebhook'));
app.use(express.json());

const sign = (body, secret = APP_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

// A recorded Meta payload, trimmed to the fields the docs list.
function envelope(value) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '200000000000002',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '972500000000', phone_number_id: NUMBER_ID },
          ...value,
        },
      }],
    }],
  };
}
function textMessage(wamid, body, from = '972501234567') {
  return envelope({
    contacts: [{ profile: { name: 'Test Sender' }, wa_id: from }],
    messages: [{ from, id: wamid, timestamp: '1794733200', type: 'text', text: { body } }],
  });
}
function statusUpdate(wamid, status, extra = {}) {
  return envelope({
    statuses: [{ id: wamid, status, timestamp: '1794733260', recipient_id: '972501234567', ...extra }],
  });
}

async function post(server, payload, { signature, contentType = 'application/json', raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const headers = { 'content-type': contentType, 'content-length': Buffer.byteLength(body) };
  const sig = signature === undefined ? sign(body) : signature;
  if (sig !== null) headers['x-hub-signature-256'] = sig;
  const res = await request(server, { method: 'POST', path: '/webhooks/whatsapp', headers, body });
  await settle();
  return res;
}

async function run() {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  // ── 1. GET handshake ─────────────────────────────────────────────
  const hub = (params) => `/webhooks/whatsapp?${new URLSearchParams(params)}`;
  let res = await request(server, { path: hub({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' }) });
  check('GET with the right verify token answers 200', res.status === 200, res.status);
  check('GET echoes hub.challenge as the whole body, not JSON', res.text === '1158201444', res.text);
  check('GET answers as text/plain', String(res.headers['content-type']).startsWith('text/plain'), res.headers['content-type']);

  res = await request(server, { path: hub({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }) });
  check('GET with a wrong verify token answers 403', res.status === 403 && !res.text.includes('1158'), res.status);
  res = await request(server, { path: hub({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' }) });
  check('GET with hub.mode other than subscribe answers 403', res.status === 403, res.status);
  res = await request(server, { path: hub({ 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1' }) });
  check('GET without hub.mode answers 403', res.status === 403, res.status);
  res = await request(server, { path: '/webhooks/whatsapp' });
  check('GET with no parameters answers 403', res.status === 403, res.status);

  delete process.env.WHATSAPP_VERIFY_TOKEN;
  res = await request(server, { path: hub({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }) });
  check('with no verify token configured, an empty one does not pass', res.status === 403, res.status);
  res = await request(server, { path: hub({ 'hub.mode': 'subscribe', 'hub.challenge': '1' }) });
  check('with no verify token configured, a missing one does not pass', res.status === 403, res.status);
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

  // ── 2. POST signature ────────────────────────────────────────────
  const stored = () => db.supportMessages.length;
  const sentToMeta = () => net.graphCalls.length;

  res = await post(server, textMessage('wamid.FORGED1', 'רצפים במרכז'), { signature: sign(JSON.stringify(textMessage('wamid.FORGED1', 'רצפים במרכז')), 'not-the-secret') });
  check('POST signed with another secret answers 401', res.status === 401, res.status);
  check('a forged POST stores nothing', stored() === 0, db.supportMessages);
  check('a forged POST searches nothing and sends nothing', net.searchCalls.length === 0 && sentToMeta() === 0);

  res = await post(server, textMessage('wamid.FORGED2', 'רצפים במרכז'), { signature: null });
  check('POST with no signature header answers 401', res.status === 401 && stored() === 0, res.status);
  res = await post(server, textMessage('wamid.FORGED3', 'רצפים במרכז'), { signature: 'sha256=' });
  check('POST with an empty signature answers 401', res.status === 401 && stored() === 0, res.status);
  res = await post(server, textMessage('wamid.FORGED4', 'רצפים במרכז'), { signature: `sha1=${'0'.repeat(40)}` });
  check('POST with a sha1 signature answers 401', res.status === 401 && stored() === 0, res.status);

  // The signature covers the bytes on the wire. Same JSON, different
  // bytes: valid for one and not for the other.
  const spaced = `{ "object":"whatsapp_business_account",   "entry":[{"id":"2","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"${NUMBER_ID}"},"messages":[{"from":"972501234567","id":"wamid.RAW1","timestamp":"1794733200","type":"text","text":{"body":"\\u05e8\\u05e6\\u05e4\\u05d9\\u05dd"}}]}}]}] }`;
  const reserialised = JSON.stringify(JSON.parse(spaced));
  check('fixture: the two bodies are the same JSON in different bytes', spaced !== reserialised);
  res = await post(server, null, { raw: spaced, signature: sign(reserialised) });
  check('a signature over the re-serialised JSON is refused: the raw bytes are what is verified', res.status === 401 && stored() === 0, res.status);
  res = await post(server, null, { raw: spaced, signature: sign(spaced) });
  check('a signature over the raw bytes is accepted', res.status === 200, res.status);
  check('and that message was stored and answered once', db.inbound().length === 1 && db.inbound()[0].message_text === 'רצפים' && sentToMeta() === 1, db.inbound());

  res = await post(server, textMessage('wamid.UPPER1', 'טייחים'), { signature: sign(JSON.stringify(textMessage('wamid.UPPER1', 'טייחים'))).toUpperCase().replace('SHA256=', 'sha256=') });
  check('an upper-case hex signature is accepted', res.status === 200 && db.inbound().some((r) => r.message_uuid === 'wamid.UPPER1'), res.status);

  const before = stored();
  res = await post(server, textMessage('wamid.CT1', 'רצפים'), { contentType: 'text/plain' });
  check('a correctly signed POST that is not application/json is refused', res.status === 401 && stored() === before, res.status);

  res = await post(server, null, { raw: 'not json at all' });
  check('a correctly signed body that is not JSON answers 400', res.status === 400 && stored() === before, res.status);

  delete process.env.WHATSAPP_APP_SECRET;
  res = await post(server, textMessage('wamid.NOSECRET', 'רצפים'), { signature: sign(JSON.stringify(textMessage('wamid.NOSECRET', 'רצפים')), '') });
  check('with no app secret configured every POST is refused', res.status === 401 && stored() === before, res.status);
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;

  // ── 3. dedup on the inbound wamid ────────────────────────────────
  db.now += 60_000;
  const payload = textMessage('wamid.DUP1', '20 פועלים סינים במרכז', '972502222222');
  const inboundBefore = db.inbound().length;
  const sentBefore = sentToMeta();
  const searchedBefore = net.searchCalls.length;
  res = await post(server, payload);
  const first = res.status;
  res = await post(server, payload);
  res = await post(server, payload);
  check('Meta delivering the same webhook three times gets 200 each time', first === 200 && res.status === 200);
  check('one inbound row', db.inbound().length === inboundBefore + 1, db.inbound().length - inboundBefore);
  check('one search', net.searchCalls.length === searchedBefore + 1, net.searchCalls.length - searchedBefore);
  check('one reply', sentToMeta() === sentBefore + 1, sentToMeta() - sentBefore);
  const inboundRow = db.inbound().find((r) => r.message_uuid === 'wamid.DUP1');
  const replies = db.outbound().filter((r) => r.in_reply_to === inboundRow.id);
  check('one outbound row, threaded under the inbound row', replies.length === 1 && replies[0].peer_phone === '+972502222222', replies);
  check('the inbound row holds the sender in DB form and Meta\'s timestamp',
    inboundRow.peer_phone === '+972502222222' && inboundRow.received_at instanceof Date && inboundRow.received_at.getTime() === 1794733200000, inboundRow);

  // Two messages in one delivery: each is its own wamid.
  db.now += 60_000;
  const two = envelope({ messages: [
    { from: '972503333333', id: 'wamid.BATCH1', timestamp: '1794733300', type: 'text', text: { body: 'רצפים' } },
    { from: '972504444444', id: 'wamid.BATCH2', timestamp: '1794733300', type: 'text', text: { body: 'טייחים' } },
  ] });
  const sentBeforeBatch = sentToMeta();
  await post(server, two);
  check('two messages in one delivery are both stored and both answered',
    db.inbound().some((r) => r.message_uuid === 'wamid.BATCH1') && db.inbound().some((r) => r.message_uuid === 'wamid.BATCH2') && sentToMeta() === sentBeforeBatch + 2);

  // ── 4. status callbacks ──────────────────────────────────────────
  const outWamid = replies[0].message_uuid;
  const logRow = () => db.whatsappLog.find((r) => r.message_uuid === outWamid);
  check('the send left a log row, status submitted, under the wamid Meta returned',
    logRow() && logRow().status === 'submitted' && logRow().submitted_at instanceof Date && logRow().phone === '+972502222222', logRow());

  res = await post(server, statusUpdate(outWamid, 'sent'));
  check('status sent: 200, and the row stays submitted', res.status === 200 && logRow().status === 'submitted', logRow().status);
  await post(server, statusUpdate(outWamid, 'delivered'));
  check('status delivered: the row moves to delivered with its time', logRow().status === 'delivered' && logRow().delivered_at.getTime() === 1794733260000, logRow());
  await post(server, statusUpdate(outWamid, 'read'));
  check('status read: the row moves to read with its time', logRow().status === 'read' && logRow().read_at instanceof Date, logRow());
  await post(server, statusUpdate(outWamid, 'delivered'));
  await post(server, statusUpdate(outWamid, 'sent'));
  check('a late delivered or sent does not move a read row backwards', logRow().status === 'read', logRow().status);
  check('statuses store nothing in support_messages and send nothing', db.inbound().length === inboundBefore + 3 && sentToMeta() === sentBeforeBatch + 2);

  const second = db.outbound().find((r) => r.message_uuid !== outWamid).message_uuid;
  const secondRow = () => db.whatsappLog.find((r) => r.message_uuid === second);
  await post(server, statusUpdate(second, 'read'));
  await post(server, statusUpdate(second, 'delivered'));
  check('read arriving before delivered: still read, and delivered_at is filled in', secondRow().status === 'read' && secondRow().delivered_at instanceof Date, secondRow());

  const third = db.outbound().find((r) => ![outWamid, second].includes(r.message_uuid)).message_uuid;
  await post(server, statusUpdate(third, 'failed', {
    errors: [{ code: 131047, title: 'Re-engagement message', message: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed since the customer last replied.' } }],
  }));
  const failedRow = db.whatsappLog.find((r) => r.message_uuid === third);
  check('status failed: the row is failed and keeps Meta\'s code and reason',
    failedRow.status === 'failed' && failedRow.delivery_err.startsWith('131047: ') && failedRow.delivery_err.includes('24 hours'), failedRow);

  // The fake applies each update by recognising it, so the rule that
  // a row never moves backwards is checked on the statements themselves.
  const updates = db.queries.filter((q) => /UPDATE whatsapp_message_log/.test(q.sql)).map((q) => q.sql.replace(/\s+/g, ' '));
  const has = (clause) => updates.some((sql) => sql === `UPDATE whatsapp_message_log SET ${clause} WHERE message_uuid = ?`);
  check('sent: fills submitted_at once and only lifts a queued row', has("submitted_at = COALESCE(submitted_at, ?), status = IF(status = 'queued', 'submitted', status)"), updates);
  check('delivered: fills delivered_at once and leaves a read row read', has("delivered_at = COALESCE(delivered_at, ?), status = IF(status = 'read', status, 'delivered')"), updates);
  check('read: fills read_at once and sets read', has("read_at = COALESCE(read_at, ?), status = 'read'"), updates);
  check('failed: sets failed and the reason', has("status = 'failed', delivery_err = ?"), updates);
  check('every status update is keyed by the wamid alone', updates.every((sql) => sql.endsWith('WHERE message_uuid = ?')));

  res = await post(server, statusUpdate('wamid.NOT-OURS', 'delivered'));
  check('a status for a wamid we never sent is answered 200 and changes nothing', res.status === 200 && !db.whatsappLog.some((r) => r.message_uuid === 'wamid.NOT-OURS'));
  res = await post(server, statusUpdate(outWamid, 'played'));
  check('a status we do not track is ignored', res.status === 200 && logRow().status === 'read');

  // ── 5. another number on the same app ────────────────────────────
  const foreign = textMessage('wamid.OTHER-NUMBER', 'רצפים', '972505555555');
  foreign.entry[0].changes[0].value.metadata.phone_number_id = '999999999999999';
  const sentBeforeForeign = sentToMeta();
  res = await post(server, foreign);
  check('a message addressed to another phone_number_id is acknowledged and not answered',
    res.status === 200 && sentToMeta() === sentBeforeForeign && !db.inbound().some((r) => r.message_uuid === 'wamid.OTHER-NUMBER'));

  // ── 6. a failure while processing never reaches Meta ─────────────
  db.failNext = (sql) => (/INSERT INTO support_messages/.test(sql) ? new Error('connection lost') : null);
  res = await post(server, textMessage('wamid.DBDOWN', 'רצפים', '972506666666'));
  db.failNext = null;
  check('a database failure after the 200 does not change the answer Meta got', res.status === 200, res.status);
  check('with no inbound row there is no reply: dedup could not be guaranteed', !net.graphCalls.some((c) => c.body.to === '972506666666'));

  check('nothing in this file went out by SMS', smsSent.length === 0, smsSent);

  const everything = logs.join('\n');
  check('the code logged its work', logs.some((l) => l.includes('wamid.DUP1')) && logs.some((l) => l.includes('POST http://user-org.test:3002/search')));
  check('no secret is in any log line',
    !everything.includes(APP_SECRET) && !everything.includes(VERIFY_TOKEN) && !everything.includes('test-access-token'));

  // ── 7. index.js mounts it the way this file does ─────────────────
  const src = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  const live = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => !l.startsWith('//') && !l.startsWith('*'));
  const mountAt = live.findIndex((l) => l === "app.use('/webhooks/whatsapp', express.raw({ type: 'application/json' }), whatsappWebhook);");
  const jsonAt  = live.findIndex((l) => l.startsWith('app.use(express.json('));
  check('src/index.js mounts the webhook behind express.raw for this path only', mountAt >= 0);
  check('src/index.js mounts it before the global express.json', mountAt >= 0 && jsonAt > mountAt, { mountAt, jsonAt });
  check('src/index.js requires the real router', live.includes("const whatsappWebhook = require('./routes/whatsappWebhook');"));
  check('express.raw is not mounted globally', !live.some((l) => /^app\.use\(express\.raw\(/.test(l)));

  server.close();
  finish('whatsapp-webhook');
}

run().catch((err) => { console.error(err); process.exit(1); });
