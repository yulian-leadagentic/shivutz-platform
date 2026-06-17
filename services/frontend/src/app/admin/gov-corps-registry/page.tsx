'use client';

// Admin page for managing the רשות האוכלוסין annual manpower-corps PDF.
// One upload per year; existing corps whose ח.פ is in the file are
// auto-promoted to tier_2 (verification_method='gov_list_match').

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Loader2, FilePlus, FileText, CheckCircle2, AlertCircle, CalendarDays, RefreshCw, Plus, ChevronDown, ChevronLeft, Search } from 'lucide-react';
import { adminApi } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface YearStat {
  source_year: number;
  row_count: number;
  matchable_count: number;
  last_imported_at: string;
}

interface ImportResult {
  source_year: number;
  rows_parsed: number;
  rows_with_business_number: number;
  rows_skipped_no_business_number: number;
  rows_inserted: number;
  existing_corps_promoted_or_renewed: number;
}

function fmt(iso?: string) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('he-IL'); } catch { return iso; }
}

export default function AdminGovCorpsPage() {
  const currentYear = new Date().getFullYear();
  const [years, setYears]       = useState<YearStat[]>([]);
  const [loadingYears, setLoadingYears] = useState(true);

  const [file, setFile]         = useState<File | null>(null);
  const [sourceYear, setSourceYear] = useState(currentYear);
  const [uploading, setUploading] = useState(false);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState<ImportResult | null>(null);

  function loadYears() {
    setLoadingYears(true);
    adminApi.listGovCorpYears()
      .then((res) => setYears(res.years))
      .catch(() => { /* silent — fresh DB has no rows yet */ })
      .finally(() => setLoadingYears(false));
  }
  useEffect(() => { loadYears(); }, []);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    setError(''); setResult(null);
    if (!file) { setError('יש לבחור קובץ PDF'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('הקובץ חייב להיות PDF'); return; }
    setUploading(true);
    try {
      const res = await adminApi.importGovCorpsPdf(sourceYear, file);
      setResult(res);
      setFile(null);
      // Reset the file input so picking the same file again works.
      const inp = document.getElementById('gov-pdf-file') as HTMLInputElement | null;
      if (inp) inp.value = '';
      loadYears();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהעלאה');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">רשימת תאגידי כוח אדם מורשים</h1>
        <p className="text-sm text-slate-500 mt-1 leading-relaxed">
          הרשימה הרשמית של רשות האוכלוסין וההגירה — קבלני כוח אדם בעלי היתר להעסיק עובדים זרים בענף הבניין.
          טעינת קובץ חדשה מחליפה את כל הרשומות לאותה שנה ומקדמת אוטומטית תאגידים שכבר רשומים במערכת שח.פ שלהם
          מופיע בקובץ.
        </p>
      </div>

      {/* Upload form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FilePlus className="h-4 w-4 text-brand-600" />
            טעינת קובץ PDF
          </CardTitle>
          <CardDescription>
            יש לטעון את הקובץ הרשמי כפי שהורד מאתר רשות האוכלוסין וההגירה.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <Input
                label="שנת הרשימה"
                type="number"
                min={2020}
                max={2100}
                value={sourceYear}
                onChange={(e) => setSourceYear(parseInt(e.target.value, 10) || currentYear)}
              />
              <div className="sm:col-span-2 flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700">קובץ PDF</label>
                <input
                  id="gov-pdf-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm file:me-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:text-slate-700 file:cursor-pointer hover:file:bg-slate-50"
                />
                {file && (
                  <p className="text-xs text-slate-500 inline-flex items-center gap-1 mt-0.5">
                    <FileText className="h-3 w-3" /> {file.name} ({Math.round(file.size / 1024)} KB)
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
            )}

            <Button type="submit" disabled={uploading || !file} className="w-full sm:w-auto">
              {uploading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> מעלה ומפענח...</>
                : <><FilePlus className="h-4 w-4" /> טען רשימה לשנת {sourceYear}</>}
            </Button>
          </form>

          {result && (
            <div className="mt-4 flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-900 leading-relaxed">
                <p className="font-semibold">הקובץ נטען בהצלחה לשנת {result.source_year}</p>
                <ul className="mt-1 space-y-0.5 text-emerald-800">
                  <li>שורות שנותחו: <strong>{result.rows_parsed}</strong></li>
                  <li>עם ח.פ תקין: <strong>{result.rows_with_business_number}</strong></li>
                  {result.rows_skipped_no_business_number > 0 && (
                    <li className="text-amber-800">דולגו (ללא ח.פ): {result.rows_skipped_no_business_number}</li>
                  )}
                  <li>תאגידים קיימים שאושרו / חודשו: <strong>{result.existing_corps_promoted_or_renewed}</strong></li>
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual entry — for corps the PDF missed */}
      <ManualEntryCard onAdded={loadYears} defaultYear={sourceYear} />

      {/* Years on file */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-slate-500" />
            שנים שנטענו במערכת
          </CardTitle>
          <button
            onClick={loadYears}
            disabled={loadingYears}
            className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loadingYears ? 'animate-spin' : ''}`} /> רענן
          </button>
        </CardHeader>
        <CardContent className="p-0">
          {loadingYears ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : years.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm flex flex-col items-center gap-1">
              <AlertCircle className="h-6 w-6 text-slate-300" />
              <p>עדיין אין רשימה במערכת — טען קובץ PDF כדי להתחיל.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs">
                  <th className="px-4 py-2 text-start font-medium">שנה</th>
                  <th className="px-4 py-2 text-start font-medium">סה״כ שורות</th>
                  <th className="px-4 py-2 text-start font-medium">עם ח.פ תקין</th>
                  <th className="px-4 py-2 text-start font-medium">נטען בתאריך</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.source_year} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{y.source_year}</td>
                    <td className="px-4 py-2.5 text-slate-700">{y.row_count}</td>
                    <td className="px-4 py-2.5 text-slate-700">{y.matchable_count}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">{fmt(y.last_imported_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <RegistryRowsBrowser years={years} />
    </div>
  );
}

interface RegistryRow {
  id: string;
  serial_no?: number | null;
  business_number?: string | null;
  company_name_he?: string | null;
  address?: string | null;
  phone_mobile_1?: string | null;
  phone_mobile_2?: string | null;
  phone_landline_1?: string | null;
  phone_landline_2?: string | null;
  source_year?: number;
  imported_at?: string;
  imported_by?: string | null;
}

/**
 * Collapsible browser for every row in the active registry year.
 * Each row collapses to "{serial} · {company_name} · {ח.פ}" and
 * expands to show the full contact detail block plus a "manually
 * added" hint when imported_by is null.
 */
function RegistryRowsBrowser({ years }: { years: YearStat[] }) {
  const latest = years[0]?.source_year ?? null;
  const [year, setYear] = useState<number | null>(latest);
  const [rows, setRows] = useState<RegistryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { setYear(years[0]?.source_year ?? null); }, [years]);

  useEffect(() => {
    if (year == null) { setRows(null); return; }
    setLoading(true);
    adminApi.previewGovCorpsYear(year)
      .then((res) => setRows(res.rows as unknown as RegistryRow[]))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [year]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      (r.company_name_he || '').toLowerCase().includes(needle) ||
      (r.business_number || '').includes(needle) ||
      (r.address || '').toLowerCase().includes(needle),
    );
  }, [rows, search]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <div>
          <CardTitle className="text-base">תאגידים ברשימה הפעילה</CardTitle>
          <CardDescription>
            רשימת התאגידים שנטענה מהקובץ + עידכונים ידניים של מנהל המערכת. לחץ על שורה לראות פרטים מלאים.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {years.length > 1 && (
            <select
              value={year ?? ''}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            >
              {years.map((y) => <option key={y.source_year} value={y.source_year}>{y.source_year}</option>)}
            </select>
          )}
          <div className="relative">
            <Search className="absolute end-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              placeholder="חפש לפי שם / ח.פ / כתובת"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-64 pe-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : !rows || rows.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">אין רשומות לשנה זו.</div>
        ) : (
          <>
            <div className="text-xs text-slate-500 mb-2">
              {filtered.length === rows.length ? `${rows.length} רשומות` : `${filtered.length} מתוך ${rows.length} רשומות`}
            </div>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
              {filtered.slice(0, 200).map((r) => {
                const isExp = expandedId === r.id;
                const isManual = !r.imported_by;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExp ? null : r.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-start hover:bg-slate-50"
                    >
                      {isExp ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronLeft className="h-4 w-4 text-slate-400" />}
                      <span className="text-xs text-slate-400 font-mono w-12">{r.serial_no ?? '—'}</span>
                      <span className="font-medium text-slate-800 flex-1 truncate">{r.company_name_he || '—'}</span>
                      <span className="text-xs text-slate-500 font-mono">{r.business_number || 'ללא ח.פ'}</span>
                      {isManual && (
                        <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">הוספה ידנית</span>
                      )}
                    </button>
                    {isExp && (
                      <div className="px-3 pb-4 bg-slate-50 border-t border-slate-100">
                        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm pt-3">
                          <RowDetail label="ח.פ"        value={r.business_number} />
                          <RowDetail label="מספר סידורי" value={r.serial_no?.toString()} />
                          <RowDetail label="כתובת"     value={r.address} />
                          <RowDetail label="טלפון 1"   value={r.phone_mobile_1}   dir="ltr" />
                          <RowDetail label="טלפון 2"   value={r.phone_mobile_2}   dir="ltr" />
                          <RowDetail label="לנדליין 1" value={r.phone_landline_1} dir="ltr" />
                          <RowDetail label="לנדליין 2" value={r.phone_landline_2} dir="ltr" />
                          <RowDetail label="נטען"      value={r.imported_at ? fmt(r.imported_at) : '—'} />
                        </dl>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {filtered.length > 200 && (
              <p className="text-xs text-slate-400 mt-2">מציג 200 ראשונים — סנן בחיפוש כדי לראות יותר.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RowDetail({ label, value, dir }: { label: string; value?: string | null; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs text-slate-500 shrink-0 w-24">{label}:</dt>
      <dd className="text-slate-800 break-all" dir={dir}>{value || '—'}</dd>
    </div>
  );
}

// ── Manual entry card — bypass the PDF parser ──────────────────────────────
function ManualEntryCard({ onAdded, defaultYear }: {
  onAdded: () => void;
  defaultYear: number;
}) {
  const [open, setOpen]       = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [result, setResult]   = useState<{ promoted: number; renewed: number } | null>(null);

  const [year, setYear]                       = useState(defaultYear);
  const [businessNumber, setBusinessNumber]   = useState('');
  const [companyName, setCompanyName]         = useState('');
  const [address, setAddress]                 = useState('');
  const [mobile1, setMobile1]                 = useState('');
  const [mobile2, setMobile2]                 = useState('');
  const [landline1, setLandline1]             = useState('');
  const [landline2, setLandline2]             = useState('');

  function reset() {
    setBusinessNumber(''); setCompanyName(''); setAddress('');
    setMobile1(''); setMobile2(''); setLandline1(''); setLandline2('');
    setError(''); setResult(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setResult(null);
    if (!businessNumber.trim() || businessNumber.trim().length !== 9 || !/^\d{9}$/.test(businessNumber.trim())) {
      setError('יש להזין מס׳ ח.פ תקין (9 ספרות)'); return;
    }
    setBusy(true);
    try {
      const res = await adminApi.addManualGovCorp({
        source_year:     year,
        business_number: businessNumber.trim(),
        company_name_he: companyName.trim() || undefined,
        address:         address.trim() || undefined,
        phone_mobile_1:  mobile1.trim() || undefined,
        phone_mobile_2:  mobile2.trim() || undefined,
        phone_landline_1: landline1.trim() || undefined,
        phone_landline_2: landline2.trim() || undefined,
      });
      setResult({ promoted: res.promoted, renewed: res.renewed });
      reset();
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהוספה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4 text-brand-600" />
          הוספה ידנית של תאגיד לרשימה
        </CardTitle>
        <Button
          variant={open ? 'outline' : 'default'}
          size="sm"
          onClick={() => { setOpen(!open); setError(''); }}
        >
          {open ? 'סגור' : 'פתח טופס'}
        </Button>
      </CardHeader>
      {open && (
        <CardContent>
          <CardDescription className="mb-3">
            לתאגיד שאינו מופיע ב-PDF של רשות האוכלוסין — הוסף אותו ידנית. אם התאגיד כבר רשום במערכת, נעדכן אותו אוטומטית ל-tier_2.
          </CardDescription>
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="שנה"
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10) || defaultYear)}
            />
            <Input
              label="מס׳ ח.פ (9 ספרות)"
              dir="ltr"
              maxLength={9}
              value={businessNumber}
              onChange={(e) => setBusinessNumber(e.target.value.replace(/\D/g, ''))}
            />
            <div className="sm:col-span-2">
              <Input
                label="שם התאגיד"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="כתובת"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            <Input
              label="טלפון נייד"
              type="tel"
              dir="ltr"
              value={mobile1}
              onChange={(e) => setMobile1(e.target.value)}
            />
            <Input
              label="טלפון נייד נוסף"
              type="tel"
              dir="ltr"
              value={mobile2}
              onChange={(e) => setMobile2(e.target.value)}
            />
            <Input
              label="טלפון משרד"
              type="tel"
              dir="ltr"
              value={landline1}
              onChange={(e) => setLandline1(e.target.value)}
            />
            <Input
              label="טלפון משרד נוסף"
              type="tel"
              dir="ltr"
              value={landline2}
              onChange={(e) => setLandline2(e.target.value)}
            />
            {error && (
              <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
            )}
            {result && (
              <p className="sm:col-span-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                התאגיד נוסף לרשימה. תאגידים קיימים שעודכנו: {result.promoted + result.renewed}.
              </p>
            )}
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                הוסף לרשימה
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
