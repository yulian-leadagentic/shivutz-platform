'use client';

// Pivot/v2 admin — subscription tier configuration.
// Six rows: (contractor + corporation) × (basic/advanced/pro).
// Inline edit of every limit + trial-days default. Payment service reads
// this table at request time so changes go live without a redeploy.

import { useEffect, useState } from 'react';
import { Loader2, Save, Infinity as InfIcon } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';

interface Plan {
  id:                     string;
  entity_type:            'contractor' | 'corporation';
  tier:                   'basic' | 'advanced' | 'pro';
  max_users:              number | null;
  max_reveals_per_month:  number | null;
  max_active_ads:         number | null;
  max_ad_lifetime_days:   number | null;
  monthly_price_nis:      number | null;
  can_boost:              boolean;
  trial_days_default:     number;
  cardcom_plan_code:      string | null;
  updated_at:             string;
}

const ENTITY_LABEL = { contractor: 'קבלן', corporation: 'תאגיד' } as const;
const TIER_LABEL   = { basic: 'בסיסי', advanced: 'מתקדם', pro: 'פרו' } as const;

interface Draft {
  max_users:             string;   // "" = unlimited
  max_reveals_per_month: string;
  max_active_ads:        string;
  max_ad_lifetime_days:  string;
  monthly_price_nis:     string;
  can_boost:             boolean;
  trial_days_default:    string;
}

function toDraft(p: Plan): Draft {
  return {
    max_users:             p.max_users             == null ? '' : String(p.max_users),
    max_reveals_per_month: p.max_reveals_per_month == null ? '' : String(p.max_reveals_per_month),
    max_active_ads:        p.max_active_ads        == null ? '' : String(p.max_active_ads),
    max_ad_lifetime_days:  p.max_ad_lifetime_days  == null ? '' : String(p.max_ad_lifetime_days),
    monthly_price_nis:     p.monthly_price_nis     == null ? '' : String(p.monthly_price_nis),
    can_boost:             p.can_boost,
    trial_days_default:    String(p.trial_days_default),
  };
}

