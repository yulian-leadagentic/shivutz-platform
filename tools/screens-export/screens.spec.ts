import { test, expect, Page, BrowserContext } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── config ──────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const OUT_ROOT = join(REPO_ROOT, 'screens-export');
const STATE_DIR = HERE;

const LOGIN_PHONE = process.env.LOGIN_PHONE ?? '0525278625';
const MASTER_OTP  = process.env.MASTER_OTP  ?? '999999';

interface Route {
  path: string;
  category: 'Public' | 'Contractor' | 'Corporation' | 'Admin';
  dynamic: boolean;
  auth: boolean;
  register: boolean;
  source: string;
  slug: string;
}

const routes: Route[] = JSON.parse(
  readFileSync(join(HERE, 'routes.json'), 'utf8'),
);

// Fake IDs for [id] / [token] segments — pages will render an error/
// empty state, which is itself a valuable screenshot.
const DYNAMIC_PLACEHOLDER = 'not-a-real-id';

function resolvePath(p: string): string {
  return p
    .replace(/\[id\]/g,    DYNAMIC_PLACEHOLDER)
    .replace(/\[token\]/g, DYNAMIC_PLACEHOLDER);
}

// ─── shared login flow ──────────────────────────────────────────
// Uses the phone + master-OTP path. When the phone owns multiple
// memberships, /select-entity appears — we don't pick one here (each
// role project handles its own picking). This helper stops at the
// first authenticated URL and saves the state.

// Bypass the UI login. We hit /api/auth/send-otp and /api/auth/login/otp
// via Playwright's request context (server-side fetch, no browser
// involvement) — that path is verified working end-to-end. Then we
// plant the returned access_token + refresh_token as cookies so the
// app boots authenticated on the next page.goto.
//
// This is deliberately different from a real user flow. We do not need
// the UI login validated in this tool — we need each screen shot.
async function loginViaOtp(context: BrowserContext): Promise<void> {
  const api = context.request;

  const sendResp = await api.post('/api/auth/send-otp', {
    data: { phone: LOGIN_PHONE, purpose: 'login' },
    headers: { 'content-type': 'application/json' },
    failOnStatusCode: false,
  });
  if (!sendResp.ok()) {
    throw new Error(`send-otp failed: HTTP ${sendResp.status()} — ${await sendResp.text()}`);
  }
  const sendBody = await sendResp.json();
  const normPhone: string = sendBody.phone ?? LOGIN_PHONE;

  const loginResp = await api.post('/api/auth/login/otp', {
    data: { phone: normPhone, code: MASTER_OTP },
    headers: { 'content-type': 'application/json' },
    failOnStatusCode: false,
  });
  if (!loginResp.ok()) {
    throw new Error(`login/otp failed: HTTP ${loginResp.status()} — ${await loginResp.text()}`);
  }
  const tok = await loginResp.json();

  // The frontend uses js-cookie which sets `access_token` and
  // `refresh_token` cookies on the current origin. Mirror that so the
  // app finds the JWT on next mount.
  const base = new URL(process.env.BASE_URL ?? 'https://frontend-pivot-staging.up.railway.app');
  const cookieBase = { domain: base.hostname, path: '/', sameSite: 'Lax' as const };
  const cookies = [];
  if (tok.access_token)  cookies.push({ ...cookieBase, name: 'access_token',  value: tok.access_token });
  if (tok.refresh_token) cookies.push({ ...cookieBase, name: 'refresh_token', value: tok.refresh_token });
  if (cookies.length === 0) {
    throw new Error(`login/otp returned no tokens: ${JSON.stringify(tok).slice(0, 200)}`);
  }
  await context.addCookies(cookies);
}

// ─── shot helper ────────────────────────────────────────────────
async function shot(page: Page, viewport: string, slug: string): Promise<'captured' | 'error'> {
  const dir = join(OUT_ROOT, viewport);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    return 'captured';
  } catch (err) {
    console.error(`  ✗ screenshot failed for ${slug}: ${(err as Error).message}`);
    return 'error';
  }
}

