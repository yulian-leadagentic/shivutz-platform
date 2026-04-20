'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, AlertCircle, FolderOpen, Handshake, Clock,
  ChevronLeft, Zap, Users, Calendar, Briefcase,
} from 'lucide-react';
import { jobApi, dealApi, orgApi } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';
import { getAccessToken, decodeJwtPayload } from '@/lib/auth';
import type { JobRequest, Deal } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('he-IL');
}

const DEAL_STATUS_LABEL: Record<string, string> = {
  proposed:         'פנייה נשלחה — ממתין לתאגיד',
  counter_proposed: 'תאגיד הגיב — בדוק צ׳אט',
  accepted:         'ממתין לאישורך',
  active:           'עובדים בשטח',
  reporting:        'שלב דיווח',
  completed:        'הושלמה',
  disputed:         'במחלוקת',
  cancelled:        'בוטלה',
};

const DEAL_STATUS_COLOR: Record<string, string> = {
  proposed:         'text-blue-600',
  counter_proposed: 'text-amber-600 font-semibold',
  accepted:         'text-emerald-600 font-semibold',
  active:           'text-emerald-700',
  reporting:        'text-amber-600',
  completed:        'text-slate-400',
  disputed:         'text-red-600 font-semibold',
  cancelled:        'text-slate-400',
};

