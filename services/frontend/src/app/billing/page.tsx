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
import { Loader2, Check, Sparkles, Users as UsersIcon, Trash2, Plus } from 'lucide-react';
import {
  subscriptionApi,
  type SubscriptionRow,
  type SubscriptionTier,
} from '@/lib/api/payments';
import { adApi, type UsageResponse } from '@/lib/api/ads';
import { memberApi, type TeamMember } from '@/lib/api/members';
import { useAuth } from '@/lib/AuthContext';

// Static tier taglines; the actual limits are pulled live from the
// subscription_plans table via /admin/subscription-plans (via the
// /subscriptions/me endpoint), so the numbers stay in sync when the
// admin edits them.
// Contractor tiers — no "active ads" (contractors don't publish).
// Numbers here are the seed defaults; admin can edit them via
// /admin/subscription-plans and the live limits render below.
const CONTRACTOR_TIERS: { code: SubscriptionTier; title: string; tagline: string; features: string[] }[] = [
  { code: 'basic',    title: 'בסיסי',   tagline: 'התחלה קלה',              features: ['משתמש אחד',          'עד 10 חשיפות פרטי קשר בחודש']  },
  { code: 'advanced', title: 'מתקדם',   tagline: 'לצוותים בקצב עבודה',    features: ['עד 3 משתמשים',        'עד 40 חשיפות בחודש']            },
  { code: 'pro',      title: 'פרו',     tagline: 'לפעילות רחבה',          features: ['עד 10 משתמשים',       'עד 120 חשיפות בחודש']           },
];
const CORP_TIERS: { code: SubscriptionTier; title: string; tagline: string; features: string[] }[] = [
  { code: 'basic',    title: 'בסיסי',   tagline: 'התחלה זריזה',            features: ['3 מודעות פעילות', 'ללא קידום'] },
  { code: 'advanced', title: 'מתקדם',   tagline: 'לתאגידים פעילים',        features: ['15 מודעות פעילות', 'קידום מודעות'] },
  { code: 'pro',      title: 'פרו',     tagline: 'ללא הגבלות',              features: ['מודעות ללא הגבלה', 'קידום ללא הגבלה'] },
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
  const { entityId, entityType } = useAuth();
  const isContractor = entityType === 'contractor';
  const TIERS = isContractor ? CONTRACTOR_TIERS : CORP_TIERS;

  const [sub, setSub]         = useState<SubscriptionRow | null>(null);
  const [usage, setUsage]     = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyTier, setBusy]   = useState<SubscriptionTier | null>(null);
  const [error, setError]     = useState<string>('');

  // Team-members merge (contractor-only). Corp still has /corporation/users.
  const [members, setMembers]   = useState<TeamMember[]>([]);
  const [newPhone, setNewPhone] = useState('');
  const [busyMem, setBusyMem]   = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [row, u] = await Promise.all([
        subscriptionApi.me(),
        adApi.usage().catch(() => null),  // don't hard-fail if usage endpoint is down
      ]);
      setSub(row);
      setUsage(u);
      if (isContractor && entityId) {
        memberApi.list('contractors', entityId)
          .then(setMembers)
          .catch(() => setMembers([]));
      }
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בטעינת המנוי');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [isContractor, entityId]);

  async function addMember() {
    if (!entityId || !isContractor) return;
    const phone = newPhone.trim();
    if (phone.length < 9) { setError('מספר טלפון לא תקין'); return; }
    setBusyMem('add');
    setError('');
    try {
      await memberApi.invite('contractors', entityId, { phone, role: 'member' });
      setNewPhone('');
      const next = await memberApi.list('contractors', entityId);
      setMembers(next);
    } catch (e) { setError((e as Error).message ?? 'שגיאה בהוספה'); }
    finally { setBusyMem(null); }
  }

  async function removeMember(m: TeamMember) {
    if (!entityId || !isContractor) return;
    if (!confirm(`להסיר משתמש: ${m.full_name || m.phone}?`)) return;
    setBusyMem(m.membership_id);
    try {
      await memberApi.remove('contractors', entityId, m.membership_id);
      setMembers((rows) => rows.filter((r) => r.membership_id !== m.membership_id));
    } catch (e) { setError((e as Error).message ?? 'שגיאה בהסרה'); }
    finally { setBusyMem(null); }
  }

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
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
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

        {/* Usage vs limits — contractor sees reveals + user seats,
             corp sees reveals + active ads. */}
        {usage && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100">
            <div>
              <p className="text-xs text-slate-500">חשיפות פרטי קשר החודש</p>
              <p className="text-base font-bold text-slate-900">
                {usage.usage.reveals_this_month} / {usage.limits.reveals_per_month ?? '∞'}
              </p>
            </div>
            {isContractor ? (
              <div>
                <p className="text-xs text-slate-500">משתמשים במנוי</p>
                <p className="text-base font-bold text-slate-900">
                  {members.filter(m => m.is_active !== false).length} / {(usage.limits as unknown as { max_users?: number | null }).max_users ?? '∞'}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-500">מודעות פעילות</p>
                <p className="text-base font-bold text-slate-900">
                  {usage.usage.active_ads} / {usage.limits.active_ads ?? '∞'}
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Contractor-only: team-member phone list (merged from /contractor/users) */}
      {isContractor && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <UsersIcon className="w-4 h-4 text-brand-600" /> משתמשים מורשים
              </h2>
              <p className="text-xs text-slate-500">משתמשים שיוכלו להתחבר לחשבון הקבלן בטלפון שלהם</p>
            </div>
          </div>

          {members.length === 0 ? (
            <p className="text-sm text-slate-500">עדיין לא הוספת משתמשים</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.membership_id} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {m.full_name || ((m.invited_first_name || '') + ' ' + (m.invited_last_name || '')).trim() || m.phone || '—'}
                    </p>
                    <p className="text-xs text-slate-500">{m.phone || '—'}{m.pending ? ' · ממתין' : ''}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMember(m)}
                    disabled={busyMem === m.membership_id}
                    className="inline-flex items-center gap-1 text-xs text-red-700 hover:bg-red-50 px-2 py-1 rounded disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> הסר
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
            <input
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="הוסף מספר טלפון"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={addMember}
              disabled={busyMem !== null || newPhone.trim().length < 9}
              className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:bg-slate-300 inline-flex items-center gap-1.5"
            >
              {busyMem === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              הוסף
            </button>
          </div>
        </section>
      )}

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
