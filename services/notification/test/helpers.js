// Shared scaffolding for the notification service's plain Node tests.
// No test framework: Node built-ins, plus express and uuid, which the
// service already depends on (so node_modules must be installed).
// Run a test with: node test/<name>.test.js
//
// The database and the network are faked here. The fake pool answers
// the statements the WhatsApp code issues by recognising them, and
// re-implements in JS what each one asks MySQL to do, so these tests
// cover the handlers' logic and wiring. They do not execute the SQL.

const http = require('http');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// ── one line per check ─────────────────────────────────────────────
let failed = 0;
let passed = 0;

const print = (text) => process.stdout.write(`${text}\n`);

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    print(`ok    ${name}`);
  } else {
    failed += 1;
    print(`FAIL  ${name}${detail === undefined ? '' : `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`);
  }
}

function finish(label) {
  print(`[${label}] ${failed ? 'FAIL' : 'pass'}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// The code under test logs through console. Collect those lines
// instead of printing them, so the output is the checks alone and a
// test can assert on what was (and was not) logged.
function captureLogs() {
  const lines = [];
  const collect = (...args) => { lines.push(args.map(String).join(' ')); };
  console.log = collect;
  console.warn = collect;
  console.error = collect;
  return lines;
}

// ── module stubs ───────────────────────────────────────────────────
function stubModule(relativeToSrc, exports) {
  const id = require.resolve(path.join(SRC, relativeToSrc));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

// Drop every loaded src module except the stubbed ones, so the next
// require re-reads process.env and starts with empty module state.
function unloadSrc(keep = []) {
  const kept = keep.map((rel) => require.resolve(path.join(SRC, rel)));
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(SRC) && !kept.includes(id)) delete require.cache[id];
  }
}

function load(relativeToSrc) {
  return require(path.join(SRC, relativeToSrc));
}

// ── fake MySQL pool ────────────────────────────────────────────────
function fakeDb() {
  const db = {
    now: Date.UTC(2026, 10, 15, 9, 0, 0),
    supportMessages: [],
    whatsappLog: [],
    memberships: {},           // '+9725…' → [{ entity_type, entity_id }]
    labels: {
      'worker_db.profession_types':   [{ code: 'flooring', name_he: 'ריצוף' }, { code: 'plastering', name_he: 'טיח' }],
      'worker_db.origin_countries':   [{ code: 'CN', name_he: 'סין' }, { code: 'IN', name_he: 'הודו' }],
      'worker_db.regions':            [{ code: 'center', name_he: 'מרכז' }, { code: 'north', name_he: 'צפון' }],
      'org_db.marketplace_categories': [{ code: 'equipment', name_he: 'ציוד וכלי עבודה' }, { code: 'housing', name_he: 'דיור להשכרה' }],
    },
    failNext: null,            // (sql) => Error | null, to inject a failure
    queries: [],
  };
  const seconds = () => Math.floor(db.now / 1000);

  async function query(sql, params = []) {
    db.queries.push({ sql, params });
    const injected = db.failNext && db.failNext(sql);
    if (injected) throw injected;

    if (/INSERT INTO support_messages/.test(sql)) {
      const inbound = /'inbound'/.test(sql);
      const row = inbound
        ? { id: params[0], channel: 'whatsapp', direction: 'inbound', peer_phone: params[1], message_text: params[2], message_uuid: params[3], received_at: params[4], in_reply_to: null }
        : { id: params[0], channel: params[1], direction: 'outbound', peer_phone: params[2], message_text: params[3], message_uuid: params[4], in_reply_to: params[5] };
      if (row.message_uuid != null && db.supportMessages.some((r) => r.message_uuid === row.message_uuid)) {
        throw Object.assign(new Error(`Duplicate entry '${row.message_uuid}' for key 'support_messages.uq_support_uuid'`), { code: 'ER_DUP_ENTRY', errno: 1062 });
      }
      row.created_at = seconds();
      db.supportMessages.push(row);
      return [{ affectedRows: 1 }];
    }

    if (/UPDATE support_messages SET message_text = \? WHERE id = \?/.test(sql)) {
      const row = db.supportMessages.find((r) => r.id === params[1]);
      if (row) row.message_text = params[0];
      return [{ affectedRows: row ? 1 : 0 }];
    }

    if (/hour_before/.test(sql)) {
      const [burstSeconds, id] = params;
      const me = db.supportMessages.find((r) => r.id === id);
      const earlier = db.supportMessages.filter((r) => r.peer_phone === me.peer_phone
        && r.channel === 'whatsapp' && r.direction === 'inbound'
        && r.created_at > me.created_at - 3600
        && (r.created_at < me.created_at || (r.created_at === me.created_at && r.id < me.id)));
      const burst = earlier.filter((r) => r.created_at > me.created_at - burstSeconds).length;
      // mysql2 hands SUM() back as a string; COUNT() as a number.
      return [[{ hour_before: earlier.length, burst_before: String(burst) }]];
    }

    if (/INTERVAL 24 HOUR/.test(sql)) {
      const open = db.supportMessages.some((r) => r.peer_phone === params[0]
        && r.channel === 'whatsapp' && r.direction === 'inbound'
        && r.created_at > seconds() - 24 * 3600);
      return [open ? [{ 1: 1 }] : []];
    }

    if (/FROM auth_db\.users/.test(sql)) {
      return [db.memberships[params[0]] || []];
    }

    const labelTable = Object.keys(db.labels).find((t) => sql.includes(`FROM ${t}`));
    if (labelTable) return [db.labels[labelTable]];

    if (/INSERT INTO whatsapp_message_log/.test(sql)) {
      const [id, phone, messageText, templateName, messageUuid, status, deliveryErr, submittedAt] = params;
      db.whatsappLog.push({ id, phone, message_text: messageText, template_name: templateName, message_uuid: messageUuid, status, delivery_err: deliveryErr, submitted_at: submittedAt, delivered_at: null, read_at: null });
      return [{ affectedRows: 1 }];
    }

    if (/UPDATE whatsapp_message_log SET/.test(sql)) {
      const wamid = params[params.length - 1];
      const row = db.whatsappLog.find((r) => r.message_uuid === wamid);
      if (!row) return [{ affectedRows: 0 }];
      if (/submitted_at = COALESCE/.test(sql)) {
        row.submitted_at = row.submitted_at || params[0];
        if (row.status === 'queued') row.status = 'submitted';
      } else if (/delivered_at = COALESCE/.test(sql)) {
        row.delivered_at = row.delivered_at || params[0];
        if (row.status !== 'read') row.status = 'delivered';
      } else if (/read_at = COALESCE/.test(sql)) {
        row.read_at = row.read_at || params[0];
        row.status = 'read';
      } else if (/status = 'failed'/.test(sql)) {
        row.status = 'failed';
        row.delivery_err = params[0];
      } else {
        throw new Error(`fakeDb: unrecognised status update: ${sql}`);
      }
      return [{ affectedRows: 1 }];
    }

    throw new Error(`fakeDb: unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
  }

  db.pool = { query };
  db.inbound  = () => db.supportMessages.filter((r) => r.direction === 'inbound');
  db.outbound = () => db.supportMessages.filter((r) => r.direction === 'outbound');
  return db;
}

// ── fake network ───────────────────────────────────────────────────
// Replaces global fetch. Routes by URL: Meta's Graph API (sends are
// POSTs, media lookups GETs), Meta's media host, ElevenLabs and the
// user-org search. Anything else is a test failure.
const VOICE_BYTES = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x07]);

function fakeNetwork() {
  const net = {
    graphCalls: [],
    searchCalls: [],
    mediaCalls: [],             // GET graph.facebook.com/{version}/{media_id}
    downloadCalls: [],          // GET the media URL Meta handed back
    sttCalls: [],               // POST api.elevenlabs.io speech-to-text
    searchResult: { filters: {}, results: [], marketplace_matches: [], hidden_types: [] },
    graph: null,                // (payload) => Response-like override
    search: null,               // (call) => Response-like override
    media: null,                // (call) => Response-like override
    download: null,             // (call) => Response-like override
    stt: null,                  // (call) => Response-like override
    transcript: 'רצפים במרכז',
    voiceBytes: VOICE_BYTES,
    wamidCounter: 0,
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  global.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith('https://api.elevenlabs.io/')) {
      const call = { url: href, method: init.method, headers: init.headers || {}, form: init.body, signal: init.signal };
      net.sttCalls.push(call);
      if (net.stt) return net.stt(call);
      return json(200, { language_code: 'heb', language_probability: 0.98, text: net.transcript });
    }
    const call = { url: href, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null, signal: init.signal };
    if (call.url.startsWith('https://graph.facebook.com/') && call.method === 'GET') {
      net.mediaCalls.push(call);
      if (net.media) return net.media(call);
      const id = decodeURIComponent(call.url.split('/').pop());
      return json(200, {
        messaging_product: 'whatsapp', url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${id}`,
        mime_type: 'audio/ogg; codecs=opus', sha256: 'f'.repeat(64), file_size: net.voiceBytes.length, id,
      });
    }
    if (call.url.startsWith('https://lookaside.fbsbx.com/')) {
      net.downloadCalls.push(call);
      if (net.download) return net.download(call);
      return new Response(net.voiceBytes, { status: 200, headers: { 'content-type': 'audio/ogg' } });
    }
    if (call.url.startsWith('https://graph.facebook.com/')) {
      net.graphCalls.push(call);
      if (net.graph) return net.graph(call);
      net.wamidCounter += 1;
      return json(200, { messaging_product: 'whatsapp', contacts: [{ input: call.body.to, wa_id: call.body.to }], messages: [{ id: `wamid.OUT${net.wamidCounter}` }] });
    }
    if (call.url.endsWith('/search')) {
      net.searchCalls.push(call);
      if (net.search) return net.search(call);
      return json(200, net.searchResult);
    }
    throw new Error(`fakeNetwork: unexpected request to ${call.url}`);
  };
  net.json = json;
  return net;
}

// Let work that was started after the HTTP response finish. Every fake
// resolves immediately, so a few turns of the event loop are enough.
async function settle(turns = 60) {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// ── tiny HTTP client (global fetch is faked) ───────────────────────
function request(server, { method = 'GET', path: urlPath, headers = {}, body }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

module.exports = {
  check, finish, captureLogs, stubModule, unloadSrc, load, fakeDb, fakeNetwork, settle, request, SRC,
};
