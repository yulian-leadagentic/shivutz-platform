// R31 §1c · RoleGuard must let a service_provider into /provider/*.
//
// §11b had asked, and nobody had ever run it: "a real non-admin
// provider — does RoleGuard let him through?" It did not. The section
// is named 'provider' and the JWT claim is 'service_provider', so
// `entityType !== expect` was true for every provider on their own
// dashboard and the render returned the need-contractor card —
// "אין לך חשבון קבלן", the exact screen /provider/dashboard was
// created to stop showing them.
//
// The effect had been patched for this in R5 §1. The render had not.
// That is the shape of this bug: two places that must agree about one
// thing, and only one of them was updated. So this test pins the thing
// that actually prevents it — that BOTH sites go through one shared
// predicate — rather than re-checking the symptom.
//
// jsdom isn't available in the repo (see l2FilterUrl.test.mjs), so we
// read the source. Comments are stripped first: a rule that a comment
// mentioning `entityType !== expect` can break is not a rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = resolve(HERE, '..', 'src', 'components', 'layout', 'RoleGuard.tsx');
const raw = readFileSync(GUARD, 'utf8');

const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

test('the section↔entity_type mapping exists in one place', () => {
  assert.match(
    code,
    /function\s+entityMatches\s*\(/,
    'a single predicate must own the section↔entity_type mapping',
  );
  assert.match(
    code,
    /expect\s*===\s*'provider'\s*\)\s*return\s+entityType\s*===\s*'service_provider'/,
    "entityMatches must map section 'provider' to claim 'service_provider'",
  );
});

test('no call site compares entityType to expect directly', () => {
  // The helper's own body is `return entityType === expect` for every
  // non-provider section — that line is the definition, not a call
  // site, so cut the function out before looking. (The first version of
  // this test failed on it, which is the check working: it cannot tell
  // a definition from a use unless it is told.)
  const callSites = code.replace(
    /function\s+entityMatches[\s\S]*?\n}\n/,
    '\n',
  );
  // This is the regression. Either form of the raw comparison means a
  // provider is measured against the string 'provider' and loses.
  assert.doesNotMatch(
    callSites,
    /entityType\s*!==\s*expect/,
    'a site still uses entityType !== expect; it must use !entityMatches(...)',
  );
  assert.doesNotMatch(
    callSites,
    /entityType\s*===\s*expect/,
    'a site still uses entityType === expect; it must use entityMatches(...)',
  );
});

test('all three sites actually call it', () => {
  // Three, not two: the effect's happy path, the no-access render, and
  // the admin cross-entity banner. The banner was the one I missed on
  // the first pass — an admin whose active entity is a service_provider
  // was told on their own section that some data would not load.
  const calls = code.match(/entityMatches\s*\(\s*entityType\s*,\s*expect\s*\)/g) || [];
  assert.ok(
    calls.length >= 3,
    `expected the effect, the render and the admin banner to call `
    + `entityMatches; found ${calls.length}`,
  );
  // The render branch is the one that produced the wrong card, so
  // assert its negated form specifically — a file that called the
  // predicate twice in the effect would otherwise pass.
  assert.match(
    code,
    /!entityMatches\s*\(\s*entityType\s*,\s*expect\s*\)/,
    'the no-access render branch must be guarded by !entityMatches(...)',
  );
});
