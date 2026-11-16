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

// R38 · a media file a user sent us (a voice note). Two calls with the
// same token: the media id gives a short-lived URL, and that URL gives
// the bytes. The token goes only to Meta's own hosts.
const MEDIA_TIMEOUT_MS = 15_000;
const MEDIA_MAX_BYTES  = 10 * 1024 * 1024;
const MEDIA_HOSTS      = ['.fbsbx.com', '.facebook.com', '.fbcdn.net', '.whatsapp.net'];

function isMetaHost(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && MEDIA_HOSTS.some((h) => hostname.endsWith(h));
  } catch {
    return false;
  }
}

async function downloadMedia(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN must be set');
  if (!mediaId) throw new Error('the message has no media id');
  const auth    = { Authorization: `Bearer ${token}` };
  const version = process.env.WHATSAPP_API_VERSION || DEFAULT_VERSION;

  const lookup = await fetch(`${GRAPH_URL}/${version}/${encodeURIComponent(mediaId)}`, {
    headers: auth, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  const info = await lookup.json().catch(() => null);
  if (!lookup.ok || !info?.url) {
    throw new Error(`Meta media lookup failed (${lookup.status}${info?.error?.code ? `, code ${info.error.code}` : ''})`);
  }
  if (!isMetaHost(info.url)) throw new Error('Meta media URL is not on a Meta host, not fetched');
  if (Number(info.file_size) > MEDIA_MAX_BYTES) throw new Error(`media is ${info.file_size} bytes, over ${MEDIA_MAX_BYTES}`);

  const file = await fetch(info.url, { headers: auth, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
  if (!file.ok) throw new Error(`Meta media download failed (${file.status})`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error('Meta media download was empty');
  if (bytes.length > MEDIA_MAX_BYTES) throw new Error(`media is ${bytes.length} bytes, over ${MEDIA_MAX_BYTES}`);
  return { bytes, mimeType: info.mime_type || file.headers.get('content-type') || 'audio/ogg' };
}

module.exports = { send, downloadMedia };
