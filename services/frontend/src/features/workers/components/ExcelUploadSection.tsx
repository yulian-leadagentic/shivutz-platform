'use client';

import { useRef, useState } from 'react';
import { Loader2, FileSpreadsheet, Download, Upload, RotateCcw, AlertTriangle } from 'lucide-react';
import { workerApi } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import type { Profession } from '@/types';
import { Button } from '@/components/ui/button';
import type { Origin, Region } from '../types';
import {
  downloadTemplate, parseCSV, validateRows, type ExcelRow,
} from '../csv';

interface Props {
  professions: Profession[];
  origins: Origin[];
  /** Optional — kept in the signature so callers don't break, but the
   *  Excel flow no longer collects per-worker availability_region. */
  regions?: Region[];
  onDone: () => void;
  onToast: (msg: string) => void;
}

export function ExcelUploadSection({
  professions, origins, regions, onDone, onToast,
}: Props) {
  // Active corp from the JWT. We pass this explicitly on every
  // worker.create() so the worker service doesn't fall back to the
  // gateway's `x-org-id` projection — which on staging projected the
  // legacy `users.org_id` (a CONTRACTOR id, from Yulian's first
  // signup) when the user was logged in without a corporation entity
  // context (e.g. admin-tile login). Worker create then failed with
  // "corporation_not_found" trying to look up a contractor id in
  // the corporations table.
  const { entityId, entityType } = useAuth();
  const corporationId = entityType === 'corporation' ? entityId : null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows]           = useState<ExcelRow[]>([]);
  const [fileName, setFileName]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState('');

  const validRows   = rows.filter(r => r._valid);
  const invalidRows = rows.filter(r => !r._valid);

  /**
   * Reset to a clean upload state — clears the parsed rows, the
   * remembered filename, any error message, AND the underlying
   * <input type="file"> value so the user can re-pick the same file
   * if they want to. Called by the "טעינה חדשה" button below the
   * preview table.
   */
  function resetUpload() {
    setRows([]);
    setFileName('');
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

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
      if (dataRows.length === 0) {
        setError('לא נמצאו שורות נתונים בקובץ');
        setRows([]);
        return;
      }
      setRows(validateRows(dataRows, professions, origins));
    };
    reader.readAsText(file, 'UTF-8');
  }

  async function handleImport() {
    if (!validRows.length) return;
    if (!corporationId) {
      setError('כדי לייבא עובדים יש להיכנס בתוך חשבון תאגיד. עבור ללוח החשבון שלך ובחר את התאגיד.');
      return;
    }
    setUploading(true); setError('');
    let created = 0;
    try {
      for (const row of validRows) {
        await workerApi.create({
          corporation_id:   corporationId,
          first_name:       row.first_name,
          last_name:        row.last_name,
          profession_type:  row.profession_type,
          experience_range: row.experience_range || null,
          origin_country:   row.origin_country   || null,
          visa_valid_until: row.visa_valid_until || null,
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
          onClick={() => downloadTemplate(professions, origins, regions ?? [])}>
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

      {!corporationId && (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            יבוא עובדים זמין רק כשמחוברים בתוך חשבון תאגיד. אם יש לך מספר חשבונות —
            פתח את התפריט בפינה ובחר את התאגיד שלך, ונסה שוב.
          </span>
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={uploading || validRows.length === 0 || !corporationId}
          onClick={handleImport}
          className="flex-1 min-w-[180px]"
        >
          {uploading
            ? <><Loader2 className="h-4 w-4 animate-spin" /> מייבא...</>
            : <><FileSpreadsheet className="h-4 w-4" /> ייבא {validRows.length > 0 ? validRows.length : ''} עובדים</>}
        </Button>
        {/* Reset — clears the loaded rows + the file picker so the
            user can switch to a different file (e.g. after fixing
            errors in their spreadsheet) without first cancelling out
            and reopening the import flow. */}
        {rows.length > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={resetUpload}
            disabled={uploading}
            title="נקה את הקובץ הנוכחי וטען קובץ חדש"
          >
            <RotateCcw className="h-4 w-4" />
            טעינה חדשה
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onDone} disabled={uploading}>ביטול</Button>
      </div>
    </div>
  );
}
