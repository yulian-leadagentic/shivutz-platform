require('dotenv').config();
const express   = require('express');
const cron      = require('node-cron');
const { initDb, getPool }    = require('./db');
const { startConsumer } = require('./consumers');
const { runVisaExpiryCron } = require('./cron/visaExpiry');
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

  app.listen(PORT, () => console.log(`Notification service listening on ${PORT}`));
})();
