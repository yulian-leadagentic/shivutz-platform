// The one message a WhatsApp search gets back, and the fixed lines the
// chat answers with when it does not search.
//
// Structured fields only. Titles, descriptions and addresses are free
// text the advertiser wrote and can name the corporation or provider,
// and the chat never identifies either: reveal happens on the site.

const NON_TEXT_REPLY      = 'כרגע אני מבין רק הודעות טקסט. מה אתם מחפשים?';
const RATE_LIMIT_REPLY    = 'קיבלתי כמה הודעות, עונה על האחרונה';
const SEARCH_FAILED_REPLY = 'לא הצלחתי לחפש כרגע, נסו שוב עוד רגע';
const VOICE_FAILED_REPLY  = 'לא הצלחתי להבין את ההודעה הקולית, נסו לכתוב במקום';

// R38 · a user with several accounts and none picked for WhatsApp. The
// link opens the card where he picks (frontend WhatsAppEntityCard).
function pickEntityReply(frontendUrl) {
  return `המספר הזה משויך לכמה חשבונות. בחרו באתר את החשבון לוואטסאפ: ${frontendUrl}/billing#whatsapp`;
}

// R38 · WhatsApp is for registered users. A number no user holds gets
// this and no search. /#register is the role picker on the home page,
// the target of the site's own "הצטרף עכשיו".
function registerInviteReply(frontendUrl) {
  return `החיפוש בוואטסאפ פתוח למשתמשים רשומים. להרשמה: ${frontendUrl}/#register`;
}

const MAX_LENGTH  = 1000;
const MAX_RESULTS = 5;
const FIELD_SHOWN = 40;
const QUERY_SHOWN = 60;
// A Hebrew letter is six characters once URL-encoded and an emoji is
// twelve, so the query is capped by its encoded size as well.
const QUERY_ENCODED_MAX = 360;

function clean(value) {
  return String(value ?? '').toWellFormed().replace(/\s+/g, ' ').trim();
}

function clip(value, max) {
  return Array.from(clean(value)).slice(0, max).join('').trim();
}

function clipQuery(query) {
  let out = '';
  for (const ch of clean(query)) {
    if (out.length + ch.length > QUERY_SHOWN) break;
    if (encodeURIComponent(out + ch).length > QUERY_ENCODED_MAX) break;
    out += ch;
  }
  return out.trim();
}

function line(kind, fields) {
  const shown = fields.map((f) => clip(f, FIELD_SHOWN)).filter(Boolean);
  return `• ${kind}${shown.length ? `: ${shown.join(' · ')}` : ''}`;
}

function workerLine(ad, labels) {
  return line('עובדים', [
    labels.profession[ad.profession_code],
    labels.origin[ad.origin_country],
    labels.region[ad.region],
    ad.quantity > 0 ? ad.quantity : null,
  ]);
}

function housingLine(ad) {
  return line('דיור', [ad.city, ad.available_beds > 0 ? `${ad.available_beds} מיטות` : null]);
}

function listingLine(listing, labels) {
  const area = listing.city || labels.region[listing.region];
  if (listing.category === 'housing') {
    return line('דיור', [area, listing.capacity > 0 ? `עד ${listing.capacity} עובדים` : null]);
  }
  return line('שירות', [labels.category[listing.category], area]);
}

function titleLine(filters, query, labels) {
  const understood = [
    filters.ad_type === 'housing' ? 'דיור' : null,
    labels.profession[filters.profession_code],
    labels.origin[filters.origin_country],
    labels.region[filters.region],
    filters.quantity > 0 ? `כמות ${filters.quantity}` : null,
  ].map((part) => clip(part, FIELD_SHOWN)).filter(Boolean);
  return `חיפשתם: ${understood.length ? understood.join(' · ') : query}`;
}

// What the viewer's scope hid (hidden_types). Every searched sender is
// registered (R38), so the sign-up line is for one who is not a
// contractor (a service provider). A contractor in review is told the
// worker ads open on approval, with no link; one rejected or suspended
// gets no line.
function hiddenLine(search, frontendUrl) {
  if ((search.hidden_types || []).length === 0) return null;
  if (search.viewer_approval_status === 'pending') return 'מודעות עובדים יוצגו אחרי אישור החשבון';
  if (search.viewer_approval_status) return null;
  return `מודעות עובדים ודיור זמינות לקבלנים רשומים: ${frontendUrl}/register/contractor`;
}

function composeReply({ query, search, labels, frontendUrl }) {
  const q        = clipQuery(query);
  const ads      = search.results || [];
  const listings = search.marketplace_matches || [];

  const adLines      = ads.map((ad) => (ad.ad_type === 'housing' ? housingLine(ad) : workerLine(ad, labels)));
  const listingLines = listings.map((listing) => listingLine(listing, labels));
  const ordered      = search.primary_section === 'marketplace'
    ? [...listingLines, ...adLines]
    : [...adLines, ...listingLines];

  const head = ordered.length === 0
    ? `לא מצאתי התאמות ל־${q}. אפשר לנסח אחרת, למשל: 10 רצפים במרכז`
    : titleLine(search.filters || {}, q, labels);
  const hidden = hiddenLine(search, frontendUrl);
  const onlyServices = ads.length === 0 && listings.length > 0;
  const link = `${frontendUrl}/?q=${encodeURIComponent(q)}${onlyServices ? '&type=services' : ''}`;

  // R38 · the search link comes before any other: WhatsApp builds the
  // preview card from the first link in a message.
  let shown = ordered.slice(0, MAX_RESULTS);
  const build = () => [head, ...shown, link, hidden].filter(Boolean).join('\n');
  let message = build();
  while (message.length >= MAX_LENGTH && shown.length > 1) {
    shown = shown.slice(0, -1);
    message = build();
  }
  return message;
}

module.exports = {
  composeReply,
  pickEntityReply,
  registerInviteReply,
  NON_TEXT_REPLY,
  RATE_LIMIT_REPLY,
  SEARCH_FAILED_REPLY,
  VOICE_FAILED_REPLY,
  MAX_LENGTH,
};
