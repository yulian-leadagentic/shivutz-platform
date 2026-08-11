import { test, Page, BrowserContext, APIRequestContext } from '@playwright/test';
import { readFileSync, statSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── config ──────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const OUT_ROOT = join(REPO_ROOT, 'screens-export');
const STATE_DIR = HERE;

// Single source of truth for the base URL. Was previously read as
// `process.env.BASE_URL` scattered through the file, and one branch
// referenced a bare `BASE_URL` identifier that would have thrown at
// runtime if the sanity gate ever tripped (dead code but nasty).
const BASE_URL = process.env.BASE_URL ?? 'https://frontend-pivot-staging.up.railway.app';

const LOGIN_PHONE = process.env.LOGIN_PHONE ?? '0525278625';
const MASTER_OTP  = process.env.MASTER_OTP  ?? '999999';

// Deploy-freshness poll config — waits up to this many minutes for a
// mid-deploy staging to catch up before giving up.
const DEPLOY_WAIT_MINUTES  = Number(process.env.DEPLOY_WAIT_MINUTES ?? '5');
const DEPLOY_POLL_INTERVAL_SECONDS = 20;

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

const DYNAMIC_PLACEHOLDER = 'not-a-real-id';

function resolvePath(p: string): string {
  return p
    .replace(/\[id\]/g,    DYNAMIC_PLACEHOLDER)
    .replace(/\[token\]/g, DYNAMIC_PLACEHOLDER);
}

// ─── login-page detection ───────────────────────────────────────
// Strings ONLY present on /login. Kept together so a copy tweak in
// login/page.tsx is easy to trace: update these markers.
// prettier-ignore
const LOGIN_MARKERS = [
  'כניסה למערכת',       // page title
  'מספר טלפון נייד',    // phone-field label
  'שלח קוד',            // send-OTP button
];

// prettier-ignore
const AUTHED_MARKERS = [
  'תפריט משתמש',   // TopBar user-menu aria-label
  'התנתקות',        // logout button
  'פאנל ניהול',    // admin panel link (admin surfaces only)
];

async function pageContainsAny(page: Page, markers: string[]): Promise<string | null> {
  // Return the first marker present, or null. locator().count() is
  // cheap and doesn't care about visibility state — that's what we
  // want here since login pages sometimes hydrate the phone input
  // slightly delayed.
  for (const m of markers) {
    const count = await page.locator(`text=${m}`).count().catch(() => 0);
    if (count > 0) return m;
  }
  return null;
}

// ─── deploy-freshness gate ──────────────────────────────────────
// Refuses to run the export until the live BASE_URL renders the
// currently-shipped landing-IA + logo build. The bug this catches:
// Railway sometimes deploys the API before the frontend, or one of
// the two is mid-rebuild — running the export in that window
// captures the previous UI as if it were current, and the QA screens
// are silently wrong.
//
// Markers below are unique to the post-landing-IA + logo-wiring
// build. If ANY are missing → staging is stale. Poll every 20s up to
// DEPLOY_WAIT_MINUTES; if still stale, exit non-zero (Playwright's
// `test.fail` propagates as a process-level failure).
async function assertDeployFresh(request: APIRequestContext): Promise<void> {
  const deadline = Date.now() + DEPLOY_WAIT_MINUTES * 60_000;
  let lastMissing: string[] = [];

  while (Date.now() < deadline) {
    const resp = await request.get('/', { failOnStatusCode: false });
    if (resp.ok()) {
      const html = await resp.text();
      // Markers must be observable in the SSR/shell HTML — Next 16
      // client components don't ship their DOM until hydrate, so
      // things like #search-hero and Hebrew text inside client
      // components will NOT appear in the raw curl body. The three
      // survivors here all live in the <head> metadata (rendered
      // server-side by app/layout.tsx and app/manifest.ts).
      const checks: Array<[string, boolean]> = [
        // logo-wiring: 32px favicon link (added in commit 0b87531,
        // metadata.icons in layout.tsx). Old build had a single
        // /brand/buildup-icon.png reference — this pattern is unique
        // to the current logo-wiring set.
        ['favicon-32.png link',  html.includes('/brand/favicon-32.png')],
        // logo-wiring: 48px favicon — belt-and-suspenders in case the
        // 32 pattern collides with something else later.
        ['favicon-48.png link',  html.includes('/brand/favicon-48.png')],
        // logo-wiring: iOS apple-touch (also added in 0b87531).
        ['apple-touch-icon link', html.includes('/brand/apple-touch-icon.png')],
      ];

      const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
      if (missing.length === 0) {
        console.log(`  ✓ deploy-freshness gate passed — all landing-IA + logo markers present`);
        return;
      }
      lastMissing = missing;
      console.log(
        `  … staging stale / mid-deploy: missing ${missing.join(', ')} — ` +
        `retry in ${DEPLOY_POLL_INTERVAL_SECONDS}s`,
      );
    } else {
      console.log(`  … BASE_URL returned HTTP ${resp.status()} — retry in ${DEPLOY_POLL_INTERVAL_SECONDS}s`);
    }

    // eslint-disable-next-line no-promise-executor-return
    await new Promise((r) => setTimeout(r, DEPLOY_POLL_INTERVAL_SECONDS * 1000));
  }

  throw new Error(
    `deploy-freshness gate failed after ${DEPLOY_WAIT_MINUTES} min. ` +
    `Landing-IA / logo markers still missing on ${BASE_URL}: ${lastMissing.join(', ')}. ` +
    `Refusing to write potentially-stale captures.`,
  );
}

// ─── shared login flow ──────────────────────────────────────────
// Direct API path (bypass UI login). Plants access_token + refresh_token
// cookies on BASE_URL so the app boots authenticated on next page.goto.
// Matches the js-cookie names the frontend reads (see auth.ts:3-4).
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

  const base = new URL(BASE_URL);
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

interface VisitResult {
  status: 'captured' | 'error' | 'skipped-login';
  note?: string;
}

async function visitAndShoot(page: Page, viewport: string, r: Route, opts: { expectAuthed: boolean } = { expectAuthed: false }): Promise<VisitResult> {
  const target = resolvePath(r.path);
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // For authed routes, detect a login redirect on the ACTUAL content
    // (not just URL) and refuse to write the screenshot. The URL check
    // alone missed a bug class where middleware left the URL untouched
    // but rendered login markup — the file was written as a "success"
    // capture even though every pixel was a login screen.
    if (opts.expectAuthed) {
      const loginMarker = await pageContainsAny(page, LOGIN_MARKERS);
      if (loginMarker) {
        return {
          status: 'skipped-login',
          note: `authed route rendered login markup ("${loginMarker}") — auth session dropped`,
        };
      }
    }

    const result = await shot(page, viewport, r.slug);
    return { status: result };
  } catch (err) {
    return { status: 'error', note: (err as Error).message.slice(0, 120) };
  }
}

