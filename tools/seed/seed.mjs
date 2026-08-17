#!/usr/bin/env node
// Staging seed runner.
//
// Idempotent — safe to re-run. Skips items whose natural key already
// exists (business_number for contractors/corps, exact title_he per
// corp for ads). All entities go through the service layer, never
// raw SQL. Reset only touches rows in the seed phone range +
// business_number range (see reset.mjs).
//
// Usage:
//   cd tools/seed
//   npm run seed:staging
//     env override for a different staging URL:
//       GATEWAY_URL=https://gateway-staging-3a12.up.railway.app npm run seed:staging
//     env override for master OTP if staging has a different bypass code:
//       MASTER_OTP=999999 npm run seed:staging

import {
  requireStagingGateway, post, get, verifyRegisterOtp, loginAs, sleep,
} from './lib.mjs';
import {
  CONTRACTORS, CORPORATIONS, WORKER_ADS, HOUSING_ADS,
  seedPhone, israeliIdWithChecksum,
} from './catalog.mjs';

// Base for contractor/corp business_number generation. Kept high
// enough (5-something) that real Israeli company IDs won't collide.
const BN_BASE_CONTRACTOR = 590000000;
const BN_BASE_CORP       = 591000000;
// Phones: contractors get 0525-900-000..014, corps get 0525-900-100..109
// (seedPhone(n) yields +9725259-00-XXX; we offset corps by +100).
const PH_OFFSET_CORP = 100;

const stats = { contractors: { created: 0, existed: 0, failed: 0 },
                corps:       { created: 0, existed: 0, failed: 0 },
                worker_ads:  { created: 0, existed: 0, failed: 0 },
                housing_ads: { created: 0, existed: 0, failed: 0 },
                boosts:      { done: 0, failed: 0 } };

// Structured failure log. Every non-2xx from ad-create or subscription
// upgrade lands here so the closing summary can attribute failures
// (tier_active_ad_limit, invalid enum, etc). Silent seed rejection was
// the root cause of the 40%-missing-coverage bug (docs/cc-prompts/
// cc_prompt_seed_coverage.md) — losing this log is the actual regression
// to guard against, not the tier cap.
const rejections = []; // { kind, corp, code, status, title, raw }

function recordRejection(kind, corpBn, title, status, body, raw) {
  // Payment/user-org shape:  {"detail": {"code": "...", ...}}  OR
  //                          {"detail": "invalid_tier"}         OR
  //                          {"detail": "..."}                  (FastAPI default)
  // Anything else falls back to the raw text.
  const detail = body?.detail;
  const code = (typeof detail === 'object' && detail?.code)
    || (typeof detail === 'string' && detail)
    || body?.error
    || `http_${status}`;
  rejections.push({ kind, corp: corpBn, title, status, code,
                    raw: raw?.slice(0, 200) ?? '' });
}

// Optimistic-create pattern shared by contractor + corp seeds. Try
// POST without touching the OTP flow first: if the entity already
// exists we get a 409 immediately, saving one send-otp and one
// verify-otp call — which matters because auth caps IP OTP calls at
// 10 per 10-minute window, and burning them on entities that already
// exist starves the fresh-create path.
//
// Returns:  { status: 'created'|'existed', body? }
// On 400 phone_not_verified → does the OTP verify dance THEN retries.
// Any other status → { status: 'failed', code, raw }.
async function createOrVerifyThenCreate(base, path, phone, body) {
  let res = await post(base, path, body);
  if (res.ok)           return { status: 'created', body: res.body };
  if (res.status === 409) return { status: 'existed' };
  const isPhoneUnverified =
    res.status === 400 && /phone_not_verified/i.test(res.raw);
  if (!isPhoneUnverified) {
    return { status: 'failed', code: res.status, raw: res.raw };
  }
  // Phone not verified → do the OTP dance, then retry the create.
  await verifyRegisterOtp(base, phone);
  res = await post(base, path, body);
  if (res.ok)           return { status: 'created', body: res.body };
  if (res.status === 409) return { status: 'existed' };
  return { status: 'failed', code: res.status, raw: res.raw };
}

