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

async function seedContractor(base, c) {
  const phone = seedPhone(c.i);
  const bn    = israeliIdWithChecksum(BN_BASE_CONTRACTOR + c.i);
  try {
    // OTP-verify the phone. Skip on rate-limit — assume prior verify
    // is still in the 15-min window.
    await verifyRegisterOtp(base, phone).catch((e) => {
      if (!/rate_limited|429/i.test(String(e))) throw e;
    });
    const res = await post(base, '/api/organizations/contractors', {
      company_name_he:    c.name_he,
      business_number:    bn,
      operating_regions:  c.regions,
      contact_name:       c.contact,
      contact_phone:      phone,
      kablan_number:      c.kablan,
    });
    if (res.ok) { stats.contractors.created++; console.log(`  + contractor [${c.i}] ${c.name_he} (${bn})`); return { id: res.body?.id, phone, bn }; }
    if (res.status === 409) {
      // phone_already_contractor OR contractor_already_registered —
      // the fixture is already seeded. Look up the existing entity.
      stats.contractors.existed++;
      console.log(`  = contractor [${c.i}] ${c.name_he} already exists (skipped)`);
      return { id: null, phone, bn };
    }
    stats.contractors.failed++;
    console.log(`  ! contractor [${c.i}] ${c.name_he} failed ${res.status}: ${res.raw.slice(0, 200)}`);
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
    await verifyRegisterOtp(base, phone).catch((e) => {
      if (!/rate_limited|429/i.test(String(e))) throw e;
    });
    const res = await post(base, '/api/organizations/corporations', {
      company_name_he:         c.name_he,
      business_number:         bn,
      countries_of_origin:     c.origins,
      minimum_contract_months: c.min_months,
      contact_name:            c.contact,
      contact_phone:           phone,
    });
    if (res.ok) { stats.corps.created++; console.log(`  + corporation [${c.i}] ${c.name_he} (${bn})`); return { id: res.body?.id, phone, bn }; }
    if (res.status === 409) {
      stats.corps.existed++;
      console.log(`  = corporation [${c.i}] ${c.name_he} already exists (skipped)`);
      return { id: null, phone, bn };
    }
    stats.corps.failed++;
    console.log(`  ! corporation [${c.i}] ${c.name_he} failed ${res.status}: ${res.raw.slice(0, 200)}`);
    return null;
  } catch (err) {
    stats.corps.failed++;
    console.log(`  ! corporation [${c.i}] ${c.name_he} threw: ${String(err).slice(0, 200)}`);
    return null;
  }
}

async function seedAds(base, corpRow, ads, kind /* 'worker' | 'housing' */) {
  if (!corpRow) return;
  const bucket = kind === 'housing' ? stats.housing_ads : stats.worker_ads;
  const phone = corpRow.phone;

  // We need a JWT scoped to this corp to POST /organizations/ads.
  // Login as the corp's contact_phone. If the user has multiple
  // memberships, `loginAs` handles the select-entity round-trip.
  const token = await loginAs(base, phone, corpRow.id, 'corporation').catch((e) => {
    console.log(`  ! auth for corp [${corpRow.bn}] failed: ${String(e).slice(0, 200)}`);
    return null;
  });
  if (!token) { bucket.failed += ads.length; return; }

  // Fetch existing ads for this corp so we can idempotent-skip by
  // exact title_he match.
  const mine = await get(base, '/api/organizations/ads?mine=1',
    { Authorization: `Bearer ${token}` });
  const existingTitles = new Set(
    ((mine.body?.results ?? mine.body) || []).map((a) => a.title_he)
  );

  for (const ad of ads) {
    if (existingTitles.has(ad.title_he)) {
      bucket.existed++;
      continue;
    }
    const res = await post(base, '/api/organizations/ads', {
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
        const b = await post(base, `/api/organizations/ads/${adId}/boost`, {},
          { Authorization: `Bearer ${token}` });
        if (b.ok) stats.boosts.done++; else stats.boosts.failed++;
      }
    } else {
      bucket.failed++;
      console.log(`    ! ad "${ad.title_he.slice(0, 40)}" failed ${res.status}: ${res.raw.slice(0, 120)}`);
    }
    await sleep(20);
  }
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
  console.log(
    `\nSubscription state manipulation (trial-ending / paused / expired ` +
    `variants) requires an admin JWT + POST /api/admin/subscriptions/... ` +
    `— NOT included in v1 of this runner. All seeded entities start in ` +
    `the default trial state. Follow-up: add \`--admin-phone <admin>\` ` +
    `flag + call extend-trial/grant/revoke per fixture's target state.`
  );
}

main().catch((err) => {
  console.error('\n*** SEED ABORTED ***');
  console.error(err);
  process.exit(1);
});
