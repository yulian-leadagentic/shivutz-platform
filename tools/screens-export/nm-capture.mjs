// SP capture — one-off screenshot of the landing page in a scrolled +
// keyboard-focused state (proves WCAG 2.4.11 "focus not obscured"),
// plus one screenshot with near-matches on screen for the SP prompt's
// specific ask. Written as a standalone script rather than as another
// entry in screens.spec.ts so the main capture pass can stay purely
// URL-driven.
//
// Output: <repo>/screens-export/desktop/nm-*.png + mobile equivalents.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE      = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT  = join(HERE, '..', '..', 'screens-export');
const BASE_URL  = process.env.BASE_URL ?? 'https://frontend-pivot-staging.up.railway.app';

const VIEWPORTS = [
  { name: 'desktop', config: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { name: 'mobile',  config: { ...devices['Desktop Chrome'], viewport: { width: 390,  height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } },
];

const NEAR_MATCH_QUERY = 'רצפים סינים'; // exact=1, near=1 (flooring/UA) — confirmed via NM battery

async function capture(vp) {
  mkdirSync(join(OUT_ROOT, vp.name), { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...vp.config, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const page    = await context.newPage();

  // Load landing, wait for the sticky search bar to render.
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.waitForSelector('form[role="search"] input', { timeout: 15_000 });

  // 1. Initial state — sticky bar at rest.
  await page.screenshot({ path: join(OUT_ROOT, vp.name, 'nm-01-landing.png'), fullPage: false });

  // 2. Type a query that triggers a near-match + submit.
  await page.fill('form[role="search"] input', NEAR_MATCH_QUERY);
  await page.locator('form[role="search"] button[type="submit"]').click();
  // Wait for the AMBER near-match banner specifically. Previous version
  // waited for any [role="status"], which matches the sr-only status
  // region that is ALWAYS in the DOM — the wait resolved instantly and
  // the screenshot caught the loading skeleton. The amber banner only
  // renders after resp.near_matches is populated, so it proves results
  // are on screen.
  await page.waitForSelector('div[role="status"].bg-amber-50', { timeout: 20_000 });
  // Also wait until the loading skeleton is gone — belt-and-suspenders
  // so we never catch a mid-swap frame.
  await page.waitForSelector('ul[aria-hidden="true"]', { state: 'detached', timeout: 5_000 }).catch(() => {});
  // Slight settle so any layout shift completes before we shoot.
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT_ROOT, vp.name, 'nm-02-near-matches.png'), fullPage: false });

  // 3. Scroll far enough that the sticky bar is docked, and Tab into
  //    a result card so we can prove focus is NOT obscured (WCAG 2.4.11).
  //    On mobile 390, one screen of scroll usually already docks the bar.
  await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'instant' }));
  await page.waitForTimeout(400);
  // Tab past the sticky bar's own controls (input, mic, חפש) into the
  // results area. The exact number varies by rendered controls; keep
  // tabbing until an element inside the results list has focus.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inResults = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return false;
      // any button/link inside the results section
      const li = el.closest('li');
      return li != null;
    });
    if (inResults) break;
  }
  await page.screenshot({ path: join(OUT_ROOT, vp.name, 'nm-03-focus-not-obscured.png'), fullPage: false });

  await browser.close();
  console.log(`[${vp.name}] wrote nm-01-landing.png, nm-02-near-matches.png, nm-03-focus-not-obscured.png`);
}

for (const vp of VIEWPORTS) {
  console.log(`── ${vp.name} ──`);
  await capture(vp);
}
