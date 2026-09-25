#!/usr/bin/env node
/**
 * R31 §2 · one command, one exit code.
 *
 * Six safety scripts existed and nothing ran them together. Three were
 * in CI, three were run by hand when someone remembered — which means
 * in practice they ran when the person who wrote them was looking.
 *
 * `npm run preflight` runs everything: the six checks, the type check,
 * the build, the unit tests and the smoke suites.
 *
 * Three outcomes per step, because the honest answer is sometimes
 * "couldn't run":
 *
 *   PASS  exit 0
 *   FAIL  non-zero exit — counts against the run
 *   SKIP  a prerequisite is genuinely absent (no live URL, no smoke
 *         credentials). Reported loudly and does NOT fail the run,
 *         because a PR should not be blocked by a secret the CI runner
 *         was never given. A SKIP that should have been a PASS is the
 *         reader's job to notice — which is why it prints the reason.
 *
 * Exit code is 1 if any required step FAILED. Skips never fail it.
 *
 * Usage:
 *   npm run preflight
 *   PREFLIGHT_BASE_URL=https://staging.tagidai.com npm run preflight
 *   PREFLIGHT_PROD_URL=https://www.tagidai.com npm run preflight
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'services', 'frontend');

const BASE_URL = process.env.PREFLIGHT_BASE_URL || '';
// Deliberately a SECOND variable, not BASE_URL.
//
// The first run of this file pointed the seed check at staging and got
// a FAIL. That FAIL was a category error, not a finding: staging is
// SUPPOSED to serve the seed rows — they hold the demo, and the R30
// decision was to rename them, never to disable them, because
// disabling kills the measurement surfaces.
//
// "Zero seed rows on a public surface" is a question about PRODUCTION.
// Asking it of staging produces a red mark that is correct behaviour,
// and a check that is red when everything is right is a check people
// route around. So it gets its own URL, and pointing it at staging
// requires typing the word production.
const PROD_URL = process.env.PREFLIGHT_PROD_URL || '';
// The smoke suites need seeded accounts; without them the runner
// cannot even log in. Named explicitly so the SKIP says which.
const SMOKE_ENV = ['MASTER_OTP', 'MYSQL_HOST', 'MYSQL_ROOT_PASSWORD',
                   'CONTRACTOR_APPROVED_PHONE', 'CORPORATION_PHONE'];
const missingSmoke = SMOKE_ENV.filter((k) => !process.env[k]);

const PY = process.platform === 'win32' ? 'python' : 'python3';

/** @type {{name:string, cmd:string, args:string[], cwd?:string, skip?:string, launchGate?:boolean}[]} */
const STEPS = [
  // ── repo-level safety checks ──────────────────────────────────
  { name: 'no secrets in .env.example', cmd: 'node', args: ['scripts/check-env-example-secrets.mjs'] },
  { name: 'migration prefixes unique',  cmd: 'node', args: ['scripts/check-migration-prefixes.mjs'] },
  { name: 'sponsor_sizes catalog parity (admin ↔ user-org ↔ TS)', cmd: PY, args: ['scripts/check-sponsor-sizes-parity.py'] },
  { name: 'phone_normalize parity (admin ↔ user-org)',            cmd: PY, args: ['scripts/check-phone-normalize-parity.py'] },
  { name: 'every bookable placement has a renderer',              cmd: PY, args: ['scripts/check-placement-renderers.py'] },
  {
    name: 'no seed rows on a public surface (production only)',
    cmd: PY,
    args: ['scripts/check-no-seed-rows-in-prod.py', '--base-url', PROD_URL],
    launchGate: true,
    skip: PROD_URL
      ? ''
      : 'PREFLIGHT_PROD_URL not set — this asks a question about PRODUCTION. '
        + 'Staging serves seed rows by design.',
  },

  // ── gateway security regression ───────────────────────────────
  { name: 'gateway strips forged identity headers', cmd: 'node', args: ['services/gateway/test/forged-identity-headers.test.js'] },

  // ── frontend ──────────────────────────────────────────────────
  { name: 'frontend tsc --noEmit', cmd: 'npx', args: ['tsc', '--noEmit'], cwd: FRONTEND },
  { name: 'frontend build',        cmd: 'npx', args: ['next', 'build'],   cwd: FRONTEND },
  { name: 'frontend tests',        cmd: 'npm', args: ['test', '--silent'], cwd: FRONTEND },

  // ── python ────────────────────────────────────────────────────
  // compileall was a CI step before this file existed and it is the
  // ONLY thing standing between a syntax error in deal/payment/worker
  // and a Railway boot loop — those three have no tests at all.
  {
    name: 'python services compile',
    cmd: PY,
    args: ['-m', 'compileall', '-q',
           'services/admin/app', 'services/deal/app', 'services/payment/app',
           'services/user-org/app', 'services/worker/app'],
  },
  { name: 'user-org pytest', cmd: PY, args: ['-m', 'pytest', 'services/user-org', '-q'] },

  // ── smoke suites ──────────────────────────────────────────────
  {
    name: 'smoke --suite all',
    cmd: PY,
    args: ['scripts/smoke_test.py', '--base-url', BASE_URL, '--suite', 'all'],
    skip: !BASE_URL
      ? 'PREFLIGHT_BASE_URL not set'
      : missingSmoke.length
        ? `missing env: ${missingSmoke.join(', ')}`
        : '',
  },
  {
    name: 'smoke --suite matrix',
    cmd: PY,
    args: ['scripts/smoke_test.py', '--base-url', BASE_URL, '--suite', 'matrix'],
    skip: !BASE_URL
      ? 'PREFLIGHT_BASE_URL not set'
      : missingSmoke.length
        ? `missing env: ${missingSmoke.join(', ')}`
        : '',
  },
];

