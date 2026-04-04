const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../db');
const redis   = require('../redis');
const { generateOtp, verifyOtp, hasRecentVerifiedOtp, normalisePhone } = require('../otp');

const ACCESS_SECRET  = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_SECRET + '_refresh';
const ACCESS_TTL     = process.env.JWT_ACCESS_EXPIRES_IN  || '15m';
const REFRESH_TTL    = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const NOTIF_URL      = process.env.NOTIF_SERVICE_URL || 'http://notification:3006';

// ─── JWT helpers ──────────────────────────────────────────────────────────────
function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}
function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

/**
 * Build a JWT payload for a user, optionally scoped to an entity membership.
 * Legacy org_id/org_type fields kept for backward compat with downstream services.
 */
function buildPayload(user, membership = null) {
  return {
    sub:      user.id,
    phone:    user.phone    || undefined,
    email:    user.email    || undefined,
    role:     user.role,
    // Legacy — kept so gateway x-org-id and downstream services don't break
    org_id:   user.org_id   || undefined,
    org_type: user.org_type || undefined,
    // New entity context — only present after entity selection
    ...(membership ? {
      entity_id:       membership.entity_id,
      entity_type:     membership.entity_type,
      membership_role: membership.role,
    } : {}),
  };
}

/**
 * Store refresh token and update last_login_at.
 */
async function issueRefreshToken(pool, userId) {
  const refreshToken = signRefresh({ sub: userId });
  const tokenHash    = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [uuidv4(), userId, tokenHash, expiresAt]
  );
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userId]);
  return refreshToken;
}

/**
 * Fetch entity memberships for a user.
 */
async function getMemberships(pool, userId) {
  const [rows] = await pool.query(
    `SELECT * FROM entity_memberships
     WHERE user_id = ? AND is_active = TRUE AND invitation_accepted_at IS NOT NULL`,
    [userId]
  );
  return rows;
}

/**
 * Send OTP SMS via notification service internal endpoint.
 */
