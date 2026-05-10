import type { Profession } from '@/types';
import type { Origin, Region } from './types';

/** Column headers for the Excel template (order matters).
 *
 * Wave 2 (2026-05) per key-user feedback: dropped "אזור זמינות" — the
 * corporation's regions cover that. profession is the only required
 * column; everything else is informational and accepts blanks. */
export const EXCEL_COLUMNS = [
  'שם פרטי', 'שם משפחה', 'מקצוע (קוד)', 'טווח ניסיון',
  'מדינת מוצא (קוד)', 'ויזה תוקף עד', 'מספר עובד',
];

// Wave 4: example row uses real profession + origin codes from the DB
// (001_initial_schema.sql seed). The previous example used "carpenter"
// which isn't a valid profession code, so importers who left the
// example row in their file got a "מקצוע לא תקין" error on row 1.
export const EXCEL_EXAMPLE = [
  'יוחנן', 'כהן', 'plastering', '12-24', 'RO', '2026-12-31', 'W-0042',
];

const VALID_EXPERIENCE_RANGES = new Set(['0-6', '6-12', '12-24', '24-36', '36+']);

export interface ExcelRow {
  first_name: string;
  last_name: string;
  profession_type: string;
  experience_range: string;
  origin_country: string;
  visa_valid_until: string;
  employee_number: string;
  _valid: boolean;
  _errors: string[];
}

/** Download a CSV template — header row + a single example row, nothing
 * else. Per key-user feedback (2026-05) the prior template's giant
 * reference-code blocks were noise — corps know what code to type. The
 * column-validation pass on import names legal codes when something
 * doesn't match. */
export function downloadTemplate(_professions: Profession[], _origins: Origin[], _regions: Region[]): void {
  const rows: string[][] = [EXCEL_COLUMNS, EXCEL_EXAMPLE];
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'תבנית_עובדים.csv'; a.click();
  URL.revokeObjectURL(url);
}

/** Naive CSV line-splitter with quote-awareness (no multi-line escaping). */
export function parseCSV(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((line) => {
    const cells: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ; }
      else if (line[i] === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else { cur += line[i]; }
    }
    cells.push(cur.trim());
    return cells;
  });
}

/** Hand-curated aliases for the common Hebrew variations users type
 * into the Excel "מקצוע" column. The DB seed uses one canonical form
 * (e.g. "ריצוף" — the activity), but importers naturally write the
 * worker form (רצף / רצפים) or alternate spellings. Mapping these to
 * the canonical code unblocks the import without forcing the user to
 * memorize the exact DB value. Add new entries here when feedback
 * surfaces them — cheaper than chasing alias support into the schema. */
const PROFESSION_ALIASES: Record<string, string> = {
  // flooring
  'רצף': 'flooring', 'רצפים': 'flooring', 'רצפן': 'flooring', 'רצפנים': 'flooring',
  'ריצוף ופרקט': 'flooring', 'פרקט': 'flooring',
  // plastering
  'טייח': 'plastering', 'טייחים': 'plastering', 'טיחים': 'plastering',
  // scaffolding
  'פיגומאי': 'scaffolding', 'פיגומאים': 'scaffolding', 'פיגום': 'scaffolding',
  // formwork
  'תפסן': 'formwork', 'תפסנים': 'formwork', 'נגרי תפסנות': 'formwork',
  // skeleton
  'שלדים': 'skeleton', 'בנאי שלד': 'skeleton', 'בנאים': 'skeleton',
  // painting
  'צבעי': 'painting', 'צבעים': 'painting', 'צבעות': 'painting',
  // electricity
  'חשמלאי': 'electricity', 'חשמלאים': 'electricity',
  // plumbing
  'אינסטלטור': 'plumbing', 'אינסטלטורים': 'plumbing', 'שרברב': 'plumbing', 'שרברבים': 'plumbing',
  // general
  'כללית': 'general', 'עובד כללי': 'general', 'פועל': 'general', 'פועלים': 'general',
};

