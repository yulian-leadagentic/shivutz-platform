/**
 * OTP — SMS one-time password logic
 * Shivutz Platform | feature/sms-otp-registration
 *
 * Responsibilities:
 *  - Generate a 6-digit code, store it hashed in sms_otp
 *  - Verify a submitted code (with attempt counting + lockout)
 *  - Rate-limit SMS sends via Redis
 *  - Normalise Israeli phone numbers to +972XXXXXXXXX
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('./db');
const redis = require('./redis');

// ─── Phone normalisation ───────────────────────────────────────────────────
// Accepts: 0521234567 | 052-123-4567 | +9725212345 | 972521234567
function normalisePhone(raw) {
  if (!raw) throw Object.assign(new Error('phone_required'), { status: 400 });
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('972') && digits.length === 12) return '+' + digits;
  if (digits.startsWith('0')   && digits.length === 10) return '+972' + digits.slice(1);
  throw Object.assign(new Error('invalid_phone'), { status: 400 });
}

// ─── Rate limiting ─────────────────────────────────────────────────────────
// 3 OTPs per phone per 10-minute window
// 10 OTPs per IP per 10-minute window
async function checkRateLimit(phone, ip) {
  const window = Math.floor(Date.now() / 600_000); // 10-min bucket

  const phoneKey = `sms_rl:phone:${phone}:${window}`;
  const phoneCount = await redis.incr(phoneKey);
  if (phoneCount === 1) await redis.expire(phoneKey, 600);
  if (phoneCount > 3) {
    const ttl = await redis.ttl(phoneKey);
    throw Object.assign(new Error('rate_limited'), { status: 429, retryAfter: ttl });
  }

  if (ip) {
    const ipKey = `sms_rl:ip:${ip}:${window}`;
    const ipCount = await redis.incr(ipKey);
    if (ipCount === 1) await redis.expire(ipKey, 600);
    if (ipCount > 10) {
      throw Object.assign(new Error('rate_limited'), { status: 429, retryAfter: 600 });
    }
  }
}

// ─── Generate OTP ──────────────────────────────────────────────────────────
/**
 * @param {string} phone   - raw phone (will be normalised)
 * @param {string} purpose - 'login' | 'register' | 'invite_accept'
 * @param {string} [ip]    - caller IP for rate limiting
 * @returns {{ code: string, normPhone: string }} plain code to send via SMS
 */
async function generateOtp(phone, purpose, ip) {
  const normPhone = normalisePhone(phone);
  await checkRateLimit(normPhone, ip);

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits, zero-padded
  const hash = await bcrypt.hash(code, 10);
  const pool = getPool();

  // Invalidate any previous unverified OTPs for same phone+purpose
  await pool.query(
    `UPDATE sms_otp
     SET verified_at = NOW()
     WHERE phone = ? AND purpose = ? AND verified_at IS NULL AND expires_at > NOW()`,
    [normPhone, purpose]
  );

  const otpId    = uuidv4();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await pool.query(
    `INSERT INTO sms_otp (otp_id, phone, code, purpose, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [otpId, normPhone, hash, purpose, expiresAt, ip || null]
  );

  return { code, normPhone };
}

// ─── Verify OTP ────────────────────────────────────────────────────────────
/**
 * @returns {{ valid: true, normPhone: string }}
 * @throws  Error with .reason string on failure
 */
async function verifyOtp(phone, code, purpose) {
  const normPhone = normalisePhone(phone);
  const pool = getPool();

  const [rows] = await pool.query(
    `SELECT * FROM sms_otp
     WHERE phone = ? AND purpose = ? AND verified_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normPhone, purpose]
  );

  const otp = rows[0];
  if (!otp) {
    throw Object.assign(new Error('otp_not_found'), { status: 401, reason: 'not_found_or_expired' });
  }

  // Increment attempts BEFORE checking, so a failed check is always counted
  await pool.query(
    'UPDATE sms_otp SET attempts = attempts + 1 WHERE otp_id = ?',
    [otp.otp_id]
  );

  if (otp.attempts >= 5) {
    // Mark as consumed so it can't be retried after lockout
    await pool.query('UPDATE sms_otp SET verified_at = NOW() WHERE otp_id = ?', [otp.otp_id]);
    throw Object.assign(new Error('max_attempts'), { status: 401, reason: 'max_attempts' });
  }

  // Master bypass code for development/testing only.
  // SECURITY: must be opt-in via env var. NO default — if MASTER_OTP is
  // unset, no bypass code works. (Previously defaulted to '999999', which
  // meant production accepted that code with no env-var ever set.)
  const masterCode = process.env.MASTER_OTP;
  const isMasterCode = !!masterCode && code === masterCode;

  const match = isMasterCode || await bcrypt.compare(code, otp.code);
  if (!match) {
    const remaining = 4 - otp.attempts; // otp.attempts is before increment (already +1 above)
    throw Object.assign(new Error('wrong_code'), {
      status: 401,
      reason: 'wrong_code',
      remaining: Math.max(0, remaining),
    });
  }

  // Mark OTP as used
  await pool.query('UPDATE sms_otp SET verified_at = NOW() WHERE otp_id = ?', [otp.otp_id]);
  return { valid: true, normPhone };
}

// ─── Check if a recent verified OTP exists (for registration pre-check) ───
async function hasRecentVerifiedOtp(phone, purpose) {
  const normPhone = normalisePhone(phone);
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT otp_id FROM sms_otp
     WHERE phone = ? AND purpose = ? AND verified_at IS NOT NULL
       AND verified_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
     ORDER BY verified_at DESC LIMIT 1`,
    [normPhone, purpose]
  );
  return rows.length > 0;
}

module.exports = { normalisePhone, generateOtp, verifyOtp, hasRecentVerifiedOtp };