const results = [];
let failed = 0;

for (const step of STEPS) {
  if (step.skip) {
    results.push({ name: step.name, state: 'SKIP', note: step.skip, launchGate: step.launchGate });
    console.log(`\n── SKIP  ${step.name}\n        ${step.skip}`);
    continue;
  }
  if (step.cwd && !existsSync(step.cwd)) {
    results.push({ name: step.name, state: 'SKIP', note: `missing dir ${step.cwd}` });
    continue;
  }
  console.log(`\n── RUN   ${step.name}`);
  const t0 = Date.now();
  const r = spawnSync(step.cmd, step.args, {
    cwd: step.cwd || ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.status === 0;
  if (!ok) failed += 1;
  results.push({ name: step.name, state: ok ? 'PASS' : 'FAIL', note: `${secs}s` });
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${step.name}  (${secs}s)`);
}

console.log('\n' + '='.repeat(72));
console.log('PREFLIGHT SUMMARY');
console.log('='.repeat(72));
for (const r of results) {
  const mark = r.state === 'PASS' ? ' ok ' : r.state === 'FAIL' ? 'FAIL' : 'skip';
  console.log(`  [${mark}] ${r.name}${r.state === 'SKIP' ? `  — ${r.note}` : ''}`);
}
const skipped = results.filter((r) => r.state === 'SKIP').length;
console.log('-'.repeat(72));
console.log(`  ${results.length - failed - skipped} passed · ${failed} failed · ${skipped} skipped`);
if (skipped) {
  console.log('  NOTE: a skip is not a pass. Re-run with the missing env to close it.');
}
// A skipped launch gate is the one skip that must not scroll past.
// This is the item that reads "zero active is_seed in production,
// verified by an automatic check and not by eye" on the launch list.
const gatesSkipped = results.filter((r) => r.state === 'SKIP' && r.launchGate);
for (const g of gatesSkipped) {
  console.log(`  🔴 LAUNCH GATE NOT RUN: ${g.name}`);
  console.log('     This one is on the launch list. It must go green against');
  console.log('     production before 14.10, not against CI.');
}
console.log('='.repeat(72));

process.exit(failed > 0 ? 1 : 0);
