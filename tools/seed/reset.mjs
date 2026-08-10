#!/usr/bin/env node
// Reset — delete rows created by seed.mjs.
//
// Scope: the service layer only exposes DELETE for ADS (and their
// sub-objects like documents/memberships) — there is no
// /organizations/contractors/{id} or /organizations/corporations/{id}
// DELETE endpoint on purpose (pre-launch, orgs are admin-managed).
//
// So this script:
//   1. For each seeded corp: log in, list its ads, delete them all.
//   2. Contractor/corp rows themselves are left in place (they're
//      harmless dupes on re-seed — the create call 409s and the
//      runner reports them as "existed" without side effects).
//
// If you need a TOTAL wipe (rare — e.g. after a data-model migration
// where the seeded rows become invalid), run this SQL manually
// against the staging MySQL — it's narrowly scoped to the seed
// phone range and business_number range so real data can't get hit:
//
//   -- Kill seed users first (memberships cascade)
//   USE auth_db;
//   DELETE FROM entity_memberships WHERE user_id IN
//     (SELECT id FROM users WHERE phone LIKE '+9725259%');
//   DELETE FROM users WHERE phone LIKE '+9725259%';
//   -- Kill seed org rows
//   USE org_db;
//   DELETE FROM ads WHERE corporation_id IN
//     (SELECT id FROM corporations WHERE business_number
//        BETWEEN '591000000' AND '591999999');
//   DELETE FROM corporations WHERE business_number
//     BETWEEN '591000000' AND '591999999';
//   DELETE FROM contractors  WHERE business_number
//     BETWEEN '590000000' AND '590999999';
//
// The SQL snippet is documented HERE (not embedded) because it
// touches DB directly and belongs in a tightly-reviewed operator
// hand-run, not an unattended npm script.

import { requireStagingGateway, get, post, loginAs, sleep } from './lib.mjs';
import { CORPORATIONS, seedPhone } from './catalog.mjs';

const PH_OFFSET_CORP = 100;

async function resetCorpAds(base, corpFixture) {
  const phone = seedPhone(PH_OFFSET_CORP + corpFixture.i);
  let token;
  try { token = await loginAs(base, phone); }
  catch (e) {
    // corp doesn't exist (never seeded, or already SQL-wiped) — nothing to do.
    if (/user_not_found|401|404/i.test(String(e))) return { deleted: 0, skipped: true };
    throw e;
  }
  const mine = await get(base, '/api/organizations/ads?mine=1',
    { Authorization: `Bearer ${token}` });
  const ads = (mine.body?.results ?? mine.body) || [];
  let deleted = 0;
  for (const ad of ads) {
    if (!ad?.id) continue;
    const del = await fetch(`${base}/api/organizations/ads/${ad.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (del.status === 204 || del.ok) deleted++;
    await sleep(20);
  }
  return { deleted, skipped: false };
}

async function main() {
  const base = requireStagingGateway();
  console.log(`Resetting (ads only) against ${base}\n`);

  let totalDeleted = 0;
  for (const c of CORPORATIONS) {
    const { deleted, skipped } = await resetCorpAds(base, c);
    if (skipped) {
      console.log(`  = corp [${c.i}] ${c.name_he} — no session (never seeded or wiped)`);
    } else {
      console.log(`  - corp [${c.i}] ${c.name_he} — deleted ${deleted} ads`);
      totalDeleted += deleted;
    }
    await sleep(30);
  }

  console.log(`\nTotal ads deleted: ${totalDeleted}`);
  console.log(
    `\nContractor + corporation rows themselves stay in the DB (no ` +
    `service-layer DELETE exists for them). Re-running seed:staging ` +
    `is safe — existing entities 409 and are reported as "existed" ` +
    `with no side effects. For a total wipe, run the SQL snippet in ` +
    `reset.mjs's header comment manually against staging MySQL.`
  );
}

main().catch((err) => {
  console.error('\n*** RESET ABORTED ***');
  console.error(err);
  process.exit(1);
});
