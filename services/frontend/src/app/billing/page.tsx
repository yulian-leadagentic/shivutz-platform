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
import { adApi, type UsageResponse, type PlanRow } from '@/lib/api/ads';
import { memberApi, type TeamMember } from '@/lib/api/members';
import { ApiError } from '@/lib/api/client';
import { mapApiError } from '@/lib/api/errors';
import { checkIsraeliPhone } from '@/lib/phone';
import { useAuth } from '@/lib/AuthContext';

// Static tier taglines; the actual limits are pulled live from the
// subscription_plans table via /admin/subscription-plans (via the
// /subscriptions/me endpoint), so the numbers stay in sync when the
// admin edits them.
// Contractor tiers — no "active ads" (contractors don't publish).
// Numbers here are the seed defaults; admin can edit them via
// /admin/subscription-plans and the live limits render below.
// R26 §1d · only names + taglines here. Every number (price, seats,
// reveals, ad lifetime) is read from the /ads/plans catalog at
// render time — see PLANS_META below and the plan-card loop far
// below. If /ads/plans doesn't have a row for a tier (fresh DB,
// unseeded plan), the card renders "מחיר לא זמין" + disabled button
// per R26 §1c — never a hardcoded ₪.
const CONTRACTOR_TIERS: { code: SubscriptionTier; title: string; tagline: string }[] = [
  { code: 'basic',    title: 'בסיסי',   tagline: 'התחלה קלה' },
  { code: 'advanced', title: 'מתקדם',   tagline: 'לצוותים בקצב עבודה' },
  { code: 'pro',      title: 'פרו',     tagline: 'לפעילות רחבה' },
];
const CORP_TIERS: { code: SubscriptionTier; title: string; tagline: string }[] = [
  { code: 'basic',    title: 'בסיסי',   tagline: 'התחלה זריזה' },
  { code: 'advanced', title: 'מתקדם',   tagline: 'לתאגידים פעילים' },
  { code: 'pro',      title: 'פרו',     tagline: 'ללא הגבלות' },
];

const TIER_ORDER: Record<SubscriptionTier, number> = { basic: 1, advanced: 2, pro: 3 };

