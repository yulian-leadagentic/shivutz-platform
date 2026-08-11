#!/usr/bin/env node
// gallery.mjs
//
// Builds screens-export/index.html — a contact sheet of every captured
// route, grouped Public / Contractor / Corporation / Admin, with the
// desktop and mobile PNG side-by-side per row and the route path
// underneath.
//
// Reads:
//   tools/screens-export/routes.json (route list + category)
//   screens-export/desktop/*.png     (captured desktop shots)
//   screens-export/mobile/*.png      (captured mobile shots)
//
// Missing PNGs get a placeholder cell so the reviewer can see at a
// glance which routes didn't capture.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'screens-export');
mkdirSync(OUT_DIR, { recursive: true });

const routes = JSON.parse(readFileSync(join(HERE, 'routes.json'), 'utf8'));

const CATEGORIES = ['Public', 'Contractor', 'Corporation', 'Admin'];

function shotUrl(viewport, slug) {
  const p = join(OUT_DIR, viewport, `${slug}.png`);
  return existsSync(p) ? `${viewport}/${slug}.png` : null;
}

const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

const css = `
:root { color-scheme: light dark; --gap: 12px; --thumb-w: 320px; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; font: 14px/1.4 -apple-system, system-ui, sans-serif; background: #f7f7f9; color: #111; }
h1 { margin: 0 0 8px; font-size: 20px; }
h2 { margin: 32px 0 12px; font-size: 16px; padding-bottom: 6px; border-bottom: 1px solid #d9d9df; }
.meta { color: #666; font-size: 12px; margin-bottom: 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(720px, 1fr)); gap: 24px; }
.card { background: #fff; border: 1px solid #e3e3ea; border-radius: 12px; padding: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.02); }
.card .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #333; margin-bottom: 8px; word-break: break-all; }
.card .flags { font-size: 11px; color: #888; margin-bottom: 8px; }
.card .flags .flag { display: inline-block; padding: 1px 6px; border-radius: 8px; background: #eee; margin-right: 4px; }
.shots { display: grid; grid-template-columns: 1fr auto; gap: var(--gap); align-items: start; }
.shot { border: 1px solid #ddd; border-radius: 6px; overflow: hidden; background: #fafafa; }
.shot img { display: block; width: 100%; height: auto; }
.shot.mobile { width: 160px; }
.shot .cap { font-size: 11px; color: #999; padding: 4px 6px; text-align: center; background: #f2f2f2; border-top: 1px solid #ddd; }
.missing { padding: 40px 12px; text-align: center; color: #a33; font-size: 12px; background: #fef2f2; border: 1px dashed #f0b7b7; border-radius: 6px; }
@media (prefers-color-scheme: dark) {
  body { background: #12131a; color: #ddd; }
  h2 { border-bottom-color: #2a2c39; }
  .card { background: #1a1c25; border-color: #2a2c39; box-shadow: none; }
  .card .path { color: #ccc; }
  .card .flags .flag { background: #2a2c39; color: #999; }
  .shot { border-color: #2a2c39; background: #12131a; }
  .shot .cap { background: #12131a; border-top-color: #2a2c39; color: #666; }
  .missing { background: #2a1717; color: #eaa; border-color: #7a3a3a; }
}
`;

const sections = [];
const summary = { total: 0, captured: 0, missing: 0 };

for (const cat of CATEGORIES) {
  const rs = routes.filter((r) => r.category === cat);
  if (rs.length === 0) continue;
  const cards = rs.map((r) => {
    const desktop = shotUrl('desktop', r.slug);
    const mobile  = shotUrl('mobile',  r.slug);
    summary.total++;
    if (desktop || mobile) summary.captured++;
    else                    summary.missing++;
    const flags = [
      r.auth      && '<span class="flag">auth</span>',
      r.dynamic   && '<span class="flag">dynamic</span>',
      r.register  && '<span class="flag">register</span>',
    ].filter(Boolean).join(' ');
    const dCell = desktop
      ? `<div class="shot desktop"><img loading="lazy" src="${desktop}"><div class="cap">desktop 1440×900</div></div>`
      : `<div class="missing">no desktop shot</div>`;
    const mCell = mobile
      ? `<div class="shot mobile"><img loading="lazy" src="${mobile}"><div class="cap">mobile 390×844</div></div>`
      : `<div class="missing">no mobile shot</div>`;
    return `<div class="card"><div class="path">${r.path}</div><div class="flags">${flags}</div><div class="shots">${dCell}${mCell}</div></div>`;
  });
  sections.push(`<h2>${cat} (${rs.length})</h2><div class="grid">${cards.join('')}</div>`);
}

const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>TagidAI — screens export</title>
<style>${css}</style>
</head>
<body>
<h1>TagidAI — screens export</h1>
<div class="meta">Generated ${now} — ${summary.captured}/${summary.total} routes captured (${summary.missing} missing)</div>
${sections.join('\n')}
</body></html>
`;

const outPath = join(OUT_DIR, 'index.html');
writeFileSync(outPath, html, 'utf8');
console.log(`\nWrote ${relative(REPO_ROOT, outPath)}`);
console.log(`  ${summary.captured}/${summary.total} routes have at least one shot`);
console.log(`  ${summary.missing} missing`);
