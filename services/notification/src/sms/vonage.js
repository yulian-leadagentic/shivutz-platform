/**
 * Vonage (formerly Nexmo) SMS provider
 * https://developer.vonage.com/en/messaging/sms/overview
 *
 * Required env vars:
 *   VONAGE_API_KEY     — from Vonage dashboard → API Settings
 *   VONAGE_API_SECRET  — from Vonage dashboard → API Settings
 *   VONAGE_FROM        — sender name (max 11 alphanumeric chars) or Vonage number
 *                        e.g. "Shivutz" or "+972XXXXXXXXX"
 */
const https = require('https');

async function send(phone, message) {
  const apiKey    = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;
  const from      = process.env.VONAGE_FROM || 'Shivutz';

  if (!apiKey || !apiSecret) {
    throw new Error('VONAGE_API_KEY and VONAGE_API_SECRET must be set');
  }

  // Vonage expects E.164 without the leading + for the `to` field
  const to = phone.startsWith('+') ? phone.slice(1) : phone;

  // type:'unicode' — required for Hebrew. Without it Vonage encodes as GSM-7
  // and every non-Latin character is replaced with '?'.
  const payload = JSON.stringify({ api_key: apiKey, api_secret: apiSecret, to, from, text: message, type: 'unicode' });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'rest.nexmo.com',
      path:     '/sms/json',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept':         'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          const msg  = body.messages?.[0];

          if (!msg) {
            return reject(new Error('Vonage: empty response'));
          }

          // status '0' = success; anything else = error
          if (msg.status !== '0') {
            return reject(new Error(`Vonage error ${msg.status}: ${msg['error-text'] || 'unknown'}`));
          }

          resolve({ messageId: msg['message-id'], provider: 'vonage' });
        } catch (e) {
          reject(new Error(`Vonage: failed to parse response — ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { send };
