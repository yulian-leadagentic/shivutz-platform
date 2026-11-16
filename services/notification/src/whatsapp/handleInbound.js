// One inbound WhatsApp message in, at most one message out.
//
// Meta bills every message we send, so nothing here sends a second
// one: no "searching" notice, no retry, no follow-up.
const { v4: uuidv4, v7: uuidv7 } = require('uuid');
const { getPool }        = require('../db');
const { sendMessage }    = require('../messaging');
const { downloadMedia }  = require('../messaging/metaWhatsapp');
const { normalizePhone } = require('./phone');
const { transcribe, sttKey } = require('./transcribe');
const {
  composeReply, pickEntityReply, registerInviteReply,
  NON_TEXT_REPLY, RATE_LIMIT_REPLY, SEARCH_FAILED_REPLY, VOICE_FAILED_REPLY,
} = require('./composeReply');

const USER_ORG_URL = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://www.tagidai.com').replace(/\/+$/, '');

const SEARCH_TIMEOUT_MS = 10_000;
const SEARCH_QUERY_MIN  = 2;     // SearchIn.query bounds in user-org
const SEARCH_QUERY_MAX  = 500;
const HOURLY_LIMIT      = 10;
const BURST_SECONDS     = 5;
const LABELS_TTL_MS     = 10 * 60_000;

// Reactions and system notices are not requests; answering them would
// spend a billable message on a thumbs-up.
const IGNORED_TYPES = new Set(['reaction', 'system']);

const NO_LABELS = { profession: {}, origin: {}, region: {}, category: {} };
let labels = { loadedAt: 0, value: NO_LABELS };

// The limits are counted on the inbound rows themselves, by the
// messages that arrived before this one. v7 ids sort by creation time,
// so (created_at, id) is arrival order even inside one second, and two
// messages landing together cannot each take the other for the earlier.
async function rateLimitVerdict(inboundId) {
  const [[row]] = await getPool().query(
    `SELECT COUNT(*) AS hour_before,
            COALESCE(SUM(earlier.created_at > me.created_at - INTERVAL ? SECOND), 0) AS burst_before
       FROM support_messages me
       JOIN support_messages earlier
         ON earlier.peer_phone = me.peer_phone
        AND earlier.channel    = 'whatsapp'
        AND earlier.direction  = 'inbound'
        AND earlier.created_at > me.created_at - INTERVAL 1 HOUR
        AND (earlier.created_at < me.created_at
             OR (earlier.created_at = me.created_at AND earlier.id < me.id))
      WHERE me.id = ?`,
    [BURST_SECONDS, inboundId],
  );
  const hourBefore  = Number(row.hour_before);
  const burstBefore = Number(row.burst_before);
  // The message that crosses a limit is told once. The ones behind it
  // get nothing, or a flood would be answered with a flood.
  if (hourBefore >= HOURLY_LIMIT) return hourBefore === HOURLY_LIMIT ? 'notice' : 'silent';
  if (burstBefore >= 1)           return burstBefore === 1 ? 'notice' : 'silent';
  return 'proceed';
}

// Who the sender is (R38). WhatsApp is for registered users only: a
// number with no live user and no active, accepted membership is
// 'unknown' and is invited to register. One membership is that one.
// With several, the one the user picked on the site
// (is_whatsapp_default, migration 110); none picked means no search,
// one reply asking him to pick.
async function identifySender(phone) {
  const [rows] = await getPool().query(
    `SELECT em.entity_type, em.entity_id, em.is_whatsapp_default
       FROM auth_db.users u
       JOIN auth_db.entity_memberships em ON em.user_id = u.id
      WHERE u.phone = ?
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
        AND em.is_active = TRUE
        AND em.invitation_accepted_at IS NOT NULL`,
    [phone],
  );
  if (rows.length === 0) return { kind: 'unknown' };
  const entity = rows.length === 1 ? rows[0] : rows.find((r) => Number(r.is_whatsapp_default) === 1);
  if (!entity) return { kind: 'pick' };
  return { kind: 'member', entityType: entity.entity_type, entityId: entity.entity_id };
}

// The entity's own scope, as the site would send it, so the R32 D1
// matrix in user-org decides what it sees: a service provider sees
// services and no worker or housing ads, as on the site.
// x-user-is-admin is never sent: a phone number is not an admin login.
function searchHeaders({ entityType, entityId }) {
  return { 'x-user-role': entityType, 'x-entity-type': entityType, 'x-entity-id': entityId };
}

async function search(query, headers) {
  const resp = await fetch(`${USER_ORG_URL}/search`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify({ query: query.slice(0, SEARCH_QUERY_MAX) }),
    signal:  AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`POST ${USER_ORG_URL}/search answered ${resp.status}`);
  return resp.json();
}

// Hebrew names for the codes the search returns. They are edited in
// the database (three profession renames so far), so they are read
// from it rather than copied here. A code with no name is left out of
// the message: an English code in a Hebrew reply helps nobody.
async function loadLabels() {
  if (Date.now() - labels.loadedAt < LABELS_TTL_MS) return labels.value;
  try {
    const pool = getPool();
    const [[professions], [origins], [regions], [categories]] = await Promise.all([
      pool.query('SELECT code, name_he FROM worker_db.profession_types'),
      pool.query('SELECT code, name_he FROM worker_db.origin_countries'),
      pool.query('SELECT code, name_he FROM worker_db.regions'),
      pool.query('SELECT code, name_he FROM org_db.marketplace_categories'),
    ]);
    const byCode = (rows) => Object.fromEntries(rows.map((r) => [r.code, r.name_he]));
    labels = {
      loadedAt: Date.now(),
      value: {
        profession: byCode(professions),
        origin:     byCode(origins),
        region:     byCode(regions),
        category:   byCode(categories),
      },
    };
  } catch (err) {
    console.error('[whatsapp] label lookup failed, replying without names:', err.message);
  }
  return labels.value;
}