export default function SubscriptionPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const rows = await apiFetch<Plan[]>('/admin/subscription-plans');
      setPlans(rows);
      const next: Record<string, Draft> = {};
      for (const p of rows) next[p.id] = toDraft(p);
      setDrafts(next);
    } catch (e) { setError((e as Error).message ?? ''); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function save(p: Plan) {
    const d = drafts[p.id];
    if (!d) return;
    setBusy(p.id);
    setError('');
    const parseCap = (s: string): { value?: number; unlimited?: true } => {
      const t = s.trim();
      if (t === '' || t === '-') return { unlimited: true };
      const n = parseInt(t, 10);
      return Number.isFinite(n) && n >= 0 ? { value: n } : { unlimited: true };
    };
    const users     = parseCap(d.max_users);
    const reveals   = parseCap(d.max_reveals_per_month);
    const ads       = parseCap(d.max_active_ads);
    const lifetime  = parseCap(d.max_ad_lifetime_days);
    const trialDays = parseInt(d.trial_days_default.trim() || '14', 10);
    const price     = d.monthly_price_nis.trim() === '' ? null : parseInt(d.monthly_price_nis, 10);

    const body: Record<string, unknown> = {
      can_boost:          d.can_boost,
      trial_days_default: trialDays,
    };
    if (price !== null && Number.isFinite(price)) body.monthly_price_nis = price;
    const unlimited: string[] = [];
    if (users.unlimited)    unlimited.push('max_users');             else body.max_users             = users.value;
    if (reveals.unlimited)  unlimited.push('max_reveals_per_month'); else body.max_reveals_per_month = reveals.value;
    if (ads.unlimited)      unlimited.push('max_active_ads');        else body.max_active_ads        = ads.value;
    if (lifetime.unlimited) unlimited.push('max_ad_lifetime_days');  else body.max_ad_lifetime_days  = lifetime.value;
    if (unlimited.length) body.unlimited = unlimited;

    try {
      const updated = await apiFetch<Plan>(`/admin/subscription-plans/${p.id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      setPlans((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      setDrafts((d2) => ({ ...d2, [updated.id]: toDraft(updated) }));
    } catch (e) { setError((e as Error).message ?? 'שגיאה בשמירה'); }
    finally { setBusy(null); }
  }

  const grouped = {
    contractor:  plans.filter((p) => p.entity_type === 'contractor'),
    corporation: plans.filter((p) => p.entity_type === 'corporation'),
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">מסלולי מנוי</h1>
        <p className="text-sm text-slate-500">הגדרת מגבלות המנוי לקבלן ולתאגיד. שינויים נכנסים לתוקף מיידית — השאר ריק לצפיה בלתי מוגבלת.</p>
      </header>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>
      ) : (
        (['contractor', 'corporation'] as const).map((et) => (
          <section key={et} className="space-y-3">
            <h2 className="text-base font-bold text-slate-800">{ENTITY_LABEL[et]}</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {grouped[et].map((p) => {
                const d = drafts[p.id];
                if (!d) return null;
                const isContractor = p.entity_type === 'contractor';
                return (
                  <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-lg font-bold text-slate-900">{TIER_LABEL[p.tier]}</h3>
                      <span className="text-[10px] text-slate-400">
                        עודכן {new Date(p.updated_at).toLocaleDateString('he-IL')}
                      </span>
                    </div>

                    <Field
                      label="משתמשים במנוי"
                      value={d.max_users}
                      onChange={(v) => updateDraft(p.id, { max_users: v })}
                    />

                    {isContractor && (
                      <Field
                        label="חשיפות פרטי קשר לחודש"
                        value={d.max_reveals_per_month}
                        onChange={(v) => updateDraft(p.id, { max_reveals_per_month: v })}
                      />
                    )}
                    {!isContractor && (
                      <>
                        <Field
                          label="מודעות פעילות מקסימום"
                          value={d.max_active_ads}
                          onChange={(v) => updateDraft(p.id, { max_active_ads: v })}
                        />
                        <Field
                          label="ימי חיים מקסימלי למודעה"
                          value={d.max_ad_lifetime_days}
                          onChange={(v) => updateDraft(p.id, { max_ad_lifetime_days: v })}
                        />
                      </>
                    )}

                    <Field
                      label="מחיר חודשי (₪)"
                      value={d.monthly_price_nis}
                      onChange={(v) => updateDraft(p.id, { monthly_price_nis: v })}
                      hideUnlimited
                    />

                    <Field
                      label="ימי ניסיון ברירת מחדל"
                      value={d.trial_days_default}
                      onChange={(v) => updateDraft(p.id, { trial_days_default: v })}
                      hideUnlimited
                    />

                    <label className="flex items-center gap-2 text-sm text-slate-700 pt-1">
                      <input
                        type="checkbox"
                        checked={d.can_boost}
                        onChange={(e) => updateDraft(p.id, { can_boost: e.target.checked })}
                        className="rounded"
                      />
                      מאפשר קידום מודעות
                    </label>

                    <button
                      type="button"
                      onClick={() => save(p)}
                      disabled={busy === p.id}
                      className="w-full mt-2 bg-brand-600 hover:bg-brand-800 text-slate-900 text-sm font-semibold py-2 rounded-lg
                                 disabled:bg-slate-300 inline-flex items-center justify-center gap-2"
                    >
                      {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      שמור
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Field({
  label, value, onChange, hideUnlimited,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hideUnlimited?: boolean;
}) {
  const isUnlimited = !hideUnlimited && (value.trim() === '' || value.trim() === '-');
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 ${
            isUnlimited ? 'border-brand-200 bg-brand-50/50 placeholder:text-slate-400' : 'border-slate-300'
          }`}
          placeholder={hideUnlimited ? '' : 'ללא הגבלה'}
        />
        {!hideUnlimited && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="ללא הגבלה"
            className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <InfIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
