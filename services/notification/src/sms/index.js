/**
 * SMS Provider abstraction
 * Shivutz Platform | feature/sms-otp-registration
 *
 * Select provider via SMS_PROVIDER env var:
 *   stub   — console.log only (development / testing)
 *   inforu — InfoRu XML API (Israeli production provider)
 *   twilio — Twilio REST API (international fallback)
 */
const providers = {
  stub:   require('./stub'),
  inforu: require('./inforu'),
  twilio: require('./twilio'),
};

const PROVIDER = process.env.SMS_PROVIDER || 'stub';

/**
 * Send an SMS message.
 * @param {string} phone   - normalised phone: +972XXXXXXXXX
 * @param {string} message - plain text, max ~160 chars
 * @returns {Promise<{ messageId: string, provider: string }>}
 */
async function sendSms(phone, message) {
  const provider = providers[PROVIDER];
  if (!provider) throw new Error(`Unknown SMS provider: ${PROVIDER}`);
  const result = await provider.send(phone, message);
  return { ...result, provider: PROVIDER };
}

module.exports = { sendSms };
