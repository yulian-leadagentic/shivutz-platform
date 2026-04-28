require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/auth');
const { initDb, getPool } = require('./db');

const app = express();
app.use(express.json());

// Liveness — static OK, independent of dependencies.
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'auth' }));

// Readiness — 503 if the DB pool can't serve a trivial query.
app.get('/readyz', async (_, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ready', service: 'auth' });
  } catch (e) {
    res.status(503).json({ status: 'not_ready', error: `db_unreachable: ${e.message}` });
  }
});

app.use('/', authRoutes);

const PORT = process.env.AUTH_PORT || 3001;

(async () => {
  await initDb();
  app.listen(PORT, '::', () => console.log(`Auth service listening on ${PORT}`));
})();