/** Validate parsed rows. Wave 2: only first_name / last_name / profession
 * are required. experience_range / origin_country / visa_valid_until
 * accept blank ("לא צויין"); we only flag a value that's PRESENT but
 * malformed (e.g. an unknown code).
 *
 * Wave 4 (2026-05-07): also accept the Hebrew name (e.g. "טיח") in
 * addition to the code (e.g. "plastering"); we silently translate to
 * the code so old corp Excel sheets that wrote Hebrew don't break.
 * Error messages now list the valid codes so the user can self-correct
 * without leaving the page.
 *
 * Wave 5 (2026-05-10): forgiving profession matching:
 *   - try each comma- or slash-separated piece independently
 *     (so "ריצוף, פרקט" picks the first valid match)
 *   - case-insensitive code match
 *   - hand-curated alias map for common worker-form / plural Hebrew
 *     names (רצפים, טייחים, חשמלאי, ...) that the seed only knows by
 *     activity-form (ריצוף, טיח, חשמל). */
export function validateRows(
  raw: string[][],
  professions: Profession[],
  origins: Origin[],
): ExcelRow[] {
  const profCodes = new Set(professions.map(p => p.code));
  const profCodesLower = new Map(professions.map(p => [p.code.toLowerCase(), p.code]));
  const originCodes = new Set(origins.map(o => o.code));

  // Hebrew name → code lookup (so "טיח" maps to "plastering" etc.).
  const profByHe   = new Map(professions.map(p => [p.name_he.trim(), p.code]));
  const originByHe = new Map(origins.map(o => [o.name_he.trim(), o.code]));

  function resolveOnePiece(piece: string): string | null {
    const t = piece.trim();
    if (!t) return null;
    if (profCodes.has(t))                return t;
    if (profCodesLower.has(t.toLowerCase())) return profCodesLower.get(t.toLowerCase()) ?? null;
    if (profByHe.has(t))                 return profByHe.get(t) ?? null;
    if (PROFESSION_ALIASES[t])           return PROFESSION_ALIASES[t];
    return null;
  }

  function resolveProfession(input: string): string {
    // Try the whole string first.
    const direct = resolveOnePiece(input);
    if (direct) return direct;
    // Then try each comma/slash-separated piece — picks first match so
    // "ריצוף, פרקט" or "טיח/טייחים" still maps cleanly.
    for (const piece of input.split(/[,/]/)) {
      const m = resolveOnePiece(piece);
      if (m) return m;
    }
    return input;
  }

  function resolveOrigin(input: string): string {
    if (originCodes.has(input))       return input;
    if (originByHe.has(input.trim())) return originByHe.get(input.trim()) || input;
    return input;
  }

  return raw.map((cells) => {
    let [first_name = '', last_name = '', profession_type = '', experience_range = '',
      origin_country = '', visa_valid_until = '', employee_number = ''] = cells;

    profession_type = resolveProfession(profession_type);
    origin_country  = resolveOrigin(origin_country);

    const errors: string[] = [];
    if (!first_name) errors.push('שם פרטי חסר');
    if (!last_name) errors.push('שם משפחה חסר');
    if (!profCodes.has(profession_type)) {
      const validList = professions.map(p => `${p.code} (${p.name_he})`).join(', ');
      errors.push(`מקצוע לא תקין: "${profession_type}". מקצועות חוקיים: ${validList}`);
    }
    if (experience_range && !VALID_EXPERIENCE_RANGES.has(experience_range)) {
      errors.push(`טווח ניסיון לא תקין: ${experience_range}. ערכים חוקיים: 0-6, 6-12, 12-24, 24-36, 36+`);
    }
    if (origin_country && !originCodes.has(origin_country)) {
      const validList = origins.map(o => `${o.code} (${o.name_he})`).join(', ');
      errors.push(`מדינת מוצא לא תקינה: "${origin_country}". מדינות חוקיות: ${validList}`);
    }
    return {
      first_name, last_name, profession_type, experience_range, origin_country,
      visa_valid_until, employee_number,
      _valid: errors.length === 0, _errors: errors,
    };
  });
}
