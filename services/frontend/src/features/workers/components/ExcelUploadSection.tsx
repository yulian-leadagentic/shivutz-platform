'use client';

import { useRef, useState } from 'react';
import { Loader2, FileSpreadsheet, Download, Upload } from 'lucide-react';
import { workerApi } from '@/lib/api';
import type { Profession } from '@/types';
import { Button } from '@/components/ui/button';
import type { Origin, Region } from '../types';
import {
  downloadTemplate, parseCSV, validateRows, type ExcelRow,
} from '../csv';

interface Props {
  professions: Profession[];
  origins: Origin[];
  regions: Region[];
  onDone: () => void;
  onToast: (msg: string) => void;
}

export function ExcelUploadSection({
  professions, origins, regions, onDone, onToast,
}: Props) {
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
