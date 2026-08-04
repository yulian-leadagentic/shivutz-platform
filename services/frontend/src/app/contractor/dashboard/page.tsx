'use client';

// Pivot/v2 contractor dashboard — deliberately minimal.
// Q1a decision: contractor doesn't need a rich dashboard. Landing
// is the search, this is a tiny status page: subscription tier chip,
// "search now" CTA, kablan status if pending.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search as SearchIcon, CreditCard, ShieldCheck, Clock } from 'lucide-react';
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
  const [kablanVerified, setKablan] = useState<boolean | null>(null);
  const [companyName, setCompanyName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    const p = token ? decodeJwtPayload(token) : null;
    const entityId = (p?.entity_id || p?.org_id) as string | undefined;
    if (entityId && p?.entity_type === 'contractor') {
      orgApi.getContractor(entityId).then((c) => {
        setKablan(!!c.kablan_verified_at);
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
        <p className="text-sm text-slate-500">התחילו חיפוש חדש או המשיכו לחפש כמו קודם</p>
      </header>

      {/* Primary CTA — search */}
      <Link
        href="/"
        className="flex items-center justify-center gap-3 bg-brand-800 hover:bg-brand-900 text-white text-lg font-semibold py-4 rounded-2xl shadow-md transition"
      >
        <SearchIcon className="w-6 h-6" />
        התחל חיפוש
      </Link>

      {/* Kablan verification banner (only if unverified) */}
      {kablanVerified === false && (
        <Link
          href="/contractor/verify-kablan"
          className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 hover:border-amber-300 transition"
        >
          <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-amber-900">השלימו אימות רישום קבלנים</h3>
            <p className="text-sm text-amber-800 mt-0.5">האימות מעלה אמון של תאגידים ומסיר סימוני "לא מאומת" מהחיפושים.</p>
          </div>
        </Link>
      )}

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
              <p className="text-sm text-amber-700 mt-1 inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> נותרו {trialDays} ימים לניסיון
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
