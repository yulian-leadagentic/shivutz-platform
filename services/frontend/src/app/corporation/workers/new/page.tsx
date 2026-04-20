'use client';

import { useEffect, useState, useRef, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, CheckCircle2, Users, User, FileSpreadsheet, Download, Upload } from 'lucide-react';
import { workerApi, enumApi } from '@/lib/api';
import type { Profession } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Constants ──────────────────────────────────────────────────────────────

const EXP_RANGES = [
  { code: '0-6',   label: '0–6 חודשים' },
  { code: '6-12',  label: '6–12 חודשים' },
  { code: '12-24', label: '12–24 חודשים' },
  { code: '24-36', label: '24–36 חודשים' },
  { code: '36+',   label: '36+ חודשים' },
] as const;

type ExpRange = '0-6' | '6-12' | '12-24' | '24-36' | '36+';

/** Map origin country code → primary language code */
const ORIGIN_TO_LANG: Record<string, string> = {
  RO: 'ro', MD: 'ro',   // Romanian / Moldovan → Romanian
  TH: 'th',             // Thailand → Thai
  PH: 'tl',             // Philippines → Tagalog
  VN: 'vi',             // Vietnam → Vietnamese
  IN: 'hi',             // India → Hindi
  NP: 'ne',             // Nepal → Nepali
  LK: 'si',             // Sri Lanka → Sinhala
  UA: 'uk',             // Ukraine → Ukrainian
  RU: 'ru',             // Russia → Russian
  CN: 'zh',             // China → Chinese
  IL: 'he',             // Israel → Hebrew
};

const LANGUAGE_OPTIONS = [
  { code: 'he', name: 'עברית' },
  { code: 'en', name: 'אנגלית' },
  { code: 'ro', name: 'רומנית' },
  { code: 'uk', name: 'אוקראינית' },
  { code: 'ru', name: 'רוסית' },
  { code: 'th', name: 'תאילנדית' },
  { code: 'zh', name: 'סינית' },
  { code: 'tl', name: 'פיליפינית' },
  { code: 'hi', name: 'הינדית' },
  { code: 'ar', name: 'ערבית' },
  { code: 'vi', name: 'וייטנאמית' },
  { code: 'ne', name: 'נפאלית' },
  { code: 'si', name: 'סינהלית' },
];

interface SharedFields {
  profession_type: string;
  experience_range: ExpRange | '';
  origin_country: string;
  languages: string[];
  visa_valid_until: string;
  available_region: string;
  available_from: string;
  employee_number: string;
}

const EMPTY_SHARED: SharedFields = {
  profession_type: '', experience_range: '', origin_country: '',
  languages: [], visa_valid_until: '', available_region: '', available_from: '',
  employee_number: '',
};

type Origin = { code: string; name_he: string; name_en: string };
type Region = { code: string; name_he: string; name_en: string };

// ── Shared fields section ──────────────────────────────────────────────────

