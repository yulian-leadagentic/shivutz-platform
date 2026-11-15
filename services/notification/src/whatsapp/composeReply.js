// The one message a WhatsApp search gets back.
//
// Structured fields only. Titles, descriptions and addresses are free
// text the advertiser wrote and can name the corporation or provider,
// and the chat never identifies either: reveal happens on the site.

const NON_TEXT_REPLY      = 'כרגע אני מבין רק הודעות טקסט. מה אתם מחפשים?';
const RATE_LIMIT_REPLY    = 'קיבלתי כמה הודעות, עונה על האחרונה';
const SEARCH_FAILED_REPLY = 'לא הצלחתי לחפש כרגע, נסו שוב עוד רגע';

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
  const hidden = (search.hidden_types || []).length > 0
    ? `מודעות עובדים ודיור זמינות לקבלנים רשומים: ${frontendUrl}/register/contractor`
    : null;
  const onlyServices = ads.length === 0 && listings.length > 0;
  const link = `${frontendUrl}/?q=${encodeURIComponent(q)}${onlyServices ? '&type=services' : ''}`;

  let shown = ordered.slice(0, MAX_RESULTS);
  const build = () => [head, ...shown, hidden, link].filter(Boolean).join('\n');
  let message = build();
  while (message.length >= MAX_LENGTH && shown.length > 1) {
    shown = shown.slice(0, -1);
    message = build();
  }
  return message;
}

module.exports = {
  composeReply,
  NON_TEXT_REPLY,
  RATE_LIMIT_REPLY,
  SEARCH_FAILED_REPLY,
  MAX_LENGTH,
};
