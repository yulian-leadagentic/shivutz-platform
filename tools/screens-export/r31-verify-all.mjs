// R31 · every UI check this round produced, in one run.
//
//   1  horizontal overflow — 12 screens × 390 and 412
//   2  the three dashboards + /provider/marketplace/new render
//   3  the side rail: absent when starved, present when not
//   4  the rail never moves the content axis
//   5  the landing demo does not shift the page, and never blanks
//   6  contrast on the public screens
//
// Dashboards are behind a login I am not permitted to perform, so
// their /api/** calls are stubbed and a synthetic JWT is injected as
// a cookie. Nothing reaches a backend; no real account is involved.

import { chromium } from 'playwright';

const BASE = 'https://frontend-staging-3206.up.railway.app';
const LISTING = '1dd865f5-e9f8-afd8-5f42-65ea531d4eb2';

const PUBLIC = [
  ['/', 'home'], ['/marketplace', 'marketplace'],
  [`/marketplace/${LISTING}`, 'listing'], ['/how-it-works', 'how-it-works'],
  ['/contact', 'contact'], ['/login', 'login'],
  ['/accessibility', 'accessibility'], ['/terms', 'terms'], ['/privacy', 'privacy'],
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (c) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
  sub: '00000000-0000-4000-8000-00000000da5b',
  exp: Math.floor(Date.now() / 1000) + 3600, ...c })}.harness`;

const DASH = [
  ['/contractor/dashboard', jwt({ role: 'user', entity_type: 'contractor', membership_role: 'owner',
    entity_id: 'c0000000-0000-4000-8000-000000000001', full_name: 'אבי כהן — עבודות שלד' })],
  ['/corporation/dashboard', jwt({ role: 'user', entity_type: 'corporation', membership_role: 'owner',
    entity_id: 'c0000000-0000-4000-8000-000000000002', full_name: 'תאגיד כוח אדם בינלאומי' })],
  ['/provider/dashboard', jwt({ role: 'user', entity_type: 'service_provider', membership_role: 'owner',
    entity_id: 'c0000000-0000-4000-8000-000000000003', full_name: 'טכנו־ספקים' })],
  ['/provider/marketplace/new', jwt({ role: 'user', entity_type: 'service_provider', membership_role: 'owner',
    entity_id: 'c0000000-0000-4000-8000-000000000003', full_name: 'טכנו־ספקים' })],
];

const FIXTURES = (url) => {
  const p = new URL(url).pathname.replace(/^\/api/, '');
  if (p.includes('/subscriptions/me')) return { id: 's1', entity_id: 'c1', entity_type: 'contractor',
    tier: 'advanced', status: 'active', cardcom_plan_code: null, trial_ends_at: null,
    current_period_end: '2026-12-31T23:59:59Z', cancelled_at: null,
    created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-20T10:00:00Z' };
  if (p.includes('/ads/usage')) return { tier: 'advanced', status: 'active', entitled: true,
    limits: { reveals_per_month: 120, active_ads: 25, can_boost: true, max_users: 10,
      included_users: 3, extra_user_price_nis: 49 },
    usage: { reveals_this_month: 87, active_ads: 14 } };
  if (p.includes('/ads/plans')) return { tiers: [] };
  if (p.includes('/providers/me')) return { id: 'c3', name: 'טכנו־ספקים · ציוד והסעות',
    business_number: '514274840', primary_category: 'equipment', contact_name: 'דנה לוי',
    contact_phone: '+972500000143', email: 'd@example.co.il', city: 'פתח תקווה',
    region: 'center', website: null, description: 'השכרת ציוד כבד.',
    approval_status: 'approved', trust_level: 'tier_2', verified: true };
  if (/\/organizations\/(contractors|corporations)\//.test(p)) return { id: 'c1',
    name: 'אבי כהן — עבודות שלד ובנייה בע״מ', business_number: '514274839',
    contact_name: 'אבי כהן', contact_phone: '+972500000141', city: 'ראשון לציון',
    region: 'center', approval_status: 'approved', trust_level: 'tier_2',
    kablan_verified: true, created_at: '2026-09-01T10:00:00Z' };
  if (p.includes('/marketplace')) return [];
  if (/users|members/.test(p)) return [];
  return /s$/.test(p) ? [] : {};
};

const OVERFLOW = () => {
  const d = document.documentElement, W = d.clientWidth;
  const sx = (e) => { const s = getComputedStyle(e);
    return (s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1; };
  const inScroller = (e) => { for (let p = e.parentElement; p && p !== d; p = p.parentElement) if (sx(p)) return true; return false; };
  const off = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width && r.height && (r.right > W + 1 || r.left < -1) && !inScroller(e);
  }).slice(0, 3).map((e) => e.tagName + '.' + String(e.className || '').slice(0, 36));
  return { ok: d.scrollWidth === W, sw: d.scrollWidth, cw: W, off };
};

const CONTRAST = () => {
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(parseFloat); return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = (el) => { const L = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { L.push(c); if (c.a >= 1) break; } }
    let o = [255, 255, 255];
    for (let i = L.length - 1; i >= 0; i--) { const c = L[i]; o = [0, 1, 2].map((k) => c.rgb[k] * c.a + o[k] * (1 - c.a)); }
    return o; };
  const ratio = (f, bg) => { const A = lum(f), B = lum(bg); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim(); if (!t) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const px = parseFloat(cs.fontSize);
    const need = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)) ? 3 : 4.5;
    const cr = ratio(fg.rgb, bgOf(el));
    if (cr < need) out.push(`${t.slice(0, 20)} ${Math.round(cr * 100) / 100} ${cs.color}`);
  }
  return [...new Set(out)];
};

const results = { overflow: [], dashboards: [], rail: {}, demo: {}, contrast: {} };
const browser = await chromium.launch();

// ── 1 · overflow, 9 public screens × 2 widths ───────────────────────
for (const width of [390, 412]) {
  for (const [path, name] of PUBLIC) {
    const c = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 915 }, locale: 'he-IL' });
    const p = await c.newPage();
    await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(2500);
    const r = await p.evaluate(OVERFLOW);
    results.overflow.push({ name, width, ...r });
    await c.close();
  }
}

// ── 2 · dashboards (stubbed API + synthetic cookie) ─────────────────
for (const width of [390, 412]) {
  for (const [path, token] of DASH) {
    const c = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 915 }, locale: 'he-IL' });
    await c.addCookies([{ name: 'access_token', value: token, domain: new URL(BASE).hostname, path: '/' }]);
    await c.route('**/api/**', (route) => route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify(FIXTURES(route.request().url())) }));
    const p = await c.newPage();
    await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(2500);
    const r = await p.evaluate(OVERFLOW);
    const mounted = await p.evaluate(() => document.querySelector('h1,h2')?.textContent?.trim().slice(0, 34) || null);
    const blocked = await p.evaluate(() => /אין לך חשבון/.test(document.body.innerText));
    results.dashboards.push({ path, width, ...r, mounted, blocked });
    await c.close();
  }
}

// ── 3+4 · the rail ──────────────────────────────────────────────────
// Three probes, because one page cannot show both halves of the rule.
//   home starved   — nothing rendered at all      → rail must be absent
//   home normal    — 199px of sponsored strip     → rail must be absent
//   /marketplace   — a tall listing grid          → rail must be PRESENT
// The last one is the half that matters: a "fix" that just deleted
// the rail would pass the first two.
for (const probe of [
  { key: 'homeStarved', path: '/', starve: true },
  { key: 'homeNormal',  path: '/', starve: false },
  { key: 'marketplace', path: '/marketplace', starve: false },
]) {
  const { key, path: probePath, starve } = probe;
  const c = await browser.newContext({ viewport: { width: 1920, height: 1000 }, locale: 'he-IL' });
  if (starve) {
    await c.route('**/api/ads/public/**', (route) => {
      const u = route.request().url();
      if (u.includes('placement=side_rail')) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(u.includes('/recent') ? [] : { results: [] }) });
    });
  }
  const p = await c.newPage();
  await p.goto(BASE + probePath, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(4500);
  results.rail[key] = await p.evaluate(() => {
    const a = document.querySelector('aside[aria-label*="צד"]');
    const grid = a ? a.parentElement : [...document.querySelectorAll('div')]
      .find((e) => / 1152px /.test(' ' + getComputedStyle(e).gridTemplateColumns + ' '));
    const content = grid ? [...grid.children].find((x) => x !== a) : null;
    const R = (e) => e ? { l: Math.round(e.getBoundingClientRect().left), r: Math.round(e.getBoundingClientRect().right) } : null;
    // Any other centred section on the same page — the axis the rail
    // must not disturb.
    const other = [...document.querySelectorAll('main *')]
      .find((e) => { const r = e.getBoundingClientRect();
        return Math.round(r.width) === 1152 && r.height > 40 && e !== content; });
    return { rail: !!a, content: R(content), otherSection: R(other),
      contentH: content ? content.offsetHeight : null,
      gap: (a && content) ? Math.round(content.getBoundingClientRect().left - a.getBoundingClientRect().right) : null };
  });
  await c.close();
}

// ── 5 · landing demo stability ──────────────────────────────────────
for (const width of [390, 1500]) {
  const c = await browser.newContext({ viewport: { width, height: 900 }, locale: 'he-IL' });
  const p = await c.newPage();
  await p.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(4000);
  const hs = [], tops = [], blanks = [];
  for (let i = 0; i < 34; i++) {
    const s = await p.evaluate(() => {
      const sec = document.querySelector('section.demo-preview');
      const below = document.querySelector('main section.demo-preview ~ *');
      return { h: sec ? Math.round(sec.getBoundingClientRect().height) : 0,
        op: sec ? Number(getComputedStyle(sec).opacity) : 0,
        cards: sec ? sec.querySelectorAll('.demo-card').length : 0,
        top: below ? Math.round(below.getBoundingClientRect().top + scrollY) : null };
    });
    hs.push(s.h); if (s.top != null) tops.push(s.top);
    if (s.cards === 0 || s.op < 0.05) blanks.push(i);
    await p.waitForTimeout(400);
  }
  results.demo[width] = { shift: tops.length ? Math.max(...tops) - Math.min(...tops) : -1,
    heights: [...new Set(hs)], blankSamples: blanks.length, samples: hs.length };
  await c.close();
}

// ── 6 · contrast ────────────────────────────────────────────────────
for (const [path, name] of PUBLIC) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  const p = await c.newPage();
  await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500);
  results.contrast[name] = await p.evaluate(CONTRAST);
  await c.close();
}

await browser.close();

// ── report ──────────────────────────────────────────────────────────
const bad = results.overflow.filter((r) => !r.ok);
console.log('\n=== 1 · HORIZONTAL OVERFLOW (public) ===');
console.log(`  ${results.overflow.length - bad.length}/${results.overflow.length} clean`);
bad.forEach((r) => console.log(`  FAIL ${r.name} @${r.width}  ${r.sw}/${r.cw}  ${r.off.join(' ')}`));

const dbad = results.dashboards.filter((r) => !r.ok || r.blocked);
console.log('\n=== 2 · DASHBOARDS ===');
results.dashboards.filter((r) => r.width === 390).forEach((r) =>
  console.log(`  ${r.blocked ? 'BLOCKED' : 'ok     '} ${r.path.padEnd(30)} mounted="${r.mounted}"`));
console.log(`  overflow: ${results.dashboards.length - results.dashboards.filter((r) => !r.ok).length}/${results.dashboards.length} clean`);

console.log('\n=== 3+4 · SIDE RAIL ===');
const EXPECT = { homeStarved: false, homeNormal: false, marketplace: true };
for (const [k, r] of Object.entries(results.rail)) {
  const okk = r.rail === EXPECT[k];
  console.log(`  ${okk ? 'ok  ' : 'FAIL'} ${k.padEnd(12)} rail=${String(r.rail).padEnd(5)}`
    + ` (expected ${EXPECT[k]})  contentH=${r.contentH}`
    + (r.gap != null ? `  gap=${r.gap}px` : ''));
}
const ax = results.rail.marketplace.content, ox = results.rail.marketplace.otherSection;
console.log(`  content axis ${JSON.stringify(ax)} vs another 1152 section ${JSON.stringify(ox)}`
  + (ax && ox ? (ax.l === ox.l && ax.r === ox.r ? '  SAME AXIS' : '  <-- DIFFERENT AXIS') : '  (no sibling to compare)'));

console.log('\n=== 5 · LANDING DEMO ===');
for (const [w, d] of Object.entries(results.demo)) {
  console.log(`  ${w}px  shift=${d.shift}px  heights=${d.heights.join(',')}  blank=${d.blankSamples}/${d.samples}`);
}

console.log('\n=== 6 · CONTRAST (< required ratio) ===');
for (const [name, list] of Object.entries(results.contrast)) {
  console.log(`  ${name.padEnd(14)} ${list.length}`);
  list.slice(0, 3).forEach((l) => console.log(`      ${l}`));
}

const pass = bad.length === 0
  && dbad.length === 0
  && Object.entries(results.rail).every(([k, r]) => r.rail === EXPECT[k])
  && Object.values(results.demo).every((d) => d.shift === 0 && d.blankSamples === 0);
console.log('\n' + (pass ? 'ALL STRUCTURAL CHECKS PASS' : 'SOME CHECKS FAILED'));
process.exit(pass ? 0 : 1);
