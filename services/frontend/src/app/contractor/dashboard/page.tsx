'use client';

// Pivot/v2 contractor dashboard — deliberately minimal.
// Q1a decision: contractor doesn't need a rich dashboard. Landing
// is the search, this is a tiny status page: subscription tier chip,
// "search now" CTA, kablan status if pending.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search as SearchIcon, CreditCard, Clock, Globe2, ArrowLeft, Users, CheckCircle2, Hourglass } from 'lucide-react';
import { adApi, type UsageResponse } from '@/lib/api/ads';
import { subscriptionApi, type SubscriptionRow } from '@/lib/api/payments';
import { memberApi } from '@/lib/api/members';
import { orgApi } from '@/lib/api';
import { ApiError } from '@/lib/api/client';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';
import type { Contractor } from '@/types';
import {
  SUBSCRIPTION_STATUS_HE_SHORT as STATUS_LABEL,
  TIER_HE_SHORT as TIER_LABEL,
} from '@/lib/labels';

// U8 §1 — STATUS_LABEL + TIER_LABEL moved to lib/labels.ts. Same
// values as the previous local copy — verified byte-identical
// during the scan.

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : null;
}

export default function ContractorDashboardPage() {
  // QA-5 — split "which subscription" (subscriptionApi.me — the same
  // endpoint /billing uses successfully) from "how many reveals used"
  // (adApi.usage, secondary). Old flow used only /ads/usage for both;
  // when the ads endpoint returned any non-2xx (500 / 401 / anything)
  // the whole card fell into the error state even when the real
  // subscription row was fetchable via /payments/subscriptions/me.
  // Now: tier + status come from `sub`, reveal meter from `usage`,
  // and either can degrade gracefully without dragging the other.
  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [subErrored, setSubErrored] = useState(false);      // U5 §3 — bool + retry, not a Hebrew string
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // U5 §7b · display name resolver — full_name from JWT → contractor's
  // contact_name → company name → nothing. Prevents the truncated
  // "שלום" greeting Yulian flagged (line was `שלום{companyName ? ', X' : ''}`,
  // which produced "שלום" alone when the /organizations fetch was slow
  // or failed).
  const token = typeof window !== 'undefined' ? getAccessToken() : null;
  const jwt = token ? decodeJwtPayload(token) : null;
  const entityId = (jwt?.entity_id || jwt?.org_id) as string | undefined;
  const jwtFullName = (jwt?.full_name as string | undefined) || '';
  const displayName = (
    jwtFullName.trim() ||
    contractor?.contact_name?.trim() ||
    contractor?.company_name_he?.trim() ||
    contractor?.company_name?.trim() ||
    ''
  );

  const fetchSub = useCallback(() => {
    setSubErrored(false);
    subscriptionApi.me()
      .then((s) => { setSub(s); setSubErrored(false); })
      .catch((err) => {
        // U5 §3.6 · a 404 means "no active subscription" (empty state,
        // NOT an error). Anything else is a real failure — surface with
        // a retry button instead of a stale Hebrew string that the user
        // can't act on. (Auth 401 already exits to /login via apiFetch's
        // session-holder branch, so it won't land here for signed-in
        // callers.)
        const status = err instanceof ApiError ? err.cause?.status : undefined;
        if (status === 404) { setSub(null); setSubErrored(false); }
        else { setSub(null); setSubErrored(true); }
      });
  }, []);

  useEffect(() => {
    if (entityId && jwt?.entity_type === 'contractor') {
      orgApi.getContractor(entityId).then(setContractor).catch(() => {});
      memberApi.list('contractors', entityId)
        .then((rows) => setMemberCount(rows.length))
        .catch(() => setMemberCount(null));
    }
    fetchSub();
    // Secondary: reveal meter. Any failure → hide meter, don't error.
    adApi.usage()
      .then((u) => setUsage(u))
      .catch(() => setUsage(null))
      .finally(() => setLoading(false));
  }, [entityId, jwt?.entity_type, fetchSub]);

  if (loading) return <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>;

  // Trial countdown comes from the subscription row (authoritative).
  // Reveal counts remain best-effort from the usage endpoint.
  const trialDays = daysUntil(sub?.trial_ends_at ?? null);
  const revealsUsed  = usage?.usage.reveals_this_month ?? 0;
  const revealsLimit = usage?.limits.reveals_per_month;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <header className="text-center space-y-1">
        {/* U5 §7b — never render a truncated "שלום" alone. displayName
            already falls back through full_name / contact_name / company;
            when EVERYTHING is empty (rare — fresh membership before any
            profile load) drop the comma so the greeting still reads as
            a full sentence. */}
        <h1 className="text-2xl font-bold text-slate-900">
          שלום{displayName ? `, ${displayName}` : ''}
        </h1>
        <p className="text-sm text-slate-500">שני מסלולים למצוא עובדים — בחרו את המתאים</p>
      </header>

      {/* C2 — split entry tiles. Reuses the same mental model as the
          landing category tiles ('workers' vs 'import') so the contractor
          reads the two jobs as one system, wherever they land. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/"
          className="group flex flex-col justify-between gap-3 p-5 rounded-2xl bg-brand-600 hover:bg-brand-800 text-slate-900 shadow-md transition min-h-[160px]"
        >
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <SearchIcon className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight">מצא עובדים זמינים עכשיו</h2>
              <p className="text-xs text-white/80 mt-0.5 leading-relaxed">חיפוש בחופש. תוצאות מיידיות מתאגידים שיש להם עובדים פנויים כעת.</p>
            </div>
          </div>
          <div className="text-xs font-semibold inline-flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition">
            חפש עכשיו <ArrowLeft className="w-3.5 h-3.5" />
          </div>
        </Link>

        <Link
          href="/contractor/tenders"
          className="group flex flex-col justify-between gap-3 p-5 rounded-2xl bg-white border-2 border-slate-200 hover:border-brand-400 hover:shadow-md text-slate-900 transition min-h-[160px]"
        >
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
              <Globe2 className="w-6 h-6 text-brand-700" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight">בקש ייבוא עובדים מחו״ל</h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">בקשה מובנית שרצה על תאגידים מורשים. הצעות חוזרות תוך ימים.</p>
            </div>
          </div>
          <div className="text-xs font-semibold text-brand-700 inline-flex items-center gap-1.5">
            פתח בקשה חדשה <ArrowLeft className="w-3.5 h-3.5" />
          </div>
        </Link>
      </div>

      {/* C1 — kablan banner intentionally NOT rendered here.
          Contractor layout mounts <KablanVerifyBanner /> globally, so
          duplicating it on the dashboard was double-messaging. */}

      {/* Subscription card. QA-5 rewrite — three-state render sourced
          from /payments/subscriptions/me (same endpoint /billing uses).
          Was: single-source /ads/usage. If /ads/usage transiently 500'd
          the whole card fell into an error state even when the sub row
          was fine. Now sub + reveal-meter are independent:
          - sub loaded → tier chip + optional trial countdown +
            reveal meter (reveals only if secondary /ads/usage came
            back too; hidden otherwise, no error).
          - sub === null && subError → Hebrew error banner.
          - sub === null && no error (404 / no-sub) → empty-state
            "אין מנוי פעיל" + "רכשו מנוי" CTA into /billing. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">המנוי שלך</p>

            {sub ? (
              <>
                <p className="text-lg font-bold text-slate-900 mt-1">
                  {TIER_LABEL[sub.tier] ?? sub.tier}
                  <span className="ms-2 text-sm font-medium text-slate-600">
                    ({STATUS_LABEL[sub.status] ?? sub.status})
                  </span>
                </p>
                {trialDays !== null && (
                  <p className="text-sm text-amber-700 mt-1 inline-flex items-center gap-1.5 flex-wrap">
                    <Clock className="w-3.5 h-3.5" />
                    נותרו {trialDays} ימים לניסיון
                    {revealsLimit != null && (
                      <>· {revealsLimit} חשיפות</>
                    )}
                    <span className="text-amber-600">· ללא כרטיס אשראי</span>
                  </p>
                )}
                {usage && (
                  <p className="text-sm text-slate-600 mt-1">
                    חשיפות החודש: <b dir="ltr">{revealsUsed} / {revealsLimit ?? '∞'}</b>
                  </p>
                )}
              </>
            ) : subErrored ? (
              // U5 §3.6 · was a red generic Hebrew line with no
              // recovery path. Now the copy names the failure and
              // gives the user a retry button — matching the enum
              // pattern from §2. On success `subErrored` flips false
              // and the tier line renders.
              <>
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mt-1">
                  לא הצלחנו לטעון את פרטי המנוי.
                </p>
                <button
                  type="button"
                  onClick={fetchSub}
                  className="mt-2 text-sm font-medium text-brand-700 hover:text-brand-800 underline"
                >
                  נסה שוב
                </button>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-slate-900 mt-1">אין לך מנוי פעיל</p>
                <p className="text-sm text-slate-600 mt-1">
                  רכשו מנוי כדי לחשוף פרטי תאגידים ולהגדיל את מכסת החשיפות שלכם.
                </p>
              </>
            )}
          </div>
          <Link
            href="/billing"
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-800 text-slate-900 text-sm font-semibold px-4 py-2 rounded-lg min-h-11"
          >
            <CreditCard className="w-4 h-4" />
            {sub ? 'ניהול מנוי' : 'רכשו מנוי'}
          </Link>
        </div>
      </div>

      {/* U5 §7 · seats + verification tier — two pieces of data the
          contractor is paying for and used to have no way to see.
          Both come from data the app already knows (usage.limits +
          contractor row). Rendered in one card side-by-side so the
          dashboard doesn't turn into a tile jungle. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Seats · X מתוך N משתמשים */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-700">
              <Users className="w-4 h-4" />
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">משתמשים</p>
          </div>
          {(() => {
            const included = usage?.limits.included_users ?? null;
            // Show the count as soon as we have it. Included=null means
            // the tier's members table row doesn't have a seat cap, so
            // omit the "מתוך N" — showing "מתוך 0" would be confusing.
            if (memberCount === null) {
              return <p className="text-sm text-slate-500">טוען נתוני משתמשים…</p>;
            }
            return (
              <>
                <p className="text-lg font-bold text-slate-900">
                  <span dir="ltr">{memberCount}{included != null ? ` / ${included}` : ''}</span>
                  {' '}משתמשים
                </p>
                {included != null && memberCount >= included && usage?.limits.extra_user_price_nis != null && (
                  <p className="text-xs text-amber-700 mt-1">
                    הגעת למכסה. משתמש נוסף — ₪{usage.limits.extra_user_price_nis}/חודש.
                  </p>
                )}
                <Link
                  href="/contractor/users"
                  className="mt-2 inline-block text-xs font-medium text-brand-700 hover:text-brand-800 underline"
                >
                  ניהול משתמשים ←
                </Link>
              </>
            );
          })()}
        </div>

        {/* Verification tier · ✓ מאומת | בבדיקה | ... */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">אימות</p>
          </div>
          {(() => {
            if (!contractor) return <p className="text-sm text-slate-500">טוען פרטי אימות…</p>;
            const status = contractor.approval_status;
            const kablanMatched = !!contractor.kablan_verified_at;
            if (status === 'approved' && kablanMatched) {
              return (
                <>
                  <p className="text-lg font-bold text-emerald-700 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    קבלן מאומת
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    אושרת ונמצאת בפנקס הקבלנים.
                  </p>
                </>
              );
            }
            if (status === 'approved') {
              return (
                <>
                  <p className="text-lg font-bold text-emerald-700 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    מאושר
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    הרשמתך אושרה. השלמת אימות פנקס הקבלנים משדרגת את הפרופיל.
                  </p>
                  <Link
                    href="/contractor/verify-kablan"
                    className="mt-2 inline-block text-xs font-medium text-brand-700 hover:text-brand-800 underline"
                  >
                    השלמת אימות פנקס ←
                  </Link>
                </>
              );
            }
            if (status === 'pending') {
              return (
                <>
                  <p className="text-lg font-bold text-amber-700 inline-flex items-center gap-1.5">
                    <Hourglass className="w-4 h-4" />
                    בבדיקה
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    בקשתך בבדיקת צוות ההרשמה — בדרך כלל עד 24 שעות עסקיות.
                    בזמן ההמתנה תוכלי לחפש עובדים; חשיפת פרטי קשר נפתחת אחרי אישור.
                  </p>
                </>
              );
            }
            if (status === 'rejected') {
              return (
                <>
                  <p className="text-lg font-bold text-red-700">נדחה</p>
                  <p className="text-xs text-slate-600 mt-1">צרו קשר עם התמיכה לפרטים.</p>
                </>
              );
            }
            // suspended
            return (
              <>
                <p className="text-lg font-bold text-red-700">מושהה</p>
                <p className="text-xs text-slate-600 mt-1">חשבונך הושהה. צרו קשר עם התמיכה.</p>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
