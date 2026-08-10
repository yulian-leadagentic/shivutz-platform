// Deterministic Hebrew fixtures for staging seed.
//
// Reserved phone range: `+972525-9XX-XXX` (all seed phones start with
// +9725259). The admin `+972525278625` is `+972525-278-625` — no
// collision. All numeric IDs are computed from a base + index so
// re-runs produce identical values (idempotent).
//
// Business number checksum (Israeli mod-10) is enforced at the
// backend — `israeliIdWithChecksum(seed)` below generates valid IDs
// from a monotonic seed.
//
// Enum values match the app's live enums (see services/user-org's
// origins + professions + regions catalogs). If a NEW enum ships,
// update this file — the backend will reject unknown values.

// ── Guard: any consumer that iterates these must abort if a phone
// doesn't start with 0525-9. The runner also verifies before POST.
export const SEED_PHONE_PREFIX = '+972525900'; // → 0525-900-XXX
                                              //   (real users: 0525-2xx…)

/** Deterministic Israeli-ID checksum-valid 9-digit generator.
 *  Takes any integer seed, walks upward until checksum passes. */
export function israeliIdWithChecksum(seedInt) {
  const isValid = (digits) => {
    if (digits.length !== 9) return false;
    let total = 0;
    for (let i = 0; i < 9; i++) {
      let n = parseInt(digits[i], 10) * (i % 2 === 0 ? 1 : 2);
      if (n > 9) n -= 9;
      total += n;
    }
    return total % 10 === 0;
  };
  let v = seedInt;
  for (let bump = 0; bump < 100; bump++, v++) {
    const s = String(v).padStart(9, '0');
    if (isValid(s)) return s;
  }
  throw new Error(`Could not find valid Israeli ID near ${seedInt}`);
}

/** Phone at index N (0-based): `+972525-900-NNN` — safe seed range. */
export function seedPhone(n) {
  return SEED_PHONE_PREFIX + String(n).padStart(3, '0');
}

// ── Regions (must match live enum) ─────────────────────────────────
export const REGIONS = ['north', 'center', 'south', 'jerusalem', 'national'];

// ── Profession codes (must match live enum) ────────────────────────
export const PROFESSIONS = [
  'flooring', 'plastering', 'scaffolding', 'formwork', 'mason',
  'skeleton', 'painting', 'plumbing', 'general', 'electrician',
];

// ── Origin countries (must match live enum) ────────────────────────
export const ORIGINS = ['CN', 'IN', 'UA', 'MD', 'LK', 'TH', 'UZ'];

// ── Israeli cities (housing ads) ───────────────────────────────────
export const CITIES = [
  'תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'פתח תקווה',
  'ראשון לציון', 'נתניה', 'רחובות',
];

// ── 15 contractors (Hebrew company names, mixed regions) ───────────
// business_number base = 590000000 (seed range, valid checksums
// computed by the generator).
export const CONTRACTORS = [
  { i:  0, name_he: 'בונים חכם בע"מ',          contact: 'רון לוי',        regions: ['center'], kablan: '10001', verified: true  },
  { i:  1, name_he: 'שיפוץ מהיר צפון',         contact: 'משה כהן',        regions: ['north'], kablan: '10002', verified: true  },
  { i:  2, name_he: 'קבלני הנגב',               contact: 'יעל ברק',        regions: ['south'], kablan: '10003', verified: true  },
  { i:  3, name_he: 'ירושלים בנייה איכותית',    contact: 'אבי גולדשטיין',  regions: ['jerusalem'], kablan: '10004', verified: true  },
  { i:  4, name_he: 'שרון פרויקטים',            contact: 'טל אזולאי',      regions: ['center'], kablan: '10005', verified: true  },
  { i:  5, name_he: 'בית ובניין',                contact: 'שירה מור',       regions: ['center'], kablan: '10006', verified: false },
  { i:  6, name_he: 'חכים ובנים',                contact: 'ניר חכים',       regions: ['north'], kablan: '10007', verified: false },
  { i:  7, name_he: 'קבוצת הרצל',                contact: 'עידן הרצל',      regions: ['center', 'north'], kablan: '10008', verified: false },
  { i:  8, name_he: 'שילת בנייה',                contact: 'רונית שילת',     regions: ['south'], kablan: '10009', verified: false },
  { i:  9, name_he: 'טופ קבלנים',                contact: 'שי בן דוד',      regions: ['jerusalem'], kablan: '10010', verified: false },
  { i: 10, name_he: 'אורי קבלנים חדשים',        contact: 'אורי דנן',       regions: ['center'], kablan: '10011', verified: false },
  { i: 11, name_he: 'שילוב הנדסה',              contact: 'מירב שילוב',     regions: ['north'], kablan: '10012', verified: false },
  { i: 12, name_he: 'צפון פרויקטים',            contact: 'ליאור צפוני',    regions: ['north', 'jerusalem'], kablan: '10013', verified: false },
  { i: 13, name_he: 'הנגב בונה',                 contact: 'דניאל הנגבי',    regions: ['south'], kablan: '10014', verified: false },
  { i: 14, name_he: 'קבוצת אחים דיין',          contact: 'עומר דיין',      regions: ['center', 'south'], kablan: '10015', verified: false },
];

