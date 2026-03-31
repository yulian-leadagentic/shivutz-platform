require('dotenv').config();
const express   = require('express');
const cron      = require('node-cron');
const { initDb }    = require('./db');
const { startConsumer } = require('./consumers');
const { runVisaExpiryCron } = require('./cron/visaExpiry');
const notifRoutes = require('./routes/notifications');

const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'notification' }));
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
