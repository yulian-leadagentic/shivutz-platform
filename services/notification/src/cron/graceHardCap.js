// Pivot/v2 (spec B3) — pause corp ads whose grace window has closed.
//
// Companion to graceReminder: after the last SMS at day 7, this cron
// physically flips ad.active=FALSE and paused_by='grace_hard_cap' so
// the ads stop appearing in search. The corp's day-7 SMS says "the
// ads have been paused" — this is the flip that makes it true.
//
// Renewal path (payment /subscriptions/start) restores paused_by=grace
// ads back to active, so a subscribed corp doesn't need any action here.

const USER_ORG_URL = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';

async function runGraceHardCapCron() {
  let resp;
  try {
    resp = await fetch(`${USER_ORG_URL}/ads/internal/grace-hard-cap`, { method: 'POST' });
  } catch (err) {
    console.error('[grace-hard-cap] user-org unreachable:', err.message);
    return;
  }
  if (!resp.ok) {
    console.error(`[grace-hard-cap] user-org ${resp.status}: ${await resp.text()}`);
    return;
  }
  const { paused } = await resp.json();
  if (paused > 0) console.log(`[grace-hard-cap] paused ${paused} ads`);
}

module.exports = { runGraceHardCapCron };