function KpiCard({ icon, label, value, loading, color = 'text-brand-600' }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  loading: boolean;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
            {loading ? (
              <div className="h-8 w-12 bg-slate-100 rounded animate-pulse" />
            ) : (
              <p className="text-3xl font-bold text-slate-900">{value}</p>
            )}
          </div>
          <div className={`${color} opacity-80`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [jobs, setJobs]       = useState<JobRequest[]>([]);
  const [deals, setDeals]     = useState<Deal[]>([]);
  const { regionMap, professionMap: profMap } = useEnums();
  const [loadingJobs, setLoadingJobs]   = useState(true);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);

  useEffect(() => {
    // Check org approval status from JWT
    const token = getAccessToken();
    if (token) {
      const payload = decodeJwtPayload(token);
      const entityId   = (payload?.entity_id || payload?.org_id) as string | undefined;
      const entityType = (payload?.entity_type || payload?.org_type) as string | undefined;
      if (entityId && entityType === 'contractor') {
        orgApi.getContractor(entityId)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((c: any) => setApprovalStatus(c.approval_status ?? null))
          .catch(() => {});
      }
    }

    jobApi.list()
      .then(setJobs)
      .catch(() => {})
      .finally(() => setLoadingJobs(false));

    dealApi.list()
      .then(setDeals)
      .catch(() => {})
      .finally(() => setLoadingDeals(false));
  }, []);

  // KPI counts
  const openJobs      = jobs.filter((j) => j.status === 'open').length;
  const pendingDeals  = deals.filter((d) => ['proposed', 'counter_proposed'].includes(d.status)).length;
  const activeDeals   = deals.filter((d) => ['accepted', 'active', 'reporting'].includes(d.status)).length;

  // Urgent items — deals needing contractor action
  const urgentDeals = deals.filter((d) => ['counter_proposed', 'accepted'].includes(d.status));

  // Recent open requests (up to 4)
  const recentOpenJobs = jobs.filter((j) => j.status !== 'cancelled').slice(0, 4);

  // Active + recent deals
  const recentActiveDeals = deals
    .filter((d) => !['cancelled', 'completed'].includes(d.status))
    .slice(0, 4);

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Pending approval banner */}
      {approvalStatus === 'pending' && (
        <div className="flex items-start gap-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-900">החשבון ממתין לאישור</h3>
            <p className="text-sm text-amber-700 mt-0.5">
              הבקשה שלך מטופלת — תקבל SMS עם קישור ישיר לפתיחת בקשת עובדים ברגע שהחשבון יאושר. בדרך כלל עד 48 שעות.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">לוח בקרה</h2>
        <Button asChild>
          <Link href="/contractor/requests/new">
            <Plus className="h-4 w-4" />
            בקשה חדשה
          </Link>
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          icon={<FolderOpen className="h-9 w-9" />}
          label="בקשות פתוחות"
          value={openJobs}
          loading={loadingJobs}
          color="text-brand-500"
        />
        <KpiCard
          icon={<AlertCircle className="h-9 w-9" />}
          label="ממתינות לתאגיד"
          value={pendingDeals}
          loading={loadingDeals}
          color="text-amber-500"
        />
        <KpiCard
          icon={<Handshake className="h-9 w-9" />}
          label="עסקאות פעילות"
          value={activeDeals}
          loading={loadingDeals}
          color="text-green-500"
        />
      </div>

      {/* Urgent deals — needs action */}
      {!loadingDeals && urgentDeals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            דורש טיפול עכשיו
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {urgentDeals.map((d) => (
              <Link
                key={d.id}
                href={`/contractor/deals/${d.id}`}
                className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 hover:bg-amber-100/60 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-900">עסקה #{d.id.slice(0, 8)}</p>
                  <p className={`text-xs mt-0.5 ${DEAL_STATUS_COLOR[d.status] ?? 'text-slate-500'}`}>
                    {DEAL_STATUS_LABEL[d.status] ?? d.status}
                  </p>
                </div>
                <ChevronLeft className="h-4 w-4 text-amber-600 shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* Recent job requests */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">בקשות עבודה</CardTitle>
              <Link href="/contractor/requests" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
                הכל <ChevronLeft className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0 mt-3">
            {loadingJobs ? (
              <div className="space-y-0 divide-y divide-slate-50">
                {[1,2,3].map((i) => (
                  <div key={i} className="px-4 py-3 animate-pulse">
                    <div className="flex justify-between gap-2 mb-1.5">
                      <div className="h-4 bg-slate-200 rounded w-32" />
                      <div className="h-4 bg-slate-100 rounded w-16" />
                    </div>
                    <div className="flex gap-2">
                      <div className="h-3 bg-slate-100 rounded w-20" />
                      <div className="h-3 bg-slate-100 rounded w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentOpenJobs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center px-4">
                <FolderOpen className="h-8 w-8 text-slate-200" />
                <p className="text-slate-400 text-sm">אין בקשות עדיין</p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/contractor/requests/new"><Plus className="h-3.5 w-3.5" />צור בקשה</Link>
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {recentOpenJobs.map((j) => {
                  const lineItems = (j as unknown as { line_items?: { profession_type: string; quantity: number }[] }).line_items ?? [];
                  const fillPct   = j.best_fill_pct ?? -1;

                  return (
                    <div key={j.id} className="px-4 py-3 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/contractor/requests/${j.id}/match`}
                              className="text-sm font-semibold text-slate-900 hover:text-brand-600 hover:underline truncate"
                            >
                              {j.project_name_he || j.project_name || '—'}
                            </Link>
                            <StatusBadge status={j.status} />
                          </div>

                          {/* Region + date */}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                            <span>{regionMap[j.region] ?? j.region ?? '—'}</span>
                            {j.project_start_date && (
                              <span className="flex items-center gap-1" dir="ltr">
                                <Calendar className="h-3 w-3" />
                                {formatDate(j.project_start_date)}
                              </span>
                            )}
                          </div>

                          {/* Profession chips */}
                          {lineItems.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {lineItems.slice(0, 3).map((li, i) => (
                                <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                                  <Briefcase className="h-2.5 w-2.5" />
                                  {profMap[li.profession_type] ?? li.profession_type}
                                  <span className="text-slate-400">×{li.quantity}</span>
                                </span>
                              ))}
                              {lineItems.length > 3 && (
                                <span className="text-[11px] text-slate-400">+{lineItems.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Match action */}
                        <Link
                          href={`/contractor/requests/${j.id}/match`}
                          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-brand-600 border border-brand-200 rounded-lg px-2 py-1.5 hover:bg-brand-50 transition-colors"
                        >
                          <Zap className="h-3 w-3" />
                          {fillPct >= 0 ? 'עדכן' : 'חפש'}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active deals */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">עסקאות פעילות</CardTitle>
              <Link href="/contractor/deals" className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
                הכל <ChevronLeft className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0 mt-3">
            {loadingDeals ? (
              <div className="divide-y divide-slate-50">
                {[1,2,3].map((i) => (
                  <div key={i} className="px-4 py-3 animate-pulse">
                    <div className="flex justify-between gap-2 mb-1.5">
                      <div className="h-4 bg-slate-200 rounded w-28" />
                      <div className="h-4 bg-slate-100 rounded w-16" />
                    </div>
                    <div className="h-3 bg-slate-100 rounded w-40" />
                  </div>
                ))}
              </div>
            ) : recentActiveDeals.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center px-4">
                <Handshake className="h-8 w-8 text-slate-200" />
                <p className="text-slate-400 text-sm">אין עסקאות פעילות</p>
                <p className="text-xs text-slate-300">שלח פנייה לתאגיד מתוך תוצאות ההתאמה</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {recentActiveDeals.map((d) => (
                  <Link
                    key={d.id}
                    href={`/contractor/deals/${d.id}`}
                    className="block px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-slate-400">#{d.id.slice(0, 8)}</span>
                          <StatusBadge status={d.status} />
                        </div>
                        <p className={`text-xs ${DEAL_STATUS_COLOR[d.status] ?? 'text-slate-500'}`}>
                          {DEAL_STATUS_LABEL[d.status] ?? d.status}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {d.workers_count} עובדים
                          </span>
                          <span>{formatDate(d.created_at)}</span>
                          {d.agreed_price && (
                            <span className="font-medium text-slate-700">
                              ₪{Number(d.agreed_price).toLocaleString('he-IL')}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronLeft className="h-4 w-4 text-slate-300 shrink-0 mt-1" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
