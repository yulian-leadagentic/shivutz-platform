'use client';

import { useEffect, useState, FormEvent } from 'react';
import { Loader2, Percent, Save, Info, Trash2, Plus, Calendar } from 'lucide-react';
import { adminApi, type VATPeriod } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

function fmtDate(iso: string | null) {
  if (!iso) return 'ללא תאריך סיום';
  return new Date(iso).toLocaleDateString('he-IL');
}

export default function AdminCommissionsPage() {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [rate, setRate]         = useState<string>('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError]       = useState('');
  const [savedAt, setSavedAt]   = useState<number | null>(null);

  async function loadRate() {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.getPlatformCommissionRate();
      setRate(data.commission_per_worker_nis != null ? String(data.commission_per_worker_nis) : '');
      setUpdatedAt(data.updated_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRate(); }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    const num = parseFloat(rate);
    if (Number.isNaN(num) || num < 0) {
      setError('יש להזין מספר חיובי');
      return;
    }
    setSaving(true);
    try {
      await adminApi.setPlatformCommissionRate(num);
      setSavedAt(Date.now());
      await loadRate();
      setTimeout(() => setSavedAt(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">עמלות פלטפורמה</h1>
        <p className="text-sm text-slate-500 mt-1">
          תעריף יחיד החל על כל העסקאות במערכת.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Percent className="h-4 w-4 text-brand-600" />
            עמלה לעובד מאוייש
          </CardTitle>
          <CardDescription>
            סכום שייגבה מהקבלן עבור כל עובד שאושר ברשימה (לפני מע״מ).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> טוען...
            </div>
          ) : (
            <form onSubmit={save} className="flex flex-col gap-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-slate-600 block mb-1.5">
                    תעריף בש״ח
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="500"
                      dir="ltr"
                      className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 pe-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₪</span>
                  </div>
                </div>
                <Button type="submit" disabled={saving} className="h-11">
                  {saving
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר</>
                    : <><Save className="h-4 w-4" /> שמור</>}
                </Button>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {error}
                </p>
              )}
              {savedAt && (
                <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                  ✓ עודכן בהצלחה
                </p>
              )}
              {updatedAt && (
                <p className="text-xs text-slate-400">
                  עדכון אחרון: {new Date(updatedAt).toLocaleString('he-IL')}
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-3">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-slate-400" />
        <div className="space-y-1">
          <p><strong>איך התעריף נכנס לחיוב:</strong> ברגע שהתאגיד שולח רשימת עובדים בעסקה, סכום העמלה מחושב כ־<code dir="ltr">תעריף × מספר עובדים שאויישו</code> ונקבע (snapshot) על העסקה. שינוי התעריף משפיע רק על עסקאות עתידיות.</p>
        </div>
      </div>

      <VATPeriodsCard />
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────
// VAT periods — multi-period table managed inline
// ─────────────────────────────────────────────────────────────────────────

function VATPeriodsCard() {
  const [periods, setPeriods] = useState<VATPeriod[] | null>(null);
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [adding, setAdding]   = useState(false);
  const [form, setForm]       = useState({ percent: '18', valid_from: '', valid_until: '', notes: '' });
  const today = new Date().toISOString().slice(0, 10);

  function load() {
    setError('');
    adminApi.listVatPeriods()
      .then(setPeriods)
      .catch((e) => setError(e instanceof Error ? e.message : 'שגיאה'));
  }

  useEffect(() => { load(); }, []);

  async function add(e: FormEvent) {
    e.preventDefault(); setError('');
    const pct = parseFloat(form.percent);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) { setError('% מע״מ חייב להיות בין 0 ל-100'); return; }
    if (!form.valid_from) { setError('יש לבחור תאריך התחלה'); return; }
    if (form.valid_until && form.valid_until < form.valid_from) { setError('תאריך הסיום חייב להיות לאחר ההתחלה'); return; }
    setSaving(true);
    try {
      await adminApi.addVatPeriod({
        percent: pct,
        valid_from: form.valid_from,
        valid_until: form.valid_until || null,
        notes: form.notes || undefined,
      });
      setForm({ percent: '18', valid_from: '', valid_until: '', notes: '' });
      setAdding(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה');
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('למחוק את התקופה הזאת?')) return;
    try {
      await adminApi.deleteVatPeriod(id);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'שגיאה'); }
  }

  function isActive(p: VATPeriod): boolean {
    return p.valid_from <= today && (!p.valid_until || p.valid_until >= today);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-4 w-4 text-brand-600" />
          תקופות מע״מ
        </CardTitle>
        <CardDescription>
          ניתן להגדיר מספר תקופות במקביל. בחישוב חיוב נבחרת התקופה הפעילה לפי תאריך החיוב.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {periods === null ? (
          <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> טוען...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs">
                  <th className="px-3 py-2 text-start font-medium">% מע״מ</th>
                  <th className="px-3 py-2 text-start font-medium">תקף מ</th>
                  <th className="px-3 py-2 text-start font-medium">תקף עד</th>
                  <th className="px-3 py-2 text-start font-medium">הערה</th>
                  <th className="px-3 py-2 text-end font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {periods.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">אין תקופות</td></tr>
                )}
                {periods.map((p) => (
                  <tr key={p.id} className={`border-b border-slate-50 last:border-0 ${isActive(p) ? 'bg-emerald-50/40' : ''}`}>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-slate-800">{p.percent}%</span>
                      {isActive(p) && <span className="ms-2 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">פעיל</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600" dir="ltr">{fmtDate(p.valid_from)}</td>
                    <td className="px-3 py-2.5 text-slate-600" dir="ltr">{fmtDate(p.valid_until)}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">{p.notes || '—'}</td>
                    <td className="px-3 py-2.5 text-end">
                      <button onClick={() => remove(p.id)} className="text-red-500 hover:text-red-700" title="מחק">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

        {!adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" /> הוסף תקופה
          </Button>
        ) : (
          <form onSubmit={add} className="border-2 border-dashed border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600">תקופת מע״מ חדשה</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">% מע״מ</label>
                <input type="number" step="0.01" min="0" max="100" value={form.percent}
                  onChange={(e) => setForm((f) => ({ ...f, percent: e.target.value }))} dir="ltr"
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">תקף מ</label>
                <input type="date" value={form.valid_from}
                  onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} dir="ltr"
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">תקף עד (אופציונלי)</label>
                <input type="date" value={form.valid_until}
                  onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} dir="ltr"
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">הערה (אופציונלי)</label>
                <input value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                שמור
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => { setAdding(false); setError(''); }}>ביטול</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
