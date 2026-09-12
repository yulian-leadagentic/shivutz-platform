#!/usr/bin/env node
// L8 §3.3 · fails CI when two files under db/migrations/ share a
// numeric prefix. Near-miss last week: 052-054 from a worktree and
// 055-057 from staging landed as siblings, and only luck prevented
// the migrations runner from applying the wrong 052.
//
// A migration prefix is the leading digits of the filename before
// the first underscore. Non-numeric filenames are skipped.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'db/migrations';

function prefixOf(name) {
  const m = name.match(/^(\d+)/);
  return m ? m[1] : null;
}

const seen = new Map();
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql'));

for (const f of files) {
  const p = prefixOf(f);
  if (!p) continue;
  if (!seen.has(p)) seen.set(p, []);
  seen.get(p).push(f);
}

const dupes = [...seen.entries()].filter(([, names]) => names.length > 1);

if (dupes.length === 0) {
  console.log(`ok · ${files.length} migrations, no duplicate prefixes`);
  process.exit(0);
}

console.error('DUPLICATE migration prefixes detected:');
for (const [prefix, names] of dupes) {
  console.error(`  ${prefix} → ${names.join(', ')}`);
}
console.error('');
console.error('Renumber one side. The runner applies by filename order and');
console.error('will silently pick the wrong one when two share a prefix.');
process.exit(1);