async function seedContractor(base, c) {
  const phone = seedPhone(c.i);
  const bn    = israeliIdWithChecksum(BN_BASE_CONTRACTOR + c.i);
  try {
    const r = await createOrVerifyThenCreate(base, '/api/organizations/contractors', phone, {
      company_name_he:    c.name_he,
      business_number:    bn,
      operating_regions:  c.regions,
      contact_name:       c.contact,
      contact_phone:      phone,
      kablan_number:      c.kablan,
    });
    if (r.status === 'created') { stats.contractors.created++; console.log(`  + contractor [${c.i}] ${c.name_he} (${bn})`); return { id: r.body?.id, phone, bn }; }
    if (r.status === 'existed') { stats.contractors.existed++; console.log(`  = contractor [${c.i}] ${c.name_he} already exists (skipped)`); return { id: null, phone, bn }; }
    stats.contractors.failed++;
    console.log(`  ! contractor [${c.i}] ${c.name_he} failed ${r.code}: ${r.raw?.slice(0, 200) ?? ''}`);
    return null;
  } catch (err) {
    stats.contractors.failed++;
    console.log(`  ! contractor [${c.i}] ${c.name_he} threw: ${String(err).slice(0, 200)}`);
    return null;
  }
}

async function seedCorp(base, c) {
  const phone = seedPhone(PH_OFFSET_CORP + c.i);
  const bn    = israeliIdWithChecksum(BN_BASE_CORP + c.i);
  try {
    const r = await createOrVerifyThenCreate(base, '/api/organizations/corporations', phone, {
      company_name_he:         c.name_he,
      business_number:         bn,
      countries_of_origin:     c.origins,
      minimum_contract_months: c.min_months,
      contact_name:            c.contact,
      contact_phone:           phone,
    });
    if (r.status === 'created') { stats.corps.created++; console.log(`  + corporation [${c.i}] ${c.name_he} (${bn})`); return { id: r.body?.id, phone, bn }; }
    if (r.status === 'existed') { stats.corps.existed++; console.log(`  = corporation [${c.i}] ${c.name_he} already exists (skipped)`); return { id: null, phone, bn }; }
    stats.corps.failed++;
    console.log(`  ! corporation [${c.i}] ${c.name_he} failed ${r.code}: ${r.raw?.slice(0, 200) ?? ''}`);
    return null;
  } catch (err) {
    stats.corps.failed++;
    console.log(`  ! corporation [${c.i}] ${c.name_he} threw: ${String(err).slice(0, 200)}`);
    return null;
  }
}

// Cache: which corps have already been upgraded to the seeding tier
// within this run. seedAds() is called twice per corp (worker + housing)
// so without a cache we'd re-issue the upgrade on the second pass.
const _upgradedCorps = new Set();

// Per-corp JWT cache — the seed makes TWO passes per corp (worker ads
// then housing ads) and each pass previously did its own login. That
// burns two OTP send-otp+login-otp round-trips per corp for no reason
// AND is the direct cause of the auth-rate-limit rejections seen when
// seeding 10 corps back-to-back (per-IP OTP quota = 10 per 10 min).
// Keyed by phone (unique per corp; corpRow.id is null for corps that
// pre-existed in the DB — using id as the cache key collapses all
// existing-corp entries into the same slot and every corp ends up
// sharing one token, which explodes gateway rate limits by funnelling
// every ad through one user's bucket).
const _corpTokens = new Map();

async function tokenForCorp(base, corpRow) {
  const cached = _corpTokens.get(corpRow.phone);
  if (cached) { corpRow.id ??= cached.entityId; return cached.token; }
  const token = await loginAs(base, corpRow.phone, corpRow.id, 'corporation')
    .catch((e) => {
      recordRejection('auth_login', corpRow.bn, 'login', 0, null, String(e));
      console.log(`  ! auth for corp [${corpRow.bn}] failed: ${String(e).slice(0, 200)}`);
      return null;
    });
  if (!token) return null;

  // Resolve the corp's actual entity_id — for corps that already
  // existed in the DB (seedCorp returned id:null), we don't know it
  // yet. Falling back to a fetch after login gives every subsequent
  // path (tier upgrade, ad POST) a real corp scope.
  let entityId = corpRow.id;
  if (!entityId) {
    const m = await get(base, '/api/auth/memberships',
      { Authorization: `Bearer ${token}` });
    const list = Array.isArray(m.body?.memberships) ? m.body.memberships : [];
    const corp = list.find((x) => x.entity_type === 'corporation');
    entityId = corp?.entity_id ?? null;
    if (entityId) corpRow.id = entityId;
  }

  _corpTokens.set(corpRow.phone, { token, entityId });
  return token;
}

