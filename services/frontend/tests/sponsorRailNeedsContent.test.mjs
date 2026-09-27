// R31 · the side rail must never be the only thing on the page.
//
// Reported as "סלוט הפרסום בצד לא עובד טוב". Measured on staging's
// landing page, the content column's innerHTML was exactly
// `<section></section>` — 0px tall. HomeSponsorBillboard and
// HomeSponsorCarousel had both returned null and `recent.length` was
// 0, so nothing rendered; SponsorRailLayout promoted to two columns
// regardless, because it only ever asked whether a rail AD existed.
// Result: a 300×600 tower beside 1120×600 of white.
//
// Launch day is that same page — `recent` is empty until someone
// posts — so this is not a staging artefact.
//
// No jsdom in the repo (see l2FilterUrl.test.mjs), so this reads the
// source with comments stripped.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src', 'features', 'advertising', 'MarketplaceSponsors.tsx');
const raw = readFileSync(SRC, 'utf8');

const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

test('showRail requires content next to the rail, not just an ad', () => {
  const m = code.match(/const\s+showRail\s*=\s*([^;]+);/);
  assert.ok(m, 'SponsorRailLayout must compute showRail');
  const expr = m[1];
  assert.match(expr, /\bad\b/, 'still needs an ad');
  assert.match(
    expr,
    /hasContent/,
    'showRail must also require that the content column rendered something — '
    + 'an ad alone is what produced the 300×600 tower beside an empty column',
  );
});

test('content presence is measured from the DOM, not assumed', () => {
  // The children decide what they render, asynchronously, after their
  // own fetches. Only the laid-out element knows.
  assert.match(code, /offsetHeight\s*>\s*0/, 'must measure the content cell');
  assert.match(
    code,
    /new ResizeObserver/,
    'billboard and carousel fill in late; a one-shot read latches 0 forever',
  );
});

test('both layout states share one tree so children never remount', () => {
  // The rail now waits on a measurement, so the single→two column
  // transition happens on essentially every load. Two separate
  // returns would remount `children` each time, re-running the
  // billboard's and carousel's effects and refetching their ads —
  // wasteful, and a dedupe hazard because SponsorProvider hands out
  // each ad exactly once.
  // Bound the slice to this function only. The first version cut at
  // the first `\n}\n`, which does not end the function — it ran on
  // into RailCell and counted its return too, reporting 3.
  const start = code.indexOf('export function SponsorRailLayout');
  assert.ok(start !== -1, 'SponsorRailLayout must exist');
  const after = code.slice(start + 1);
  const nextDecl = after.search(/\n(?:export )?function /);
  const upToEnd = nextDecl === -1 ? after : after.slice(0, nextDecl);
  // A JSX return opens its paren and breaks the line. `return (` alone
  // also matches the two effect cleanups — `return () => ro.disconnect()`
  // and `return () => { cancelled = true; }` — which is what made the
  // first version report 3.
  const returns = upToEnd.match(/\n\s*return \(\s*\n/g) || [];
  assert.equal(
    returns.length,
    1,
    `SponsorRailLayout must have exactly one return; found ${returns.length}`,
  );
  assert.match(upToEnd, /ref=\{contentRef\}/, 'the content column must carry the ref');
});
