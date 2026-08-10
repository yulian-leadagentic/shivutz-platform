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
import Link from 'next/link';
import { Loader2, Check, Sparkles, Users as UsersIcon, Trash2, Plus, ChevronRight, RefreshCw, Crown, ArrowLeft, ArrowRight } from 'lucide-react';
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
const CONTRACTOR_TIERS: { code: SubscriptionTier; title: string; tagline: string; price: number | null; features: string[] }[] = [
  { code: 'basic',    title: 'בסיסי',   tagline: 'התחלה קלה',              price: null, features: ['משתמש אחד',          'עד 10 חשיפות פרטי קשר בחודש']  },
  { code: 'advanced', title: 'מתקדם',   tagline: 'לצוותים בקצב עבודה',    price: null, features: ['עד 3 משתמשים',        'עד 40 חשיפות בחודש']            },
  { code: 'pro',      title: 'פרו',     tagline: 'לפעילות רחבה',          price: null, features: ['עד 10 משתמשים',       'עד 120 חשיפות בחודש']           },
];
const CORP_TIERS: { code: SubscriptionTier; title: string; tagline: string; price: number; features: string[] }[] = [
  { code: 'basic',    title: 'בסיסי',   tagline: 'התחלה זריזה',      price: 80,  features: ['3 משתמשים', '3 מודעות פעילות במקביל', 'פרסום עד 30 יום'] },
  { code: 'advanced', title: 'מתקדם',   tagline: 'לתאגידים פעילים',  price: 140, features: ['6 משתמשים', '6 מודעות פעילות במקביל', 'פרסום עד 90 יום · קידום'] },
  { code: 'pro',      title: 'פרו',     tagline: 'ללא הגבלות',        price: 170, features: ['12 משתמשים', '12 מודעות פעילות', 'פרסום ללא הגבלה · קידום'] },
];

