/**
 * Channel-aware messaging dispatcher.
 *
 * Replaces the previous `sendSms()` single-channel call. Callers now ask
 * for `sendMessage(phone, body, opts)` and the dispatcher picks the right
 * channel based on `opts.channel`:
 *
 *   - 'sms'       (default) → existing SMS provider (Vonage / InfoRu / etc.)
 *   - 'whatsapp'           → Meta Cloud API. Free text only inside the 24h
 *                            window the user's last message opened. Outside
 *                            it, or when Meta rejects a template, the
 *                            message goes by SMS instead of failing.
 *   - 'auto'               → try WhatsApp first IF opts.templateName is set
 *                            AND the WHATSAPP_* credentials are configured,
 *                            else SMS. On WhatsApp failure, falls back to SMS.
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
const whatsappProvider = require('./metaWhatsapp');
const { normalizePhone } = require('../whatsapp/phone');

const HAS_WHATSAPP = () => !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

// Meta delivers free text only within 24 hours of the user's last
// message to us. The webhook stores every inbound message, so that
// table is the record of whether the window is open. A failed lookup
// throws: guessing "closed" would turn a chat reply into an SMS.
async function insideServiceWindow(phone) {
  const [rows] = await getPool().query(
    `SELECT 1
       FROM support_messages
      WHERE channel = 'whatsapp' AND direction = 'inbound'
        AND peer_phone = ?
        AND created_at > NOW() - INTERVAL 24 HOUR
      LIMIT 1`,
    [normalizePhone(phone)],
  );
  return rows.length > 0;
}

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
    return { ...result, provider: 'meta-cloud', channel: 'whatsapp' };
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
      throw new Error('WhatsApp channel requested but WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set');
    }
    if (opts.templateName) {
      try {
        return await sendWhatsappOnce(phone, message, opts);
      } catch (err) {
        console.warn(`[messaging] WhatsApp template send failed, falling back to SMS: ${err.message}`);
      }
    } else if (await insideServiceWindow(phone)) {
      return sendWhatsappOnce(phone, message, opts);
    } else {
      console.warn('[messaging] outside the 24h WhatsApp window and no template, sending by SMS');
    }
    // Fall through to SMS.
  }

  if (channel === 'auto') {
    // 'auto' = prefer WhatsApp if we have credentials AND the caller gave us
    // a template, otherwise SMS. It never sends free text, open window or
    // not: its caller is the OTP, which goes over WhatsApp only as an
    // approved template. On any WhatsApp failure, fall back to SMS so
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
