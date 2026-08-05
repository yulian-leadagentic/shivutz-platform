'use client';

// Pivot/v2 contractor dashboard — deliberately minimal.
// Q1a decision: contractor doesn't need a rich dashboard. Landing
// is the search, this is a tiny status page: subscription tier chip,
// "search now" CTA, kablan status if pending.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search as SearchIcon, CreditCard, Clock, Globe2, ArrowLeft } from 'lucide-react';
import { adApi, type UsageResponse } from '@/lib/api/ads';
import { orgApi } from '@/lib/api';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';

const STATUS_LABEL: Record<string, string> = {
  trialing: 'ניסיון', active: 'פעיל', past_due: 'תשלום נכשל', cancelled: 'בוטל', expired: 'פג',
};
const TIER_LABEL: Record<string, string> = { basic: 'בסיסי', advanced: 'מתקדם', pro: 'פרו' };

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : null;
}

export default function ContractorDashboardPage() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [companyName, setCompanyName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    const p = token ? decodeJwtPayload(token) : null;
    const entityId = (p?.entity_id || p?.org_id) as string | undefined;
    if (entityId && p?.entity_type === 'contractor') {
      orgApi.getContractor(entityId).then((c) => {
        setCompanyName(c.company_name_he || c.company_name || '');
      }).catch(() => {});
    }
    adApi.usage().then(setUsage).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>;

  const trialDays = daysUntil((usage as UsageResponse & { trial_ends_at?: string | null })?.trial_ends_at ?? null);
  const revealsUsed  = usage?.usage.reveals_this_month ?? 0;
  const revealsLimit = usage?.limits.reveals_per_month;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <header className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">שלום{companyName ? `, ${companyName}` : ''}</h1>
        <p className="text-sm text-slate-500">שני מסלולים למצוא עובדים — בחרו את המתאים</p>
      </header>

      {/* C2 — split entry tiles. Reuses the same mental model as the
          landing category tiles ('workers' vs 'import') so the contractor
          reads the two jobs as one system, wherever they land. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/"
          className="group flex flex-col justify-between gap-3 p-5 rounded-2xl bg-brand-800 hover:bg-brand-900 text-white shadow-md transition min-h-[160px]"
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

      {/* Subscription card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">המנוי שלך</p>
            <p className="text-lg font-bold text-slate-900 mt-1">
              {usage ? TIER_LABEL[usage.tier] : '—'}
              <span className="ms-2 text-sm font-medium text-slate-600">
                {usage ? `(${STATUS_LABEL[usage.status] ?? usage.status})` : ''}
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
                חשיפות החודש: <b>{revealsUsed}</b> / <b>{revealsLimit ?? '∞'}</b>
              </p>
            )}
          </div>
          <Link
            href="/billing"
            className="inline-flex items-center gap-2 bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            <CreditCard className="w-4 h-4" />
            ניהול מנוי
          </Link>
        </div>
      </div>
    </div>
  );
}
