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
  const jsxBlock = src.match(/aria-atomic="true">([\s\S]{50,500}?)<\/div>/);
  assert.ok(jsxBlock, 'region body must exist');
  const body = jsxBlock[1];
  assert.match(body, /loading/,  'loading branch present');
  assert.match(body, /error/,    'error branch present');
  assert.match(body, /resp\.total\s*===\s*0/, 'no-match branch present');
  assert.match(body, /\$\{resp\.total\}/,     'total-count branch present');
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
