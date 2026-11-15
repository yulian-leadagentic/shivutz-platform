// One inbound WhatsApp message in, at most one message out.
//
// Meta bills every message we send, so nothing here sends a second
// one: no "searching" notice, no retry, no follow-up.
const { v4: uuidv4, v7: uuidv7 } = require('uuid');
const { getPool }        = require('../db');
const { sendMessage }    = require('../messaging');
const { normalizePhone } = require('./phone');
const {
  composeReply, NON_TEXT_REPLY, RATE_LIMIT_REPLY, SEARCH_FAILED_REPLY,
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

// Search headers for the sender, by the R32 D1 matrix. Exactly one
// active membership, as a contractor or a corporation, searches with
// that entity's scope. Everyone else searches as an anonymous visitor.
// x-user-is-admin is never sent: a phone number is not an admin login.
async function identitySearchHeaders(phone) {
  const [rows] = await getPool().query(
    `SELECT em.entity_type, em.entity_id
       FROM auth_db.users u
       JOIN auth_db.entity_memberships em ON em.user_id = u.id
      WHERE u.phone = ?
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
        AND em.is_active = TRUE
        AND em.invitation_accepted_at IS NOT NULL`,
    [phone],
  );
  if (rows.length !== 1) return {};
  const { entity_type: entityType, entity_id: entityId } = rows[0];
  if (entityType !== 'contractor' && entityType !== 'corporation') return {};
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

async function searchReply(phone, text) {
  if (Array.from(text).length < SEARCH_QUERY_MIN) {
    return composeReply({ query: text, search: {}, labels: NO_LABELS, frontendUrl: FRONTEND_URL });
  }

  let headers = {};
  try {
    headers = await identitySearchHeaders(phone);
  } catch (err) {
    console.error('[whatsapp] sender lookup failed, searching as anonymous:', err.message);
  }

  let result;
  try {
    result = await search(text, headers);
  } catch (err) {
    console.error('[whatsapp] search failed:', err.message);
    return SEARCH_FAILED_REPLY;
  }
  console.log(
    `[whatsapp] search POST ${USER_ORG_URL}/search scope=${headers['x-entity-type'] || 'anonymous'} ` +
    `ads=${(result.results || []).length} listings=${(result.marketplace_matches || []).length}`,
  );
  return composeReply({
    query: text, search: result, labels: await loadLabels(), frontendUrl: FRONTEND_URL,
  });
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

  let body;
  if (verdict === 'notice') body = RATE_LIMIT_REPLY;
  else if (!isText)         body = NON_TEXT_REPLY;
  else                      body = await searchReply(phone, text);

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
