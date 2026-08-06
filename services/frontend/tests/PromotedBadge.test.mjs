// verify(L4) — PromotedBadge's accessibility contract, tested without
// jsdom by parsing the source and asserting on the JSX shape.
//
// Reading the .tsx as text is coarse but sufficient to guard the two
// invariants the L4 audit demanded:
//   1. The word "מקודם" is a real text node (in the accessible name),
//      not conveyed by color alone.
//   2. The Zap icon is aria-hidden so screen readers announce "מקודם"
//      once, not "מקודם, Zap icon".
//
// The full rendering path (organic cards do NOT show the badge) is a
// caller-side gate — see /page.tsx, FeaturedAdsCarousel.tsx, and
// /corporation/ads/page.tsx: each wraps <PromotedBadge /> in a
// {boosted && ...} test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BADGE = resolve(
  HERE, '..', 'src', 'components', 'ads', 'PromotedBadge.tsx',
);
const src = readFileSync(BADGE, 'utf8');

test('renders the Hebrew word "מקודם" as a real text node', () => {
  // Text between the closing </Zap> style call and the closing </span>
  // — greedy check that "מקודם" appears in JSX children, not inside
  // an attribute like aria-label.
  const jsxTextRegex = />\s*מקודם\s*</;
  assert.ok(
    jsxTextRegex.test(src),
    '"מקודם" must appear as a JSX text node so screen readers pick it up',
  );
});

test('Zap icon is aria-hidden', () => {
  // The icon is decorative; the disclosure is carried by the text.
  // Screen readers announcing "Zap icon, מקודם" would double-up.
  const iconLine = src.match(/<Zap[^/>]*\/>/);
  assert.ok(iconLine, 'the Zap icon is rendered');
  assert.match(iconLine[0], /aria-hidden=/, 'Zap must be aria-hidden');
});

test('uses DS tokens (brand-*) rather than ad-hoc hex', () => {
  // Guards the "token, not hex" DS requirement. If someone drops a
  // #f88b17 in here to match a mock, this yells.
  const hasBrandTokens =
    /bg-brand-\d/.test(src) &&
    /text-brand-\d/.test(src);
  assert.ok(hasBrandTokens, 'must use bg-brand-* + text-brand-* tokens');
  // Any raw hex in this component fails the token rule.
  assert.doesNotMatch(
    src,
    /#[0-9a-fA-F]{3,8}\b/,
    'no raw hex colours allowed — DS tokens only',
  );
});

test('the three ad-surface callers gate the badge on a boost flag', () => {
  // Organic cards must NOT show it. We verify by grepping each caller
  // for the `{boosted && <PromotedBadge` pattern.
  const CALLERS = [
    '../src/app/page.tsx',
    '../src/features/advertising/FeaturedAdsCarousel.tsx',
    '../src/app/corporation/ads/page.tsx',
  ];
  for (const rel of CALLERS) {
    const path = resolve(HERE, rel);
    const s = readFileSync(path, 'utf8');
    assert.match(
      s,
      /\{\s*boosted\s*&&\s*<PromotedBadge/,
      `${rel}: PromotedBadge must be gated on the boosted flag`,
    );
  }
});
