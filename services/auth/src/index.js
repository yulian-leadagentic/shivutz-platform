require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/auth');
const { initDb } = require('./db');

const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'auth' }));
app.use('/', authRoutes);

const PORT = process.env.AUTH_PORT || 3001;

(async () => {
  await initDb();
  app.listen(PORT, () => console.log(`Auth service listening on ${PORT}`));
})();
