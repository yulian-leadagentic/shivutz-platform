'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Loader2, Pencil, Check, X, Percent, Building2, AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { adminApi } from '@/lib/adminApi';
import type { CorpCommission } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CorpRow {
  id: string;
  name: string;
  commission: CorpCommission | null;
  loadingComm: boolean;
}

// ─── Inline editor ────────────────────────────────────────────────────────────

function CommissionCell({
  row,
  onSaved,
}: {
  row: CorpRow;
  onSaved: (corpId: string, amount: number) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [value, setValue]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const current = row.commission?.commission_per_worker_amount;

  function startEdit() {
    setValue(current != null ? String(current) : '');
    setEditing(true);
    setError('');
  }

  async function handleSave() {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) { setError('יש להזין סכום תקין'); return; }
    setSaving(true);
    try {
      await adminApi.setCorpCommission(row.id, { commission_per_worker_amount: num });
      onSaved(row.id, num);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setSaving(false);
    }
  }

  if (row.loadingComm) {
    return <Loader2 className="h-4 w-4 animate-spin text-slate-300" />;
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${current ? 'text-slate-900' : 'text-slate-400'}`}>
          {current != null ? `₪${Number(current).toLocaleString('he-IL', { minimumFractionDigits: 2 })} / עובד` : 'לא הוגדר'}
        </span>
        <Button size="sm" variant="ghost" onClick={startEdit} className="h-7 w-7 p-0 text-slate-400 hover:text-brand-600">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <span className="absolute start-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₪</span>
        <Input
          type="number"
          min={0}
          step={0.01}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-32 ps-6 text-sm"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 w-8 p-0">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving} className="h-8 w-8 p-0 text-slate-400">
        <X className="h-3.5 w-3.5" />
      </Button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CommissionsPage() {
  const [rows, setRows]     = useState<CorpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch all approved corps
      const orgs = await adminApi.allOrgs();
      const corps = orgs.filter((o) => o.org_type === 'corporation');

      const initial: CorpRow[] = corps.map((c) => ({
        id:          c.id,
        name:        c.company_name_he || c.company_name,
        commission:  null,
        loadingComm: true,
      }));
      setRows(initial);
      setLoading(false);

      // Fetch commission info in parallel
      await Promise.allSettled(
        corps.map(async (c) => {
          try {
            const comm = await adminApi.getCorpCommission(c.id);
            setRows((prev) => prev.map((r) =>
              r.id === c.id ? { ...r, commission: comm, loadingComm: false } : r
            ));
          } catch {
            setRows((prev) => prev.map((r) =>
              r.id === c.id ? { ...r, loadingComm: false } : r
            ));
          }
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינה');
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSaved(corpId: string, amount: number) {
    setRows((prev) => prev.map((r) =>
      r.id === corpId
        ? { ...r, commission: { ...r.commission!, commission_per_worker_amount: amount, currency: 'ILS' } }
        : r
    ));
  }

  const filtered = rows.filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  );

  const noCommCount = rows.filter(
    (r) => !r.loadingComm && (r.commission?.commission_per_worker_amount == null || r.commission.commission_per_worker_amount === 0)
  ).length;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">עמלות תאגידים</h1>
        <p className="text-sm text-slate-500 mt-1">
          הגדרת עמלה לתאגיד — הסכום מחושב לפי מספר עובדים בעסקה × עמלה לעובד
        </p>
      </div>

      {/* Alert: corps without commission */}
      {!loading && noCommCount > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800">
            <strong>{noCommCount} תאגידים</strong> עדיין לא הוגדרה להם עמלה — חיוב בעסקאות שלהם יהיה ₪0
          </p>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-base">
              <Percent className="h-4 w-4 text-brand-600" />
              תאגידים מאושרים ({rows.length})
            </CardTitle>
            <Input
              placeholder="חיפוש תאגיד..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 h-8 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="animate-spin h-5 w-5 me-2" />טוען תאגידים...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              {search ? 'לא נמצאו תאגידים' : 'אין תאגידים מאושרים'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs text-slate-500 font-medium">
                  <th className="text-start px-5 py-3">תאגיד</th>
                  <th className="text-start px-5 py-3">עמלה לעובד</th>
                  <th className="text-start px-5 py-3">עודכן לאחרונה</th>
                  <th className="text-start px-5 py-3">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((row) => {
                  const hasComm = row.commission?.commission_per_worker_amount != null &&
                                  row.commission.commission_per_worker_amount > 0;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Corp name */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                            <Building2 className="h-4 w-4 text-slate-400" />
                          </div>
                          <span className="font-medium text-slate-900">{row.name}</span>
                        </div>
                      </td>

                      {/* Commission editor */}
                      <td className="px-5 py-3">
                        <CommissionCell row={row} onSaved={handleSaved} />
                      </td>

                      {/* Last updated */}
                      <td className="px-5 py-3 text-slate-500 text-xs">
                        {row.commission?.commission_set_at
                          ? new Date(row.commission.commission_set_at).toLocaleDateString('he-IL')
                          : '—'}
                      </td>

                      {/* Status chip */}
                      <td className="px-5 py-3">
                        {row.loadingComm ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300" />
                        ) : hasComm ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="h-3 w-3" />מוגדר
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="h-3 w-3" />לא הוגדר
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Explanation */}
      <Card className="bg-slate-50 border-slate-200">
        <CardContent className="py-4 text-sm text-slate-600 space-y-1.5">
          <p className="font-semibold text-slate-700">איך מחשבים את העמלה לעסקה?</p>
          <p>
            <strong>עמלה לעסקה</strong> = מספר עובדים בעסקה × עמלה לעובד × (1 + מע״מ 18%)
          </p>
          <p className="text-xs text-slate-400">
            לדוגמה: 5 עובדים × ₪200 = ₪1,000 + מע״מ ₪180 = <strong>₪1,180 לחיוב</strong>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
