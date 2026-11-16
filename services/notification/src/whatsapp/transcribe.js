// R38 · a WhatsApp voice note to text, with ElevenLabs Scribe: the same
// call the gateway's /api/voice/transcribe makes for the site's mic,
// made from here so the audio never goes through the public gateway.
//
// ELEVENLABS_API_KEY is read on each call and never logged. Unset, or
// the `-` placeholder the env files carry, means voice is off.

const STT_URL        = 'https://api.elevenlabs.io/v1/speech-to-text';
const STT_TIMEOUT_MS = 30_000;
const EXTENSION      = {
  'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/webm': 'webm', 'audio/wav': 'wav',
};

function sttKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  return !key || key.startsWith('-') ? null : key;
}

async function transcribe(bytes, mimeType) {
  const apiKey = sttKey();
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase() || 'audio/ogg';

  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), `voice.${EXTENSION[type] || 'ogg'}`);
  form.append('model_id', 'scribe_v1');
  form.append('language_code', 'heb');

  const resp = await fetch(STT_URL, {
    method:  'POST',
    headers: { 'xi-api-key': apiKey },
    body:    form,
    signal:  AbortSignal.timeout(STT_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`ElevenLabs answered ${resp.status}: ${detail.slice(0, 200)}`);
  }
  const data = await resp.json();
  return String(data.text ?? '').replace(/\s+/g, ' ').trim();
}

module.exports = { transcribe, sttKey };
