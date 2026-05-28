'use client';

// Contractor foreign-import tender builder.
// One tender can request several professions (15 carpenters, 5
// plasterers, 10 tilers). Published → broadcast to all corps → they
// bid → contractor selects → admin approves + reveals.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, Globe2, Send, AlertCircle } from 'lucide-react';
import { tenderApi } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface LineItem {
  key: string;
  profession_type: string;
  origin_country: string;   // per-line origin
  quantity: number;
  min_experience: number;
}

function newLine(): LineItem {
  return { key: crypto.randomUUID(), profession_type: '', origin_country: '', quantity: 10, min_experience: 0 };
}

const EXP_OPTIONS = [
  { months: 0,  label: 'ללא דרישת ניסיון' },
  { months: 6,  label: 'חצי שנה+' },
  { months: 12, label: 'שנה+' },
  { months: 24, label: 'שנתיים+' },
];

export default function NewTenderPage() {
  const router = useRouter();
  const { professions, origins } = useEnums();
  const activeProfs = professions.filter((p) => p.is_active);

  const [title, setTitle]       = useState('');
  const [startDate, setStart]   = useState('');
  const [notes, setNotes]       = useState('');
  const [lines, setLines]       = useState<LineItem[]>([newLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');

  const totalWorkers = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const validLines   = lines.filter((l) => l.profession_type && Number(l.quantity) > 0);
  const canSubmit    = validLines.length > 0 && !submitting;

  function updateLine(key: string, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine()    { setLines((prev) => [...prev, newLine()]); }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  async function handlePublish() {
    if (!validLines.length) { setError('יש להוסיף לפחות מקצוע אחד עם כמות'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await tenderApi.create({
        title: title.trim() || undefined,
        target_start_date: startDate || undefined,
        notes: notes.trim() || undefined,
        items: validLines.map((l) => ({
          profession_type: l.profession_type,
          origin_country: l.origin_country || undefined,
          quantity: Number(l.quantity),
          min_experience: Number(l.min_experience) || 0,
        })),
      });
      router.push(`/contractor/tenders/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בפרסום המכרז');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Globe2 className="h-6 w-6 text-brand-600" />
          <h1 className="text-2xl font-bold text-slate-900">מכרז ייבוא עובדים מחו״ל</h1>
        </div>
        <p className="text-sm text-slate-600">
          הגדר כמה עובדים ובאילו מקצועות אתה צריך. הבקשה תופץ לכל התאגידים, והם יגישו הצעות.
          הפרטים שלך נשמרים חסויים עד לאישור מנהל המערכת.
        </p>
      </header>

      {/* ── Professions (line items) ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900">מקצועות וכמויות</h2>
          <span className="text-sm text-slate-500">סה״כ {totalWorkers} עובדים</span>
        </div>

        {lines.map((line) => (
          <div key={line.key} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {line.profession_type && (
                  <ProfessionIcon code={line.profession_type} size={32} alt="" className="object-contain" />
                )}
                <span className="text-sm font-semibold text-slate-700">
                  {activeProfs.find((p) => p.code === line.profession_type)?.name_he || 'בחר מקצוע'}
                </span>
              </div>
              {lines.length > 1 && (
                <button type="button" onClick={() => removeLine(line.key)}
                  className="text-slate-400 hover:text-rose-600 transition p-1" aria-label="הסר">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">מקצוע</label>
                <select
                  value={line.profession_type}
                  onChange={(e) => updateLine(line.key, { profession_type: e.target.value })}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="">בחר…</option>
                  {activeProfs.map((p) => (
                    <option key={p.code} value={p.code}>{p.name_he}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">ארץ מוצא</label>
                <select
                  value={line.origin_country}
                  onChange={(e) => updateLine(line.key, { origin_country: e.target.value })}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="">ללא העדפה</option>
                  {origins.map((o) => (<option key={o.code} value={o.code}>{o.name_he}</option>))}
                </select>
              </div>
              <Input
                label="כמות"
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: Number(e.target.value) })}
              />
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">ניסיון מינ׳</label>
                <select
                  value={line.min_experience}
                  onChange={(e) => updateLine(line.key, { min_experience: Number(e.target.value) })}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  {EXP_OPTIONS.map((o) => (
                    <option key={o.months} value={o.months}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" onClick={addLine} className="w-full">
          <Plus className="h-4 w-4" /> הוסף מקצוע
        </Button>
      </div>

      {/* ── Tender meta ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 space-y-4">
        <h2 className="font-bold text-slate-900">פרטי המכרז</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="כותרת (אופציונלי)" placeholder="לדוגמה: עובדים לפרויקט חדש"
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input label="תאריך התחלה רצוי" type="date"
            value={startDate} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">דרישות נוספות (אופציונלי)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="שפות, הסמכות, תנאי לינה וכו׳"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none" />
        </div>
      </div>

      {/* Admin-approval notice */}
      <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 text-sm text-sky-900">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-sky-600" />
        <span>המכרז יישלח לאישור מנהל המערכת לפני שיפורסם לתאגידים. לאחר האישור תקבל הצעות.</span>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="button" disabled={!canSubmit} onClick={handlePublish} size="lg" className="flex-1">
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח…</>
            : <><Send className="h-4 w-4" /> שלח לאישור — {totalWorkers} עובדים</>}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={() => router.push('/contractor/tenders')}>
          ביטול
        </Button>
      </div>
    </div>
  );
}