// Upgrade a corp's subscription to the tier we need for seeding.
// Rationale: lazy-init in payment-service creates 'basic' (active_ads=3)
// so slots 3+ of every corp are rejected with 402 tier_active_ad_limit.
// Seed catalogue depends on 5 ads/corp to cover all 10 professions; the
// fix is to opt these corps into a tier that permits unlimited ads.
//
// Tier choice: `pro` on pivot-staging has active_ads=NULL (unlimited).
// `advanced` was originally intended but on pivot-staging the admin
// dropped its ceiling to 6 — with 5 seed ads per corp plus any
// pre-existing ad from prior runs, 6 doesn't leave headroom. Using
// `pro` decouples the seed from whatever the admin sets `advanced` to.
// Fake-mode /payments/subscriptions/start (CARDCOM_SUBS_FAKE_MODE=1
// is default on staging) so no real card flow runs.
async function upgradeCorpTier(base, corpRow, token, tier = 'pro') {
  if (_upgradedCorps.has(corpRow.id)) return true;
  const res = await postWithBackoff(base, '/api/payments/subscriptions/start', { tier },
    { Authorization: `Bearer ${token}` });
  if (res.ok) {
    _upgradedCorps.add(corpRow.id);
    console.log(`  ↑ corp [${corpRow.bn}] upgraded to ${tier} (${res.body?.mode ?? 'live'})`);
    return true;
  }
  recordRejection('sub_upgrade', corpRow.bn, `tier=${tier}`, res.status, res.body, res.raw);
  console.log(`  ! sub upgrade for corp [${corpRow.bn}] failed ${res.status}: ${res.raw.slice(0, 120)}`);
  return false;
}

async function seedAds(base, corpRow, ads, kind /* 'worker' | 'housing' */) {
  if (!corpRow) return;
  const bucket = kind === 'housing' ? stats.housing_ads : stats.worker_ads;

  // Cached per-corp token (login once, reuse across worker + housing).
  const token = await tokenForCorp(base, corpRow);
  if (!token) {
    // Auth failure — count every ad as a failure AND record it. Previously
    // this branch just += bucket.failed and the rejections table under-
    // reported the real loss.
    for (const ad of ads) {
      recordRejection(`${kind}_ad`, corpRow.bn, ad.title_he, 0,
        null, 'skipped: no token');
    }
    bucket.failed += ads.length;
    return;
  }

  // Ensure the corp is on a tier that permits the full ad set BEFORE
  // we start POSTing — otherwise slots 3+ silently 402.
  await upgradeCorpTier(base, corpRow, token);

  // Fetch existing ads for this corp so we can idempotent-skip by
  // exact title_he match. The corp-scoped endpoint is /api/ads/mine
  // (proxied to user-org's GET /ads/mine) and returns a plain array,
  // not {results: [...]}. Previous URL was /api/ads?mine=1
  // which doesn't exist and returned an object without .map().
  const mine = await get(base, '/api/ads/mine',
    { Authorization: `Bearer ${token}` });
  const arr = Array.isArray(mine.body) ? mine.body : [];
  const existingTitles = new Set(arr.map((a) => a.title_he));

  for (const ad of ads) {
    if (existingTitles.has(ad.title_he)) {
      bucket.existed++;
      continue;
    }
    const res = await postWithBackoff(base, '/api/ads', {
      ad_type:               ad.ad_type,
      title_he:              ad.title_he,
      body_he:               ad.body_he,
      profession_code:       ad.profession_code,
      origin_country:        ad.origin_country,
      region:                ad.region,
      quantity:              ad.quantity,
      experience_min_months: ad.experience_min_months,
      city:                  ad.city,
      total_beds:            ad.total_beds,
      available_beds:        ad.available_beds,
      price_per_bed_nis:     ad.price_per_bed_nis,
    }, { Authorization: `Bearer ${token}` });
    if (res.ok) {
      bucket.created++;
      const adId = res.body?.id;
      if (ad.boosted && adId) {
        const b = await postWithBackoff(base, `/api/ads/${adId}/boost`, {},
          { Authorization: `Bearer ${token}` });
        if (b.ok) stats.boosts.done++; else stats.boosts.failed++;
      }
    } else {
      bucket.failed++;
      recordRejection(`${kind}_ad`, corpRow.bn, ad.title_he, res.status, res.body, res.raw);
      console.log(`    ! ad "${ad.title_he.slice(0, 40)}" failed ${res.status}: ${res.raw.slice(0, 120)}`);
    }
    // Space POSTs enough that a low RATE_LIMIT_USER (as low as ~15/min
    // has been seen on pivot-staging Railway env) doesn't trip. 500ms
    // ≈ 120/min, still fast overall but polite.
    await sleep(500);
  }
}

