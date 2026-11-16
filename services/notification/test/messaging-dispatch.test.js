// R35 §1 · the dispatcher on Meta, and the SMS fallback.
//
// WhatsApp moved from Vonage to Meta's Cloud API. Meta delivers free
// text only inside the 24 hours after the user's last message; outside
// that window it wants an approved template, and R35 has none. So a
// caller that asks for WhatsApp when WhatsApp cannot deliver must end
// up on SMS, not on an error. The OTP route is the caller that matters
// most (channel 'auto' with the authentication template, when the user
// picked WhatsApp on the login screen), and an OTP that fails to send
// is a user who cannot log in.
//
// Real dispatcher, real Meta sender, real OTP route. Fake database,
// fake SMS provider, fake network.
//
// Run: node test/messaging-dispatch.test.js

const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  check, finish, captureLogs, stubModule, unloadSrc, load, fakeDb, fakeNetwork, request, SRC,
} = require('./helpers');

const PHONE = '+972501234567';
const WA_ID = '972501234567';

const logs = captureLogs();
const db   = fakeDb();
const net  = fakeNetwork();
const smsSent = [];
const STUBS = ['db.js', 'sms/index.js', 'mailer/sendgrid.js', 'consumers/handlers.js'];
stubModule('db.js', { getPool: () => db.pool, initDb: async () => {} });
stubModule('sms/index.js', {
  sendSms: async (phone, message) => { smsSent.push({ phone, message }); return { messageId: `sms-${smsSent.length}`, provider: 'stub' }; },
});
// The OTP route's file also pulls these in; neither is on the OTP path.
stubModule('mailer/sendgrid.js', { sendEmail: async () => {} });
stubModule('consumers/handlers.js', { handle: async () => {} });

