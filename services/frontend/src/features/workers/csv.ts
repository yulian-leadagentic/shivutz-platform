import type { Profession } from '@/types';
import type { Origin, Region } from './types';

/** Column headers for the Excel template (order matters). */
export const EXCEL_COLUMNS = [
  'שם פרטי', 'שם משפחה', 'מקצוע (קוד)', 'טווח ניסיון',
  'מדינת מוצא (קוד)', 'ויזה תוקף עד', 'אזור זמינות (קוד)', 'מספר עובד',
];

export const EXCEL_EXAMPLE = [
  'יוחנן', 'כהן', 'carpenter', '12-24', 'RO', '2026-12-31', 'center', 'W-0042',
];

const VALID_EXPERIENCE_RANGES = new Set(['0-6', '6-12', '12-24', '24-36', '36+']);

export interface ExcelRow {
  first_name: string;
  last_name: string;
  profession_type: string;
  experience_range: string;
  origin_country: string;
  visa_valid_until: string;
  available_region: string;
  employee_number: string;
  _valid: boolean;
  _errors: string[];
}

/** Download a CSV template (with example row + reference code tables). */
export function downloadTemplate(professions: Profession[], origins: Origin[], regions: Region[]): void {
  const rows: string[][] = [
    EXCEL_COLUMNS,
    EXCEL_EXAMPLE,
    [],
    ['--- קודי מקצועות ---'],
    ...professions.filter(p => p.is_active).map(p => [p.code, p.name_he]),
    [],
    ['--- קודי מדינות ---'],
    ...origins.map(o => [o.code, o.name_he]),
    [],
    ['--- קודי אזורים ---'],
    ...regions.map(r => [r.code, r.name_he]),
    [],
    ['--- טווחי ניסיון ---'],
    ['0-6', '0–6 חודשים'],
    ['6-12', '6–12 חודשים'],
    ['12-24', '12–24 חודשים'],
    ['24-36', '24–36 חודשים'],
    ['36+', '36+ חודשים'],
  ];
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
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

export function validateRows(
  raw: string[][],
  professions: Profession[],
  origins: Origin[],
): ExcelRow[] {
  const profCodes = new Set(professions.map(p => p.code));
  const originCodes = new Set(origins.map(o => o.code));

  return raw.map((cells) => {
    const [first_name = '', last_name = '', profession_type = '', experience_range = '',
      origin_country = '', visa_valid_until = '', available_region = '', employee_number = ''] = cells;
    const errors: string[] = [];
    if (!first_name) errors.push('שם פרטי חסר');
    if (!last_name) errors.push('שם משפחה חסר');
    if (!profCodes.has(profession_type)) errors.push(`מקצוע לא תקין: ${profession_type}`);
    if (!VALID_EXPERIENCE_RANGES.has(experience_range)) errors.push(`טווח ניסיון לא תקין: ${experience_range}`);
    if (!originCodes.has(origin_country)) errors.push(`מדינת מוצא לא תקינה: ${origin_country}`);
    if (!visa_valid_until) errors.push('תאריך ויזה חסר');
    return {
      first_name, last_name, profession_type, experience_range, origin_country,
      visa_valid_until, available_region, employee_number,
      _valid: errors.length === 0, _errors: errors,
    };
  });
}
