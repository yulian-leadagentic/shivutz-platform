'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, CheckCircle2, XCircle, BadgeDollarSign } from 'lucide-react';
import { adminApi, CorporationPricing } from '@/lib/adminApi';
import { orgApi } from '@/lib/api';
import type { Corporation } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function fmt(d?: string) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('he-IL'); } catch { return d; }
}

interface PricingFormState {
  corporation_id: string;
  price_per_deal: string;
  valid_from: string;
  valid_until: string;
  notes: string;
}

const EMPTY_FORM: PricingFormState = {
  corporation_id: '', price_per_deal: '', valid_from: '', valid_until: '', notes: '',
};

export default function PricingPage() {
  const [pricings, setPricings]     = useState<CorporationPricing[]>([]);
  const [corps, setCorps]           = useState<Corporation[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editId, setEditId]         = useState<string | null>(null);
  const [form, setForm]             = useState<PricingFormState>(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    Promise.all([
      adminApi.listPricing(),
      // Fetch approved corporations list — use admin orgs endpoint
      adminApi.allOrgs().then((orgs) =>
        orgs.filter((o) => (o as unknown as { org_type: string }).org_type === 'corporation')
      ),
    ]).then(([p, c]) => {
      setPricings(p);
      setCorps(c as unknown as Corporation[]);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function startNew() {
    setEditId(null);
    setForm({ ...EMPTY_FORM, valid_from: new Date().toISOString().slice(0, 10) });
    setShowForm(true);
    setError('');
  }

  function startEdit(p: CorporationPricing) {
    setEditId(p.id);
    setForm({
      corporation_id: p.corporation_id,
      price_per_deal: String(p.price_per_deal),
      valid_from: p.valid_from ?? '',
      valid_until: p.valid_until ?? '',
      notes: p.notes ?? '',
    });
    setShowForm(true);
    setError('');
  }

  async function handleSave() {
    if (!form.corporation_id) { setError('יש לבחור תאגיד'); return; }
    const price = parseFloat(form.price_per_deal);
    if (!price || price <= 0) { setError('יש להזין מחיר תקין'); return; }
    if (!form.valid_from) { setError('יש להזין תאריך תחילת תוקף'); return; }

    setSaving(true); setError('');
    try {
      if (editId) {
        await adminApi.updatePricing(editId, {
          price_per_deal: price,
          valid_until: form.valid_until || undefined,
          notes: form.notes || undefined,
        });
        setPricings((prev) => prev.map((p) =>
          p.id === editId ? { ...p, price_per_deal: price, valid_until: form.valid_until, notes: form.notes } : p
        ));
      } else {
        const result = await adminApi.createPricing({
          corporation_id: form.corporation_id,
          price_per_deal: price,
          valid_from: form.valid_from,
          valid_until: form.valid_until || undefined,
          notes: form.notes || undefined,
        });
        // Refresh list
        const fresh = await adminApi.listPricing();
        setPricings(fresh);
        void result;
      }
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: CorporationPricing) {
    await adminApi.updatePricing(p.id, { is_active: !p.is_active });
    setPricings((prev) => prev.map((x) => x.id === p.id ? { ...x, is_active: !x.is_active } : x));
  }

  const corpMap = Object.fromEntries(corps.map((c) => [c.id, c.company_name_he || c.company_name]));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">תמחור תאגידים</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            ניהול עלות גיוס קבועה לכל תאגיד — מחושב אוטומטית בעת אישור עסקה
          </p>
        </div>
        <Button onClick={startNew}>
          <Plus className="h-4 w-4" />
          הוסף תמחור
        </Button>
      </div>

      {/* Explanation card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-4 flex items-start gap-3">
          <BadgeDollarSign className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold">כיצד עובד התמחור?</p>
            <p className="mt-0.5 text-blue-700">
              כאשר תאגיד מאשר עסקה, המחיר מהתמחור הפעיל נרשם אוטומטית כ&quot;מחיר מוסכם&quot; בעסקה.
              זה מאפשר לך לחייב את התאגיד על כל גיוס שמתבצע דרך הפלטפורה.
              תשלום בפועל יטופל בשלב מאוחר יותר.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      {showForm && (
        <Card className="border-primary-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editId ? 'עריכת תמחור' : 'תמחור חדש'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!editId && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700">תאגיד *</label>
                <select
                  value={form.corporation_id}
                  onChange={(e) => setForm((f) => ({ ...f, corporation_id: e.target.value }))}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">בחר תאגיד...</option>
                  {corps.map((c) => (
                    <option key={c.id} value={c.id}>{c.company_name_he || c.company_name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="מחיר לגיוס (₪) *"
                type="number"
                min={0}
                step={100}
                placeholder="5000"
                value={form.price_per_deal}
                onChange={(e) => setForm((f) => ({ ...f, price_per_deal: e.target.value }))}
              />
              <Input
                label="תאריך תחילת תוקף *"
                type="date"
                value={form.valid_from}
                onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
              />
              <Input
                label="תאריך סיום תוקף (ריק = ללא הגבלה)"
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
              />
            </div>
            <Input
              label="הערות (אופציונלי)"
              placeholder="הערות לתנאי ההתקשרות..."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
            )}
            <div className="flex gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />שומר...</> : 'שמור'}
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>ביטול</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${pricings.length} רשומות תמחור`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : pricings.length === 0 ? (
            <p className="text-center text-slate-400 py-8 text-sm">
              אין רשומות תמחור — הוסף תמחור לתאגיד ראשון
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="px-4 py-3 text-start font-medium">תאגיד</th>
                    <th className="px-4 py-3 text-start font-medium">מחיר לגיוס</th>
                    <th className="px-4 py-3 text-start font-medium">תוקף</th>
                    <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                    <th className="px-4 py-3 text-start font-medium">הערות</th>
                    <th className="px-4 py-3 text-start font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {pricings.map((p) => (
                    <tr key={p.id} className={`border-b border-slate-50 hover:bg-slate-50 ${!p.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {p.corporation_name || corpMap[p.corporation_id] || p.corporation_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        ₪{Number(p.price_per_deal).toLocaleString('he-IL')}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <div>{fmt(p.valid_from)} –</div>
                        <div>{p.valid_until ? fmt(p.valid_until) : 'ללא הגבלה'}</div>
                      </td>
                      <td className="px-4 py-3">
                        {p.is_active
                          ? <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 text-xs"><CheckCircle2 className="h-3 w-3" />פעיל</span>
                          : <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5 text-xs"><XCircle className="h-3 w-3" />לא פעיל</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{p.notes || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => startEdit(p)}
                            className="text-slate-400 hover:text-primary-600 transition-colors"
                            title="ערוך"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => toggleActive(p)}
                            className={`text-xs font-medium hover:underline ${p.is_active ? 'text-red-500' : 'text-emerald-600'}`}
                          >
                            {p.is_active ? 'השבת' : 'הפעל'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
