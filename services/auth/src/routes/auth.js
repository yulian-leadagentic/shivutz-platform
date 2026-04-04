const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../db');
const redis   = require('../redis');

const ACCESS_SECRET  = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_SECRET + '_refresh';
const ACCESS_TTL     = process.env.JWT_ACCESS_EXPIRES_IN  || '15m';
const REFRESH_TTL    = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}
function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

// POST /auth/login
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1', [email]
  );
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: 'invalid credentials' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'invalid credentials' });

  const payload = { sub: user.id, email: user.email, role: user.role, org_id: user.org_id, org_type: user.org_type };
  const accessToken  = signAccess(payload);
  const refreshToken = signRefresh({ sub: user.id });

  const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [uuidv4(), user.id, tokenHash, expiresAt]
  );

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  res.json({ access_token: accessToken, refresh_token: refreshToken, role: user.role });
});

// POST /auth/refresh
router.post('/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });

  let decoded;
  try {
    decoded = jwt.verify(refresh_token, REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid refresh token' });
  }

  const tokenHash = require('crypto').createHash('sha256').update(refresh_token).digest('hex');
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()',
    [tokenHash]
  );
  if (!rows[0]) return res.status(401).json({ error: 'token revoked or expired' });

  // Rotate: revoke old, issue new
  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?', [tokenHash]);

  const [users] = await pool.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [decoded.sub]);
  const user = users[0];
  if (!user) return res.status(401).json({ error: 'user not found' });

  const payload = { sub: user.id, email: user.email, role: user.role, org_id: user.org_id, org_type: user.org_type };
  const newAccess  = signAccess(payload);
  const newRefresh = signRefresh({ sub: user.id });

  const newHash    = require('crypto').createHash('sha256').update(newRefresh).digest('hex');
  const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [uuidv4(), user.id, newHash, expiresAt]
  );

  res.json({ access_token: newAccess, refresh_token: newRefresh });
});

// POST /auth/logout
router.post('/auth/logout', async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    const tokenHash = require('crypto').createHash('sha256').update(refresh_token).digest('hex');
    await getPool().query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?', [tokenHash]);
  }
  res.json({ message: 'logged out' });
});

// GET /auth/me  — validates Bearer token and returns user info (used by gateway)
router.get('/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no token' });

  // Check blocklist
  const blocked = await redis.get(`blocklist:${token}`);
  if (blocked) return res.status(401).json({ error: 'token revoked' });

  try {
    const decoded = jwt.verify(token, ACCESS_SECRET);
    res.json({ user: decoded });
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
});

// POST /auth/register  — internal use (called by user-org service after org creation)
router.post('/auth/register', async (req, res) => {
  const { email, password, role, org_id, org_type } = req.body;
  if (!email || !password || !role) return res.status(400).json({ error: 'email, password, role required' });

  const hash = await bcrypt.hash(password, 12);
  const id   = uuidv4();
  const pool = getPool();

  try {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, role, org_id, org_type) VALUES (?, ?, ?, ?, ?, ?)',
      [id, email, hash, role, org_id || null, org_type || null]
    );
    res.status(201).json({ id, email, role });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'email already registered' });
    throw err;
  }
});

module.exports = router;
