// verify(O3) — every "קוד אימות נשלח…" (or "קוד נשלח…") line must sit
// inside a live region so SR users hear the code-sent transition, not
// just the visual sub-step change. Errors were already covered by
// aria-live=assertive; O3's remaining gap was this transition.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACES = [
  ['register/contractor',  '../src/app/register/contractor/page.tsx'],
  ['register/corporation', '../src/app/register/corporation/page.tsx'],
  ['login',                '../src/app/login/page.tsx'],
  ['invite/accept',        '../src/app/invite/accept/[token]/page.tsx'],
];

for (const [name, rel] of SURFACES) {
  test(`${name}: 'קוד אימות נשלח' announcement is inside a live region`, () => {
    const src = readFileSync(resolve(HERE, rel), 'utf8');
    // Match the <p ...>...code-sent copy...</p> and require the tag
    // itself to carry role=status + aria-live=polite.
    const paragraphs = [...src.matchAll(/<p[^>]*>[\s\S]*?<\/p>/g)];
    const relevant = paragraphs.filter((m) => /קוד\s*(אימות\s*)?נשלח/.test(m[0]));
    assert.ok(relevant.length >= 1, `${name}: at least one 'קוד נשלח' <p> expected`);
    for (const [tag] of relevant) {
      assert.match(
        tag,
        /role="status"/,
        `${name}: <p> containing 'קוד נשלח' must carry role="status"`,
      );
      assert.match(
        tag,
        /aria-live="polite"/,
        `${name}: <p> containing 'קוד נשלח' must carry aria-live="polite"`,
      );
    }
  });
}

test('contractor register: verify sub-step SMS-code announcement also lives inside a live region', () => {
  const src = readFileSync(
    resolve(HERE, '../src/app/register/contractor/page.tsx'),
    'utf8',
  );
  // Second flow: post-registration verification picks a channel and
  // sends a code — the "קוד נשלח ל-{target}" line has the same SR
  // requirement as Step 1.
  const paragraphs = [...src.matchAll(/<p[^>]*>[\s\S]*?<\/p>/g)];
  const rel = paragraphs.filter((m) => /קוד\s+נשלח\s+ל-/.test(m[0]));
  assert.ok(rel.length >= 1, 'verify sub-step code-sent <p> expected');
  assert.match(rel[0][0], /role="status"/);
  assert.match(rel[0][0], /aria-live="polite"/);
});