const STATUS_LABEL: Record<string, string> = {
  trialing:  'תקופת ניסיון',
  active:    'מנוי פעיל',
  past_due:  'תשלום נכשל',
  cancelled: 'בוטל',
  expired:   'פג תוקף',
  // R9 §5 · admin-granted comp. Yulian: "the contractor sees an
  // indicator — 'active subscription · no billing'. Not 'trial' and
  // not 'free'; it's a full account."
  comped:    'מנוי פעיל · ללא חיוב',
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function BillingPage() {
  const { entityId, entityType, userId } = useAuth();
  const isContractor = entityType === 'contractor';
  const TIERS = isContractor ? CONTRACTOR_TIERS : CORP_TIERS;

  const [sub, setSub]         = useState<SubscriptionRow | null>(null);
  const [usage, setUsage]     = useState<UsageResponse | null>(null);
  // R26 §1b · full tier catalog for the current entity_type. Each
  // plan card reads its numbers from here (price, included_users,
  // max_users, extra_user_price_nis). A tier that isn't in the DB
  // is absent from `plans` and its card renders "מחיר לא זמין"
  // + disabled button per R26 §1c.
  const [plans, setPlans]     = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTier, setBusy]   = useState<SubscriptionTier | null>(null);
  const [error, setError]     = useState<string>('');
  // R2 — distinct empty-state from real error. `noSub` is set when the
  // payment service returns 404 (no subscription row); the hero switches
  // to "אין מנוי פעיל · רכשו מנוי" instead of the red banner. Today the
  // payment service lazy-inits a trialing row so this is rarely hit,
  // but the whole point is that IF the lazy-init breaks, the user sees
  // a CTA rather than assuming the app is broken.
  const [noSub, setNoSub]     = useState<boolean>(false);
  // L5 §8 · last successful charge's Cardcom invoice link. Cleared
  // on each upgrade attempt; hydrated only when the payment service
  // returns `invoice_url` (real-mode only).
  const [lastInvoiceUrl, setLastInvoiceUrl] = useState<string | null>(null);

  // Team-members merge (contractor-only). Corp still has /corporation/users.
  const [members, setMembers]   = useState<TeamMember[]>([]);
  const [newPhone, setNewPhone] = useState('');
  const [busyMem, setBusyMem]   = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError('');
    setNoSub(false);
    try {
      const [row, u, p] = await Promise.all([
        subscriptionApi.me(),
        adApi.usage().catch(() => null),  // don't hard-fail if usage endpoint is down
        adApi.plans().catch(() => ({ tiers: [] as PlanRow[] })),  // catalog is nice-to-have too
      ]);
      setSub(row);
      setUsage(u);
      setPlans(p.tiers);
      if (isContractor && entityId) {
        memberApi.list('contractors', entityId)
          .then(setMembers)
          .catch(() => setMembers([]));
      }
    } catch (e) {
      // R2 — 404 means "no subscription yet", not "something broke".
      // Show the empty-state (CTA to buy) instead of a red 5xx banner.
      // status is bound to the transport, so a copy tweak in
      // mapApiError won't silently break this branch. See b3c6620.
      const status = e instanceof ApiError ? e.cause?.status : undefined;
      if (status === 404) {
        setSub(null);
        setNoSub(true);
      } else {
        // QA-3 fallout: raw `.message` was surfacing English codes into
        // the red banner. Route through mapApiError instead.
        setError(mapApiError(e));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [isContractor, entityId]);

  async function addMember() {
    if (!entityId || !isContractor) return;
    // U8 §4a — validate the raw text then send the NORMALIZED
    // form. `phone.trim()` used to ship "0525267879גגג" straight to
    // the server. `check.normalized` is always the canonical form
    // (0XXXXXXXXX or +972XXXXXXXXX).
    const check = checkIsraeliPhone(newPhone);
    if (!check.valid || !check.normalized) {
      setError(check.message ?? 'מספר טלפון לא תקין');
      return;
    }
    setBusyMem('add');
    setError('');
    try {
      await memberApi.invite('contractors', entityId, { phone: check.normalized, role: 'member' });
      setNewPhone('');
      const next = await memberApi.list('contractors', entityId);
      setMembers(next);
    } catch (e) {
      // Detect the seat-limit case off the structured server code
      // (`cause.error === 'seat_limit'`), not the Hebrew message —
      // otherwise a mapApiError copy tweak silently breaks the
      // specialised upgrade nudge. mapApiError is still the default.
      const code = e instanceof ApiError ? (e.cause?.error || e.cause?.code) : undefined;
      if (code === 'seat_limit') {
        setError('הגעת לתקרת המשתמשים במסלול הנוכחי — שדרג כדי להוסיף עוד.');
      } else {
        setError(mapApiError(e));
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
    } catch (e) { setError(mapApiError(e)); }
    finally { setBusyMem(null); }
  }

  async function upgrade(tier: SubscriptionTier) {
    setBusy(tier);
    setError('');
    setLastInvoiceUrl(null);
    try {
      const result = await subscriptionApi.start(tier);
      // L5 §8 — surface the Cardcom invoice link when it came back.
      // Fake mode returns no invoice, so this stays null and the
      // "Invoice ready" row simply doesn't render.
      if (result.invoice_url) setLastInvoiceUrl(result.invoice_url);
      await refresh();
    } catch (e) {
      // R3 — QA-3 follow-up. Sibling calls (`refresh`, `addMember`,
      // `removeMember`) already go through mapApiError, so an upgrade
      // failure was the only path still leaking English machine codes
      // ("no_active_subscription", "plan_not_found") into the red
      // banner.
      setError(mapApiError(e));
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
          {/* R25 §1d · payment-service mode chip. Only rendered when
              the backend explicitly reports payment_mode === 'fake'
              (server-gated by PAYMENT_FAKE_MODE) — self-hides in
              production. Tooltip text softened to plain-language
              "test environment" instead of the previous dev-jargon
              copy that read as a Cardcom outage. */}
          {(sub as unknown as { payment_mode?: string })?.payment_mode === 'fake' && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider rounded-full border border-amber-300 bg-amber-50 text-amber-700 px-2 py-0.5"
              title="סביבת בדיקות — התשלומים לא באמת נגבים."
            >
              מצב בדיקה
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500">ניהול המנוי החודשי שלך</p>
      </header>

      {/* R2 — no-subscription empty state. Shown ONLY when the payment
          service explicitly returns 404 (not on any other error).
          Matches the "אין מנוי פעיל · רכשו מנוי" pattern on the
          dashboard subscription widget so both surfaces speak the same
          language when a lazy-init miss finally happens. */}
      {noSub && !loading && (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-700 mx-auto mb-3 flex items-center justify-center">
            <Crown className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">אין מנוי פעיל</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
            בחרו מסלול למטה כדי להתחיל — פרסום מודעות וחשיפת פרטי תאגידים דורשים מנוי פעיל.
          </p>
        </section>
      )}

      {/* Current subscription hero — bold summary + clear status */}
      {!noSub && (() => {
        const currentTier = sub ? TIERS.find(t => t.code === sub.tier) : null;
        const isTrialing  = sub?.status === 'trialing';
        const isActive    = sub?.status === 'active';
        // R9 §5 · comped renders like `active` (both are "your account
        // works"). Kept as its own variable so the chip label — which
        // reads differently — stays honest.
        const isComped    = sub?.status === 'comped';
        const isLapsed    = sub && !isActive && !isTrialing && !isComped;
        const statusColor = isTrialing ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : isActive     ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : isComped     ? 'bg-sky-100 text-sky-800 border-sky-300'
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
            {/* R26 §1d · hero price reads from /ads/plans catalog for
                the current tier (same source the plan cards use). No
                more hardcoded price on the tier meta. Missing row =
                the hero simply omits the price line — the disabled
                upgrade path on the cards below already communicates
                'no catalog'. */}
            {sub && (() => {
              const heroPrice = plans.find(p => p.tier === sub.tier)?.monthly_price_nis;
              if (heroPrice == null) return null;
              return (
                <p className="text-lg font-bold text-slate-700">
                  ₪{heroPrice}
                  <span className="text-xs font-medium text-slate-500 ms-1">/ חודש · חידוש אוטומטי</span>
                </p>
              );
            })()}
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
              {members.map((m) => {
                // R25 §1e · account owner can't remove themselves. The
                // 'הסר' button on the current user's own row was a
                // footgun — server would refuse (last-owner guard),
                // but the customer-side experience was "click, wait,
                // Hebrew error". Disable the button visibly + label.
                const isSelf = m.user_id != null && m.user_id === userId;
                return (
                <li key={m.membership_id} className="py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {m.full_name || ((m.invited_first_name || '') + ' ' + (m.invited_last_name || '')).trim() || m.phone || '—'}
                      {isSelf && <span className="text-[10px] font-normal text-slate-400 ms-1.5">(אתה)</span>}
                    </p>
                    <p className="text-xs text-slate-500"><span dir="ltr">{m.phone || '—'}</span>{m.pending ? ' · ממתין' : ''}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => !isSelf && removeMember(m)}
                    disabled={isSelf || busyMem === m.membership_id}
                    title={isSelf ? 'בעל החשבון אינו יכול להסיר את עצמו' : undefined}
                    className="inline-flex items-center gap-1 text-xs text-red-700 hover:bg-red-50 px-2 py-1 rounded disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> הסר
                  </button>
                </li>
                );
              })}
            </ul>
          )}

          <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
            {/* R30 §15 · dir="ltr" so the number reads in the right
                order. No autoComplete: this adds a TEAMMATE's number to
                the notification list, and autofilling the operator's own
                details into a third-party field is worse than no
                autofill at all. inputMode still gives the right keypad. */}
            <input
              type="tel"
              inputMode="tel"
              dir="ltr"
              id="billing-notify-phone"
              name="notify-phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="הוסף מספר טלפון"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm text-start outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
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

      {/* L5 §8 — Cardcom invoice link from the last successful charge.
          Displayed only in real mode; fake mode returns no invoice_url
          and this row simply doesn't render. */}
      {lastInvoiceUrl && (
        <div className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="flex-1">התשלום נקלט. חשבונית מוכנה להורדה מ-Cardcom.</span>
          <a
            href={lastInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 px-2 py-1 rounded"
          >
            הצג חשבונית
          </a>
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
          const isCurrent     = sub?.tier === t.code && (sub?.status === 'active' || sub?.status === 'trialing' || sub?.status === 'comped');
          const isUpgrade     = !isCurrent && targetOrder > currentOrder;
          const isDowngrade   = !isCurrent && targetOrder < currentOrder;
          // R26 §1b/c/d · card numbers come from the /ads/plans catalog.
          // No row = tier isn't seeded on this env → priceMissing branch.
          // Row with monthly_price_nis === null = same branch (fallback
          // path from subscription_limits.tier_limits when the DB row
          // is absent; _FALLBACK doesn't carry a price by design).
          const plan          = plans.find(p => p.tier === t.code);
          const price         = plan?.monthly_price_nis ?? null;
          const priceMissing  = price == null;
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
              {/* R26 §1c · price OR the 'not available' notice, never
                  a blank line. When priceMissing the upgrade button
                  is disabled too — a card without a price cannot be
                  purchased, and rendering a live button next to
                  no-price is the exact "click and be surprised" bug
                  R26 exists to prevent. */}
              {priceMissing ? (
                <p className="text-sm text-slate-500 italic">
                  מחיר לא זמין
                  <span className="text-xs font-normal text-slate-400 ms-1">· פנה לתמיכה</span>
                </p>
              ) : (
                <p className="text-lg font-extrabold text-slate-900">
                  ₪{price}
                  <span className="text-xs font-medium text-slate-500 ms-1">/ חודש · חידוש אוטומטי</span>
                </p>
              )}
              {/* R26 §1d · features from the catalog row. included_users
                  / max_users renders as "N כלולים · עד M" (R25 §1b
                  wording, now data-driven). reveals_per_month varies
                  by tier so it belongs here too. active_ads only for
                  corporations (that's where the tier gate on ads
                  lives — contractors don't publish). */}
              <ul className="text-sm text-slate-700 space-y-1.5 flex-grow">
                {plan?.included_users != null && (
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>
                      {plan.included_users} משתמשים כלולים
                      {plan.max_users != null && ` · עד ${plan.max_users}`}
                    </span>
                  </li>
                )}
                {plan?.reveals_per_month != null && (
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>עד {plan.reveals_per_month} חשיפות בחודש</span>
                  </li>
                )}
                {!isContractor && plan?.active_ads != null && (
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{plan.active_ads} מודעות פעילות במקביל</span>
                  </li>
                )}
                {/* extra_user_price_nis === null → row omitted (that's
                    what NULL means per subscription_limits.py:99: extra
                    seats are not sold on this tier). */}
                {plan?.extra_user_price_nis != null && (
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>₪{plan.extra_user_price_nis} למשתמש נוסף</span>
                  </li>
                )}
              </ul>
              <button
                type="button"
                disabled={busyTier !== null || isCurrent || priceMissing}
                onClick={() => upgrade(t.code)}
                title={priceMissing ? 'מחיר חסר בקטלוג — פנה לתמיכה' : undefined}
                className={`w-full text-sm font-semibold py-2.5 rounded-lg
                           disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition ${
                  isCurrent || priceMissing
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
                ) : priceMissing ? (
                  <>לא זמין</>
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
