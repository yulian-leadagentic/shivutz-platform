// WhatsApp sender on Meta's Cloud API. Same contract as the SMS
// providers: send(phone, message, opts) resolves to { messageId }.
//
// Free text is only deliverable inside the 24 hours after the user's
// last message to us. Outside that window Meta requires an approved
// template; the dispatcher decides which of the two applies.
const { toWaId } = require('../whatsapp/phone');

const GRAPH_URL        = 'https://graph.facebook.com';
const DEFAULT_VERSION  = 'v26.0';
const DEFAULT_LANGUAGE = 'he';
const SEND_TIMEOUT_MS  = 10_000;

// An AUTHENTICATION template (the only kind Meta accepts for one-time
// codes) carries the code twice: as the body parameter and as the
// parameter of its copy-code button, which Meta stores as a URL button
// at index 0.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates
function authenticationTemplate(to, opts) {
  const code = String(opts.otpCode);
  return {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type: 'template',
    template: {
      name:     opts.templateName,
      language: { code: opts.templateLanguage || DEFAULT_LANGUAGE },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
}

function bodyTemplate(to, opts) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name:     opts.templateName,
      language: { code: opts.templateLanguage || DEFAULT_LANGUAGE },
      components: [{
        type: 'body',
        parameters: (opts.templateParams || []).map((v) => ({ type: 'text', text: String(v) })),
      }],
    },
  };
}

function buildPayload(to, message, opts) {
  if (opts.templateName && opts.otpCode) return authenticationTemplate(to, opts);
  if (opts.templateName) return bodyTemplate(to, opts);
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: message, preview_url: true },
  };
}

async function send(phone, message, opts = {}) {
  const token         = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set');
  }
  const to = toWaId(phone);
  if (!to) throw new Error('WhatsApp send needs a phone number');

  const payload = buildPayload(to, message, opts);

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
