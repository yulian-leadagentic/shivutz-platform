// H7 phase 1 — count staging state via public endpoints + admin fallbacks.
import { chromium, devices } from '@playwright/test';
const BASE = 'https://staging.buildupai.net';
const PHONE = '0525278625', OTP = '999999';

const b = await chromium.launch();
const c = await b.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
const p = await c.newPage();

await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45_000 });
await p.locator('input[type=tel]').fill(PHONE);
await p.locator('button:has-text("כניסה"), button:has-text("שלח")').first().click();
await p.waitForSelector('input[inputmode=numeric], input[maxlength="6"]', { timeout: 20_000 });
await p.locator('input[inputmode=numeric], input[maxlength="6"]').first().fill(OTP);
await p.locator('button:has-text("כניסה")').first().click();
await p.waitForURL(/select-entity|admin|dashboard/i, { timeout: 20_000 });
if (/select-entity/.test(p.url())) {
  await p.locator('button:has-text("מנהל מערכת")').first().click();
  await p.waitForLoadState('networkidle', { timeout: 20_000 });
}

// Try several admin endpoints to find the right paths
const report = await p.evaluate(async () => {
  const token = document.cookie.split('; ').find(r => r.startsWith('access_token='))?.split('=')[1];
  if (!token) return { error: 'no_token' };
  const H = { 'Authorization': `Bearer ${token}` };

  const grab = async (path, opts = {}) => {
    try {
      const r = await fetch(path, { ...opts, headers: { ...H, ...(opts.headers ?? {}) } });
      const txt = await r.text();
      let body;
      try { body = JSON.parse(txt); } catch { body = txt.slice(0, 200); }
      return { status: r.status, body };
    } catch (e) {
      return { error: String(e) };
    }
  };

  const stats     = await grab('/api/ads/public/stats');
  const recent    = await grab('/api/ads/public/recent?limit=100');
  const search    = await grab('/api/search?q=%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D&limit=100');
  const adminAds  = await grab('/api/admin/ads?limit=1000');
  const adminOrgs = await grab('/api/admin/orgs?limit=1000');
  const adminOrgsSlash = await grab('/api/admin/orgs/');
  const adminCorps = await grab('/api/admin/organizations?limit=1000');
  const dashStats = await grab('/api/admin/dashboard/stats');
  const membershipsMe = await grab('/api/auth/memberships');

  return { stats, recent, search, adminAds, adminOrgs, adminOrgsSlash, adminCorps, dashStats, membershipsMe };
});

// Save raw response then pretty-print summaries only
const summarize = {
  publicStats: report.stats?.body,
  membershipRole: report.membershipsMe?.body?.memberships?.[0]?.role || report.membershipsMe?.body?.role,
  endpointStatuses: {
    'GET /api/ads/public/stats':     report.stats?.status,
    'GET /api/ads/public/recent':    report.recent?.status,
    'GET /api/search?q=...':         report.search?.status,
    'GET /api/admin/ads':            report.adminAds?.status,
    'GET /api/admin/orgs':           report.adminOrgs?.status,
    'GET /api/admin/orgs/':          report.adminOrgsSlash?.status,
    'GET /api/admin/organizations':  report.adminCorps?.status,
    'GET /api/admin/dashboard/stats': report.dashStats?.status,
    'GET /api/auth/memberships':     report.membershipsMe?.status,
  },
  adminAdsIsArray:  Array.isArray(report.adminAds?.body),
  adminAdsCount:    Array.isArray(report.adminAds?.body) ? report.adminAds.body.length : `err:${JSON.stringify(report.adminAds?.body).slice(0,80)}`,
  adminOrgsBody:    report.adminOrgs?.body,
  adminOrgsSlashBody: report.adminOrgsSlash?.body,
  dashStatsBody:    report.dashStats?.body,
  recentAdsCount:   Array.isArray(report.recent?.body?.results) ? report.recent.body.results.length : `err:${JSON.stringify(report.recent?.body).slice(0,80)}`,
};

// If recent has ads, aggregate
if (Array.isArray(report.recent?.body?.results)) {
  const ads = report.recent.body.results;
  const byProf = {}, byOrigin = {}, byRegion = {};
  for (const a of ads) {
    const p = a.profession_code ?? '(null)';
    const o = a.origin_country ?? '(null)';
    const r = a.region ?? '(null)';
    byProf[p]   = (byProf[p]   ?? 0) + 1;
    byOrigin[o] = (byOrigin[o] ?? 0) + 1;
    byRegion[r] = (byRegion[r] ?? 0) + 1;
  }
  summarize.recentAggregation = { byProf, byOrigin, byRegion, sample: ads.slice(0,3) };
}

console.log(JSON.stringify(summarize, null, 2));

await b.close();