function SharedFieldsSection({ fields, professions, origins, regions, showEmployeeNumber = true, onChange }: {
  fields: SharedFields;
  professions: Profession[];
  origins: Origin[];
  regions: Region[];
  showEmployeeNumber?: boolean;
  onChange: (f: Partial<SharedFields>) => void;
}) {
  function toggleLang(code: string) {
    const next = fields.languages.includes(code)
      ? fields.languages.filter((l) => l !== code)
      : [...fields.languages, code];
    onChange({ languages: next });
  }

  function handleOriginChange(code: string) {
    const update: Partial<SharedFields> = { origin_country: code };
    // Auto-add primary language for this origin if not already selected
    const lang = ORIGIN_TO_LANG[code];
    if (lang && !fields.languages.includes(lang)) {
      update.languages = [...fields.languages, lang];
    }
    onChange(update);
  }

  return (
    <div className="space-y-4">
      {/* Employee number */}
      {showEmployeeNumber && (
        <Input
          label="מספר עובד בתאגיד"
          placeholder="לדוגמה: EMP-001"
          value={fields.employee_number}
          onChange={(e) => onChange({ employee_number: e.target.value })}
        />
      )}

      {/* Profession */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700">מקצוע *</label>
        <select value={fields.profession_type}
          onChange={(e) => onChange({ profession_type: e.target.value })}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">בחר מקצוע...</option>
          {professions.filter((p) => p.is_active).map((p) => (
            <option key={p.code} value={p.code}>{p.name_he}</option>
          ))}
        </select>
      </div>

      {/* Experience range — months */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">טווח ניסיון *</label>
        <div className="flex flex-wrap gap-2">
          {EXP_RANGES.map((r) => (
            <button key={r.code} type="button"
              onClick={() => onChange({ experience_range: r.code })}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                fields.experience_range === r.code
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
              }`}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Origin country — auto-selects language */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700">מדינת מוצא *</label>
        <select value={fields.origin_country}
          onChange={(e) => handleOriginChange(e.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">בחר מדינה...</option>
          {origins.map((o) => (
            <option key={o.code} value={o.code}>{o.name_he}</option>
          ))}
        </select>
      </div>

      {/* Languages — pills */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">שפות</label>
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGE_OPTIONS.map((l) => (
            <button key={l.code} type="button" onClick={() => toggleLang(l.code)}
              className={`px-2.5 py-1 rounded-full text-xs border font-medium transition-colors ${
                fields.languages.includes(l.code)
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
              }`}>{l.name}</button>
          ))}
        </div>
      </div>

      {/* Visa */}
      <Input label="ויזה תקפה עד *" type="date" dir="ltr"
        value={fields.visa_valid_until}
        onChange={(e) => onChange({ visa_valid_until: e.target.value })} />

      {/* Availability region — uses real region list */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">אזור זמינות</label>
          <select value={fields.available_region}
            onChange={(e) => onChange({ available_region: e.target.value })}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">כל הארץ</option>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>{r.name_he}</option>
            ))}
          </select>
        </div>
        <Input label="זמין מתאריך" type="date" dir="ltr"
          value={fields.available_from}
          onChange={(e) => onChange({ available_from: e.target.value })} />
      </div>
    </div>
  );
}

// ── Excel upload ──────────────────────────────────────────────────────────

// Column headers for the Excel template (order matters)
const EXCEL_COLUMNS = ['שם פרטי', 'שם משפחה', 'מקצוע (קוד)', 'טווח ניסיון', 'מדינת מוצא (קוד)', 'ויזה תוקף עד', 'אזור זמינות (קוד)', 'מספר עובד'];
const EXCEL_EXAMPLE = ['יוחנן', 'כהן', 'carpenter', '12-24', 'RO', '2026-12-31', 'center', 'W-0042'];

function downloadTemplate(professions: Profession[], origins: Origin[], regions: Region[]) {
  // Build a CSV template with headers + one example row + reference sheet
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

interface ExcelRow {
  first_name: string; last_name: string;
  profession_type: string; experience_range: string;
  origin_country: string; visa_valid_until: string;
  available_region: string; employee_number: string;
  _valid: boolean; _errors: string[];
}

function parseCSV(text: string): string[][] {
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

function validateRows(raw: string[][], professions: Profession[], origins: Origin[]): ExcelRow[] {
  const profCodes = new Set(professions.map(p => p.code));
  const originCodes = new Set(origins.map(o => o.code));
  const validRanges = new Set(['0-6', '6-12', '12-24', '24-36', '36+']);

  return raw.map((cells) => {
    const [first_name = '', last_name = '', profession_type = '', experience_range = '',
      origin_country = '', visa_valid_until = '', available_region = '', employee_number = ''] = cells;
    const errors: string[] = [];
    if (!first_name) errors.push('שם פרטי חסר');
    if (!last_name) errors.push('שם משפחה חסר');
    if (!profCodes.has(profession_type)) errors.push(`מקצוע לא תקין: ${profession_type}`);
    if (!validRanges.has(experience_range)) errors.push(`טווח ניסיון לא תקין: ${experience_range}`);
    if (!originCodes.has(origin_country)) errors.push(`מדינת מוצא לא תקינה: ${origin_country}`);
    if (!visa_valid_until) errors.push('תאריך ויזה חסר');
    return { first_name, last_name, profession_type, experience_range, origin_country,
      visa_valid_until, available_region, employee_number,
      _valid: errors.length === 0, _errors: errors };
  });
}

function ExcelUploadSection({ professions, origins, regions, onDone, onToast }: {
  professions: Profession[]; origins: Origin[]; regions: Region[];
  onDone: () => void; onToast: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows]           = useState<ExcelRow[]>([]);
  const [fileName, setFileName]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState('');

  const validRows   = rows.filter(r => r._valid);
  const invalidRows = rows.filter(r => !r._valid);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const allRows = parseCSV(text);
      // Skip header row(s) — find first row where first cell matches "שם פרטי"
      const dataStart = allRows.findIndex(r => r[0] === 'שם פרטי') + 1;
      const dataRows = allRows.slice(dataStart || 1).filter(r => r[0] && r[0] !== '---');
      if (dataRows.length === 0) { setError('לא נמצאו שורות נתונים בקובץ'); setRows([]); return; }
      setRows(validateRows(dataRows, professions, origins));
    };
    reader.readAsText(file, 'UTF-8');
  }

  async function handleImport() {
    if (!validRows.length) return;
    setUploading(true); setError('');
    let created = 0;
    try {
      for (const row of validRows) {
        await workerApi.create({
          first_name:       row.first_name,
          last_name:        row.last_name,
          profession_type:  row.profession_type,
          experience_range: row.experience_range,
          origin_country:   row.origin_country,
          visa_valid_until: row.visa_valid_until || null,
          available_region: row.available_region || null,
          employee_number:  row.employee_number  || null,
        });
        created++;
      }
      onToast(`${created} עובדים יובאו בהצלחה`);
      onDone();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בייבוא');
    } finally { setUploading(false); }
  }

  return (
    <div className="space-y-4">
      {/* Download template */}
      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
        <div>
          <p className="text-sm font-medium text-slate-700">הורד תבנית CSV</p>
          <p className="text-xs text-slate-500 mt-0.5">מלא את הקובץ ואז העלה אותו</p>
        </div>
        <Button type="button" variant="outline" size="sm"
          onClick={() => downloadTemplate(professions, origins, regions)}>
          <Download className="h-4 w-4" /> הורד תבנית
        </Button>
      </div>

      {/* Upload area */}
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-slate-300 rounded-lg px-6 py-8 text-center cursor-pointer hover:border-brand-400 transition-colors"
      >
        <Upload className="h-8 w-8 mx-auto text-slate-300 mb-2" />
        {fileName
          ? <p className="text-sm font-medium text-slate-700">{fileName}</p>
          : <p className="text-sm text-slate-500">לחץ לבחירת קובץ CSV</p>}
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-green-700 font-medium">{validRows.length} שורות תקינות</span>
            {invalidRows.length > 0 && (
              <span className="text-red-600 font-medium">{invalidRows.length} שורות עם שגיאות</span>
            )}
          </div>

          {invalidRows.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
              {invalidRows.map((r, i) => (
                <p key={i} className="text-xs text-red-700">
                  <span className="font-medium">{r.first_name} {r.last_name}:</span> {r._errors.join(' | ')}
                </p>
              ))}
            </div>
          )}

          <div className="border border-slate-200 rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="px-2 py-2 text-start">שם</th>
                  <th className="px-2 py-2 text-start">מקצוע</th>
                  <th className="px-2 py-2 text-start">ניסיון</th>
                  <th className="px-2 py-2 text-start">מדינה</th>
                  <th className="px-2 py-2 text-start">ויזה</th>
                  <th className="px-2 py-2 text-start">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i} className={`border-b border-slate-100 ${r._valid ? '' : 'bg-red-50'}`}>
                    <td className="px-2 py-1.5">{r.first_name} {r.last_name}</td>
                    <td className="px-2 py-1.5 font-mono">{r.profession_type}</td>
                    <td className="px-2 py-1.5">{r.experience_range}</td>
                    <td className="px-2 py-1.5 font-mono">{r.origin_country}</td>
                    <td className="px-2 py-1.5">{r.visa_valid_until}</td>
                    <td className="px-2 py-1.5">
                      {r._valid
                        ? <span className="text-green-600 font-medium">✓</span>
                        : <span className="text-red-600" title={r._errors.join('\n')}>⚠ {r._errors[0]}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 20 && <p className="text-xs text-slate-400 px-2 py-1.5">+{rows.length - 20} שורות נוספות...</p>}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

      <div className="flex gap-3">
        <Button
          type="button"
          disabled={uploading || validRows.length === 0}
          onClick={handleImport}
          className="flex-1"
        >
          {uploading
            ? <><Loader2 className="h-4 w-4 animate-spin" /> מייבא...</>
            : <><FileSpreadsheet className="h-4 w-4" /> ייבא {validRows.length > 0 ? validRows.length : ''} עובדים</>}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>ביטול</Button>
      </div>
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-green-700 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium">
      <CheckCircle2 className="h-5 w-5 shrink-0" />{msg}
      <button onClick={onClose} className="ms-2 text-green-200 hover:text-white text-base leading-none">✕</button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

type Mode = 'single' | 'bulk' | 'excel';

export default function NewWorkerPage() {
  const router = useRouter();
  const [mode, setMode]             = useState<Mode>('single');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [toast, setToast]           = useState('');

  const [professions, setProfessions] = useState<Profession[]>([]);
  const [origins, setOrigins]         = useState<Origin[]>([]);
  const [regions, setRegions]         = useState<Region[]>([]);

  // single mode
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [shared, setShared]       = useState<SharedFields>(EMPTY_SHARED);

  // bulk mode — comma-separated names
  const [bulkNames, setBulkNames] = useState('');
  const [bulkShared, setBulkShared] = useState<SharedFields>(EMPTY_SHARED);

  useEffect(() => {
    enumApi.professions().then(setProfessions).catch(() => {});
    enumApi.origins().then(setOrigins).catch(() => {});
    enumApi.regions().then(setRegions).catch(() => {});
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4500);
  }

  // ── Single ────────────────────────────────────────────────────────────────
  function validateSingle(): string {
    if (!firstName.trim())        return 'יש להזין שם פרטי';
    if (!lastName.trim())         return 'יש להזין שם משפחה';
    if (!shared.profession_type)  return 'יש לבחור מקצוע';
    if (!shared.experience_range) return 'יש לבחור טווח ניסיון';
    if (!shared.origin_country)   return 'יש לבחור מדינת מוצא';
    if (!shared.visa_valid_until) return 'יש להזין תאריך ויזה';
    return '';
  }

  async function handleSingleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateSingle();
    if (err) { setError(err); return; }
    setError(''); setSubmitting(true);
    try {
      await workerApi.create({
        first_name:       firstName,
        last_name:        lastName,
        profession_type:  shared.profession_type,
        experience_range: shared.experience_range,
        origin_country:   shared.origin_country,
        languages:        shared.languages,
        visa_valid_until: shared.visa_valid_until || null,
        available_region: shared.available_region || null,
        available_from:   shared.available_from   || null,
        employee_number:  shared.employee_number  || null,
      });
      showToast(`${firstName} ${lastName} נוסף בהצלחה`);
      setFirstName(''); setLastName('');
      setShared((s) => ({ ...s, employee_number: '' }));
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בשמירה');
    } finally { setSubmitting(false); }
  }

  // ── Bulk ──────────────────────────────────────────────────────────────────

  /** Parse "שם פרטי שם משפחה, שם פרטי שם משפחה, ..." → [{first, last}] */
  function parseNames(raw: string): Array<{ first: string; last: string }> {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((full) => {
        const parts = full.trim().split(/\s+/);
        if (parts.length === 1) return { first: parts[0], last: '' };
        return { first: parts[0], last: parts.slice(1).join(' ') };
      });
  }

  const parsedNames = parseNames(bulkNames);

  function validateBulk(): string {
    if (!bulkNames.trim())                return 'יש להזין שמות (מופרדים בפסיק)';
    if (parsedNames.length === 0)         return 'יש להזין לפחות שם אחד';
    if (!bulkShared.profession_type)      return 'יש לבחור מקצוע';
    if (!bulkShared.experience_range)     return 'יש לבחור טווח ניסיון';
    if (!bulkShared.origin_country)       return 'יש לבחור מדינת מוצא';
    if (!bulkShared.visa_valid_until)     return 'יש להזין תאריך ויזה';
    return '';
  }

  async function handleBulkSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateBulk();
    if (err) { setError(err); return; }
    setError(''); setSubmitting(true);
    try {
      // Create workers one by one so each gets their real name
      let created = 0;
      for (const { first, last } of parsedNames) {
        await workerApi.create({
          first_name:       first,
          last_name:        last,
          profession_type:  bulkShared.profession_type,
          experience_range: bulkShared.experience_range,
          origin_country:   bulkShared.origin_country,
          languages:        bulkShared.languages,
          visa_valid_until: bulkShared.visa_valid_until || null,
          available_region: bulkShared.available_region || null,
          available_from:   bulkShared.available_from   || null,
          // employee_number is intentionally omitted in bulk — assign individually after
        });
        created++;
      }
      showToast(`${created} עובדים נוצרו בהצלחה`);
      setBulkNames('');
      setBulkShared(EMPTY_SHARED);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בשמירה');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {toast && <Toast msg={toast} onClose={() => setToast('')} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-900">הוספת עובדים</h2>
        <button onClick={() => router.push('/corporation/workers')}
          className="text-sm text-slate-500 hover:text-slate-700 underline">חזרה לרשימה</button>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {([['single', 'עובד בודד', User], ['bulk', 'הוספה כמותית', Users], ['excel', 'ייבוא אקסל', FileSpreadsheet]] as const).map(([m, label, Icon]) => (
          <button key={m} onClick={() => { setMode(m as Mode); setError(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── Single mode ── */}
      {mode === 'single' && (
        <form onSubmit={handleSingleSubmit} className="space-y-4" noValidate>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">פרטים אישיים</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Input label="שם פרטי *" value={firstName}
                  onChange={(e) => setFirstName(e.target.value)} autoFocus />
                <Input label="שם משפחה *" value={lastName}
                  onChange={(e) => setLastName(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">פרטים מקצועיים וזמינות</CardTitle></CardHeader>
            <CardContent>
              <SharedFieldsSection
                fields={shared}
                professions={professions}
                origins={origins}
                regions={regions}
                showEmployeeNumber={true}
                onChange={(delta) => setShared((s) => ({ ...s, ...delta }))}
              />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</> : <><Plus className="h-4 w-4" /> שמור והוסף עובד נוסף</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/corporation/workers')}>סיום</Button>
          </div>
        </form>
      )}

      {/* ── Bulk mode ── */}
      {mode === 'bulk' && (
        <form onSubmit={handleBulkSubmit} className="space-y-4" noValidate>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">שמות עובדים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">
                הזן שמות מלאים מופרדים בפסיק. כל עובד יקבל שם נפרד עם אותם מאפיינים. מספר עובד ניתן להקצות אחרי יצירה.
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700">שמות (מופרדים בפסיק) *</label>
                <textarea
                  value={bulkNames}
                  onChange={(e) => setBulkNames(e.target.value)}
                  placeholder="יוחנן כהן, מריה פופסקו, אנדרי בונדרנקו"
                  rows={3}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                />
              </div>
              {parsedNames.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-600 space-y-1">
                  <p className="font-medium text-slate-700">{parsedNames.length} עובדים:</p>
                  <p>{parsedNames.map((n) => `${n.first} ${n.last}`.trim()).join(' · ')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">מאפיינים משותפים</CardTitle></CardHeader>
            <CardContent>
              <SharedFieldsSection
                fields={bulkShared}
                professions={professions}
                origins={origins}
                regions={regions}
                showEmployeeNumber={false}
                onChange={(delta) => setBulkShared((s) => ({ ...s, ...delta }))}
              />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <Button type="submit" disabled={submitting || parsedNames.length === 0} className="flex-1">
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> יוצר עובדים...</>
                : <><Users className="h-4 w-4" /> צור {parsedNames.length > 0 ? parsedNames.length : ''} עובדים</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/corporation/workers')}>סיום</Button>
          </div>
        </form>
      )}

      {/* ── Excel mode ── */}
      {mode === 'excel' && (
        <ExcelUploadSection
          professions={professions}
          origins={origins}
          regions={regions}
          onDone={() => router.push('/corporation/workers')}
          onToast={showToast}
        />
      )}
    </div>
  );
}
