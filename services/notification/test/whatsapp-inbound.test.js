// R35 §4 · inbound message → search → one reply.
//
// What is locked here:
//   * who the sender is decides the search scope (decision 2), and the
//     headers that carry it are exactly the three the search reads
//   * R38: only a registered number is searched for; one with several
//     memberships uses the one picked on the site, or is asked to pick;
//     a voice note is downloaded from Meta, transcribed by ElevenLabs
//     and searched as text, and any failure there is one line
//   * every inbound message gets at most one outbound message, and a
//     normal one gets exactly one (decision 3: each is billed)
//   * the per-number limits: 10 an hour, 1 per 5 seconds
//   * a failure anywhere still ends in one Hebrew reply or in silence,
//     never in a second message and never in an SMS
//
// handleInbound is the real one, with the real dispatcher and the real
// Meta sender behind it. The database, the SMS provider and the
// network are fakes (see helpers.js for what that does and does not
// prove about the SQL).
//
// Run: node test/whatsapp-inbound.test.js

const {
  check, finish, captureLogs, stubModule, unloadSrc, load, fakeDb, fakeNetwork,
} = require('./helpers');

process.env.WHATSAPP_ACCESS_TOKEN    = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
process.env.WHATSAPP_API_VERSION     = 'v26.0';
process.env.USER_ORG_SERVICE_URL     = 'http://user-org.test:3002';
process.env.FRONTEND_URL             = 'https://staging.example.test/';

const logs = captureLogs();
const db   = fakeDb();
const net  = fakeNetwork();
const smsSent = [];
stubModule('db.js', { getPool: () => db.pool, initDb: async () => {} });
stubModule('sms/index.js', {
  sendSms: async (phone, message) => { smsSent.push({ phone, message }); return { messageId: `sms-${smsSent.length}`, provider: 'stub' }; },
});
let { handleInbound } = load('whatsapp/handleInbound');
const {
  pickEntityReply, registerInviteReply, NON_TEXT_REPLY, RATE_LIMIT_REPLY, SEARCH_FAILED_REPLY, VOICE_FAILED_REPLY, MAX_LENGTH,
} = load('whatsapp/composeReply');
const INVITE = registerInviteReply('https://staging.example.test');

const CONTRACTOR  = '972501110001';
const CORPORATION = '972501110002';
const PROVIDER    = '972501110003';
const TWO_HATS    = '972501110004';
const UNKNOWN     = '972501110005';
const TWO_PICKED  = '972501110006';
db.memberships = {
  '+972501110001': [{ entity_type: 'contractor', entity_id: 'con-1', is_whatsapp_default: 0 }],
  '+972501110002': [{ entity_type: 'corporation', entity_id: 'corp-1', is_whatsapp_default: 0 }],
  '+972501110003': [{ entity_type: 'service_provider', entity_id: 'prov-1', is_whatsapp_default: 0 }],
  '+972501110004': [{ entity_type: 'contractor', entity_id: 'con-2', is_whatsapp_default: 0 }, { entity_type: 'corporation', entity_id: 'corp-2', is_whatsapp_default: 0 }],
  // mysql2 hands a BOOLEAN back as 0 / 1
  '+972501110006': [
    { entity_type: 'contractor', entity_id: 'con-3', is_whatsapp_default: 0 },
    { entity_type: 'corporation', entity_id: 'corp-3', is_whatsapp_default: 1 },
    { entity_type: 'service_provider', entity_id: 'prov-3', is_whatsapp_default: 0 },
  ],
};
// The rate-limit runs below are about the limiter, so their numbers are
// registered: an unknown number would never reach the search anyway.
for (const n of ['+972501119999', '+972501118888', '+972501117777']) {
  db.memberships[n] = [{ entity_type: 'contractor', entity_id: `con-${n.slice(-4)}`, is_whatsapp_default: 0 }];
}

