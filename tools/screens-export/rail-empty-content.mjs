// R31 · prove the side rail collapses when it has nothing to sit beside.
//
// The bug needs a landing page where the billboard, the carousel and
// the recent-ads mosaic all render nothing while a side_rail ad still
// exists. On staging that depends on which ads happen to be eligible,
// so reproducing it by reloading is luck. Here it is forced: every
// sponsored fetch EXCEPT side_rail is answered empty, and
// /ads/public/recent returns [].
//
// Case A — content starved, rail ad available → rail must be ABSENT.
// Case B — nothing blocked                    → rail must be PRESENT.
//
// B is the half that matters most: a fix that just deletes the rail
// would pass A.

import { chromium } from 'playwright';

const BASE = 'https://frontend-staging-3206.up.railway.app';

const probe = () => {
  const aside = document.querySelector('aside[aria-label*="צד"]');
  const grid = aside ? aside.parentElement : null;
  const content = grid ? grid.children[0] : null;
  const anyGrid = [...document.querySelectorAll('div')]
    .find((e) => /300px/.test(getComputedStyle(e).gridTemplateColumns));
  return {
    railPresent: !!aside,
    twoColumn: !!anyGrid,
    contentHTML: content ? content.innerHTML.slice(0, 60) : null,
    contentH: content ? Math.round(content.getBoundingClientRect().height) : null,
  };
};

async function run(label, { starve }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 }, locale: 'he-IL' });

  if (starve) {
    await ctx.route('**/api/ads/public/**', async (route) => {
      const url = route.request().url();
      if (url.includes('placement=side_rail')) return route.continue();
      const empty = url.includes('/recent') ? [] : { results: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(empty) });
    });
  }

  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(probe);
  console.log(`${label.padEnd(26)} rail=${String(r.railPresent).padEnd(5)} ` +
              `twoCol=${String(r.twoColumn).padEnd(5)} contentH=${r.contentH} ` +
              `content=${JSON.stringify(r.contentHTML)}`);
  await page.screenshot({ path: `${process.argv[2] || '.'}/rail-${starve ? 'starved' : 'normal'}.png`, fullPage: false });
  await browser.close();
  return r;
}

const a = await run('A · content starved', { starve: true });
const b = await run('B · normal', { starve: false });

const ok = a.railPresent === false && b.railPresent === true;
console.log(`\nA rail absent: ${a.railPresent === false}`);
console.log(`B rail present: ${b.railPresent === true}`);
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
