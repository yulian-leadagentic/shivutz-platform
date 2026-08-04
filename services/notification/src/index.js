require('dotenv').config();
const express   = require('express');
const cron      = require('node-cron');
const { initDb, getPool }    = require('./db');
const { startConsumer } = require('./consumers');
const { runVisaExpiryCron } = require('./cron/visaExpiry');
const { runContractorRevalidationCron } = require('./cron/contractorRevalidation');
const { runTrialEndingReminderCron }    = require('./cron/trialEndingReminder');
const { runAdExpiringReminderCron }     = require('./cron/adExpiringReminder');
const { runGraceReminderCron }          = require('./cron/graceReminder');
const { runGraceHardCapCron }           = require('./cron/graceHardCap');
const notifRoutes = require('./routes/notifications');

const app = express();
// Capture raw body buffer on req.rawBody before JSON parsing —
// required by vonageWebhookAuth to verify the payload_hash claim in signed JWTs.
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

// Liveness — static OK, independent of dependencies.
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'notification' }));

// Readiness — 503 if the DB pool can't serve a trivial query.
// (RabbitMQ has its own retry loop on consumer start; not probed here.)
app.get('/readyz', async (_, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ready', service: 'notification' });
  } catch (e) {
    res.status(503).json({ status: 'not_ready', error: `db_unreachable: ${e.message}` });
  }
});

app.use('/', notifRoutes);

const PORT = process.env.NOTIF_PORT || 3006;

(async () => {
  await initDb();
  await startConsumer();

  // Daily at 06:00 — check visa expiries
  cron.schedule('0 6 * * *', () => {
    console.log('[cron] Running visa expiry check');
    runVisaExpiryCron().catch(console.error);
  });

  // Daily at 06:30 — re-check tier_2 contractors against פנקס הקבלנים
  cron.schedule('30 6 * * *', () => {
    console.log('[cron] Running contractor revalidation');
    runContractorRevalidationCron().catch(console.error);
  });

  // Daily at 08:00 — SMS entities whose trial ends within the next
  // 3 days (see TRIAL_ENDING_DAYS_AHEAD). One SMS per sub, latched
  // via subscriptions.trial_expiry_notified_at.
  cron.schedule('0 8 * * *', () => {
    console.log('[cron] Running trial-ending reminder');
    runTrialEndingReminderCron().catch(console.error);
  });

  // Daily at 08:15 — SMS corps whose ad expires within the next 3
  // days (see AD_EXPIRY_DAYS_AHEAD). One SMS per ad, latched via
  // ads.expiry_notified_at.
  cron.schedule('15 8 * * *', () => {
    console.log('[cron] Running ad-expiring reminder');
    runAdExpiringReminderCron().catch(console.error);
  });

  // Daily at 08:30 — corp trial-end grace SMS series (spec B3).
  // 4 sends (day 0/3/6/7) latched per-step via grace_sms_step so a
  // missed run catches up on the next day. Companion cron below flips
  // the ads.
  cron.schedule('30 8 * * *', () => {
    console.log('[cron] Running grace-period reminder');
    runGraceReminderCron().catch(console.error);
  });

  // Daily at 08:45 — hard-cap: pause corp ads whose grace_ends_at is
  // past. Runs AFTER the day-7 SMS at 08:30 so the "המודעות הושהו" SMS
  // is factually true by the time it hits the phone.
  cron.schedule('45 8 * * *', () => {
    console.log('[cron] Running grace hard-cap');
    runGraceHardCapCron().catch(console.error);
  });

  app.listen(PORT, () => console.log(`Notification service listening on ${PORT}`));
})();
