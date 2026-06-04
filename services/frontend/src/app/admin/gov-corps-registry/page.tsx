'use client';

// Admin page for managing the רשות האוכלוסין annual manpower-corps PDF.
// One upload per year; existing corps whose ח.פ is in the file are
// auto-promoted to tier_2 (verification_method='gov_list_match').

import { useEffect, useState, FormEvent } from 'react';
import { Loader2, FilePlus, FileText, CheckCircle2, AlertCircle, CalendarDays, RefreshCw } from 'lucide-react';
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
    </div>
  );
}
