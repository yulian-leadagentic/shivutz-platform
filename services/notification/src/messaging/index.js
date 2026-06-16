/**
 * Channel-aware messaging dispatcher.
 *
 * Replaces the previous `sendSms()` single-channel call. Callers now ask
 * for `sendMessage(phone, body, opts)` and the dispatcher picks the right
 * channel based on `opts.channel`:
 *
 *   - 'sms'       (default) → existing SMS provider (Vonage / InfoRu / etc.)
 *   - 'whatsapp'           → Vonage Messages API, WhatsApp channel
 *   - 'auto'               → try WhatsApp first IF opts.templateName is set
 *                            AND VONAGE_WHATSAPP_NUMBER is configured, else
 *                            SMS. On WhatsApp failure, falls back to SMS.
 *
 * Backwards compatible: the legacy `sendSms()` from ../sms/index.js is
 * still exported under the same name. Existing call sites keep working
 * unchanged; they migrate to `sendMessage()` opportunistically.
 *
 * Persistence: each successful send writes a row to either sms_log (SMS)
 * or whatsapp_message_log (WhatsApp). Callers don't need to do their own
 * logging — that happens inside this module.
 */
const { v4: uuidv4 } = require('uuid');
const { getPool }    = require('../db');
const { sendSms }    = require('../sms');
const whatsappProvider = require('./vonageWhatsapp');

const HAS_WHATSAPP = () => !!(process.env.VONAGE_APPLICATION_ID && process.env.VONAGE_PRIVATE_KEY && process.env.VONAGE_WHATSAPP_NUMBER);

async function logWhatsapp({ phone, message, templateName, messageId, status, err }) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO whatsapp_message_log
         (id, phone, message_text, template_name, message_uuid, status, delivery_err, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        phone,
        message,
        templateName || null,
        messageId    || null,
        status,
        err          || null,
        status === 'submitted' ? new Date() : null,
      ],
    );
  } catch (e) {
    // Logging failure must never break the send path.
    console.error('[messaging] whatsapp_message_log insert failed:', e.message);
  }
}

async function sendWhatsappOnce(phone, message, opts) {
  try {
    const result = await whatsappProvider.send(phone, message, opts);
    await logWhatsapp({
      phone,
      message,
      templateName: opts.templateName,
      messageId:    result.messageId,
      status:       'submitted',
    });
    return { ...result, provider: 'vonage-whatsapp', channel: 'whatsapp' };
  } catch (err) {
    await logWhatsapp({
      phone,
      message,
      templateName: opts.templateName,
      status:       'failed',
      err:          err.message,
    });
    throw err;
  }
}

/**
 * Send a message via the requested or auto-selected channel.
 *
 * @param {string} phone   — E.164 (with or without leading +)
 * @param {string} message — body text. For WhatsApp templates this is the
 *                           rendered fallback text.
 * @param {object} [opts]
 * @param {('sms'|'whatsapp'|'auto')} [opts.channel='sms']
 * @param {string}   [opts.templateName]   — WhatsApp template name; required
 *                                          for out-of-window sends
 * @param {string[]} [opts.templateParams] — positional template params
 * @returns {Promise<{ messageId: string, provider: string, channel: string }>}
 */
async function sendMessage(phone, message, opts = {}) {
  const channel = opts.channel || 'sms';

  if (channel === 'whatsapp') {
    if (!HAS_WHATSAPP()) {
      throw new Error('WhatsApp channel requested but VONAGE_* env vars not set');
    }
    return sendWhatsappOnce(phone, message, opts);
  }

  if (channel === 'auto') {
    // 'auto' = prefer WhatsApp if we have credentials AND the caller gave us
    // a template (free-text only valid in 24h window — we can't safely guess
    // that). Otherwise SMS. On any WhatsApp failure, fall back to SMS so
    // the user still gets the message.
    if (HAS_WHATSAPP() && opts.templateName) {
      try {
        return await sendWhatsappOnce(phone, message, opts);
      } catch (err) {
        console.warn(`[messaging] WhatsApp send failed, falling back to SMS: ${err.message}`);
      }
    }
    // Fall through to SMS.
  }

  // SMS path — keep delegating to the existing provider abstraction.
  const result = await sendSms(phone, message);
  return { ...result, channel: 'sms' };
}

module.exports = { sendMessage, sendSms };