const WORKERS = {
  filters: { ad_type: 'worker', profession_code: 'flooring', origin_country: 'CN', region: 'center', quantity: 20 },
  results: [
    { id: 'a1', ad_type: 'worker', title_he: 'TITLE-MUST-NOT-APPEAR', body_he: 'BODY-MUST-NOT-APPEAR', profession_code: 'flooring', origin_country: 'CN', region: 'center', quantity: 25, owner_entity_id: 'corp-9' },
  ],
  near_matches: [], relaxed: null, marketplace_matches: [], primary_section: 'ads',
  viewer_approval_status: 'approved', hidden_types: [],
};
const SERVICES_ONLY = {
  filters: { ad_type: 'worker', profession_code: 'flooring', origin_country: 'CN', region: 'center', quantity: 20 },
  results: [], near_matches: [], relaxed: null,
  marketplace_matches: [{ id: 'm1', category: 'equipment', title: 'TITLE-MUST-NOT-APPEAR', city: 'נתניה', region: 'center' }],
  primary_section: 'marketplace', viewer_approval_status: null, hidden_types: ['workers', 'housing'],
};

let counter = 0;
function text(from, body, extra = {}) {
  counter += 1;
  return { from, id: `wamid.IN${counter}`, timestamp: String(Math.floor(db.now / 1000)), type: 'text', text: { body }, ...extra };
}
function media(from, type) {
  counter += 1;
  return { from, id: `wamid.IN${counter}`, timestamp: String(Math.floor(db.now / 1000)), type, [type]: { id: 'media-1' } };
}
// Runs one inbound message and reports what it caused.
async function deliver(message) {
  const before = {
    graph: net.graphCalls.length, search: net.searchCalls.length, inbound: db.inbound().length, outbound: db.outbound().length, sms: smsSent.length,
    media: net.mediaCalls.length, download: net.downloadCalls.length, stt: net.sttCalls.length,
  };
  let error = null;
  try {
    await handleInbound(message);
  } catch (err) {
    error = err;
  }
  return {
    error,
    sent:     net.graphCalls.slice(before.graph),
    searches: net.searchCalls.slice(before.search),
    inbound:  db.inbound().slice(before.inbound),
    outbound: db.outbound().slice(before.outbound),
    sms:      smsSent.slice(before.sms),
    media:    net.mediaCalls.slice(before.media),
    download: net.downloadCalls.slice(before.download),
    stt:      net.sttCalls.slice(before.stt),
  };
}
function voice(from, extra = {}) {
  counter += 1;
  return { from, id: `wamid.IN${counter}`, timestamp: String(Math.floor(db.now / 1000)), type: 'audio', audio: { id: `media-${counter}`, mime_type: 'audio/ogg; codecs=opus', voice: true, ...extra } };
}
const wait = (seconds) => { db.now += seconds * 1000; };
const bodyOf = (r) => r.sent[0]?.body?.text?.body;

