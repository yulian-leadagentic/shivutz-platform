'use client';

// Pivot/v2 corp dashboard — ad-centric.
// Removed: deal/tender/worker tiles + urgency banners.
// New: ad counters (worker + housing), reveals-received (30d),
// subscription tier + usage, "publish new ad" nudge for new corps.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Megaphone, Home, Eye, CreditCard, Clock, Plus } from 'lucide-react';
import { adApi, type UsageResponse } from '@/lib/api/ads';
import { orgApi } from '@/lib/api';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';
import { PublishFirstAdBanner } from '@/features/corporation/PublishFirstAdBanner';

const STATUS_LABEL: Record<string, string> = {
  trialing: 'ניסיון', active: 'פעיל', past_due: 'תשלום נכשל', cancelled: 'בוטל', expired: 'פג',
};
const TIER_LABEL: Record<string, string> = { basic: 'בסיסי', advanced: 'מתקדם', pro: 'פרו' };

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : null;
}

function Tile({
  icon: Icon, label, value, sub, href, accent = 'brand',
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: string;
  href?: string;
  accent?: 'brand' | 'amber' | 'emerald' | 'slate';
}) {
  const accentMap = {
    brand:   'bg-brand-50   text-brand-700',
    amber:   'bg-amber-50   text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    slate:   'bg-slate-100  text-slate-700',
  };
  const inner = (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-brand-300 transition h-full">
      <div className={`w-10 h-10 rounded-lg ${accentMap[accent]} flex items-center justify-center mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-extrabold text-slate-900 mt-0.5">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

export default function CorporationDashboardPage() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [approvalStatus, setApproval] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    const p = token ? decodeJwtPayload(token) : null;
    const entityId = (p?.entity_id || p?.org_id) as string | undefined;
    if (entityId && p?.entity_type === 'corporation') {
      orgApi.getCorporation(entityId).then((c) => {
        setApproval(c.approval_status ?? null);
        setCompanyName(c.company_name_he || c.company_name || '');
      }).catch(() => {});
    }
    adApi.usage().then(setUsage).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>;

  const trialEndsAt = (usage as UsageResponse & { trial_ends_at?: string | null })?.trial_ends_at ?? null;
  const graceEndsAt = (usage as UsageResponse & { grace_ends_at?: string | null })?.grace_ends_at ?? null;
  // Trial "days left" — only when the trial itself is still active.
  const now = new Date();
  const trialLive = usage?.status === 'trialing' && trialEndsAt !== null && new Date(trialEndsAt) > now;
  const trialDays = trialLive ? daysUntil(trialEndsAt) : null;
  // B3 grace state — trial ended, grace not yet closed. Days-left uses
  // grace_ends_at; server pauses ads on grace_ends_at + 1 day.
  const inGrace = usage?.status === 'trialing'
               && trialEndsAt !== null
               && new Date(trialEndsAt) <= now
               && (graceEndsAt === null || new Date(graceEndsAt) > now);
  const graceDaysLeft = inGrace ? daysUntil(graceEndsAt) : null;
  const revealsReceived30d = (usage?.usage as (UsageResponse['usage'] & { reveals_received_30d?: number }))?.reveals_received_30d ?? 0;
  const adsByType = (usage?.usage as (UsageResponse['usage'] & { ads_by_type?: Record<string, number> }))?.ads_by_type ?? { worker: 0, housing: 0 };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">שלום{companyName ? `, ${companyName}` : ''}</h1>
        <p className="text-sm text-slate-500">סקירה של המודעות והמנוי שלכם</p>
      </header>

      <PublishFirstAdBanner />

      {inGrace && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <Clock className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-amber-900">תקופת הניסיון הסתיימה</h3>
            <p className="text-sm text-amber-800 mt-0.5">
              {graceDaysLeft !== null && graceDaysLeft > 0
                ? `נותרו ${graceDaysLeft} ימים לחדש לפני שהמודעות יושהו ויוסתרו מתוצאות החיפוש.`
                : 'המודעות יושהו במהלך היממה הקרובה. חדש כדי להחזירן מיד.'}
            </p>
          </div>
          <Link
            href="/billing"
            className="shrink-0 inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-800 text-slate-900 text-sm font-semibold px-4 py-2 rounded-lg"
          >
            <CreditCard className="w-4 h-4" />
            חדש מנוי
          </Link>
        </div>
      )}

      {approvalStatus === 'pending' && (
        <div className="flex items-start gap-3 bg-sky-50 border border-sky-200 rounded-2xl p-4">
          <Clock className="h-5 w-5 text-sky-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-sky-900">החשבון בבדיקה</h3>
            <p className="text-sm text-sky-700 mt-0.5">הרישום שלכם ממתין לאישור מנהל. תוכלו להמשיך בהכנת מודעות בינתיים.</p>
          </div>
        </div>
      )}

      {/* Ads */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">המודעות שלי</p>
          <Link href="/corporation/ads/new" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">
            <Plus className="w-3.5 h-3.5" /> מודעה חדשה
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile icon={Megaphone} label="עובדים" value={adsByType.worker  ?? 0} href="/corporation/ads" />
          <Tile icon={Home}      label="דיור"    value={adsByType.housing ?? 0} href="/corporation/ads" accent="slate" />
          <Tile icon={Eye}       label="חשיפות פרטי קשר (30 יום)" value={revealsReceived30d} sub="פניות של קבלנים לפרטי הקשר שלכם" accent="emerald" />
          <Tile icon={Megaphone} label="פעילות כוללות" value={usage?.usage.active_ads ?? 0}
                sub={usage?.limits.active_ads == null ? undefined : `מתוך ${usage.limits.active_ads}`}
                href="/corporation/ads" />
        </div>
      </div>

      {/* Subscription */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">מנוי</p>
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <p className="text-lg font-bold text-slate-900">
                {usage ? TIER_LABEL[usage.tier] : '—'}
                <span className="ms-2 text-sm font-medium text-slate-600">
                  {usage ? `(${STATUS_LABEL[usage.status] ?? usage.status})` : ''}
                </span>
              </p>
              {trialDays !== null && (
                <p className="text-sm text-amber-700 mt-0.5">
                  נותרו {trialDays} ימים לניסיון <span className="text-amber-600">· ללא כרטיס אשראי</span>
                </p>
              )}
            </div>
            <Link
              href="/billing"
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-800 text-slate-900 text-sm font-semibold px-4 py-2 rounded-lg"
            >
              <CreditCard className="w-4 h-4" />
              ניהול מנוי
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
