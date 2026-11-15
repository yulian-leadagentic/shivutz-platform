// R37 4.0 · where a webhook lands.
//
// The gateway proxies by path prefix and mounts the prefixes in the
// order of the route table (src/serviceMap.js). Cardcom's
// recurring-charge webhook, /api/webhooks/cardcom-recurring, is handled
// by the payment service. It had no rule of its own, fell under
// /api/webhooks, reached the notification service and got a 404 there:
// on staging it answered "Cannot POST /webhooks/cardcom-recurring".
//
// What is pinned here:
//   1. that exact path goes to payment
//   2. everything else under /api/webhooks still goes to notification
//      (Vonage's webhooks, and Meta's WhatsApp webhook)
//   3. the specific rule sits before the broad one, because order is
//      what decides
//   4. index.js still mounts from this table, in its order
//
// Built-ins only, the real module. Run: node test/webhook-routing.test.js

const fs   = require('fs');
const path = require('path');

// Distinct addresses, so "which service" cannot pass by coincidence of
// two defaults. Set before the module reads them.
process.env.PAYMENT_SERVICE_URL      = 'http://payment.test';
process.env.NOTIFICATION_SERVICE_URL = 'http://notification.test';
process.env.USER_ORG_SERVICE_URL     = 'http://user-org.test';

const { services, upstreamFor } = require('../src/serviceMap');

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) { passed += 1; console.log(`ok    ${label}`); }
  else      { failed += 1; console.log(`FAIL  ${label}${extra ? `  [${extra}]` : ''}`); }
}

const PAYMENT      = 'http://payment.test';
const NOTIFICATION = 'http://notification.test';
const target = (p) => (upstreamFor(p) || {}).target;

// 1 · the Cardcom recurring webhook
check('POST /api/webhooks/cardcom-recurring goes to the payment service',
  target('/api/webhooks/cardcom-recurring') === PAYMENT, target('/api/webhooks/cardcom-recurring'));
check('with a query string too',
  target('/api/webhooks/cardcom-recurring?attempt=2') === PAYMENT);
check('and with a trailing path',
  target('/api/webhooks/cardcom-recurring/') === PAYMENT);

// 2 · the rest of /api/webhooks is untouched
for (const p of [
  '/api/webhooks/vonage',
  '/api/webhooks/vonage/sms/inbound',
  '/api/webhooks/vonage/messages/status',
  '/api/webhooks/whatsapp',
  '/api/webhooks/whatsapp?hub.mode=subscribe',
  '/api/webhooks',
]) {
  check(`${p} still goes to the notification service`, target(p) === NOTIFICATION, target(p));
}

// The rule is for one path, not for everything that starts with it.
check('a longer name that merely starts the same way is not the Cardcom path',
  target('/api/webhooks/cardcom-recurring-old') === NOTIFICATION);
// Not routed to payment today, and not public either: the LowProfile
// result webhook (payment's /webhooks/cardcom) is a separate decision.
// Pinned so that changing it is a deliberate edit of this line.
check('/api/webhooks/cardcom (the card-page result webhook) has no rule of its own yet',
  target('/api/webhooks/cardcom') === NOTIFICATION);

// 3 · order
const order = Object.keys(services);
check('the Cardcom rule is listed before /api/webhooks',
  order.indexOf('/api/webhooks/cardcom-recurring') !== -1 &&
  order.indexOf('/api/webhooks/cardcom-recurring') < order.indexOf('/api/webhooks'));
check('no prefix is listed after a broader prefix that would swallow it', (() => {
  for (let i = 0; i < order.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (order[i] !== order[j] && order[i].startsWith(order[j] + '/')) return false;
    }
  }
  return true;
})());

// Payments themselves were always routed correctly; make sure the move
// of the table into its own file kept every other route.
check('/api/payments still goes to the payment service', target('/api/payments/subscriptions/me') === PAYMENT);
check('/api/marketplace still goes to user-org', target('/api/marketplace/categories') === 'http://user-org.test');
check('an unknown path has no upstream', upstreamFor('/api/nope') === null);
check('a prefix needs a path boundary', upstreamFor('/api/authx') === null);

// 4 · index.js mounts this table, in this order. Comments are stripped
// first so a commented-out line cannot satisfy the check.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
check('index.js takes the table from ./serviceMap',
  /const\s*\{\s*services\s*\}\s*=\s*require\('\.\/serviceMap'\)/.test(source));
check('index.js defines no route table of its own', !/const\s+services\s*=\s*\{/.test(source));
check('index.js mounts one proxy per entry, in the table\'s order',
  /for\s*\(const\s*\[prefix,\s*target\]\s*of\s*Object\.entries\(services\)\)\s*\{\s*app\.use\(prefix,/.test(source));
check('the Cardcom path is still in the public list (Cardcom carries no user token)',
  /'\/api\/webhooks\/cardcom-recurring'/.test(source));

// R35 · Meta's WhatsApp webhook. It reaches notification through the
// broad /api/webhooks rule (pinned above) and has to be public: Meta
// sends no user token, and a 401 from the gateway would fail the
// handshake before the service ever saw it.
const publicList = (source.match(/const PUBLIC_PREFIXES = \[([\s\S]*?)\];/) || [])[1] || '';
check('/api/webhooks/whatsapp is in the public list', /'\/api\/webhooks\/whatsapp'/.test(publicList));
check('/api/webhooks/vonage is still in the public list', /'\/api\/webhooks\/vonage'/.test(publicList));
check('the whole /api/webhooks prefix is not public: each webhook is listed by name',
  !/'\/api\/webhooks'\s*,/.test(publicList));

console.log(`[webhook-routing] ${failed ? 'FAIL' : 'pass'}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
