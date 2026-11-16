// R35 §4.5 · the one reply a WhatsApp search gets.
//
// Three rules from the spec are what this file holds in place:
//   1. under 1,000 characters, whatever the search returned
//   2. nothing that identifies a corporation or a provider, for anyone
//   3. it always ends with the link to the site
//
// The fixtures below are shaped like the real POST /search response
// (user-org routes/search.py: _serialize_ad and
// _serialize_marketplace_listing), plus fields that response does NOT
// carry today (contact_phone, corporation_name, owner name). Those
// extra fields are there on purpose: if the search ever starts
// returning them, the chat must still not print them.
//
// Run: node test/whatsapp-compose.test.js

const { check, finish, load } = require('./helpers');

const { composeReply, MAX_LENGTH } = load('whatsapp/composeReply');

const FRONTEND = 'https://staging.tagidai.com';
const labels = {
  profession: { flooring: 'ריצוף', plastering: 'טיח' },
  origin:     { CN: 'סין', IN: 'הודו' },
  region:     { center: 'מרכז', north: 'צפון' },
  category:   { equipment: 'ציוד וכלי עבודה', housing: 'דיור להשכרה' },
};

// Every string here would identify the advertiser if it reached the chat.
const SECRETS = [
  'כוח אדם הצפון בע"מ', 'SECRET-TITLE', 'SECRET-BODY', 'רחוב הסוד 7', '03-5550000', '0505550000',
  'corp-11111111', 'SECRET-LISTING-TITLE', 'SECRET-DESCRIPTION', 'דני הספק', 'SECRET-SUBCATEGORY',
];

function workerAd(over = {}) {
  return {
    id: 'ad-w1', ad_type: 'worker', title_he: 'SECRET-TITLE כוח אדם הצפון בע"מ', body_he: 'SECRET-BODY 03-5550000',
    region: 'center', trust_level: 'verified', owner_entity_id: 'corp-11111111',
    profession_code: 'flooring', origin_country: 'CN', quantity: 20,
    experience_min_months: 12, visa_valid_until: '2027-01-01', languages: ['he'],
    corp_name: 'כוח אדם הצפון בע"מ', contact_phone: '0505550000',
    ...over,
  };
}
function housingAd(over = {}) {
  return {
    id: 'ad-h1', ad_type: 'housing', title_he: 'SECRET-TITLE', body_he: 'SECRET-BODY', region: 'north',
    trust_level: 'registered', owner_entity_id: 'corp-11111111',
    city: 'חיפה', address_he: 'רחוב הסוד 7', total_beds: 12, available_beds: 8, price_per_bed_nis: 950,
    amenities: ['wifi'], photos: null,
    ...over,
  };
}
function listing(over = {}) {
  return {
    id: 'ml-1', is_corporation_verified: true, category: 'equipment', subcategory: 'SECRET-SUBCATEGORY',
    title: 'SECRET-LISTING-TITLE', description: 'SECRET-DESCRIPTION 03-5550000', city: 'נתניה', region: 'center',
    price: 1200, price_unit: 'per_month', capacity: null, images_json: null, status: 'active',
    contact_phone: '0505550000', contact_name: 'דני הספק', corporation_name: 'כוח אדם הצפון בע"מ', corporation_id: 'corp-11111111',
    ...over,
  };
}

function compose(search, query = '20 פועלים סינים במרכז') {
  return composeReply({ query, search, labels, frontendUrl: FRONTEND });
}
const lines = (message) => message.split('\n');
const lastLine = (message) => lines(message).at(-1);
function noSecrets(name, message) {
  const leaked = SECRETS.filter((s) => message.includes(s));
  check(`${name}: nothing that identifies the advertiser`, leaked.length === 0, leaked);
}
function underLimit(name, message) {
  check(`${name}: under 1,000 characters (${message.length})`, message.length < MAX_LENGTH && MAX_LENGTH === 1000);
}