// ── 10 corporations (with ח.פ starting at 591000000) ───────────────
export const CORPORATIONS = [
  { i:  0, name_he: 'כוח אדם גלובל',            contact: 'איתן שטרן',      origins: ['CN', 'UA'],       min_months: 3, verified: true  },
  { i:  1, name_he: 'עובדים בינלאומיים בע"מ',   contact: 'ליאת רוזן',      origins: ['UA', 'MD'],       min_months: 3, verified: true  },
  { i:  2, name_he: 'ידיים בעבודה',             contact: 'עדי חנן',        origins: ['CN', 'TH'],       min_months: 6, verified: true  },
  { i:  3, name_he: 'תאגיד השרון',              contact: 'רונן שרוני',     origins: ['IN', 'LK'],       min_months: 6, verified: true  },
  { i:  4, name_he: 'סקאי מנפאואר',              contact: 'אלון סקאי',      origins: ['CN', 'IN', 'UA'], min_months: 3, verified: false },
  { i:  5, name_he: 'ג.פ העסקה',                contact: 'גיא פרידמן',     origins: ['UA'],             min_months: 3, verified: false },
  { i:  6, name_he: 'עובדי חוץ תל אביב',        contact: 'איריס בן צור',   origins: ['CN', 'MD'],       min_months: 3, verified: false },
  { i:  7, name_he: 'מנפאואר ישראל',             contact: 'טל מנצור',       origins: ['UA', 'UZ'],       min_months: 3, verified: false },
  { i:  8, name_he: 'תאגיד הצפון לעובדים',      contact: 'הדס יערי',       origins: ['TH', 'IN'],       min_months: 6, verified: false },
  { i:  9, name_he: 'ג׳י אנד ג׳י כוח אדם',      contact: 'גל גורדון',      origins: ['CN', 'UA', 'MD'], min_months: 3, verified: false },
];

// ── 50 worker ads (spread over the 10 corps, mixed states) ─────────
// generated below by expanding a template so we don't repeat 50 obj
// literals by hand.
function _mkAdTemplate() {
  const out = [];
  let idx = 0;
  for (let corpI = 0; corpI < 10; corpI++) {
    // 5 ads per corp on average.
    for (let a = 0; a < 5; a++) {
      const prof = PROFESSIONS[idx % PROFESSIONS.length];
      const origin = ORIGINS[idx % ORIGINS.length];
      const region = REGIONS[idx % REGIONS.length];
      const qty = 2 + (idx % 8);          // 2..9
      const expMonths = [6, 12, 24, 36, 60][idx % 5];
      // ~15% of ads get boosted for the promoted-carousel test.
      const boosted = idx % 7 === 0;
      out.push({
        i: idx,
        corpI,
        ad_type: 'worker',
        title_he: `${qty} ${_profLabelHe(prof)} מ${_originLabelHe(origin)} · ${_regionLabelHe(region)}`,
        body_he:  `זמינים מיידית. ניסיון ${expMonths} חודשים+ בפרויקטים בישראל. ויזה בתוקף.`,
        profession_code:       prof,
        origin_country:        origin,
        region:                region,
        quantity:              qty,
        experience_min_months: expMonths,
        boosted,
      });
      idx++;
      if (idx >= 50) return out;
    }
  }
  return out;
}
function _profLabelHe(p) {
  return ({ flooring: 'ריצוף', plastering: 'טייחים', scaffolding: 'רתכים', formwork: 'תפסנים',
    mason: 'בנאים', skeleton: 'ברזלנים', painting: 'צבעים', plumbing: 'אינסטלטורים',
    general: 'פועלים כלליים', electrician: 'חשמלאים' })[p] ?? p;
}
function _originLabelHe(o) {
  return ({ CN: 'סין', IN: 'הודו', UA: 'אוקראינה', MD: 'מולדובה',
    LK: 'סרי לנקה', TH: 'תאילנד', UZ: 'אוזבקיסטן' })[o] ?? o;
}
function _regionLabelHe(r) {
  return ({ north: 'צפון', center: 'מרכז', south: 'דרום',
    jerusalem: 'ירושלים', national: 'ארצי' })[r] ?? r;
}
export const WORKER_ADS = _mkAdTemplate();

// ── 10 housing ads (spread over 5 corps) ───────────────────────────
export const HOUSING_ADS = Array.from({ length: 10 }).map((_, i) => {
  const city = CITIES[i % CITIES.length];
  const beds = 4 + (i % 6);        // 4..9
  const price = 800 + (i % 4) * 100; // 800..1100
  const boosted = i % 5 === 0;      // 2 of 10 boosted
  return {
    i,
    corpI: i % 5,   // spread over first 5 corps
    ad_type: 'housing',
    title_he: `${beds} מיטות פנויות ב${city}`,
    body_he:  `מזרן חדש, חשמל, אינטרנט. נקי ומטופל. זמין מיידית.`,
    city,
    total_beds: beds + 2,
    available_beds: beds,
    price_per_bed_nis: price,
    boosted,
  };
});