// ─── HARD sanity gate — content-based, not URL-based ─────────────
async function assertAuthStuck(page: Page): Promise<void> {
  await page.goto('/contractor/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});

  // First: URL should not have bounced to /login.
  const landedOn = new URL(page.url()).pathname;
  if (landedOn.startsWith('/login')) {
    throw new Error(
      `sanity-gate: /contractor/dashboard redirected to ${landedOn}. ` +
      `Auth service unreachable or MASTER_OTP=${MASTER_OTP} rejected on ${BASE_URL}.`,
    );
  }

  // Second: content check. Even if URL is /contractor/dashboard, if
  // the rendered DOM has login markers (RoleGuard soft-fallback that
  // doesn't router.push) the export would still capture login pixels.
  const loginMarker = await pageContainsAny(page, LOGIN_MARKERS);
  if (loginMarker) {
    throw new Error(
      `sanity-gate: /contractor/dashboard URL is authed but content is login page ` +
      `(matched marker "${loginMarker}"). Aborting before writing 50+ misleading captures.`,
    );
  }

  // Third: positive check — at least ONE authed-shell marker present.
  const authedMarker = await pageContainsAny(page, AUTHED_MARKERS);
  if (!authedMarker) {
    // Not fatal by itself — an admin-only account on a contractor
    // dashboard might legitimately show a NoAccessCard with no
    // TopBar marker. But log it so a broken shell surfaces.
    console.log(`  ⚠ sanity-gate: no authed-shell marker found — expected any of ${AUTHED_MARKERS.join(' / ')}`);
  } else {
    console.log(`  ✓ sanity-gate: authed content confirmed (matched "${authedMarker}")`);
  }
}

// ─── one-time login fixture (per project) ────────────────────────
async function ensureLoggedInContext(browser: any, viewport: string): Promise<BrowserContext> {
  const statePath = join(STATE_DIR, `storageState.${viewport}.json`);

  // Always re-auth on each run (see M3 step 0 note in prior version).
  const ctx = await browser.newContext({ locale: 'he-IL' });
  await loginViaOtp(ctx);

  // If /select-entity is required, visit it once so the app resolves
  // the entity claim into the JWT.
  const page = await ctx.newPage();
  await page.goto('/select-entity', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.locator('button, a').filter({ hasText: /המשך|בחר|Continue/ }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});

  // HARD sanity gate — throws if auth didn't take. See helper.
  await assertAuthStuck(page);

  await ctx.storageState({ path: statePath });
  await page.close();
  return ctx;
}

// ─── identical-bytes clustering (post-run) ──────────────────────
// The bug this catches: an entire cluster of authed captures came
// back at exactly 67850 bytes because they were all the same login-
// page screenshot. Any batch of 3+ PNGs sharing an exact byte size
// (or SHA256) means the export captured the same content repeatedly —
// almost always because auth silently dropped mid-run.
function assertNoByteClusters(viewport: string, captured: string[]): void {
  if (captured.length < 3) return;

  const sizeGroups: Record<number, string[]> = {};
  const hashGroups: Record<string, string[]> = {};

  for (const slug of captured) {
    const file = join(OUT_ROOT, viewport, `${slug}.png`);
    if (!existsSync(file)) continue;
    const size = statSync(file).size;
    (sizeGroups[size] ||= []).push(slug);
    // Only hash the ones that share a size — cheaper than hashing
    // every file.
  }

  const suspiciousSizes = Object.entries(sizeGroups).filter(([, slugs]) => slugs.length >= 3);
  for (const [size, slugs] of suspiciousSizes) {
    // Confirm with a real hash — same byte size CAN be a coincidence
    // (e.g. cached empty-state cards).
    for (const slug of slugs) {
      const file = join(OUT_ROOT, viewport, `${slug}.png`);
      const h = createHash('sha256').update(readFileSync(file)).digest('hex');
      (hashGroups[h] ||= []).push(slug);
    }
    const identical = Object.entries(hashGroups).filter(([, s]) => s.length >= 3);
    if (identical.length > 0) {
      const list = identical
        .map(([h, s]) => `  · ${s.length}× identical (sha=${h.slice(0, 8)}): ${s.slice(0, 6).join(', ')}${s.length > 6 ? '…' : ''}`)
        .join('\n');
      throw new Error(
        `identical-bytes cluster detected in ${viewport} captures ` +
        `(size=${size}) — this is the "auth dropped, everything is a login page" ` +
        `pattern. Refusing to sign off the export.\n${list}`,
      );
    }
  }
}

// ─── the actual capture matrix ───────────────────────────────────
test.describe.configure({ mode: 'serial' });

test('public routes', async ({ browser, request }, testInfo) => {
  const viewport = testInfo.project.name;
  // Deploy-freshness runs before ANY captures land on disk.
  await assertDeployFresh(request);

  const ctx = await browser.newContext({ locale: 'he-IL' });
  const page = await ctx.newPage();
  const publics = routes.filter((r) => !r.auth);
  const results: Array<{ path: string; status: string; note?: string }> = [];
  for (const r of publics) {
    const res = await visitAndShoot(page, viewport, r, { expectAuthed: false });
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
  const capturedSlugs: string[] = [];
  for (const r of authed) {
    const res = await visitAndShoot(page, viewport, r, { expectAuthed: true });
    results.push({ path: r.path, ...res });
    if (res.status === 'captured') capturedSlugs.push(r.slug);
    console.log(`  [authed/${viewport}] ${r.path.padEnd(40)} ${res.status}${res.note ? ' — ' + res.note : ''}`);
  }
  await ctx.close();
  await testInfo.attach(`results-authed-${viewport}.json`, {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: 'application/json',
  });

  // Refuse to sign off if a captured cluster is byte-identical.
  assertNoByteClusters(viewport, capturedSlugs);

  // Fail the run if ANY authed route came back as a login page —
  // that's the "silent bad export" pattern. skipped-login means the
  // per-route detector caught it (we didn't write a fake capture),
  // but the auth SHOULD have stuck for every authed route.
  const skippedLogin = results.filter((r) => r.status === 'skipped-login');
  if (skippedLogin.length > 0) {
    const list = skippedLogin.map((r) => `  · ${r.path} — ${r.note}`).join('\n');
    throw new Error(
      `${skippedLogin.length} authed route(s) rendered login markup — ` +
      `auth session dropped mid-run:\n${list}`,
    );
  }
});
