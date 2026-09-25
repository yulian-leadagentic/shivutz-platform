// verify(L2) — the landing filters must round-trip through the URL,
// and the live region must exist as a real sr-only aria-live element.
// jsdom isn't available in the repo, so we grep the compiled source
// for the required attributes + wire-up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, '..', 'src', 'app', 'page.tsx');
const src = readFileSync(PAGE, 'utf8');

test('mounts the sr-only aria-live region for search results', () => {
  // The region must be persistent (present before content changes) so
  // screen readers pick up the announcement — not gated behind {resp
  // && …}. Grep for the sr-only status region.
  const region = src.match(/<div\s+className="sr-only"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.ok(region, 'sr-only region with role=status aria-live=polite aria-atomic=true is required');
});

test('announces loading, error, no-match, and total count', () => {
  // R31 §2 · this assertion used to be
  //   /aria-atomic="true">([\s\S]{50,500}?)<\/div>/
  // and had been FAILING since before R30 — the preflight runner is
  // simply the first thing that ran it where anyone looked.
  //
  // Nothing was wrong with the region. The body outgrew the 500-char
  // window when R28 §1 added the comment explaining why near_matches
  // do not count as results, so the lazy quantifier could no longer
  // reach a closing </div>. A test that breaks when a COMMENT is added
  // is measuring the wrong thing.
  //
  // Anchor on the region and read a generous window forward; the four
  // branch assertions below are what this test actually cares about.
  const start = src.indexOf('aria-atomic="true">');
  assert.ok(start !== -1, 'region body must exist');
  const body = src.slice(start, start + 4000);
  // The assertions below were written against the ORIGINAL region and
  // two of them had drifted away from the implementation:
  //
  //   /error/          the state was renamed `error` → `searchError`,
  //                    and /error/ is case-sensitive so it stopped
  //                    matching the capital E.
  //   /resp\.total/    R28 §1 deliberately replaced resp.total with
  //                    exact + market, because near_matches are
  //                    labelled separately and must NOT count as
  //                    results. The test was still asserting the
  //                    behaviour that section removed.
  //
  // Updated to the current implementation. What this test protects is
  // unchanged: the live region must announce all four states, so a
  // screen-reader user is never left listening to silence.
  assert.match(body, /loading/,      'loading branch present');
  assert.match(body, /searchError/,  'error branch present');
  assert.match(body, /mainTotal === 0 && near === 0/, 'no-match branch present');
  assert.match(body, /\$\{exact\}|exact === 1/,       'result-count branch present');
});

test('reads prof/region/origin from URL on mount', () => {
  // A single useEffect that seeds fProf/fRegion/fOrigin from
  // useSearchParams so shared URLs reproduce the same filter state.
  assert.match(src, /params\?\.get\('prof'\)/,   'reads ?prof');
  assert.match(src, /params\?\.get\('region'\)/, 'reads ?region');
  assert.match(src, /params\?\.get\('origin'\)/, 'reads ?origin');
});

test('syncFiltersToUrl writes filter chips back to the URL', () => {
  // Same helper used by runSearch + clearFilters; router.replace
  // preserves other params (?reveal etc.) via URL construction.
  assert.match(src, /function\s+syncFiltersToUrl/, 'helper defined');
  assert.match(src, /router\.replace\(url\.pathname\s*\+\s*url\.search/, 'writes via router.replace');
  assert.match(src, /syncFiltersToUrl\(fProf,\s*fRegion,\s*fOrigin\)/, 'runSearch calls sync with current filter state');
  assert.match(src, /syncFiltersToUrl\('',\s*'',\s*''\)/, 'clearFilters wipes URL params');
});

test('URL setter uses set/delete based on value truthiness', () => {
  // A `?prof=` with an empty string is worse than absent — grep for
  // the ternary that deletes when empty.
  assert.match(
    src,
    /prof\s*\?\s*url\.searchParams\.set\('prof',\s*prof\)\s*:\s*url\.searchParams\.delete\('prof'\)/,
    'prof: set when truthy, delete when empty',
  );
});
