/**
 * InfoRu SMS provider — Israeli production
 * https://www.inforu.co.il
 *
 * Required env vars:
 *   INFORU_USERNAME  — InfoRu account username
 *   INFORU_API_KEY   — InfoRu API key / password
 *   INFORU_SENDER    — Sender name / number (e.g. "Shivutz")
 */
const https = require('https');

function buildXml(phone, message) {
  const user = process.env.INFORU_USERNAME;
  const key  = process.env.INFORU_API_KEY;
  const from = process.env.INFORU_SENDER || 'Shivutz';
  // Remove leading + for InfoRu (expects 972XXXXXXXXX)
  const dest = phone.replace(/^\+/, '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<INFO>
  <USER>
    <USERNAME>${user}</USERNAME>
    <PASSWORD>${key}</PASSWORD>
  </USER>
  <OPERATION>SendSms</OPERATION>
  <CONTENT>
    <SENDER>${from}</SENDER>
    <SmsText>${message}</SmsText>
  </CONTENT>
  <RECIPIENT>
    <PHONE_LIST>
      <PHONE>${dest}</PHONE>
    </PHONE_LIST>
  </RECIPIENT>
</INFO>`;
}

async function send(phone, message) {
  const xml  = buildXml(phone, message);
  const body = `InforuXML=${encodeURIComponent(xml)}`;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.inforu.co.il',
      path:     '/SendMessageXml.aspx',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        // InfoRu returns XML with <Status> and <MessageID>
        const statusMatch = data.match(/<Status>(\d+)<\/Status>/);
        const idMatch     = data.match(/<MessageID>([^<]+)<\/MessageID>/);
        const status = statusMatch ? parseInt(statusMatch[1]) : -1;
        if (status === 1) {
          resolve({ messageId: idMatch ? idMatch[1] : 'inforu-ok' });
        } else {
          reject(new Error(`InfoRu error: status=${status} body=${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { send };
