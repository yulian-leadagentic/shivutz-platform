require('dotenv').config();
const express     = require('express');
const morgan      = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { v4: uuidv4 } = require('uuid');
const { validateToken } = require('./auth');
const { rateLimiter }   = require('./rateLimit');

const app = express();

// ─── Request ID ────────────────────────────────────────────
app.use((req, _, next) => {
  req.id = uuidv4();
  next();
});

// ─── Logging ───────────────────────────────────────────────
app.use(morgan(':method :url :status :response-time ms - :req[x-request-id]'));

// ─── CORS ──────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Health ────────────────────────────────────────────────
// Liveness — static OK, independent of dependencies.
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'gateway' }));
// Readiness — gateway itself has no direct deps; downstream failure surfaces
// as 502s on the proxied routes, so readyz tracks only the listener.
app.get('/readyz', (_, res) => res.json({ status: 'ready', service: 'gateway' }));

// ─── Route table ───────────────────────────────────────────
const services = {
  '/api/auth':          process.env.AUTH_SERVICE_URL          || 'http://auth:3001',
  '/api/organizations': process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/users':         process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/documents':     process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/workers':       process.env.WORKER_SERVICE_URL        || 'http://worker:3003',
  '/api/enums':         process.env.WORKER_SERVICE_URL        || 'http://worker:3003',
  '/api/searches':      process.env.JOB_MATCH_SERVICE_URL     || 'http://job-match:3004',
  '/api/deals':         process.env.DEAL_SERVICE_URL          || 'http://deal:3005',
  '/api/commissions':   process.env.DEAL_SERVICE_URL          || 'http://deal:3005',
  '/api/tenders':       process.env.DEAL_SERVICE_URL          || 'http://deal:3005',
  '/api/notifications': process.env.NOTIFICATION_SERVICE_URL  || 'http://notification:3006',
  '/api/webhooks':      process.env.NOTIFICATION_SERVICE_URL  || 'http://notification:3006',
  '/api/admin':         process.env.ADMIN_SERVICE_URL         || 'http://admin:3007',
  '/api/payments':      process.env.PAYMENT_SERVICE_URL       || 'http://payment:3009',
  '/api/marketplace':   process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/uploads':       process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/support-tickets': process.env.USER_ORG_SERVICE_URL    || 'http://user-org:3002',
};

// Public routes (no auth required) — matched against req.originalUrl
const PUBLIC_PREFIXES = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/register',
  '/api/auth/send-otp',          // SMS OTP — Phase 2
  '/api/auth/verify-otp',        // SMS OTP — Phase 2
  '/api/auth/login/otp',         // SMS OTP login — Phase 2
  '/api/auth/invite/validate',   // Invitation token check — Phase 4
  '/api/auth/invite/accept',     // Invitation acceptance — Phase 4
  '/api/enums',                  // profession/region enum lookups are public
  '/api/webhooks/vonage',        // Vonage webhooks — secured by Signature Secret JWT, not user JWT
  // Uploaded files are served as static assets via the user-org service.
  // Filenames are server-generated UUIDs, so the URL is itself the
  // capability — `<a href>` clicks from the docs page don't carry an
  // Authorization header, so 401-gating them broke file preview entirely
  // (QA-R3 #22). Acceptable pre-launch; swap to signed short-lived URLs
  // before opening up to real tenant data.
  '/api/uploads',
];

// Public only for specific HTTP methods (exact path → allowed methods)
const PUBLIC_METHOD_ROUTES = {
  '/api/organizations/contractors': new Set(['POST']),          // self-registration
  '/api/organizations/contractors/lookup': new Set(['POST']),   // pre-registration registry lookup (gated by recent OTP)
  '/api/organizations/corporations': new Set(['POST']),         // self-registration
  '/api/organizations/corporations/lookup': new Set(['POST']),  // pre-registration registry lookup (gated by recent OTP)
};

// Public only for specific HTTP methods matched by prefix (prefix → allowed methods)
// Used for routes where GET is public but mutating methods require auth
const PUBLIC_METHOD_PREFIXES = [
  { prefix: '/api/marketplace/leads', methods: new Set(['POST']) }, // lead capture — no auth
  { prefix: '/api/marketplace',       methods: new Set(['GET']) },  // public browse
];

// Public only for specific HTTP methods matched by suffix on a prefix
// (e.g. /api/organizations/contractors/{any-id}/verify/start) — security
// comes from the verification token in the body, not a JWT.
const PUBLIC_METHOD_SUFFIXES = [
  { prefix: '/api/organizations/contractors/', suffix: '/verify/start',   methods: new Set(['POST']) },
  { prefix: '/api/organizations/contractors/', suffix: '/verify/confirm', methods: new Set(['POST']) },
];

