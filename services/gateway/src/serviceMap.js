// The gateway's route table: path prefix → upstream service.
//
// index.js mounts one proxy per entry, in this order, and Express
// serves a request from the first mount that matches. So a rule for
// one exact path under a broader prefix has to come BEFORE the
// broader one. Kept in its own module so a test can ask "where does
// this path go" of the same object the gateway mounts
// (test/webhook-routing.test.js).

const services = {
  '/api/auth':          process.env.AUTH_SERVICE_URL          || 'http://auth:3001',
  '/api/organizations': process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/users':         process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/documents':     process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/workers':       process.env.WORKER_SERVICE_URL        || 'http://worker:3003',
  '/api/enums':         process.env.WORKER_SERVICE_URL        || 'http://worker:3003',
  '/api/tenders':       process.env.DEAL_SERVICE_URL          || 'http://deal:3005',
  '/api/notifications': process.env.NOTIFICATION_SERVICE_URL  || 'http://notification:3006',
  // R37 4.0 · Cardcom's recurring-charge webhook is handled by the
  // payment service (payment/app/routes/webhooks.py). It was in the
  // public list but had no rule of its own, so it fell under
  // /api/webhooks below and reached the notification service, which
  // answered 404. Listed first: the mounts are made in this order and
  // the first match serves the request.
  '/api/webhooks/cardcom-recurring': process.env.PAYMENT_SERVICE_URL || 'http://payment:3009',
  // R37 4.1 · Cardcom's call when a card page is finished, also handled
  // by payment. A prefix needs a path boundary to match, so this rule
  // and the one above do not overlap.
  '/api/webhooks/cardcom': process.env.PAYMENT_SERVICE_URL || 'http://payment:3009',
  '/api/webhooks':      process.env.NOTIFICATION_SERVICE_URL  || 'http://notification:3006',
  '/api/admin':         process.env.ADMIN_SERVICE_URL         || 'http://admin:3007',
  '/api/payments':      process.env.PAYMENT_SERVICE_URL       || 'http://payment:3009',
  '/api/marketplace':   process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/uploads':       process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/support-tickets': process.env.USER_ORG_SERVICE_URL    || 'http://user-org:3002',
  '/api/membership-requests': process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002',
  '/api/ads':           process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/events':        process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/search':        process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  // L10 shipped the /legal/{slug} + /legal/settings routes on user-org
  // and added /api/legal to PUBLIC_PREFIXES, but forgot to add the
  // proxy mapping here — every /api/legal/* call fell through to the
  // default 404 handler. Surfaced by S1 smoke test §2.2 B2.
  '/api/legal':         process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  // L7 — /api/contractor/reveals (PRD-2). Named prefix so future
  // contractor-only routes can land here without a per-endpoint
  // gateway edit.
  '/api/contractor':    process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
};

// Where Express would send `path`: the first entry, in order, whose
// prefix is the path itself or is followed by a slash. That boundary
// is Express's own rule for app.use(prefix): '/api/webhooks/cardcom'
// does not match '/api/webhooks/cardcom-recurring'.
function upstreamFor(path, table = services) {
  const clean = String(path).split('?')[0];
  for (const [prefix, target] of Object.entries(table)) {
    if (clean === prefix || clean.startsWith(prefix + '/')) return { prefix, target };
  }
  return null;
}

module.exports = { services, upstreamFor };