async function sendOtpSms(phone, code) {
  const message = `קוד האימות שלך לשיבוץ פלטפורמה: ${code}\nבתוקף 10 דקות. אל תשתף קוד זה.`;
  try {
    const resp = await fetch(`${NOTIF_URL}/internal/sms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, message }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('[OTP] SMS send failed:', err);
    }
  } catch (err) {
    // Log but don't throw — we don't want OTP generation to fail if SMS is down
    console.error('[OTP] SMS service unreachable:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/send-otp
// Send a 6-digit OTP to a phone number.
// Rate limited: 3 per phone per 10 minutes.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/send-otp', async (req, res) => {
  try {
    const { phone, purpose } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (!['login', 'register', 'invite_accept'].includes(purpose)) {
      return res.status(400).json({ error: 'invalid purpose' });
    }

    const ip = req.ip || req.headers['x-forwarded-for'];
    const { code, normPhone } = await generateOtp(phone, purpose, ip);
    await sendOtpSms(normPhone, code);

    res.json({ sent: true, phone: normPhone });
  } catch (err) {
    if (err.status === 429) return res.status(429).json({ error: 'rate_limited', retryAfter: err.retryAfter });
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[send-otp]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/verify-otp
// Stateless OTP check — does NOT issue a JWT.
// Used by registration Step 3 (inline OTP) to confirm phone ownership.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/verify-otp', async (req, res) => {
  try {
    const { phone, code, purpose } = req.body;
    if (!phone || !code || !purpose) {
      return res.status(400).json({ error: 'phone, code, purpose required' });
    }

    const { normPhone } = await verifyOtp(phone, code, purpose);
    res.json({ valid: true, phone: normPhone });
  } catch (err) {
    if (err.reason === 'wrong_code') {
      return res.status(401).json({ error: 'wrong_code', remaining: err.remaining });
    }
    if (err.reason === 'max_attempts') {
      return res.status(401).json({ error: 'max_attempts' });
    }
    if (err.reason === 'not_found_or_expired') {
      return res.status(401).json({ error: 'otp_expired_or_not_found' });
    }
    console.error('[verify-otp]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/login/otp
// Full login: verify OTP + look up user + issue JWT.
// Returns needs_entity_selection=true if user has multiple entities.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/login/otp', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });

    // 1. Verify OTP
    const { normPhone } = await verifyOtp(phone, code, 'login');

    // 2. Look up user by phone
    const pool = getPool();
    const [users] = await pool.query(
      'SELECT * FROM users WHERE phone = ? AND deleted_at IS NULL LIMIT 1',
      [normPhone]
    );
    const user = users[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'user_not_found' });
    }

    // 3. Fetch entity memberships
    const memberships = await getMemberships(pool, user.id);

    let payload, needsEntitySelection = false;

    if (memberships.length === 1) {
      // Single entity — issue full JWT with entity context
      payload = buildPayload(user, memberships[0]);
    } else if (memberships.length > 1) {
      // Multiple entities — partial JWT, frontend routes to /select-entity
      payload = buildPayload(user);
      needsEntitySelection = true;
    } else {
      // No active membership yet (pending approval or no org)
      payload = buildPayload(user);
    }

    const accessToken  = signAccess(payload);
    const refreshToken = await issueRefreshToken(pool, user.id);

    res.json({
      access_token:            accessToken,
      refresh_token:           refreshToken,
      role:                    user.role,
      needs_entity_selection:  needsEntitySelection,
      memberships:             needsEntitySelection ? memberships.map(m => ({
        membership_id: m.membership_id,
        entity_id:     m.entity_id,
        entity_type:   m.entity_type,
        role:          m.role,
      })) : undefined,
    });
  } catch (err) {
    if (err.reason === 'wrong_code') return res.status(401).json({ error: 'wrong_code', remaining: err.remaining });
    if (err.reason === 'max_attempts') return res.status(401).json({ error: 'max_attempts' });
    if (err.reason === 'not_found_or_expired') return res.status(401).json({ error: 'otp_expired' });
    console.error('[login/otp]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/select-entity
// Re-issue JWT scoped to a specific entity.
// Called after /login/otp when needs_entity_selection=true.
// Requires a valid Bearer token (without entity context yet).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/select-entity', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no token' });

  let decoded;
  try {
    decoded = jwt.verify(token, ACCESS_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }

  const { entity_id, entity_type } = req.body;
  if (!entity_id || !entity_type) {
    return res.status(400).json({ error: 'entity_id and entity_type required' });
  }

  const pool = getPool();
  const [memberships] = await pool.query(
    `SELECT * FROM entity_memberships
     WHERE user_id = ? AND entity_id = ? AND entity_type = ? AND is_active = TRUE`,
    [decoded.sub, entity_id, entity_type]
  );
  const membership = memberships[0];
  if (!membership) return res.status(403).json({ error: 'not_a_member' });

  const [users] = await pool.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [decoded.sub]);
  const user = users[0];
  if (!user) return res.status(401).json({ error: 'user_not_found' });

  // Blocklist old token
  const remaining = decoded.exp - Math.floor(Date.now() / 1000);
  if (remaining > 0) await redis.setex(`blocklist:${token}`, remaining, '1');

  const payload    = buildPayload(user, membership);
  const accessToken = signAccess(payload);
  const refreshToken = await issueRefreshToken(pool, user.id);

  res.json({ access_token: accessToken, refresh_token: refreshToken });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/invite/validate
// Public — validate an invitation token and return metadata.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/invite/validate', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT em.*, u.full_name AS inviter_name, u.email AS inviter_email
     FROM entity_memberships em
     LEFT JOIN users u ON u.id = em.invited_by
     WHERE em.invitation_token = ?
       AND em.invitation_accepted_at IS NULL
     LIMIT 1`,
    [token]
  );
  const membership = rows[0];
  if (!membership) return res.status(404).json({ error: 'invite_not_found_or_used' });

  // Check expiry — invitation tokens last 7 days from creation
  const age = Date.now() - new Date(membership.created_at).getTime();
  if (age > 7 * 24 * 60 * 60 * 1000) {
    return res.status(410).json({ error: 'invite_expired' });
  }

  res.json({
    entity_type:  membership.entity_type,
    entity_id:    membership.entity_id,
    role:         membership.role,
    job_title:    membership.job_title,
    inviter_name: membership.inviter_name || null,
    membership_id: membership.membership_id,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/invite/accept
// Accept an invitation: verify OTP, create/link user, activate membership.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/invite/accept', async (req, res) => {
  try {
    const { token, phone, code, full_name } = req.body;
    if (!token || !phone || !code) {
      return res.status(400).json({ error: 'token, phone, code required' });
    }

    const pool = getPool();

    // 1. Validate token
    const [memberships] = await pool.query(
      `SELECT * FROM entity_memberships
       WHERE invitation_token = ? AND invitation_accepted_at IS NULL`,
      [token]
    );
    const membership = memberships[0];
    if (!membership) return res.status(404).json({ error: 'invite_not_found_or_used' });

    const age = Date.now() - new Date(membership.created_at).getTime();
    if (age > 7 * 24 * 60 * 60 * 1000) return res.status(410).json({ error: 'invite_expired' });

    // 2. Verify OTP
    const { normPhone } = await verifyOtp(phone, code, 'invite_accept');

    // 3. Find or create user
    let [users] = await pool.query(
      'SELECT * FROM users WHERE phone = ? AND deleted_at IS NULL LIMIT 1',
      [normPhone]
    );
    let user = users[0];

    if (!user) {
      if (!full_name) return res.status(400).json({ error: 'full_name required for new users' });
      const newId = uuidv4();
      const orgRole = membership.entity_type === 'contractor' ? 'contractor' : 'corporation';
      await pool.query(
        `INSERT INTO users (id, phone, full_name, role, auth_method)
         VALUES (?, ?, ?, ?, 'sms')`,
        [newId, normPhone, full_name, orgRole]
      );
      [users] = await pool.query('SELECT * FROM users WHERE id = ?', [newId]);
      user = users[0];
    }

    // 4. Activate membership — link user_id, clear invitation_token
    await pool.query(
      `UPDATE entity_memberships
       SET user_id = ?, invitation_accepted_at = NOW(), invitation_token = NULL, is_active = TRUE
       WHERE membership_id = ?`,
      [user.id, membership.membership_id]
    );

    // 5. Issue JWT with entity context
    const updatedMembership = { ...membership, user_id: user.id, entity_id: membership.entity_id };
    const payload    = buildPayload(user, updatedMembership);
    const accessToken  = signAccess(payload);
    const refreshToken = await issueRefreshToken(pool, user.id);

    res.json({ access_token: accessToken, refresh_token: refreshToken, role: user.role });
  } catch (err) {
    if (err.reason === 'wrong_code') return res.status(401).json({ error: 'wrong_code', remaining: err.remaining });
    if (err.reason === 'max_attempts') return res.status(401).json({ error: 'max_attempts' });
    if (err.reason === 'not_found_or_expired') return res.status(401).json({ error: 'otp_expired' });
    console.error('[invite/accept]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/login  (legacy — email + password, kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1', [email]
  );
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: 'invalid credentials' });
  if (!user.password_hash) return res.status(401).json({ error: 'use_phone_login' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'invalid credentials' });

  // Fetch memberships for entity context
  const memberships = await getMemberships(pool, user.id);
  const membership  = memberships.length === 1 ? memberships[0] : null;

  const payload = buildPayload(user, membership);
  const accessToken  = signAccess(payload);
  const refreshToken = await issueRefreshToken(pool, user.id);

  res.json({
    access_token:           accessToken,
    refresh_token:          refreshToken,
    accessToken:            accessToken,   // legacy field — some frontend code reads this
    role:                   user.role,
    needs_entity_selection: memberships.length > 1,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/refresh
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });

  let decoded;
  try {
    decoded = jwt.verify(refresh_token, REFRESH_SECRET);
  } catch {
    return res.status(401).json({ error: 'invalid refresh token' });
  }

  const tokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()',
    [tokenHash]
  );
  if (!rows[0]) return res.status(401).json({ error: 'token revoked or expired' });

  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?', [tokenHash]);

  const [users] = await pool.query('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [decoded.sub]);
  const user = users[0];
  if (!user) return res.status(401).json({ error: 'user not found' });

  const memberships = await getMemberships(pool, user.id);
  const membership  = memberships.length === 1 ? memberships[0] : null;
  const payload     = buildPayload(user, membership);

  const newAccess  = signAccess(payload);
  const newRefresh = signRefresh({ sub: user.id });
  const newHash    = crypto.createHash('sha256').update(newRefresh).digest('hex');
  const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [uuidv4(), user.id, newHash, expiresAt]
  );

  res.json({ access_token: newAccess, refresh_token: newRefresh });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/logout', async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    const tokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    await getPool().query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?', [tokenHash]);
  }
  res.json({ message: 'logged out' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/me  — validates Bearer token (used by gateway)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no token' });

  const blocked = await redis.get(`blocklist:${token}`);
  if (blocked) return res.status(401).json({ error: 'token revoked' });

  try {
    const decoded = jwt.verify(token, ACCESS_SECRET);
    res.json({ user: decoded });
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/register — internal (called by user-org after entity creation)
// Supports both legacy email+password and new phone-first paths.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auth/register', async (req, res) => {
  const { email, password, phone, full_name, role, org_id, org_type } = req.body;
  if (!role) return res.status(400).json({ error: 'role required' });

  const pool = getPool();
  const id   = uuidv4();

  try {
    if (phone) {
      // Phone-first path (SMS OTP)
      const normPhone = normalisePhone(phone);
      // Require a recently verified OTP for 'register' purpose
      const otpOk = await hasRecentVerifiedOtp(normPhone, 'register');
      if (!otpOk) return res.status(400).json({ error: 'phone_not_verified' });

      // Upsert — if user already exists (phone), just update their org link
      const [existing] = await pool.query(
        'SELECT id FROM users WHERE phone = ? AND deleted_at IS NULL LIMIT 1',
        [normPhone]
      );
      if (existing[0]) {
        await pool.query(
          'UPDATE users SET org_id=?, org_type=?, role=? WHERE id=?',
          [org_id || null, org_type || null, role, existing[0].id]
        );
        return res.status(200).json({ id: existing[0].id, phone: normPhone, role });
      }

      await pool.query(
        `INSERT INTO users (id, phone, full_name, role, org_id, org_type, auth_method)
         VALUES (?, ?, ?, ?, ?, ?, 'sms')`,
        [id, normPhone, full_name || null, role, org_id || null, org_type || null]
      );
      return res.status(201).json({ id, phone: normPhone, role });

    } else {
      // Legacy email+password path
      if (!email || !password) {
        return res.status(400).json({ error: 'email and password required' });
      }
      const hash = await bcrypt.hash(password, 12);
      await pool.query(
        `INSERT INTO users (id, email, password_hash, role, org_id, org_type, auth_method)
         VALUES (?, ?, ?, ?, ?, ?, 'email_password')`,
        [id, email, hash, role, org_id || null, org_type || null]
      );
      return res.status(201).json({ id, email, role });
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'already_registered' });
    console.error('[register]', err);
    throw err;
  }
});

module.exports = router;