// ── workers ────────────────────────────────────────────────────────
{
  const message = compose({
    filters: { ad_type: 'worker', profession_code: 'flooring', origin_country: 'CN', region: 'center', quantity: 20 },
    results: [workerAd(), workerAd({ id: 'ad-w2', quantity: 12, origin_country: 'IN' })],
    marketplace_matches: [], primary_section: 'ads', hidden_types: [],
  });
  const l = lines(message);
  check('workers: the title says what was understood', l[0] === 'חיפשתם: ריצוף · סין · מרכז · כמות 20', l[0]);
  check('workers: a result is profession · origin · region · quantity', l[1] === '• עובדים: ריצוף · סין · מרכז · 20', l[1]);
  check('workers: the second result is its own line', l[2] === '• עובדים: ריצוף · הודו · מרכז · 12', l[2]);
  check('workers: ends with the link, query encoded', lastLine(message) === `${FRONTEND}/?q=${encodeURIComponent('20 פועלים סינים במרכז')}`, lastLine(message));
  check('workers: no register line for a viewer who can see everything', !message.includes('/register/'));
  check('workers: no &type=services when ads came back', !message.includes('type=services'));
  noSecrets('workers', message);
  underLimit('workers', message);
}

// ── housing ────────────────────────────────────────────────────────
{
  const message = compose({
    filters: { ad_type: 'housing', region: 'north', quantity: 8 },
    results: [housingAd()],
    marketplace_matches: [listing({ category: 'housing', city: 'עכו', capacity: 6 })],
    primary_section: 'ads', hidden_types: [],
  }, 'דיור ל-8 עובדים בצפון');
  const l = lines(message);
  check('housing: the title names housing and the filters', l[0] === 'חיפשתם: דיור · צפון · כמות 8', l[0]);
  check('housing: an ad is city · beds', l[1] === '• דיור: חיפה · 8 מיטות', l[1]);
  check('housing: a marketplace housing listing is city · capacity', l[2] === '• דיור: עכו · עד 6 עובדים', l[2]);
  check('housing: the street address is not printed', !message.includes('רחוב'));
  noSecrets('housing', message);
  underLimit('housing', message);
}

// ── services ───────────────────────────────────────────────────────
{
  const message = compose({
    filters: { ad_type: 'worker' },
    results: [],
    marketplace_matches: [listing(), listing({ id: 'ml-2', city: null, region: 'north' })],
    primary_section: 'marketplace', hidden_types: ['workers', 'housing'],
  }, 'השכרת ציוד');
  const l = lines(message);
  check('services: with no filter understood the title repeats the query', l[0] === 'חיפשתם: השכרת ציוד', l[0]);
  check('services: a result is category · area (city)', l[1] === '• שירות: ציוד וכלי עבודה · נתניה', l[1]);
  check('services: area falls back to the region name', l[2] === '• שירות: ציוד וכלי עבודה · צפון', l[2]);
  check('services: hidden types add the register line, worded as the spec has it',
    l[3] === `מודעות עובדים ודיור זמינות לקבלנים רשומים: ${FRONTEND}/register/contractor`, l[3]);
  check('services: only services came back, so the link carries &type=services',
    lastLine(message) === `${FRONTEND}/?q=${encodeURIComponent('השכרת ציוד')}&type=services`, lastLine(message));
  noSecrets('services', message);
  underLimit('services', message);
}

// ── section order and the cap of five ──────────────────────────────
{
  const ads = Array.from({ length: 4 }, (_, i) => workerAd({ id: `w${i}`, quantity: i + 1 }));
  const listings = Array.from({ length: 4 }, (_, i) => listing({ id: `m${i}`, city: `עיר${i}` }));
  const adsFirst = lines(compose({ filters: { ad_type: 'worker', profession_code: 'flooring' }, results: ads, marketplace_matches: listings, primary_section: 'ads', hidden_types: [] }));
  const results = adsFirst.filter((x) => x.startsWith('• '));
  check('at most five results are listed', results.length === 5, results.length);
  check('primary_section=ads puts the ads first', results.slice(0, 4).every((x) => x.startsWith('• עובדים')) && results[4].startsWith('• שירות'));
  const marketFirst = lines(compose({ filters: { ad_type: 'worker' }, results: ads, marketplace_matches: listings, primary_section: 'marketplace', hidden_types: [] }))
    .filter((x) => x.startsWith('• '));
  check('primary_section=marketplace puts the services first', marketFirst.slice(0, 4).every((x) => x.startsWith('• שירות')) && marketFirst[4].startsWith('• עובדים'));
  check('ads and services together: the link carries no &type=services', !adsFirst.at(-1).includes('type=services') && adsFirst.at(-1).startsWith(FRONTEND), adsFirst.at(-1));
}

