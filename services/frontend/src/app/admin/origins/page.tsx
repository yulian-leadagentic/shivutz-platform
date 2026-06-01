'use client';

// Admin CRUD for the origin-country pick-list — QA-R3 #19b. The list is
// short (handful of countries) so we render every row inline rather than
// paginate. Soft-disable via is_active=0 preserves historical worker /
// bid rows that still reference a code.

import { useEffect, useState } from 'react';
import { Loader2, Plus, Edit2, Save, X, EyeOff, Eye, AlertCircle, CheckCircle2 } from 'lucide-react';
import { adminApi } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Country {
  code: string;
  name_he: string;
  name_en: string;
  is_active: number | boolean;
}

function isActive(c: Country): boolean {
  // MySQL returns TINYINT(1) as `0|1` (number); cast defensively.
  return c.is_active === 1 || c.is_active === true;
}

export default function AdminOriginsPage() {
  const [rows, setRows]       = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [toast, setToast]     = useState('');

  // Add-form state
  const [adding, setAdding]   = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newHe, setNewHe]     = useState('');
  const [newEn, setNewEn]     = useState('');
  const [saving, setSaving]   = useState(false);

  // Edit-row state — keyed by code
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editHe, setEditHe] = useState('');
  const [editEn, setEditEn] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function reload() {
    setLoading(true); setError('');
    try {
      const data = await adminApi.listAllOrigins();
      // Sort: active first, then inactive; alpha within each group.
      data.sort((a, b) => {
        const aa = isActive(a) ? 0 : 1;
        const bb = isActive(b) ? 0 : 1;
        if (aa !== bb) return aa - bb;
        return a.name_he.localeCompare(b.name_he, 'he');
      });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת רשימת הארצות');
    } finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, []);

  function startEdit(c: Country) {
    setEditingCode(c.code);
    setEditHe(c.name_he);
    setEditEn(c.name_en);
  }
  function cancelEdit() { setEditingCode(null); }

  async function saveEdit(code: string) {
    setRowBusy(code);
    try {
      await adminApi.updateOrigin(code, { name_he: editHe.trim(), name_en: editEn.trim() });
      flashToast('הארץ עודכנה');
      setEditingCode(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בעדכון');
    } finally { setRowBusy(null); }
  }

  async function toggleActive(c: Country) {
    setRowBusy(c.code);
    try {
      if (isActive(c)) await adminApi.deactivateOrigin(c.code);
      else             await adminApi.updateOrigin(c.code, { is_active: true });
      flashToast(isActive(c) ? 'הארץ הושבתה' : 'הארץ הופעלה');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשינוי הסטטוס');
    } finally { setRowBusy(null); }
  }

  async function submitAdd() {
    const code = newCode.trim().toUpperCase();
    if (code.length !== 2) { setError('יש להזין קוד ISO בן שתי אותיות (למשל UA)'); return; }
    if (!newHe.trim() || !newEn.trim()) { setError('שמות עבריים ואנגליים הם שדות חובה'); return; }
    setSaving(true); setError('');
    try {
      await adminApi.addOrigin({ code, name_he: newHe.trim(), name_en: newEn.trim() });
      flashToast(`${newHe} נוספה לרשימה`);
      setNewCode(''); setNewHe(''); setNewEn('');
      setAdding(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בהוספה');
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ארצות מוצא</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            ניהול רשימת הארצות שמוצגות לקבלן בעת פתיחת בקשה ולתאגיד בעת הגשת הצעה.
          </p>
        </div>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> הוסף ארץ
          </Button>
        )}
      </div>

      {/* Inline add form */}
      {adding && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50/30 p-4 space-y-3">
          <h2 className="text-sm font-bold text-slate-800">הוספת ארץ חדשה</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="קוד ISO (2 אותיות)" placeholder="UA"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase().slice(0, 2))}
              dir="ltr" />
            <Input label="שם בעברית" placeholder="אוקראינה"
              value={newHe} onChange={(e) => setNewHe(e.target.value)} />
            <Input label="שם באנגלית" placeholder="Ukraine"
              value={newEn} onChange={(e) => setNewEn(e.target.value)} dir="ltr" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setAdding(false); setError(''); }}>
              ביטול
            </Button>
            <Button size="sm" onClick={submitAdd} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר…</> : <><Plus className="h-4 w-4" /> הוסף</>}
            </Button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800 inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> {toast}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 inline-flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-10 text-sm text-slate-500">אין ארצות ברשימה.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-start px-4 py-2.5 font-semibold">קוד</th>
                <th className="text-start px-4 py-2.5 font-semibold">שם בעברית</th>
                <th className="text-start px-4 py-2.5 font-semibold">שם באנגלית</th>
                <th className="text-start px-4 py-2.5 font-semibold">סטטוס</th>
                <th className="text-end px-4 py-2.5 font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => {
                const editing = editingCode === c.code;
                const busy    = rowBusy === c.code;
                const active  = isActive(c);
                return (
                  <tr key={c.code} className={!active ? 'opacity-60' : ''}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500" dir="ltr">{c.code}</td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <Input value={editHe} onChange={(e) => setEditHe(e.target.value)} />
                      ) : (
                        <span className="font-semibold text-slate-900">{c.name_he}</span>
                      )}
                    </td>
                    <td className="px-4 py-3" dir="ltr">
                      {editing ? (
                        <Input value={editEn} onChange={(e) => setEditEn(e.target.value)} />
                      ) : (
                        <span className="text-slate-700">{c.name_en}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {active ? 'פעיל' : 'מושבת'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 justify-end">
                        {editing ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => saveEdit(c.code)} disabled={busy}>
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              שמור
                            </Button>
                            <Button size="sm" variant="outline" onClick={cancelEdit}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => startEdit(c)}>
                              <Edit2 className="h-3.5 w-3.5" /> ערוך
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => toggleActive(c)} disabled={busy}>
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : active
                                ? <><EyeOff className="h-3.5 w-3.5" /> השבת</>
                                : <><Eye className="h-3.5 w-3.5" /> הפעל</>}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-slate-400">
        ארץ מושבתת לא תוצג בבחירת מוצא בטופסי קבלן ותאגיד, אבל עובדים והצעות קיימות שמתייחסים אליה יישמרו.
      </p>
    </div>
  );
}