async function visitAndShoot(
  page: Page, viewport: string, r: Route,
): Promise<{ status: string; note?: string }> {
  const target = resolvePath(r.path);
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Extra idle wait — RSC streams, enum fetches, hero carousels.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // Register wizards: the initial mount shows step 1; that's what we
    // want. We deliberately do NOT click through to later steps
    // client-side because doing so would send a real OTP + could POST
    // an org. Step 1 (phone + name) is the meaningful screenshot.
    const result = await shot(page, viewport, r.slug);
    return { status: result };
  } catch (err) {
    return { status: 'error', note: (err as Error).message.slice(0, 120) };
  }
}

// ─── one-time login fixture (per project) ────────────────────────
// The Playwright config projects (`desktop`, `mobile`) share state
// files on disk. We derive the state file name from the project name
// so re-runs are hermetic per viewport.

async function ensureLoggedInContext(
  browser: any, viewport: string,
): Promise<BrowserContext> {
  const statePath = join(STATE_DIR, `storageState.${viewport}.json`);

  // M3 step 0 — always re-auth on each run.
  //
  // The previous shortcut ("if storageState.json exists, reuse it")
  // silently kept stale JWT cookies alive across weeks. When the
  // token expired or the auth contract shifted (P0-1 / P0-3 shape
  // changes), the app's api-client 401'd every request → RoleGuard
  // punted every authed route to /login → the export captured 55
  // login pages while looking like it worked. Trading a few seconds
  // per run for hermetic correctness is the right call.
  const ctx = await browser.newContext({ locale: 'he-IL' });
  // Inject JWT cookies via the direct-API path (bypasses UI login).
  await loginViaOtp(ctx);
  // If /select-entity is required, visit it once so the app resolves
  // the entity claim into the JWT and stashes it (some builds gate
  // subsequent nav on this). Silently continue if not applicable.
  const page = await ctx.newPage();
  await page.goto('/select-entity', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.locator('button, a').filter({ hasText: /המשך|בחר|Continue/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});

  // M3 step 0 sanity gate — before we shoot 50+ authed routes, prove
  // the auth actually stuck by loading one authed page and asserting
  // it did NOT redirect to /login. If it did, the whole authed batch
  // would silently capture login pages (the bug this run is meant to
  // fix). Throw loudly so a future auth-contract shift doesn't get
  // buried in a passing-looking export.
  await page.goto('/contractor/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  const landedOn = new URL(page.url()).pathname;
  if (landedOn.startsWith('/login')) {
    throw new Error(
      `sanity-gate: auth failed. /contractor/dashboard redirected to ${landedOn}. ` +
      `Check the auth service is up on ${BASE_URL} and MASTER_OTP=${MASTER_OTP} is honored.`,
    );
  }

  await ctx.storageState({ path: statePath });
  await page.close();
  return ctx;
}

// ─── the actual capture matrix ───────────────────────────────────
// Grouped by category so the test log reads as a category-by-category
// pass. Public routes reuse a fresh anonymous context; authed routes
// share the logged-in state.

test.describe.configure({ mode: 'serial' });

test('public routes', async ({ browser }, testInfo) => {
  const viewport = testInfo.project.name;
  const ctx = await browser.newContext({ locale: 'he-IL' });
  const page = await ctx.newPage();
  const publics = routes.filter((r) => !r.auth);
  const results: Array<{ path: string; status: string; note?: string }> = [];
  for (const r of publics) {
    const res = await visitAndShoot(page, viewport, r);
    results.push({ path: r.path, ...res });
    console.log(`  [public/${viewport}] ${r.path.padEnd(40)} ${res.status}${res.note ? ' — ' + res.note : ''}`);
  }
  await ctx.close();
  await testInfo.attach(`results-public-${viewport}.json`, {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: 'application/json',
  });
});

test('authed routes', async ({ browser }, testInfo) => {
  const viewport = testInfo.project.name;
  const ctx = await ensureLoggedInContext(browser, viewport);
  const page = await ctx.newPage();
  const authed = routes.filter((r) => r.auth);
  const results: Array<{ path: string; status: string; note?: string }> = [];
  for (const r of authed) {
    const res = await visitAndShoot(page, viewport, r);
    results.push({ path: r.path, ...res });
    console.log(`  [authed/${viewport}] ${r.path.padEnd(40)} ${res.status}${res.note ? ' — ' + res.note : ''}`);
  }
  await ctx.close();
  await testInfo.attach(`results-authed-${viewport}.json`, {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: 'application/json',
  });
});
