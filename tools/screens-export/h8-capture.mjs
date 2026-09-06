// H8 capture — full-page landing on both viewports + docHeight
// probe. Also verifies:
//   • LandingTrustBar not rendered (below H8 threshold: 11 workers,
//     6 corps — both under 20 / 10).
//   • RoleRegisterPicker shows only 2 tiles (no "מתווכים ...בקרוב").
//   • HowItWorksSection is hidden by default (hidden attr present,
//     h2 not visible in the DOM's laid-out size).
//   • Nav trigger has aria-expanded="false".
// Then clicks the nav trigger and verifies the section opens.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE     = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(HERE, '..', '..', 'screens-export');
const BASE_URL = process.env.BASE_URL ?? 'https://staging.buildupai.net';

const VP = [
  { name: 'desktop', config: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { name: 'mobile',  config: { ...devices['Desktop Chrome'], viewport: { width: 390,  height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } },
];

const results = {};

for (const vp of VP) {
  const dir = join(OUT_ROOT, vp.name);
  mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const c = await b.newContext({ ...vp.config, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', reducedMotion: 'reduce' });
  const p = await c.newPage();
  await p.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45_000 });
  await p.waitForSelector('.ai-mark.ai-mark--hl', { timeout: 15_000 });
  await p.waitForTimeout(500);

  // ── Fold + full-page probes ──────────────────────────────────
  const closed = await p.evaluate(() => {
    const body = document.body.innerText;
    return {
      docHeight:            document.documentElement.scrollHeight,
      viewportHeight:       window.innerHeight,
      trustBarPresent:      !!document.querySelector('.tabular-nums'),  // trust bar tiles use tabular-nums
      trustBarText:         document.body.innerText.includes('חשיפות ב-30 יום'),
      hasComingSoonTile:    body.includes('מתווכים ובעלי מקצוע'),
      howItWorksHidden:     document.getElementById('how-it-works')?.hidden ?? null,
      navHowAriaExpanded:   document.querySelector('[aria-controls="how-it-works"]')?.getAttribute('aria-expanded'),
    };
  });
  console.log(`[${vp.name}] closed:`, JSON.stringify(closed, null, 2));

  await p.screenshot({ path: join(dir, 'h8-01-scroll0.png'), fullPage: false });
  await p.screenshot({ path: join(dir, 'h8-02-full.png'), fullPage: true });

  // ── Open the disclosure via nav ──────────────────────────────
  // On mobile the trigger lives inside the hamburger drawer;
  // click the hamburger first so the drawer's trigger becomes
  // visible. Desktop trigger is already visible.
  if (vp.name === 'mobile') {
    await p.locator('button.md\\:hidden').first().click();
    await p.waitForTimeout(300);
  }
  await p.locator('[aria-controls="how-it-works"]:visible').first().click();
  await p.waitForTimeout(600);

  const open = await p.evaluate(() => ({
    howItWorksHidden:     document.getElementById('how-it-works')?.hidden ?? null,
    navHowAriaExpanded:   document.querySelector('[aria-controls="how-it-works"]')?.getAttribute('aria-expanded'),
    activeElement:        document.activeElement?.tagName + ':' + (document.activeElement?.textContent?.slice(0, 30) ?? ''),
    hash:                 window.location.hash,
  }));
  console.log(`[${vp.name}] after nav-click:`, JSON.stringify(open, null, 2));
  await p.screenshot({ path: join(dir, 'h8-03-how-open.png'), fullPage: false });

  // ── Esc closes and returns focus ─────────────────────────────
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const afterEsc = await p.evaluate(() => ({
    howItWorksHidden:     document.getElementById('how-it-works')?.hidden ?? null,
    navHowAriaExpanded:   document.querySelector('[aria-controls="how-it-works"]')?.getAttribute('aria-expanded'),
    activeIsNavTrigger:   document.activeElement?.getAttribute('aria-controls') === 'how-it-works',
    hash:                 window.location.hash,
  }));
  console.log(`[${vp.name}] after Esc:`, JSON.stringify(afterEsc, null, 2));

  results[vp.name] = { closed, open, afterEsc };
  await b.close();
}

console.log('\n=== summary ===');
for (const [vp, r] of Object.entries(results)) {
  console.log(`${vp}: docHeight=${r.closed.docHeight}, trustBar=${r.closed.trustBarPresent}, comingSoon=${r.closed.hasComingSoonTile}, howHidden=${r.closed.howItWorksHidden}, ariaExp=${r.closed.navHowAriaExpanded} → after-click aria=${r.open.navHowAriaExpanded} → after-Esc restore=${r.afterEsc.activeIsNavTrigger}`);
}
