#!/usr/bin/env node
// L8 §3.3 · fails CI when .env.example contains a value that looks
// like a real secret. .env.example is committed to git; a real key
// pasted there is a public leak the moment the commit lands.
//
// Patterns are conservative — flag things that OBVIOUSLY are
// secrets, don't fight false positives. False negatives are
// tolerable here; a paranoid CI that never fires teaches the team
// to ignore it.

import { readFileSync } from 'node:fs';

const PATH = '.env.example';

// Provider-specific + generic. Order matters only for the error
// message the CI prints; every pattern runs.
const SUSPECT = [
  { name: 'OpenAI-shaped',     re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Google-API',        re: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { name: 'Anthropic-shaped',  re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'JWT (3-part b64)',  re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'long hex secret',   re: /=\s*"?[a-fA-F0-9]{40,}"?\s*$/m },
  { name: 'AWS access key',    re: /\bAKIA[0-9A-Z]{16}\b/ },
];

let body;
try {
  body = readFileSync(PATH, 'utf8');
} catch (e) {
  console.error(`cannot read ${PATH}: ${e.message}`);
  process.exit(1);
}

const hits = [];
body.split(/\r?\n/).forEach((line, i) => {
  // Skip commented-out examples — those are documentation.
  if (line.trim().startsWith('#')) return;
  for (const p of SUSPECT) {
    if (p.re.test(line)) hits.push({ line: i + 1, name: p.name, text: line.slice(0, 120) });
  }
});

if (hits.length === 0) {
  console.log(`ok · ${PATH} has no values matching known secret patterns`);
  process.exit(0);
}

console.error(`Suspicious values found in ${PATH}:`);
for (const h of hits) {
  console.error(`  L${h.line}  [${h.name}]  ${h.text}`);
}
console.error('');
console.error('Replace with an obviously-fake placeholder (e.g. "your-key-here")');
console.error('and rotate the leaked secret if it was ever committed.');
process.exit(1);