const TIER_ORDER: Record<SubscriptionTier, number> = { basic: 1, advanced: 2, pro: 3 };

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
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/seat_limit/i.test(msg)) {
        setError('הגעת לתקרת המשתמשים במסלול הנוכחי — שדרג כדי להוסיף עוד.');
      } else {
        setError(msg || 'שגיאה בהוספה');
      }
    }
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
        <Link
          href={isContractor ? '/contractor/dashboard' : '/corporation/dashboard'}
          className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
        >
          <ChevronRight className="w-3 h-3 me-1" /> חזרה ללוח בקרה
        </Link>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900">חשבון ומנוי</h1>
          {/* B4 — payment-service mode chip. Only shown while the
              backend runs in fake mode; hides itself once Cardcom
              recurring is live. */}
          {(sub as unknown as { payment_mode?: string })?.payment_mode === 'fake' && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider rounded-full border border-amber-300 bg-amber-50 text-amber-700 px-2 py-0.5"
              title="חיוב מדומה — Cardcom האמיתי עדיין לא מחובר. כל 'תשלום' עובר להצלחה מיידית."
            >
              מצב בדיקה
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500">ניהול המנוי החודשי שלך</p>
      </header>

      {/* Current subscription hero — bold summary + clear status */}
      {(() => {
        const currentTier = sub ? TIERS.find(t => t.code === sub.tier) : null;
        const isTrialing  = sub?.status === 'trialing';
        const isActive    = sub?.status === 'active';
        const isLapsed    = sub && !isActive && !isTrialing;
        const statusColor = isTrialing ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : isActive     ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        :                'bg-red-100 text-red-800 border-red-300';
        return (
      <section className="rounded-2xl overflow-hidden shadow-md border border-slate-200 bg-gradient-to-l from-brand-50 via-white to-white">
        <div className="p-5 sm:p-6 space-y-3">
          {/* B2 — hero line: label + status chip in one row.
              Removes the vestigial flex-justify-between wrapper that
              left the right half of the card empty on wide screens. */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-brand-700 uppercase tracking-wider inline-flex items-center gap-1.5">
              <Crown className="w-3.5 h-3.5" /> המנוי שלך
            </p>
            {sub && (
              <span className={`inline-block text-[11px] font-bold rounded-full px-2.5 py-0.5 border ${statusColor}`}>
                {STATUS_LABEL[sub.status] ?? sub.status}
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
              {currentTier?.title ?? (error ? '—' : (
                <span className="inline-block w-24 h-8 rounded-md bg-slate-100 animate-pulse" aria-label="טוען" />
              ))}
            </h2>
            {currentTier && 'price' in currentTier && currentTier.price != null && (
              <p className="text-lg font-bold text-slate-700">
                ₪{currentTier.price}
                <span className="text-xs font-medium text-slate-500 ms-1">/ חודש · חידוש אוטומטי</span>
              </p>
            )}
          </div>

          {trialDays !== null && (
            <p className="text-sm text-amber-800 font-medium">
              נותרו {trialDays} ימים בתקופת הניסיון החינמית
            </p>
          )}
          {periodDays !== null && (
            <p className="text-sm text-emerald-800 font-medium">
              החיוב הבא בעוד {periodDays} ימים
            </p>
          )}
          {isLapsed && (
            <p className="text-sm text-red-800 font-medium">
              המנוי לא פעיל. שדרג כדי להמשיך להשתמש.
            </p>
          )}

        {/* Usage vs limits — B1 role-scoped grid:
             contractor sees reveals-consumed + user seats;
             corp sees active-ads + ad lifetime + user seats
             (no reveal counter — corps receive reveals, don't spend). */}
        {usage && (
          <div className={`grid grid-cols-1 ${isContractor ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-3 pt-3 border-t border-slate-100`}>
            {isContractor ? (
              <>
                <div>
                  <p className="text-xs text-slate-500">חשיפות פרטי קשר החודש</p>
                  <p className="text-base font-bold text-slate-900">
                    {usage.usage.reveals_this_month} / {usage.limits.reveals_per_month ?? '∞'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">משתמשים במנוי</p>
                  <p className="text-base font-bold text-slate-900">
                    {members.filter(m => m.is_active !== false).length} / {(usage.limits as unknown as { max_users?: number | null }).max_users ?? '∞'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs text-slate-500">מודעות פעילות</p>
                  <p className="text-base font-bold text-slate-900">
                    {usage.usage.active_ads} / {usage.limits.active_ads ?? '∞'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">משך חיים מקסימלי למודעה</p>
                  <p className="text-base font-bold text-slate-900">
                    {(usage.limits as unknown as { max_ad_lifetime_days?: number | null }).max_ad_lifetime_days == null
                      ? 'ללא הגבלה'
                      : `${(usage.limits as unknown as { max_ad_lifetime_days?: number }).max_ad_lifetime_days} ימים`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">משתמשים במנוי</p>
                  <p className="text-base font-bold text-slate-900">
                    <Link href="/corporation/users" className="text-brand-700 hover:underline">לניהול</Link>
                    {' '}/ {(usage.limits as unknown as { max_users?: number | null }).max_users ?? '∞'}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
        </div>
      </section>
        );
      })()}

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
                    <p className="text-xs text-slate-500"><span dir="ltr">{m.phone || '—'}</span>{m.pending ? ' · ממתין' : ''}</p>
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
              className="bg-brand-600 hover:bg-brand-800 text-slate-900 text-sm font-semibold px-4 py-2 rounded-lg disabled:bg-slate-300 inline-flex items-center gap-1.5"
            >
              {busyMem === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              הוסף
            </button>
          </div>
        </section>
      )}

      {error && (
        <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1 text-xs font-semibold text-red-800 hover:bg-red-100 px-2 py-1 rounded"
          >
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      )}

      {/* Tier picker */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-3">חבילות זמינות</h2>
      </div>
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {TIERS.map((t) => {
          const currentOrder  = sub ? (TIER_ORDER[sub.tier] ?? 0) : 0;
          const targetOrder   = TIER_ORDER[t.code];
          // Highlight current tier for both trialing + active so it's
          // marked from day 0, not only after conversion.
          const isCurrent     = sub?.tier === t.code && (sub?.status === 'active' || sub?.status === 'trialing');
          const isUpgrade     = !isCurrent && targetOrder > currentOrder;
          const isDowngrade   = !isCurrent && targetOrder < currentOrder;
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
                {isCurrent && (
                  <span className="ms-auto inline-flex items-center gap-1 text-[10px] font-bold text-brand-800 bg-brand-100 border border-brand-300 rounded-full px-2 py-0.5">
                    <Crown className="w-3 h-3" /> המנוי שלך
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">{t.tagline}</p>
              {t.price != null && (
                <p className="text-lg font-extrabold text-slate-900">
                  ₪{t.price}
                  <span className="text-xs font-medium text-slate-500 ms-1">/ חודש · חידוש אוטומטי</span>
                </p>
              )}
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
                className={`w-full text-sm font-semibold py-2.5 rounded-lg
                           disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition ${
                  isCurrent
                    ? 'bg-slate-100 text-slate-500 border border-slate-200'
                    : isDowngrade
                      ? 'bg-white text-slate-700 border-2 border-slate-300 hover:border-slate-400'
                      : 'bg-brand-600 hover:bg-brand-800 text-slate-900 disabled:bg-slate-300'
                }`}
              >
                {busyTier === t.code ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> מעבד…</>
                ) : isCurrent ? (
                  <><Crown className="w-4 h-4" /> המנוי הנוכחי</>
                ) : isUpgrade ? (
                  <>שדרג ל{t.title} <ArrowLeft className="w-4 h-4" /></>
                ) : isDowngrade ? (
                  <>עבור ל{t.title} <ArrowRight className="w-4 h-4" /></>
                ) : (
                  <>בחר חבילה זו <ArrowLeft className="w-4 h-4" /></>
                )}
              </button>
            </div>
          );
        })}
      </section>

      {/* Payment method / Cardcom footnote — real recurring flow lands
          when the customer's Cardcom account is active (see Q4 in the
          pivot plan). For now upgrades flip status via fake mode. */}
      <p className="text-xs text-slate-400 text-center pt-2">
        התשלום מתבצע בקארדקום · חידוש אוטומטי חודשי · ניתן לבטל בכל עת
      </p>
    </div>
  );
}
