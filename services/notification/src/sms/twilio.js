/**
 * Twilio SMS provider — international fallback
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER  — e.g. "+15017122661"
 */
const https = require('https');

async function send(phone, message) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  const body = new URLSearchParams({ To: phone, From: from, Body: message }).toString();
  const auth  = Buffer.from(`${sid}:${token}`).toString('base64');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.twilio.com',
      path:     `/2010-04-01/Accounts/${sid}/Messages.json`,
      method:   'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.sid) resolve({ messageId: parsed.sid });
        else reject(new Error(`Twilio error: ${parsed.message || data}`));
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { send };