// ── zero results ───────────────────────────────────────────────────
{
  const query = 'מנוף צריח בערבה';
  const message = compose({ filters: { ad_type: 'worker' }, results: [], marketplace_matches: [], primary_section: 'ads', hidden_types: [] }, query);
  const l = lines(message);
  check('zero results: the sentence is the spec\'s, with the query in it',
    l[0] === `לא מצאתי התאמות ל־${query}. אפשר לנסח אחרת, למשל: 10 רצפים במרכז`, l[0]);
  check('zero results: the hyphen after ל is the Hebrew maqaf, not a dash', l[0].includes('ל־'));
  check('zero results: then the link and nothing else', l.length === 2 && l[1] === `${FRONTEND}/?q=${encodeURIComponent(query)}`, l);
  underLimit('zero results', message);

  const anonymous = compose({ filters: {}, results: [], marketplace_matches: [], hidden_types: ['workers', 'housing'] }, query);
  const a = lines(anonymous);
  check('zero results, anonymous viewer: sentence, register line, link',
    a.length === 3 && a[1].startsWith('מודעות עובדים ודיור זמינות לקבלנים רשומים: ') && a[2].startsWith(`${FRONTEND}/?q=`), a);

  const empty = composeReply({ query: 'x', search: {}, labels, frontendUrl: FRONTEND });
  check('a search object with nothing in it still composes', lines(empty).length === 2 && empty.startsWith('לא מצאתי התאמות ל־x.'), empty);
}

// ── hidden types ───────────────────────────────────────────────────
{
  const pending = compose({
    filters: { ad_type: 'housing' }, results: [housingAd()], marketplace_matches: [], primary_section: 'ads',
    viewer_approval_status: 'pending', hidden_types: ['workers'],
  }, 'דיור בחיפה');
  check('hidden types: a pending contractor (workers hidden) gets the register line once',
    pending.split('מודעות עובדים ודיור זמינות לקבלנים רשומים: ').length === 2);
  check('hidden types: the register line sits just above the link',
    lines(pending).at(-2).endsWith('/register/contractor') && lastLine(pending).startsWith(`${FRONTEND}/?q=`));
  noSecrets('hidden types', pending);
  underLimit('hidden types', pending);

  const open = compose({ filters: { ad_type: 'housing' }, results: [housingAd()], marketplace_matches: [], hidden_types: [] }, 'דיור בחיפה');
  check('hidden types: an empty list adds no register line', !open.includes('/register/'));
}

// ── codes without a Hebrew name ────────────────────────────────────
{
  const message = composeReply({
    query: 'רצפים',
    search: { filters: { ad_type: 'worker', profession_code: 'flooring' }, results: [workerAd()], marketplace_matches: [listing()], hidden_types: [] },
    labels: { profession: {}, origin: {}, region: {}, category: {} },
    frontendUrl: FRONTEND,
  });
  check('no labels: raw codes never reach a Hebrew message', !/flooring|\bCN\b|center|equipment/.test(message), message);
  check('no labels: the result lines keep what can still be said', message.includes('• עובדים: 20') && message.includes('• שירות: נתניה'), message);
}

