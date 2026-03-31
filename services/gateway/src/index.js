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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Health ────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'gateway' }));

// ─── Route table ───────────────────────────────────────────
const services = {
  '/api/auth':          process.env.AUTH_SERVICE_URL          || 'http://auth:3001',
  '/api/organizations': process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/users':         process.env.USER_ORG_SERVICE_URL      || 'http://user-org:3002',
  '/api/workers':       process.env.WORKER_SERVICE_URL        || 'http://worker:3003',
  '/api/enums':         process.env.WORKER_SERVICE_URL        || 'http://worker:3003',
  '/api/job-requests':  process.env.JOB_MATCH_SERVICE_URL     || 'http://job-match:3004',
  '/api/contractors':   process.env.JOB_MATCH_SERVICE_URL     || 'http://job-match:3004',
  '/api/deals':         process.env.DEAL_SERVICE_URL          || 'http://deal:3005',
  '/api/commissions':   process.env.DEAL_SERVICE_URL          || 'http://deal:3005',
  '/api/notifications': process.env.NOTIFICATION_SERVICE_URL  || 'http://notification:3006',
  '/api/admin':         process.env.ADMIN_SERVICE_URL         || 'http://admin:3007',
};

// Public routes (no auth required)
const PUBLIC_PREFIXES = ['/api/auth/login', '/api/auth/refresh', '/api/auth/register'];

// Admin-only routes
const ADMIN_ONLY = ['/api/admin'];

for (const [prefix, target] of Object.entries(services)) {
  app.use(prefix, async (req, res, next) => {
    req.headers['x-request-id'] = req.id;

    // Rate limiting
    const limited = await rateLimiter(req, res);
    if (limited) return;

    // Auth check (skip for public routes)
    const isPublic = PUBLIC_PREFIXES.some(p => req.path.startsWith(p.replace(prefix, '')));
    if (!isPublic) {
      const user = await validateToken(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Role guard for admin routes
      if (ADMIN_ONLY.some(p => prefix.startsWith(p)) && user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.headers['x-user-id']   = user.sub;
      req.headers['x-user-role'] = user.role;
      req.headers['x-org-id']    = user.org_id || '';
    }

    next();
  }, createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: { [`^${prefix}`]: '' },
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
