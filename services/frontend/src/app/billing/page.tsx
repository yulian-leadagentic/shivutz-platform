'use client';

// Pivot/v2 Phase 1 — minimal billing page.
// Shows the calling entity's subscription row + 3 upgrade buttons. No
// invoice history, no proration UX — that's Phase 1.5+.
//
// Phase 1 runs against CARDCOM_SUBS_FAKE_MODE=1, so "Upgrade" returns
// instantly with status=active. When Cardcom recurring is wired the
// /start endpoint will return a Cardcom redirect URL and we'll
// window.location to it here.

import { useEffect, useState } from 'react';
import { Loader2, Check, Sparkles } from 'lucide-react';
import {
  subscriptionApi,
  type SubscriptionRow,
  type SubscriptionTier,
} from '@/lib/api/payments';

const TIERS: { code: SubscriptionTier; title: string; tagline: string; features: string[] }[] = [
  {
    code: 'basic',
    title: 'בסיסי',
    tagline: 'התחלה זריזה',
    features: ['חיפוש בסיסי', 'חשיפת פרטי קשר מוגבלת', '3 מודעות פעילות'],
  },
  {
    code: 'advanced',
    title: 'מתקדם',
    tagline: 'לעובדים בקצב גבוה',
    features: ['חיפושים נרחבים', 'חשיפת קשר מורחבת', '15 מודעות פעילות'],
  },
  {
    code: 'pro',
    title: 'פרו',
    tagline: 'ללא הגבלות',
    features: ['חיפוש ללא הגבלה', 'חשיפת קשר ללא הגבלה', 'מודעות ללא הגבלה + קידום'],
  },
];

const STATUS_LABEL: Record<string, string> = {
  trialing:  'תקופת ניסיון',
  active:    'מנוי פעיל',
  past_due:  'תשלום נכשל',
  cancelled: 'בוטל',
  expired:   'פג תוקף',
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function BillingPage() {
  const [sub, setSub]         = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyTier, setBusy]   = useState<SubscriptionTier | null>(null);
  const [error, setError]     = useState<string>('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const row = await subscriptionApi.me();
      setSub(row);
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בטעינת המנוי');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function upgrade(tier: SubscriptionTier) {
    setBusy(tier);
    setError('');
    try {
      await subscriptionApi.start(tier);
      await refresh();
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בשדרוג');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" />
      </div>
    );
  }

  const trialDays  = sub?.status === 'trialing'  ? daysUntil(sub.trial_ends_at)      : null;
  const periodDays = sub?.status === 'active'    ? daysUntil(sub.current_period_end) : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">חשבון ומנוי</h1>
        <p className="text-sm text-slate-500">ניהול המנוי החודשי שלך</p>
      </header>

      {/* Current subscription card */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">מנוי נוכחי</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {sub ? TIERS.find(t => t.code === sub.tier)?.title : '—'}
              <span className="ms-2 text-sm font-medium text-slate-600">
                {sub ? `(${STATUS_LABEL[sub.status] ?? sub.status})` : ''}
              </span>
            </p>
            {trialDays !== null && (
              <p className="text-sm text-amber-700 mt-1">
                נותרו {trialDays} ימים בתקופת הניסיון
              </p>
            )}
            {periodDays !== null && (
              <p className="text-sm text-emerald-700 mt-1">
                החיוב הבא בעוד {periodDays} ימים
              </p>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Tier picker */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {TIERS.map((t) => {
          const isCurrent = sub?.tier === t.code && sub?.status === 'active';
          return (
            <div
              key={t.code}
              className={`rounded-2xl border p-5 shadow-sm flex flex-col gap-3 transition ${
                isCurrent
                  ? 'border-brand-500 bg-brand-50/40'
                  : 'border-slate-200 bg-white hover:border-brand-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-600" />
                <h3 className="text-lg font-bold text-slate-900">{t.title}</h3>
              </div>
              <p className="text-xs text-slate-500">{t.tagline}</p>
              <ul className="text-sm text-slate-700 space-y-1.5 flex-grow">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busyTier !== null || isCurrent}
                onClick={() => upgrade(t.code)}
                className="w-full bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold py-2.5 rounded-lg
                           disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition"
              >
                {busyTier === t.code ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> מעבד...</>
                ) : isCurrent ? (
                  'המנוי הנוכחי'
                ) : (
                  'שדרג'
                )}
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