// ── length, with hostile input ─────────────────────────────────────
{
  const longCity = 'קריית '.repeat(40);
  const search = {
    filters: { ad_type: 'worker', profession_code: 'flooring', origin_country: 'CN', region: 'center', quantity: 9999 },
    results: Array.from({ length: 50 }, (_, i) => workerAd({ id: `w${i}`, quantity: 9999 })),
    marketplace_matches: Array.from({ length: 20 }, (_, i) => listing({ id: `m${i}`, city: longCity })),
    primary_section: 'ads', hidden_types: ['workers', 'housing'],
  };
  // Names far longer than any real one, on every field of every line:
  // five such lines alone would pass the limit.
  const longLabels = {
    profession: { flooring: 'ריצוף '.repeat(30) },
    origin:     { CN: 'סין '.repeat(30) },
    region:     { center: 'מרכז '.repeat(30) },
    category:   { equipment: 'ציוד '.repeat(30) },
  };
  for (const [name, query] of [
    ['500 Hebrew letters', 'ש'.repeat(500)],
    ['500 emoji', '🏗️'.repeat(250)],
    ['a query of newlines and tabs', 'רצפים\n\n\t  במרכז\r\nדחוף'],
    ['a lone surrogate', `רצפים \uD83D במרכז`],
  ]) {
    let message;
    let threw = null;
    try {
      message = composeReply({ query, search, labels: longLabels, frontendUrl: FRONTEND });
    } catch (err) {
      threw = err;
    }
    check(`${name}: composes without throwing`, threw === null, threw && threw.message);
    if (!message) continue;
    underLimit(name, message);
    check(`${name}: still ends with the link`, lastLine(message).startsWith(`${FRONTEND}/?q=`), lastLine(message));
    check(`${name}: the link is a valid URL`, URL.canParse(lastLine(message)));
    const kept = lines(message).filter((x) => x.startsWith('• ')).length;
    check(`${name}: results were dropped to fit, and at least one is kept (${kept} of 5)`, kept >= 1 && kept < 5, kept);
    check(`${name}: the register line survives the trimming`, message.includes('/register/contractor'));
  }
  const tidy = composeReply({ query: 'רצפים\n\n\t  במרכז', search: { results: [], marketplace_matches: [] }, labels, frontendUrl: FRONTEND });
  check('whitespace in the query is collapsed, so the reply stays two lines', lines(tidy).length === 2 && tidy.includes('ל־רצפים במרכז.'), tidy);
}

// ── no em dash in anything sent to a user ──────────────────────────
{
  const all = [
    compose({ filters: {}, results: [workerAd(), housingAd()], marketplace_matches: [listing()], hidden_types: ['workers'] }),
    compose({ results: [], marketplace_matches: [] }),
    load('whatsapp/composeReply').NON_TEXT_REPLY,
    load('whatsapp/composeReply').RATE_LIMIT_REPLY,
    load('whatsapp/composeReply').SEARCH_FAILED_REPLY,
    load('whatsapp/composeReply').pickEntityReply(FRONTEND),
  ].join('\n');
  check('no em dash in any user-facing string', !all.includes(String.fromCharCode(0x2014)));
  check('the fixed replies are worded as the spec has them',
    load('whatsapp/composeReply').NON_TEXT_REPLY === 'כרגע אני מבין רק הודעות טקסט. מה אתם מחפשים?'
    && load('whatsapp/composeReply').RATE_LIMIT_REPLY === 'קיבלתי כמה הודעות, עונה על האחרונה'
    && load('whatsapp/composeReply').SEARCH_FAILED_REPLY === 'לא הצלחתי לחפש כרגע, נסו שוב עוד רגע');
}

// ── R38 · several accounts, none picked for WhatsApp ───────────────
{
  const message = load('whatsapp/composeReply').pickEntityReply(FRONTEND);
  check('pick reply: one line, ends with the link to the card', !message.includes('\n') && message.endsWith(`${FRONTEND}/billing#whatsapp`), message);
  check('pick reply: the link is the only URL in it, so the preview card opens the card', message.match(/https?:\/\//g).length === 1, message);
}

finish('whatsapp-compose');
