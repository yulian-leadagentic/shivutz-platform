// WhatsApp sender on Meta's Cloud API. Same contract as the SMS
// providers: send(phone, message, opts) resolves to { messageId }.
//
// Free text is only deliverable inside the 24 hours after the user's
// last message to us. Outside that window Meta requires an approved
// template; the dispatcher decides which of the two applies.
const { toWaId } = require('../whatsapp/phone');

const GRAPH_URL       = 'https://graph.facebook.com';
const DEFAULT_VERSION = 'v26.0';
const SEND_TIMEOUT_MS = 10_000;

async function send(phone, message, opts = {}) {
  const token         = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set');
  }
  const to = toWaId(phone);
  if (!to) throw new Error('WhatsApp send needs a phone number');

  // Template branch is a skeleton: body text parameters only. An
  // AUTHENTICATION template also needs its button component, to be
  // added with the first template Meta approves.
  const payload = opts.templateName
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name:     opts.templateName,
          language: { code: 'he' },
          components: [{
            type: 'body',
            parameters: (opts.templateParams || []).map((v) => ({ type: 'text', text: String(v) })),
          }],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message, preview_url: true },
      };

  const version = process.env.WHATSAPP_API_VERSION || DEFAULT_VERSION;
  const resp = await fetch(`${GRAPH_URL}/${version}/${phoneNumberId}/messages`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const data  = await resp.json().catch(() => null);
  const wamid = data?.messages?.[0]?.id;
  if (!resp.ok || !wamid) {
    const e      = data?.error;
    const detail = e?.error_data?.details || e?.message || 'no message id in the response';
    throw new Error(`Meta WhatsApp send failed (${resp.status}${e?.code ? `, code ${e.code}` : ''}): ${detail}`);
  }
  return { messageId: wamid };
}

module.exports = { send };
