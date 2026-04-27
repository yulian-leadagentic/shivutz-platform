const USER_ORG_URL = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';

/**
 * Daily — call user-org's revalidation endpoint, which re-checks all
 * email/sms-verified tier_2 contractors against the live פנקס הקבלנים
 * dataset on data.gov.il and demotes any whose license has been removed.
 */
async function runContractorRevalidationCron() {
  const res = await fetch(`${USER_ORG_URL}/admin/contractors/revalidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`user-org revalidate ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  console.log(
    `[cron] Contractor revalidation: checked=${body.checked} ` +
    `revalidated=${body.revalidated} demoted=${body.demoted}`
  );
}

module.exports = { runContractorRevalidationCron };