async function searchReply(sender, text) {
  if (Array.from(text).length < SEARCH_QUERY_MIN) {
    return composeReply({ query: text, search: {}, labels: NO_LABELS, frontendUrl: FRONTEND_URL });
  }

  const headers = searchHeaders(sender);
  let result;
  try {
    result = await search(text, headers);
  } catch (err) {
    console.error('[whatsapp] search failed:', err.message);
    return SEARCH_FAILED_REPLY;
  }
  console.log(
    `[whatsapp] search POST ${USER_ORG_URL}/search scope=${headers['x-entity-type']} ` +
    `ads=${(result.results || []).length} listings=${(result.marketplace_matches || []).length}`,
  );
  return composeReply({
    query: text, search: result, labels: await loadLabels(), frontendUrl: FRONTEND_URL,
  });
}

// R38 · a voice note becomes the text it says, kept on the inbound row
// as "[audio] <transcript>". Any failure is null: the caller answers
// with one line asking to type instead.
async function voiceToText(message, inboundId) {
  if (!sttKey()) {
    console.warn('[whatsapp] voice note, ELEVENLABS_API_KEY is not set');
    return null;
  }
  let transcript;
  try {
    const { bytes, mimeType } = await downloadMedia(message.audio?.id);
    transcript = await transcribe(bytes, mimeType);
  } catch (err) {
    console.error('[whatsapp] voice note not transcribed:', err.message);
    return null;
  }
  if (!transcript) {
    console.warn('[whatsapp] voice note transcribed to nothing');
    return null;
  }
  try {
    await getPool().query(
      'UPDATE support_messages SET message_text = ? WHERE id = ?',
      [`[audio] ${transcript}`, inboundId],
    );
  } catch (err) {
    console.error('[whatsapp] transcript not stored:', err.message);
  }
  console.log(`[whatsapp] voice note transcribed, ${Array.from(transcript).length} characters`);
  return transcript;
}

// Who the sender is decides the reply before what he sent does: an
// unregistered number or an unpicked entity gets its one line whatever
// the message was, and nothing is searched or transcribed for it.
async function replyFor(message, phone, text, inboundId) {
  let sender;
  try {
    sender = await identifySender(phone);
  } catch (err) {
    // Not knowing who wrote is not a reason to search for him.
    console.error('[whatsapp] sender lookup failed, no search:', err.message);
    return SEARCH_FAILED_REPLY;
  }
  if (sender.kind === 'unknown') return registerInviteReply(FRONTEND_URL);
  if (sender.kind === 'pick')    return pickEntityReply(FRONTEND_URL);
  if (message.type === 'audio') {
    const transcript = await voiceToText(message, inboundId);
    return transcript ? searchReply(sender, transcript) : VOICE_FAILED_REPLY;
  }
  if (message.type !== 'text')   return NON_TEXT_REPLY;
  return searchReply(sender, text);
}

async function handleInbound(message) {
  const phone = normalizePhone(message?.from);
  const wamid = message?.id;
  if (!phone || !wamid) {
    console.warn('[whatsapp] inbound message without a sender number or an id, ignored');
    return;
  }
  if (IGNORED_TYPES.has(message.type)) return;

  const isText = message.type === 'text';
  const text   = isText ? String(message.text?.body ?? '').trim() : `[${message.type}]`;
  const sentAt = Number(message.timestamp);
  const pool   = getPool();

  const inboundId = uuidv7();
  try {
    await pool.query(
      `INSERT INTO support_messages
         (id, channel, direction, peer_phone, message_text, message_uuid, received_at)
       VALUES (?, 'whatsapp', 'inbound', ?, ?, ?, ?)`,
      [inboundId, phone, text, wamid, sentAt ? new Date(sentAt * 1000) : null],
    );
  } catch (err) {
    // Meta redelivers webhooks. The unique index on message_uuid is
    // what makes the second copy stop here.
    if (err.code === 'ER_DUP_ENTRY') return;
    throw err;
  }

  const verdict = await rateLimitVerdict(inboundId);
  if (verdict === 'silent') {
    console.log(`[whatsapp] inbound ${wamid} is over the rate limit, no reply`);
    return;
  }

  const body = verdict === 'notice' ? RATE_LIMIT_REPLY : await replyFor(message, phone, text, inboundId);

  const sent = await sendMessage(phone, body, { channel: 'whatsapp' });
  await pool.query(
    `INSERT INTO support_messages
       (id, channel, direction, peer_phone, message_text, message_uuid, in_reply_to)
     VALUES (?, ?, 'outbound', ?, ?, ?, ?)`,
    [uuidv4(), sent.channel, phone, body, sent.messageId, inboundId],
  );
  console.log(`[whatsapp] inbound ${wamid} type=${message.type} verdict=${verdict}, replied ${sent.messageId}`);
}

module.exports = { handleInbound };
