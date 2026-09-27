// R31 §4 · horizontal-overflow measurement for the three dashboards.
//
// The dashboards are behind a login and I am not permitted to
// authenticate. But §4 asks a pure layout question —
// `document.scrollWidth === document.clientWidth` — which needs the
// deployed CSS and a rendered tree, not a real session.
//
// So: every /api/** request is intercepted and answered from fixtures
// here, and a synthetic JWT is injected as the access_token cookie.
// No request reaches a backend and no real account is involved.
// AuthContext decodes the payload without verifying the signature
// (lib/AuthContext.tsx parseToken → decodeJwtPayload), and the comment
// above it already names "Playwright's cookie-injection flow" as a
// supported path, so this is the harness the code was written for.
//
// Fixtures deliberately carry LONG Hebrew strings and wide numbers.
// A dashboard overflows on its worst content, not its average.

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'https://frontend-staging-3206.up.railway.app';
const OUT = process.argv[2] || '.';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: '00000000-0000-4000-8000-00000000da5b',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.harness-not-a-signature`;

const PERSONAS = {
  contractor: {
    path: '/contractor/dashboard',
    token: jwt({
      role: 'user', entity_type: 'contractor', membership_role: 'owner',
      entity_id: 'c0000000-0000-4000-8000-000000000001',
      full_name: 'אבי כהן — עבודות שלד ובנייה בע״מ', phone: '+972500000141',
    }),
  },
  corporation: {
    path: '/corporation/dashboard',
    token: jwt({
      role: 'user', entity_type: 'corporation', membership_role: 'owner',
      entity_id: 'c0000000-0000-4000-8000-000000000002',
      full_name: 'תאגיד כוח אדם בינלאומי לבנייה בע״מ', phone: '+972500000142',
    }),
  },
  provider: {
    path: '/provider/dashboard',
    token: jwt({
      role: 'user', entity_type: 'service_provider', membership_role: 'owner',
      entity_id: 'c0000000-0000-4000-8000-000000000003',
      full_name: 'טכנו־ספקים · ציוד והסעות לאתרי בנייה', phone: '+972500000143',
    }),
  },
};

const USAGE = {
  tier: 'advanced', status: 'active', entitled: true,
  limits: {
    reveals_per_month: 120, active_ads: 25, can_boost: true,
    max_users: 10, included_users: 3, extra_user_price_nis: 49,
  },
  usage: { reveals_this_month: 87, active_ads: 14 },
};

const SUBSCRIPTION = (entityType, entityId) => ({
  id: 's0000000-0000-4000-8000-000000000001',
  entity_id: entityId, entity_type: entityType,
  tier: 'advanced', status: 'active', cardcom_plan_code: null,
  trial_ends_at: null, current_period_end: '2026-12-31T23:59:59Z',
  cancelled_at: null,
  created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-20T10:00:00Z',
});

const ORG = (kind, id) => ({
  id, name: kind === 'contractor'
    ? 'אבי כהן — עבודות שלד ובנייה בע״מ'
    : 'תאגיד כוח אדם בינלאומי לבנייה בע״מ',
  business_number: '514274839', contact_name: 'אבי כהן',
  contact_phone: '+972500000141', email: 'avi@example.co.il',
  city: 'ראשון לציון', region: 'center',
  kablan_registry_number: '1234567', kablan_verified: true,
  approval_status: 'approved', trust_level: 'tier_2',
  classification: 'ג-100 · בנייה · סיווג 5',
  address_he: 'רחוב יוסף בן־דוד 6, ראשון לציון',
  created_at: '2026-09-01T10:00:00Z',
});

const PROVIDER_ME = {
  id: 'c0000000-0000-4000-8000-000000000003',
  name: 'טכנו־ספקים · ציוד והסעות לאתרי בנייה',
  business_number: '514274840', primary_category: 'equipment',
  contact_name: 'דנה לוי', contact_phone: '+972500000143',
  email: 'dana@example.co.il', city: 'פתח תקווה', region: 'center',
  website: 'https://example.co.il', approval_status: 'approved',
  trust_level: 'tier_2', verified: true,
  description: 'השכרת ציוד כבד, פיגומים והסעות עובדים לאתרי בנייה בכל הארץ.',
};

const LISTINGS = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    title: 'השכרת פיגומים ממוכנים — פריסה ארצית תוך 24 שעות',
    category: 'equipment', category_he: 'ציוד וכלי עבודה',
    price_nis: 2400, price_unit: 'month', city: 'פתח תקווה',
    region: 'center', status: 'active', active: 1, is_seed: 0,
    views: 1284, reveals: 37, created_at: '2026-09-10T10:00:00Z',
    updated_at: '2026-09-20T10:00:00Z', photos: [], description:
      'פיגומים תקניים עם אישור בודק מוסמך, הובלה והרכבה כלולים במחיר.',
  },
];

const MEMBERS = [
  { id: 'u1', user_id: 'u1', full_name: 'אבי כהן', phone: '+972500000141',
    email: 'avi@example.co.il', membership_role: 'owner', status: 'active',
    created_at: '2026-09-01T10:00:00Z' },
  { id: 'u2', user_id: 'u2', full_name: 'מרים בן־שושן', phone: '+972500000144',
    email: 'miriam@example.co.il', membership_role: 'member', status: 'active',
    created_at: '2026-09-05T10:00:00Z' },
];

function fixtureFor(url, persona) {
  const p = new URL(url).pathname.replace(/^\/api/, '');
  const { entity_type, entity_id } = JSON.parse(
    Buffer.from(PERSONAS[persona].token.split('.')[1], 'base64url').toString(),
  );

  if (p.includes('/subscriptions/me')) return SUBSCRIPTION(entity_type, entity_id);
  if (p.includes('/ads/usage')) return USAGE;
  if (p.includes('/ads/plans')) return { tiers: [] };
  if (p.includes('/providers/me')) return PROVIDER_ME;
  if (/\/organizations\/contractors\//.test(p)) return ORG('contractor', entity_id);
  if (/\/organizations\/corporations\//.test(p)) return ORG('corporation', entity_id);
  if (p.includes('/marketplace')) return LISTINGS;
  if (/users|members/.test(p)) return MEMBERS;
  if (p.includes('/ads/mine') || p.includes('/ads')) return [];
  if (p.includes('/reveals')) return [];
  if (p.includes('/tenders')) return [];
  if (p.includes('/notifications')) return { items: [], unread: 0 };
  // Unknown endpoint: a list-shaped path gets [], anything else {}.
  return /s$/.test(p) ? [] : {};
}

const PROBE = () => {
  const d = document.documentElement;
  const W = d.clientWidth;
  const sx = (e) => {
    const s = getComputedStyle(e);
    return (s.overflowX === 'auto' || s.overflowX === 'scroll')
        && e.scrollWidth > e.clientWidth + 1;
  };
  const inScroller = (e) => {
    for (let p = e.parentElement; p && p !== d; p = p.parentElement) if (sx(p)) return true;
    return false;
  };
  const off = [...document.querySelectorAll('body *')]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width && r.height && (r.right > W + 1 || r.left < -1) && !inScroller(e);
    })
    .slice(0, 5)
    .map((e) => {
      const r = e.getBoundingClientRect();
      const c = e.className?.baseVal !== undefined ? e.className.baseVal : String(e.className || '');
      return `${e.tagName}.${c.slice(0, 48)} [${Math.round(r.left)}..${Math.round(r.right)}]`;
    });
  return {
    sw: d.scrollWidth, cw: W, ok: d.scrollWidth === W, off,
    // A guard that rendered instead of the dashboard would make the
    // measurement meaningless, so report what actually mounted.
    h1: document.querySelector('h1,h2')?.textContent?.trim().slice(0, 48) || null,
    bounced: location.pathname,
    guard: /אין לך|אין גישה|הפניה|מפנה/.test(document.body.innerText),
  };
};

const rows = [];
const browser = await chromium.launch();

for (const [name, persona] of Object.entries(PERSONAS)) {
  for (const width of [390, 412]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 915 },
      locale: 'he-IL', deviceScaleFactor: 2,
    });
    await ctx.addCookies([{
      name: 'access_token', value: persona.token,
      domain: new URL(BASE).hostname, path: '/',
    }]);
    await ctx.route('**/api/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureFor(route.request().url(), name)),
      });
    });

    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    await page.goto(BASE + persona.path, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);

    const r = await page.evaluate(PROBE);
    rows.push({ dashboard: persona.path, width, ...r, errors: errors.slice(0, 2) });
    console.log(
      `${persona.path.padEnd(24)} ${width}  ok=${r.ok}  ${r.sw}/${r.cw}` +
      `  mounted="${r.h1}"  at=${r.bounced}` +
      (r.off.length ? `\n      ${r.off.join('\n      ')}` : '') +
      (errors.length ? `\n      JS: ${errors[0]}` : ''),
    );
    await page.screenshot({ path: `${OUT}/dash-${name}-${width}.png`, fullPage: true });
    await ctx.close();
  }
}

await browser.close();
writeFileSync(`${OUT}/dash-overflow.json`, JSON.stringify(rows, null, 2));
console.log('\nwrote dash-overflow.json + 6 screenshots');