function configureMeta(on) {
  if (on) {
    process.env.WHATSAPP_ACCESS_TOKEN    = 'test-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '100000000000001';
  } else {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}
const metaRejects = (code, message) => () => net.json(400, { error: { message, type: 'OAuthException', code, error_data: { messaging_product: 'whatsapp', details: message } } });

// Runs one send and reports which channel it really used.
async function send(sendMessage, opts, phone = PHONE) {
  const before = { graph: net.graphCalls.length, sms: smsSent.length };
  let result = null;
  let error = null;
  try {
    result = await sendMessage(phone, 'גוף ההודעה', opts);
  } catch (err) {
    error = err;
  }
  return { result, error, graph: net.graphCalls.slice(before.graph), sms: smsSent.slice(before.sms) };
}
function openWindow(phone = PHONE, secondsAgo = 60) {
  db.supportMessages.push({
    id: `in-${db.supportMessages.length}`, channel: 'whatsapp', direction: 'inbound', peer_phone: phone,
    message_text: 'רצפים', message_uuid: `wamid.WINDOW${db.supportMessages.length}`, created_at: Math.floor(db.now / 1000) - secondsAgo,
  });
}

async function run() {
  configureMeta(true);
  process.env.WHATSAPP_API_VERSION = 'v26.0';
  let { sendMessage, sendSms } = load('messaging/index.js');

  // ── 1. the contract that did not change ──────────────────────────
  check('sendMessage and sendSms are still what the module exports', typeof sendMessage === 'function' && typeof sendSms === 'function');
  let r = await send(sendMessage, undefined);
  check('no channel given: SMS, as before', r.result.channel === 'sms' && r.sms.length === 1 && r.graph.length === 0, r.result);
  r = await send(sendMessage, { channel: 'sms' });
  check("channel 'sms': SMS", r.result.channel === 'sms' && r.result.provider === 'stub' && r.sms.length === 1 && r.graph.length === 0, r.result);

  // ── 2. 'whatsapp' free text and the 24-hour window ───────────────
  r = await send(sendMessage, { channel: 'whatsapp' });
  check("'whatsapp' free text with no inbound message on record: goes by SMS, not an error",
    r.error === null && r.result.channel === 'sms' && r.sms.length === 1 && r.sms[0].phone === PHONE, r.error && r.error.message);
  check('and Meta is not called for a message it would not deliver', r.graph.length === 0);

  openWindow(PHONE, 25 * 3600);
  r = await send(sendMessage, { channel: 'whatsapp' });
  check('last inbound message 25 hours ago: still SMS', r.result.channel === 'sms' && r.graph.length === 0 && r.sms.length === 1);

  openWindow(PHONE, 23 * 3600);
  r = await send(sendMessage, { channel: 'whatsapp' });
  check('last inbound message 23 hours ago: WhatsApp', r.error === null && r.result.channel === 'whatsapp' && r.graph.length === 1 && r.sms.length === 0, r.result);
  check("the provider string is 'meta-cloud' and messageId is the wamid", r.result.provider === 'meta-cloud' && r.result.messageId === 'wamid.OUT1', r.result);
  const text = r.graph[0];
  check('POST https://graph.facebook.com/{version}/{phone number id}/messages',
    text.method === 'POST' && text.url === 'https://graph.facebook.com/v26.0/100000000000001/messages', text.url);
  check('Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}', text.headers.Authorization === 'Bearer test-access-token' && text.headers['Content-Type'] === 'application/json');
  check('text payload: messaging_product, to without the plus, type text, body, preview_url true',
    JSON.stringify(text.body) === JSON.stringify({ messaging_product: 'whatsapp', to: WA_ID, type: 'text', text: { body: 'גוף ההודעה', preview_url: true } }), text.body);
  check('the request carries a timeout signal', text.signal instanceof AbortSignal);
  const row = db.whatsappLog.at(-1);
  check('whatsapp_message_log row: submitted, wamid, no template',
    row.status === 'submitted' && row.message_uuid === 'wamid.OUT1' && row.template_name === null && row.phone === PHONE && row.submitted_at instanceof Date, row);

  r = await send(sendMessage, { channel: 'whatsapp' }, '0501234567');
  check('the window is found whatever form the caller gives the number in', r.result.channel === 'whatsapp' && r.graph[0].body.to === WA_ID, r.result);
  r = await send(sendMessage, { channel: 'whatsapp' }, '+972509999999');
  check("one number's open window does not open another's", r.result.channel === 'sms' && r.graph.length === 0);

  net.graph = metaRejects(131000, 'Something went wrong');
  r = await send(sendMessage, { channel: 'whatsapp' });
  check("'whatsapp' free text inside the window that Meta refuses: an error, and no SMS (a chat reply is not re-sent as SMS)",
    r.error !== null && r.sms.length === 0 && r.graph.length === 1, r.result);
  check("Meta's status and code are in the error, the token is not",
    r.error.message.includes('400') && r.error.message.includes('code 131000') && !r.error.message.includes('test-access-token'), r.error.message);
  check('the failed attempt is logged', db.whatsappLog.at(-1).status === 'failed' && db.whatsappLog.at(-1).delivery_err.includes('131000'), db.whatsappLog.at(-1));
  net.graph = null;

  db.failNext = (sql) => (/INTERVAL 24 HOUR/.test(sql) ? new Error('connection lost') : null);
  r = await send(sendMessage, { channel: 'whatsapp' });
  db.failNext = null;
  check('window lookup fails: an error, not a guess, and no SMS', r.error !== null && r.sms.length === 0 && r.graph.length === 0);

  // ── 3. templates ─────────────────────────────────────────────────
  const WINDOWLESS = '+972507777777';
  r = await send(sendMessage, { channel: 'whatsapp', templateName: 'tagidai_otp_he', templateParams: ['123456'] }, WINDOWLESS);
  check("'whatsapp' with a template needs no open window", r.result.channel === 'whatsapp' && r.graph.length === 1 && r.sms.length === 0, r.result);
  check('template payload skeleton: name, language he, body parameters',
    JSON.stringify(r.graph[0].body) === JSON.stringify({
      messaging_product: 'whatsapp', to: '972507777777', type: 'template',
      template: { name: 'tagidai_otp_he', language: { code: 'he' }, components: [{ type: 'body', parameters: [{ type: 'text', text: '123456' }] }] },
    }), r.graph[0].body);
  check('the log row names the template', db.whatsappLog.at(-1).template_name === 'tagidai_otp_he');

  net.graph = metaRejects(132001, 'Template name does not exist in the translation');
  r = await send(sendMessage, { channel: 'whatsapp', templateName: 'tagidai_otp_he', templateParams: ['123456'] }, WINDOWLESS);
  check("'whatsapp' with a template Meta has not approved: falls back to SMS", r.error === null && r.result.channel === 'sms' && r.graph.length === 1 && r.sms.length === 1, r.error && r.error.message);
  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp_he', templateParams: ['123456'] }, WINDOWLESS);
  check("'auto' with a template Meta has not approved: falls back to SMS", r.error === null && r.result.channel === 'sms' && r.graph.length === 1 && r.sms.length === 1, r.error && r.error.message);
  check('the SMS carries the same text to the same number', r.sms[0].phone === WINDOWLESS && r.sms[0].message === 'גוף ההודעה', r.sms[0]);
  net.graph = () => { throw new TypeError('fetch failed'); };
  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp_he', templateParams: ['123456'] }, WINDOWLESS);
  check("'auto' when Meta cannot be reached at all: SMS", r.error === null && r.result.channel === 'sms' && r.sms.length === 1);
  net.graph = null;

  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp_he', templateParams: ['123456'] }, WINDOWLESS);
  check("'auto' with a template Meta accepts: WhatsApp, no SMS", r.result.channel === 'whatsapp' && r.result.provider === 'meta-cloud' && r.sms.length === 0);
  r = await send(sendMessage, { channel: 'auto' });
  check("'auto' without a template: SMS, and Meta is not called, even inside the window", r.result.channel === 'sms' && r.graph.length === 0 && r.sms.length === 1);

  // ── 3b. the AUTHENTICATION template (the OTP) ────────────────────
  // Meta's documented send: the code as the body parameter AND as the
  // parameter of the copy-code button (a URL button at index "0").
  const AUTH_PAYLOAD = (name, code, language = 'he') => ({
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '972507777777', type: 'template',
    template: {
      name, language: { code: language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  });
  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp', otpCode: '482913' }, WINDOWLESS);
  check('authentication template: WhatsApp, no SMS', r.error === null && r.result.channel === 'whatsapp' && r.graph.length === 1 && r.sms.length === 0, r.result);
  check('authentication template payload: body parameter and copy-code button parameter, both the code, language he',
    JSON.stringify(r.graph[0].body) === JSON.stringify(AUTH_PAYLOAD('tagidai_otp', '482913')), r.graph[0].body);
  check('the button index is the string "0", as Meta documents it', r.graph[0].body.template.components[1]?.index === '0');
  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp', otpCode: 482913, templateLanguage: 'en_US' }, WINDOWLESS);
  check('the language can be overridden, and a numeric code is sent as text',
    JSON.stringify(r.graph[0].body) === JSON.stringify(AUTH_PAYLOAD('tagidai_otp', '482913', 'en_US')), r.graph[0].body);
  r = await send(sendMessage, { channel: 'auto', otpCode: '482913' }, WINDOWLESS);
  check('a code without a template name: SMS, Meta not called', r.result.channel === 'sms' && r.graph.length === 0 && r.sms.length === 1, r.result);
  net.graph = metaRejects(132018, 'There was an issue with the parameters in your template');
  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp', otpCode: '482913' }, WINDOWLESS);
  check('authentication template Meta refuses: SMS', r.error === null && r.result.channel === 'sms' && r.graph.length === 1 && r.sms.length === 1, r.error && r.error.message);
  net.graph = null;

  // ── 4. no Meta credentials ───────────────────────────────────────
  configureMeta(false);
  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp_he', templateParams: ['123456'] });
  check("no WHATSAPP_* credentials: 'auto' goes straight to SMS", r.result.channel === 'sms' && r.graph.length === 0 && r.sms.length === 1);
  r = await send(sendMessage, { channel: 'whatsapp' });
  check("no WHATSAPP_* credentials: 'whatsapp' is a configuration error that names the variables",
    r.error !== null && r.error.message.includes('WHATSAPP_ACCESS_TOKEN') && r.error.message.includes('WHATSAPP_PHONE_NUMBER_ID') && r.sms.length === 0, r.error && r.error.message);
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp_he' });
  check('the token alone is not enough: both variables are required', r.result.channel === 'sms' && r.graph.length === 0);
  // The old Vonage variables no longer switch anything on.
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  process.env.VONAGE_APPLICATION_ID  = 'x';
  process.env.VONAGE_PRIVATE_KEY     = 'x';
  process.env.VONAGE_WHATSAPP_NUMBER = 'x';
  r = await send(sendMessage, { channel: 'auto', templateName: 'tagidai_otp_he' });
  check('the three Vonage WhatsApp variables no longer enable WhatsApp', r.result.channel === 'sms' && r.graph.length === 0);
  delete process.env.VONAGE_APPLICATION_ID;
  delete process.env.VONAGE_PRIVATE_KEY;
  delete process.env.VONAGE_WHATSAPP_NUMBER;

  // ── 5. the API version ───────────────────────────────────────────
  configureMeta(true);
  process.env.WHATSAPP_API_VERSION = 'v23.0';
  r = await send(sendMessage, { channel: 'whatsapp' });
  check('WHATSAPP_API_VERSION is read on each send', r.graph[0].url.startsWith('https://graph.facebook.com/v23.0/'), r.graph[0].url);
  delete process.env.WHATSAPP_API_VERSION;
  r = await send(sendMessage, { channel: 'whatsapp' });
  check('unset, the request still names a version', /^https:\/\/graph\.facebook\.com\/v\d+\.0\/100000000000001\/messages$/.test(r.graph[0].url), r.graph[0].url);

  // ── 6. the OTP route: POST /internal/otp { phone, code, channel } ─
  async function otpServer(templateName, language) {
    if (templateName) process.env.WHATSAPP_OTP_TEMPLATE_NAME = templateName;
    else delete process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    if (language) process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE = language;
    else delete process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE;
    unloadSrc(STUBS);
    const app = express();
    app.use(express.json());
    app.use('/', load('routes/notifications.js'));
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    return server;
  }
  async function otp(server, body) {
    const before = { graph: net.graphCalls.length, sms: smsSent.length };
    const payload = JSON.stringify(body);
    const res = await request(server, { method: 'POST', path: '/internal/otp', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, body: payload });
    return { status: res.status, json: JSON.parse(res.text), graph: net.graphCalls.slice(before.graph), sms: smsSent.slice(before.sms) };
  }
  const OTP_TEXT = 'קוד האימות שלך לכניסה לפורטל TagidAI הוא: 482913\nבתוקף 10 דקות. אל תשתף קוד זה.';

  // As deployed today: Meta credentials set, no approved template.
  let server = await otpServer(null);
  let o = await otp(server, { phone: PHONE, code: '482913', channel: 'whatsapp' });
  check('OTP, WhatsApp chosen, no template configured: 200 and sent', o.status === 200 && o.json.sent === true, o.json);
  check('by SMS, and the answer says sms', o.json.channel === 'sms' && o.sms.length === 1 && o.sms[0].phone === PHONE && o.sms[0].message === OTP_TEXT, o.sms);
  check('without calling Meta first', o.graph.length === 0, o.graph.length);
  openWindow(PHONE, 60);
  o = await otp(server, { phone: PHONE, code: '482913', channel: 'whatsapp' });
  check('inside the 24-hour window, still no free-text OTP: SMS without a template', o.json.channel === 'sms' && o.graph.length === 0);
  o = await otp(server, { phone: PHONE, code: '482913', channel: 'sms' });
  check("OTP, channel 'sms': SMS", o.json.channel === 'sms' && o.graph.length === 0 && o.sms.length === 1);
  o = await otp(server, { phone: PHONE, code: '482913' });
  check('OTP with no channel at all (registration): SMS', o.json.channel === 'sms' && o.graph.length === 0 && o.sms.length === 1);
  o = await otp(server, { phone: PHONE });
  check('OTP without a code is still a 400', o.status === 400 && o.sms.length === 0);
  o = await otp(server, { phone: PHONE, code: '482913', channel: 'telegram' });
  check('OTP with an unknown channel: 400, nothing sent', o.status === 400 && o.sms.length === 0 && o.graph.length === 0, o.json);
  server.close();

  // The template is configured.
  server = await otpServer('tagidai_otp');
  net.graph = metaRejects(132001, 'Template name does not exist in the translation');
  o = await otp(server, { phone: PHONE, code: '482913', channel: 'whatsapp' });
  check('OTP, template configured but Meta rejects it: the user still gets the code, by SMS, and the answer says sms',
    o.status === 200 && o.json.sent === true && o.json.channel === 'sms' && o.sms.length === 1 && o.sms[0].message === OTP_TEXT && o.graph.length === 1, o.json);
  net.graph = null;
  o = await otp(server, { phone: PHONE, code: '482913', channel: 'whatsapp' });
  const sent = o.graph[0] && o.graph[0].body;
  check('OTP, template configured and accepted: WhatsApp, and the answer says whatsapp', o.json.channel === 'whatsapp' && o.sms.length === 0 && o.graph.length === 1, o.json);
  check('sent as the authentication template: the code in the body and in the copy-code button, language he',
    JSON.stringify(sent) === JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: WA_ID, type: 'template',
      template: {
        name: 'tagidai_otp', language: { code: 'he' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
        ],
      },
    }), sent);
  check('the log row names the template', db.whatsappLog.at(-1).template_name === 'tagidai_otp' && db.whatsappLog.at(-1).status === 'submitted');
  o = await otp(server, { phone: PHONE, code: '482913', channel: 'sms' });
  check('OTP, template configured, SMS chosen: SMS, Meta not called', o.json.channel === 'sms' && o.graph.length === 0 && o.sms.length === 1);
  o = await otp(server, { phone: PHONE, code: '482913' });
  check('OTP, template configured, no channel (registration): SMS, Meta not called', o.json.channel === 'sms' && o.graph.length === 0 && o.sms.length === 1);
  o = await otp(server, { phone: PHONE, code: '482913', whatsapp_opt_in: true });
  check('the old whatsapp_opt_in flag no longer switches WhatsApp on', o.json.channel === 'sms' && o.graph.length === 0);
  server.close();

  server = await otpServer('tagidai_otp', 'en_US');
  o = await otp(server, { phone: PHONE, code: '482913', channel: 'whatsapp' });
  check('WHATSAPP_OTP_TEMPLATE_LANGUAGE overrides he', o.json.channel === 'whatsapp' && o.graph[0].body.template.language.code === 'en_US', o.graph[0] && o.graph[0].body.template);
  server.close();

  // No Meta credentials at all (a local stack).
  configureMeta(false);
  server = await otpServer('tagidai_otp');
  o = await otp(server, { phone: PHONE, code: '482913', channel: 'whatsapp' });
  check('OTP with no Meta credentials: SMS', o.status === 200 && o.json.channel === 'sms' && o.graph.length === 0 && o.sms.length === 1);
  server.close();
  delete process.env.WHATSAPP_OTP_TEMPLATE_NAME;
  delete process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE;

  // ── 7. callers, read from the source ─────────────────────────────
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  })(SRC);
  const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');
  const source = Object.fromEntries(files.map((f) => [rel(f), fs.readFileSync(f, 'utf8')]));
  const callers = Object.keys(source).filter((f) => /sendMessage\(/.test(source[f]) && f !== 'messaging/index.js').sort();
  check('sendMessage has exactly two callers: the OTP route and the WhatsApp reply',
    JSON.stringify(callers) === JSON.stringify(['routes/notifications.js', 'whatsapp/handleInbound.js']), callers);
  const names = (re) => Object.keys(source).filter((f) => re.test(source[f]));
  check('nothing in src reads the Vonage WhatsApp variables',
    names(/VONAGE_APPLICATION_ID|VONAGE_PRIVATE_KEY|VONAGE_WHATSAPP_NUMBER/).length === 0, names(/VONAGE_APPLICATION_ID|VONAGE_PRIVATE_KEY|VONAGE_WHATSAPP_NUMBER/));
  check('nothing in src requires vonageWhatsapp, and the file is gone',
    names(/vonageWhatsapp/).length === 0 && !fs.existsSync(path.join(SRC, 'messaging', 'vonageWhatsapp.js')), names(/vonageWhatsapp/));
  check('the SMS side still has its Vonage provider', fs.existsSync(path.join(SRC, 'sms', 'vonage.js')) && /VONAGE_API_KEY/.test(source['sms/vonage.js']));
  check('the OTP template name has no hard-coded default', !/WHATSAPP_OTP_TEMPLATE_NAME\s*\|\|/.test(source['routes/notifications.js']));

  check('the access token is in no log line', !logs.join('\n').includes('test-access-token'));
  finish('messaging-dispatch');
}

run().catch((err) => { process.stdout.write(`${err.stack}\n`); process.exit(1); });