// POST with a single retry on 429. Gateway 429 returns retry_after
// (seconds) in the body; we honour it up to a ceiling so a runaway
// misconfig doesn't hang the seed for minutes. Only retry ONCE — if
// the second attempt also 429s, the caller records the rejection
// and moves on; a single seed cycle should not gate on the rate
// limiter re-cooling forever.
async function postWithBackoff(base, path, body, headers = {}) {
  const first = await post(base, path, body, headers);
  if (first.status !== 429) return first;
  const wait = Math.min(90, Math.max(5, first.body?.retry_after ?? 60));
  console.log(`    … 429 on ${path}; sleeping ${wait}s and retrying once`);
  await sleep(wait * 1000);
  return post(base, path, body, headers);
}

async function main() {
  const base = requireStagingGateway();
  console.log(`Seeding against ${base}\n`);

  console.log('── Contractors ─────────────────────────────');
  const contractorRows = [];
  for (const c of CONTRACTORS) {
    contractorRows.push(await seedContractor(base, c));
    await sleep(50);
  }

  console.log('\n── Corporations ────────────────────────────');
  const corpRows = [];
  for (const c of CORPORATIONS) {
    corpRows.push(await seedCorp(base, c));
    await sleep(50);
  }

  console.log('\n── Worker ads ──────────────────────────────');
  for (let i = 0; i < corpRows.length; i++) {
    const ads = WORKER_ADS.filter((a) => a.corpI === i);
    if (ads.length) await seedAds(base, corpRows[i], ads, 'worker');
  }

  console.log('\n── Housing ads ─────────────────────────────');
  for (let i = 0; i < corpRows.length; i++) {
    const ads = HOUSING_ADS.filter((a) => a.corpI === i);
    if (ads.length) await seedAds(base, corpRows[i], ads, 'housing');
  }

  console.log('\n── Summary ─────────────────────────────────');
  console.log(JSON.stringify(stats, null, 2));

  // Group rejections by (kind, code) so a wall of "tier_active_ad_limit"
  // shows up as one line with a count, not 16 stack traces.
  if (rejections.length) {
    console.log('\n── Rejections ──────────────────────────────');
    const byCode = new Map();
    for (const r of rejections) {
      const key = `${r.kind} · ${r.status} ${r.code}`;
      const bucket = byCode.get(key) ?? { count: 0, corps: new Set() };
      bucket.count++;
      bucket.corps.add(r.corp);
      byCode.set(key, bucket);
    }
    for (const [key, { count, corps }] of byCode) {
      const corpList = [...corps].join(', ');
      console.log(`  × ${key}  × ${count}  (corps: ${corpList})`);
    }
  }

  console.log(
    `\nSubscription state manipulation (trial-ending / paused / expired ` +
    `variants) requires an admin JWT + POST /api/admin/subscriptions/... ` +
    `— NOT included in v1 of this runner. All seeded entities start in ` +
    `the default trial state. Follow-up: add \`--admin-phone <admin>\` ` +
    `flag + call extend-trial/grant/revoke per fixture's target state.`
  );

  // Exit non-zero when the run had ANY rejection. A seed that silently
  // dropped 40% of the catalog and reported success is exactly what
  // hid the general+CN coverage gap for weeks — the CI/manual runner
  // is expected to notice a non-zero exit and read the Rejections
  // block. Do NOT downgrade this to a warning.
  if (rejections.length > 0) {
    console.error(`\n*** SEED FINISHED WITH ${rejections.length} REJECTION(S) ***`);
    console.error(`See the Rejections table above. Every rejection means`);
    console.error(`a fixture the catalog INTENDED to create was silently dropped.`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('\n*** SEED ABORTED ***');
  console.error(err);
  process.exit(1);
});