// Admin-only routes — matched against the request URL (not the service
// prefix) so we can mark sub-paths admin-only without affecting the rest
// of the upstream service. e.g. /api/marketplace/admin/* is admin-only,
// but /api/marketplace/* (browse) stays public for everyone.
const ADMIN_ONLY = ['/api/admin', '/api/marketplace/admin'];

for (const [prefix, target] of Object.entries(services)) {
  app.use(prefix, async (req, res, next) => {
    req.headers['x-request-id'] = req.id;

    // Rate limiting
    const limited = await rateLimiter(req, res);
    if (limited) return;

    // Auth check — use originalUrl so the full /api/... path is available
    const url = req.originalUrl.split('?')[0];
    const isPublic =
      PUBLIC_PREFIXES.some(p => req.originalUrl.startsWith(p)) ||
      Object.entries(PUBLIC_METHOD_ROUTES).some(
        ([path, methods]) => url === path && methods.has(req.method)
      ) ||
      PUBLIC_METHOD_PREFIXES.some(
        ({ prefix: p, methods }) => req.originalUrl.startsWith(p) && methods.has(req.method)
      ) ||
      PUBLIC_METHOD_SUFFIXES.some(
        ({ prefix: p, suffix: s, methods }) =>
          url.startsWith(p) && url.endsWith(s) && methods.has(req.method)
      );
    function attachUserHeaders(user) {
      req.headers['x-user-id']   = user.sub;
      // Effective role for this request. Multi-membership users
      // (e.g. yulian@ — owns a corp AND a contractor entity) have a
      // legacy `role` from users.role that reflects their FIRST
      // signup, while their CURRENT working context is decided by
      // the entity they picked at /select-entity. Downstream services
      // gate on the role they're acting as right now, so we project
      // entity_type into x-user-role when present and only fall back
      // to the legacy role for admins (who have no entity context).
      // This fixed the "contractor_only" 403 a corp-rooted contractor
      // got when approving a deal.
      req.headers['x-user-role'] = user.entity_type || user.role;
      // x-org-id is consumed across services as the CURRENT ACTING
      // entity's id (the thing the user is operating as right now),
      // not as the legacy users.org_id. For multi-membership users
      // (own a corp AND a contractor), the legacy org_id reflects
      // their first signup — which is the WRONG entity if they're
      // currently acting as the other one. Mirror the entity-aware
      // projection we do for x-user-role: when entity context is
      // present, project entity_id into x-org-id; only fall back
      // to the legacy org_id when there's no entity context (admins
      // with no org, old single-entity users).
      // Audit 2026-05-17: every x-org-id reader (deals, job-match,
      // payment, user-org/marketplace*, worker) treats this as
      // "current acting entity" already, so the projection is
      // semantically lossless.
      const effectiveOrgId = user.entity_id || user.org_id;
      if (effectiveOrgId)       req.headers['x-org-id']          = effectiveOrgId;
      else                      delete req.headers['x-org-id'];
      if (user.phone)           req.headers['x-phone']           = user.phone;
      else                      delete req.headers['x-phone'];
      if (user.entity_id)       req.headers['x-entity-id']       = user.entity_id;
      else                      delete req.headers['x-entity-id'];
      if (user.entity_type)     req.headers['x-entity-type']     = user.entity_type;
      else                      delete req.headers['x-entity-type'];
      if (user.membership_role) req.headers['x-membership-role'] = user.membership_role;
      else                      delete req.headers['x-membership-role'];
    }

    if (!isPublic) {
      const user = await validateToken(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Role guard for admin routes — match against request URL so a
      // sub-path (e.g. /api/marketplace/admin) can be admin-only while
      // its parent (/api/marketplace) stays public for browse traffic.
      if (ADMIN_ONLY.some(p => url.startsWith(p)) && user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      attachUserHeaders(user);
    } else if (req.headers.authorization) {
      // Public route, but the caller IS logged in — pass identity headers so
      // backends can offer scoped behaviour (e.g. /marketplace?mine=true).
      const user = await validateToken(req).catch(() => null);
      if (user) attachUserHeaders(user);
    }

    next();
  }, createProxyMiddleware({
    target,
    changeOrigin: true,
    // Rewrite /api/auth/register → /auth/register, /api/enums/professions → /enums/professions
    // Express strips the mount prefix from req.url, so we restore it via originalUrl
    pathRewrite: (_path, req) => req.originalUrl.replace(/^\/api/, ''),
    on: {
      error: (err, _, res) => {
        console.error(`[gateway] Proxy error → ${target}:`, err.message);
        res.status(502).json({ error: 'Service unavailable' });
      }
    }
  }));
}

const PORT = process.env.GATEWAY_PORT || 3000;
app.listen(PORT, () => console.log(`API Gateway listening on ${PORT}`));
// Wave 4 deploy probe — 2026-05-07T09:12:51Z
// deploy probe — 2026-05-29 (pick up /api/tenders proxy route)