async function run() {
  // ── 1. an approved contractor ────────────────────────────────────
  net.searchResult = WORKERS;
  let r = await deliver(text(CONTRACTOR, '  20 פועלים סינים במרכז  '));
  const call = r.searches[0];
  check('the search is called once', r.searches.length === 1, r.searches.length);
  check('directly on user-org: POST {USER_ORG_SERVICE_URL}/search, no /api prefix',
    call.url === 'http://user-org.test:3002/search' && call.method === 'POST', `${call.method} ${call.url}`);
  check('the body is { query } with the message text, trimmed', JSON.stringify(call.body) === JSON.stringify({ query: '20 פועלים סינים במרכז' }), call.body);
  check('contractor: x-user-role, x-entity-type and x-entity-id carry the one membership',
    call.headers['x-user-role'] === 'contractor' && call.headers['x-entity-type'] === 'contractor' && call.headers['x-entity-id'] === 'con-1', call.headers);
  const identityHeaders = (h) => Object.keys(h).map((k) => k.toLowerCase()).filter((k) => k.startsWith('x-')).sort();
  check('and no other identity header: never x-user-is-admin, x-user-id or x-org-id',
    JSON.stringify(identityHeaders(call.headers)) === JSON.stringify(['x-entity-id', 'x-entity-type', 'x-user-role']), identityHeaders(call.headers));
  check('the search carries a timeout signal', call.signal instanceof AbortSignal);

  check('exactly one message goes to Meta', r.sent.length === 1, r.sent.length);
  const out = r.sent[0];
  check('to the Graph messages endpoint of our number, at the configured version',
    out.url === 'https://graph.facebook.com/v26.0/100000000000001/messages' && out.method === 'POST', out.url);
  check('with the System User token as a Bearer header', out.headers.Authorization === 'Bearer test-access-token');
  check('recipient is E.164 without the plus', out.body.to === CONTRACTOR, out.body.to);
  check('payload is the text shape the spec gives',
    JSON.stringify(out.body) === JSON.stringify({ messaging_product: 'whatsapp', to: CONTRACTOR, type: 'text', text: { body: out.body.text.body, preview_url: true } }), out.body);
  check('the reply lists the worker result', bodyOf(r).includes('• עובדים: ריצוף · סין · מרכז · 25'), bodyOf(r));
  check('the reply ends with the site link (FRONTEND_URL trailing slash dropped)',
    bodyOf(r).split('\n').at(-1) === `https://staging.example.test/?q=${encodeURIComponent('20 פועלים סינים במרכז')}`, bodyOf(r).split('\n').at(-1));
  check('no ad title or body in the reply', !bodyOf(r).includes('MUST-NOT-APPEAR'));
  check('under 1,000 characters', bodyOf(r).length < MAX_LENGTH);

  check('one inbound row: whatsapp, sender in DB form, the text, the wamid',
    r.inbound.length === 1 && r.inbound[0].channel === 'whatsapp' && r.inbound[0].peer_phone === '+972501110001'
    && r.inbound[0].message_text === '20 פועלים סינים במרכז' && r.inbound[0].message_uuid === 'wamid.IN1', r.inbound);
  check('one outbound row: the reply text, the wamid Meta returned, in_reply_to = the inbound row',
    r.outbound.length === 1 && r.outbound[0].message_text === bodyOf(r) && r.outbound[0].message_uuid === 'wamid.OUT1'
    && r.outbound[0].in_reply_to === r.inbound[0].id && r.outbound[0].channel === 'whatsapp' && r.outbound[0].peer_phone === '+972501110001', r.outbound);
  const logged = db.whatsappLog.at(-1);
  check('the dispatcher logged the send as submitted', logged.message_uuid === 'wamid.OUT1' && logged.status === 'submitted' && logged.template_name === null, logged);
  check('nothing went by SMS', r.sms.length === 0);

  // ── 2. the other senders ─────────────────────────────────────────
  wait(10);
  r = await deliver(text(CORPORATION, 'רצפים במרכז'));
  check('corporation user: corporation scope with its entity id',
    r.searches[0].headers['x-user-role'] === 'corporation' && r.searches[0].headers['x-entity-type'] === 'corporation' && r.searches[0].headers['x-entity-id'] === 'corp-1', r.searches[0].headers);

  wait(10);
  r = await deliver(text(TWO_PICKED, 'רצפים במרכז'));
  check('several memberships, one picked for WhatsApp: searches with the picked one',
    r.searches.length === 1 && r.searches[0].headers['x-user-role'] === 'corporation'
    && r.searches[0].headers['x-entity-type'] === 'corporation' && r.searches[0].headers['x-entity-id'] === 'corp-3', r.searches[0]?.headers);

  wait(10);
  r = await deliver(text(TWO_HATS, '20 פועלים סינים במרכז'));
  check('several memberships, none picked: no search', r.searches.length === 0, r.searches.length);
  check('and one reply asking to pick, with the link to the card',
    r.sent.length === 1 && bodyOf(r) === pickEntityReply('https://staging.example.test')
    && bodyOf(r).endsWith('https://staging.example.test/billing#whatsapp') && r.outbound.length === 1, bodyOf(r));
  wait(10);
  r = await deliver(text(TWO_HATS, '?'));
  check('even a message too short to search gets the pick reply', r.sent.length === 1 && bodyOf(r) === pickEntityReply('https://staging.example.test'), bodyOf(r));

  net.searchResult = SERVICES_ONLY;
  wait(10);
  r = await deliver(text(PROVIDER, '20 פועלים סינים במרכז'));
  check('a service provider: searches with its own scope, and the D1 matrix in user-org decides what it sees',
    r.searches.length === 1 && r.searches[0].headers['x-user-role'] === 'service_provider'
    && r.searches[0].headers['x-entity-type'] === 'service_provider' && r.searches[0].headers['x-entity-id'] === 'prov-1', r.searches[0]?.headers);
  check('a service provider: one reply, with the sign-up line for what it cannot see',
    r.sent.length === 1 && bodyOf(r).includes('מודעות עובדים ודיור זמינות לקבלנים רשומים: https://staging.example.test/register/contractor'), bodyOf(r));
  check('and the first link in it is the search link, so the preview card opens the results',
    bodyOf(r).match(/https?:\/\/\S+/)[0] === `https://staging.example.test/?q=${encodeURIComponent('20 פועלים סינים במרכז')}&type=services`, bodyOf(r));

  // ── 2b. R38 · registered users only ──────────────────────────────
  for (const [type, message] of [['text', () => text(UNKNOWN, '20 פועלים סינים במרכז')], ['image', () => media(UNKNOWN, 'image')], ['audio', () => media(UNKNOWN, 'audio')]]) {
    wait(10);
    r = await deliver(message());
    check(`an unknown number, ${type}: stored, no search, exactly one reply, the invitation`,
      r.inbound.length === 1 && r.searches.length === 0 && r.sent.length === 1 && bodyOf(r) === INVITE && r.outbound.length === 1, { searches: r.searches.length, body: bodyOf(r) });
    check(`an unknown number, ${type}: nothing is downloaded or transcribed`, r.media.length === 0 && r.stt.length === 0);
  }
  check('the invitation links to the role picker on the home page, and is the only link in it',
    INVITE.endsWith('https://staging.example.test/#register') && INVITE.match(/https?:\/\//g).length === 1, INVITE);
  db.memberships['+972501110007'] = [];
  wait(10);
  r = await deliver(text('972501110007', 'רצפים'));
  check('a number whose user has no active membership is not registered either', r.searches.length === 0 && bodyOf(r) === INVITE, bodyOf(r));
  delete db.memberships['+972501110007'];
  check('an x-user-is-admin header was never built, for anyone',
    net.searchCalls.every((c) => !Object.keys(c.headers).some((k) => k.toLowerCase() === 'x-user-is-admin')));

  // The membership query must ask for the right rows: the fake cannot
  // tell, so the statement itself is checked.
  const lookup = db.queries.find((q) => /FROM auth_db\.users/.test(q.sql));
  const flat = lookup.sql.replace(/\s+/g, ' ');
  check('the sender lookup reads auth_db.users joined to auth_db.entity_memberships by phone',
    flat.includes('FROM auth_db.users u JOIN auth_db.entity_memberships em ON em.user_id = u.id WHERE u.phone = ?') && lookup.params[0] === '+972501110001', flat);
  check('and only counts live users and accepted, active memberships',
    flat.includes('u.is_active = TRUE') && flat.includes('u.deleted_at IS NULL') && flat.includes('em.is_active = TRUE') && flat.includes('em.invitation_accepted_at IS NOT NULL'), flat);
  check('and reads which membership is picked for WhatsApp', flat.includes('em.is_whatsapp_default'), flat);

  // ── 3. non-text, from a registered number ────────────────────────
  for (const type of ['image', 'document', 'location', 'video', 'sticker', 'unsupported']) {
    wait(10);
    r = await deliver(media(CORPORATION, type));
    check(`${type}: stored, answered once with the text-only line, no search`,
      r.inbound.length === 1 && r.inbound[0].message_text === `[${type}]` && r.sent.length === 1 && bodyOf(r) === NON_TEXT_REPLY
      && r.searches.length === 0 && r.outbound.length === 1 && r.outbound[0].in_reply_to === r.inbound[0].id, { sent: r.sent.length, body: bodyOf(r) });
  }
  check('the text-only line is the spec\'s', NON_TEXT_REPLY === 'כרגע אני מבין רק הודעות טקסט. מה אתם מחפשים?');
  for (const type of ['reaction', 'system']) {
    wait(10);
    r = await deliver(media(UNKNOWN, type));
    check(`${type}: not a request, so nothing is stored and nothing is sent`, r.inbound.length === 0 && r.sent.length === 0 && r.error === null);
  }
  r = await deliver({ id: 'wamid.NOFROM', type: 'text', text: { body: 'רצפים' } });
  check('a message with no sender number is dropped without a reply', r.inbound.length === 0 && r.sent.length === 0 && r.error === null);

  // ── 3b. R38 · voice notes ────────────────────────────────────────
  net.searchResult = WORKERS;
  delete process.env.ELEVENLABS_API_KEY;
  for (const [name, key] of [['not set', undefined], ['the "-" placeholder', '-']]) {
    if (key) process.env.ELEVENLABS_API_KEY = key;
    wait(10);
    r = await deliver(voice(CONTRACTOR));
    check(`voice, ELEVENLABS_API_KEY ${name}: one reply, the type-instead line, no download, no transcription, no search`,
      r.sent.length === 1 && bodyOf(r) === VOICE_FAILED_REPLY && r.media.length === 0 && r.stt.length === 0 && r.searches.length === 0
      && r.inbound[0].message_text === '[audio]' && r.outbound.length === 1, { body: bodyOf(r), media: r.media.length });
  }
  check('the type-instead line', VOICE_FAILED_REPLY === 'לא הצלחתי להבין את ההודעה הקולית, נסו לכתוב במקום');

  process.env.ELEVENLABS_API_KEY = 'test-eleven-key';
  wait(10);
  r = await deliver(voice(CONTRACTOR));
  check('voice: the media id is looked up once, on the Graph API at the configured version, with the token',
    r.media.length === 1 && r.media[0].url === `https://graph.facebook.com/v26.0/media-${counter}` && r.media[0].method === 'GET'
    && r.media[0].headers.Authorization === 'Bearer test-access-token' && r.media[0].signal instanceof AbortSignal, r.media[0]);
  check('voice: the URL Meta returned is fetched once, with the same token',
    r.download.length === 1 && r.download[0].url.startsWith('https://lookaside.fbsbx.com/') && r.download[0].headers.Authorization === 'Bearer test-access-token', r.download[0]);
  const stt = r.stt[0];
  check('voice: ElevenLabs is called once, as the gateway calls it', r.stt.length === 1
    && stt.url === 'https://api.elevenlabs.io/v1/speech-to-text' && stt.method === 'POST' && stt.headers['xi-api-key'] === 'test-eleven-key'
    && stt.form.get('model_id') === 'scribe_v1' && stt.form.get('language_code') === 'heb' && stt.signal instanceof AbortSignal, stt && stt.headers);
  const file = stt.form.get('file');
  check('voice: the bytes Meta sent are the file, typed audio/ogg without the codec parameter',
    file.type === 'audio/ogg' && file.name === 'voice.ogg' && Buffer.from(await file.arrayBuffer()).equals(Buffer.from(net.voiceBytes)), { type: file.type, name: file.name, size: file.size });
  check('voice: the transcript is the query, with the sender\'s own scope',
    r.searches.length === 1 && r.searches[0].body.query === 'רצפים במרכז' && r.searches[0].headers['x-entity-id'] === 'con-1', r.searches[0]?.body);
  check('voice: one reply, the search reply', r.sent.length === 1 && bodyOf(r).includes('• עובדים: ריצוף · סין · מרכז · 25') && r.outbound.length === 1, bodyOf(r));
  check('voice: the inbound row keeps the transcript', db.inbound().find((x) => x.id === r.inbound[0].id).message_text === '[audio] רצפים במרכז',
    db.inbound().find((x) => x.id === r.inbound[0].id).message_text);
  check('voice: neither key nor transcript is in a log line',
    !logs.join('\n').includes('test-eleven-key') && !logs.join('\n').includes('רצפים במרכז'));

  const voiceFails = [
    ['the media lookup answers 404', () => { net.media = () => net.json(404, { error: { message: 'Unsupported get request', code: 100 } }); }, 'Meta media lookup failed (404, code 100)'],
    ['the media URL is not on a Meta host', () => { net.media = () => net.json(200, { url: 'https://media.example.test/x', mime_type: 'audio/ogg', file_size: 7 }); }, 'not on a Meta host'],
    ['the file is over 10 MB', () => { net.media = () => net.json(200, { url: 'https://lookaside.fbsbx.com/x', mime_type: 'audio/ogg', file_size: 11 * 1024 * 1024 }); }, 'over 10485760'],
    ['the download answers 401', () => { net.download = () => new Response('no', { status: 401 }); }, 'Meta media download failed (401)'],
    ['ElevenLabs answers 500', () => { net.stt = () => net.json(500, { detail: 'boom' }); }, 'ElevenLabs answered 500'],
    ['ElevenLabs times out', () => { net.stt = () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }; }, 'aborted due to timeout'],
    ['the transcript is empty', () => { net.transcript = '   '; }, 'transcribed to nothing'],
  ];
  wait(3600); // the hourly limit is not what these are about
  for (const [name, arrange, logged] of voiceFails) {
    arrange();
    wait(10);
    r = await deliver(voice(CONTRACTOR));
    net.media = null; net.download = null; net.stt = null; net.transcript = 'רצפים במרכז';
    check(`voice, ${name}: one reply, the type-instead line, no search, the row stays [audio]`,
      r.error === null && r.sent.length === 1 && bodyOf(r) === VOICE_FAILED_REPLY && r.searches.length === 0
      && db.inbound().find((x) => x.id === r.inbound[0].id).message_text === '[audio]', { body: bodyOf(r), error: r.error && r.error.message });
    check(`voice, ${name}: and a log line`, logs.some((l) => l.includes('[whatsapp] voice note') && l.includes(logged)), logs.slice(-2));
  }
  check('voice: the token never went to a host that is not Meta\'s', !logs.some((l) => l.includes('unexpected request')));

  wait(10);
  r = await deliver(voice(TWO_HATS));
  check('voice from a user who has not picked an entity: the pick reply, nothing transcribed',
    bodyOf(r) === pickEntityReply('https://staging.example.test') && r.media.length === 0 && r.stt.length === 0);
  wait(10);
  const v1 = await deliver(voice(CORPORATION));
  const v2 = await deliver(voice(CORPORATION));
  check('a second voice note in the burst window: the limit notice, nothing transcribed for it',
    v1.stt.length === 1 && bodyOf(v2) === RATE_LIMIT_REPLY && v2.media.length === 0 && v2.stt.length === 0, bodyOf(v2));
  delete process.env.ELEVENLABS_API_KEY;

  // ── 4. dedup ─────────────────────────────────────────────────────
  wait(4000);
  const once = text(CONTRACTOR, 'טייחים בצפון');
  r = await deliver(once);
  const again = await deliver(once);
  check('the same wamid a second time: no row, no search, no reply, no error',
    r.sent.length === 1 && again.inbound.length === 0 && again.searches.length === 0 && again.sent.length === 0 && again.error === null);

  // ── 5. rate limit: twelve in a row ───────────────────────────────
  wait(4000);
  net.searchResult = WORKERS;
  const FLOOD = '972501119999';
  const flood = [];
  for (let i = 0; i < 12; i += 1) flood.push(await deliver(text(FLOOD, `רצפים ${i}`)));
  const kinds = flood.map((x) => (x.sent.length === 0 ? 'silent' : bodyOf(x) === RATE_LIMIT_REPLY ? 'notice' : 'search'));
  check('12 messages in the same second: the first is searched', kinds[0] === 'search' && flood[0].searches.length === 1, kinds);
  check('the second is told once, with the spec\'s line', kinds[1] === 'notice' && RATE_LIMIT_REPLY === 'קיבלתי כמה הודעות, עונה על האחרונה', kinds);
  check('the third to the tenth get nothing', kinds.slice(2, 10).every((k) => k === 'silent'), kinds);
  check('the eleventh crosses the hourly limit and is told once', kinds[10] === 'notice', kinds);
  check('the twelfth gets nothing', kinds[11] === 'silent', kinds);
  check('all twelve are stored', flood.every((x) => x.inbound.length === 1));
  check('only one of the twelve reached the search', flood.reduce((n, x) => n + x.searches.length, 0) === 1);
  check('no message got more than one reply', flood.every((x) => x.sent.length <= 1 && x.outbound.length === x.sent.length));
  check('a limited number does not limit anyone else', (await deliver(text(CORPORATION, 'רצפים'))).searches.length === 1);

  // ── 6. rate limit: spaced out ────────────────────────────────────
  const STEADY = '972501118888';
  const steady = [];
  for (let i = 0; i < 12; i += 1) { wait(6); steady.push(await deliver(text(STEADY, `רצפים ${i}`))); }
  const steadyKinds = steady.map((x) => (x.sent.length === 0 ? 'silent' : bodyOf(x) === RATE_LIMIT_REPLY ? 'notice' : 'search'));
  check('6 seconds apart: ten searches in the hour',
    steadyKinds.slice(0, 10).every((k) => k === 'search') && steady.slice(0, 10).every((x) => x.searches.length === 1), steadyKinds);
  check('the eleventh in the hour is told once, the twelfth gets nothing', steadyKinds[10] === 'notice' && steadyKinds[11] === 'silent', steadyKinds);
  wait(3600);
  r = await deliver(text(STEADY, 'רצפים שוב'));
  check('an hour later the number is searched again', r.searches.length === 1 && r.sent.length === 1 && bodyOf(r) !== RATE_LIMIT_REPLY);

  const PAIR = '972501117777';
  wait(100);
  const p1 = await deliver(text(PAIR, 'רצפים'));
  wait(4);
  const p2 = await deliver(text(PAIR, 'במרכז'));
  wait(5);
  const p3 = await deliver(text(PAIR, 'רצפים במרכז'));
  check('two messages 4 seconds apart: the second is not searched',
    p1.searches.length === 1 && p2.searches.length === 0 && bodyOf(p2) === RATE_LIMIT_REPLY);
  check('5 seconds after the last one, the next is searched', p3.searches.length === 1);
  wait(10);
  const m1 = await deliver(media(PAIR, 'image'));
  const m2 = await deliver(media(PAIR, 'image'));
  const m3 = await deliver(media(PAIR, 'image'));
  check('non-text messages are limited the same way',
    bodyOf(m1) === NON_TEXT_REPLY && bodyOf(m2) === RATE_LIMIT_REPLY && m3.sent.length === 0);

  const limiter = db.queries.find((q) => /hour_before/.test(q.sql));
  const limiterSql = limiter.sql.replace(/\s+/g, ' ');
  check('the limiter counts inbound WhatsApp rows of the same number that came before this one',
    limiterSql.includes('earlier.peer_phone = me.peer_phone') && limiterSql.includes("earlier.channel = 'whatsapp'") && limiterSql.includes("earlier.direction = 'inbound'")
    && limiterSql.includes('earlier.created_at > me.created_at - INTERVAL 1 HOUR') && limiterSql.includes('earlier.id < me.id') && limiterSql.includes('WHERE me.id = ?'), limiterSql);
  check('with a 5 second burst window', limiter.params[0] === 5 && limiterSql.includes('INTERVAL ? SECOND'), limiter.params);

  // ── 7. search failures ───────────────────────────────────────────
  wait(4000);
  net.search = () => net.json(500, { detail: 'boom' });
  r = await deliver(text(CONTRACTOR, 'רצפים במרכז'));
  check('search answers 500: one Hebrew reply, the spec\'s line',
    r.sent.length === 1 && bodyOf(r) === SEARCH_FAILED_REPLY && SEARCH_FAILED_REPLY === 'לא הצלחתי לחפש כרגע, נסו שוב עוד רגע', bodyOf(r));
  check('and a log line', logs.some((l) => l.includes('[whatsapp] search failed') && l.includes('500')));
  check('and no second attempt at the search', r.searches.length === 1);

  wait(10);
  net.search = () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  r = await deliver(text(CONTRACTOR, 'רצפים במרכז'));
  check('search times out: the same single reply', r.sent.length === 1 && bodyOf(r) === SEARCH_FAILED_REPLY && r.outbound.length === 1);
  net.search = null;

  // ── 8. queries the search would refuse ───────────────────────────
  wait(10);
  r = await deliver(text(CONTRACTOR, '?'));
  check('a one-character message is not sent to the search (it needs two)', r.searches.length === 0);
  check('and is answered once, as no results', r.sent.length === 1 && bodyOf(r).startsWith('לא מצאתי התאמות ל־?.'), bodyOf(r));
  wait(10);
  r = await deliver(text(CONTRACTOR, 'ר'.repeat(700)));
  check('a 700-character message is cut to the 500 the search accepts', r.searches[0].body.query.length === 500, r.searches[0].body.query.length);
  check('and its reply is still under 1,000 characters', bodyOf(r).length < MAX_LENGTH, bodyOf(r).length);

  // ── 9. the sender lookup fails ───────────────────────────────────
  wait(10);
  net.searchResult = SERVICES_ONLY;
  db.failNext = (sql) => (/FROM auth_db\.users/.test(sql) ? new Error('auth_db unreachable') : null);
  r = await deliver(text(CONTRACTOR, 'רצפים במרכז'));
  db.failNext = null;
  check('sender lookup fails: no search, since who wrote is not known',
    r.searches.length === 0, r.searches[0]?.headers);
  check('and one reply, the search-failed line, never the invitation to a user who may be registered',
    r.sent.length === 1 && bodyOf(r) === SEARCH_FAILED_REPLY, bodyOf(r));
  check('and a log line', logs.some((l) => l.includes('[whatsapp] sender lookup failed, no search') && l.includes('auth_db unreachable')));

  // ── 10. Meta refuses the send ────────────────────────────────────
  wait(10);
  net.graph = () => net.json(401, { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } });
  r = await deliver(text(CONTRACTOR, 'רצפים במרכז'));
  net.graph = null;
  check('Meta refuses the send: one attempt, no retry', r.sent.length === 1, r.sent.length);
  check('the failure surfaces to the caller with Meta\'s code', r.error && r.error.message.includes('401') && r.error.message.includes('code 190'), r.error && r.error.message);
  check('a search reply never falls back to SMS', r.sms.length === 0);
  check('no outbound row for a message that was not sent', r.outbound.length === 0);
  check('the attempt is logged as failed', db.whatsappLog.at(-1).status === 'failed' && db.whatsappLog.at(-1).message_uuid === null, db.whatsappLog.at(-1));
  check('the token is not in the error', !r.error.message.includes('test-access-token'));

  // ── 11. names come from the database, once ───────────────────────
  const labelReads = db.queries.filter((q) => /SELECT code, name_he FROM/.test(q.sql));
  check('the Hebrew names were read once and reused: four small queries in all',
    labelReads.length === 4 && ['worker_db.profession_types', 'worker_db.origin_countries', 'worker_db.regions', 'org_db.marketplace_categories']
      .every((t) => labelReads.some((q) => q.sql.includes(`FROM ${t}`))), labelReads.map((q) => q.sql));

  unloadSrc(['db.js', 'sms/index.js']);
  ({ handleInbound } = load('whatsapp/handleInbound'));
  wait(10);
  net.searchResult = WORKERS;
  db.failNext = (sql) => (/SELECT code, name_he FROM/.test(sql) ? new Error('worker_db unreachable') : null);
  r = await deliver(text(CONTRACTOR, 'רצפים במרכז'));
  db.failNext = null;
  check('the names cannot be read: the reply still goes out, once', r.sent.length === 1 && r.error === null, r.error && r.error.message);
  check('without raw codes in it', !/flooring|\bCN\b|center/.test(bodyOf(r)) && bodyOf(r).includes('• עובדים: 25'), bodyOf(r));
  wait(10);
  r = await deliver(text(CONTRACTOR, 'רצפים במרכז'));
  check('and the next message reads them again', bodyOf(r).includes('• עובדים: ריצוף · סין · מרכז · 25'), bodyOf(r));

  // ── 12. one outbound per inbound, over everything above ──────────
  const inboundRows = db.inbound();
  const repliesPer = inboundRows.map((row) => db.outbound().filter((o) => o.in_reply_to === row.id).length);
  check('no inbound row has more than one reply', repliesPer.every((n) => n <= 1), repliesPer);
  check('every outbound row answers an inbound row', db.outbound().every((o) => inboundRows.some((row) => row.id === o.in_reply_to)));
  check('every message sent to Meta that was accepted has its outbound row',
    db.outbound().length === net.graphCalls.length - 1, { outbound: db.outbound().length, graph: net.graphCalls.length });
  check('every reply went to the number that wrote', db.outbound().every((o) => inboundRows.find((row) => row.id === o.in_reply_to).peer_phone === o.peer_phone));
  check('nothing in this file went out by SMS', smsSent.length === 0, smsSent);
  check('the access token is in no log line', !logs.join('\n').includes('test-access-token'));

  finish('whatsapp-inbound');
}

run().catch((err) => { process.stdout.write(`${err.stack}\n`); process.exit(1); });
