'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, AlertCircle, FolderOpen, Handshake } from 'lucide-react';
import { jobApi, dealApi, enumApi } from '@/lib/api';
import type { JobRequest, Deal } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="h-4 bg-slate-200 rounded w-1/2 mb-2" />
      <div className="h-8 bg-slate-200 rounded w-1/4" />
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <tr key={i} className="animate-pulse">
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-32" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-20" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-16" /></td>
          <td className="px-4 py-3"><div className="h-4 bg-slate-200 rounded w-24" /></td>
        </tr>
      ))}
    </>
  );
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('he-IL');
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<JobRequest[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [regionMap, setRegionMap] = useState<Record<string, string>>({});
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [errorJobs, setErrorJobs] = useState(false);
  const [errorDeals, setErrorDeals] = useState(false);

  useEffect(() => {
    jobApi.list().then(setJobs).catch(() => setErrorJobs(true)).finally(() => setLoadingJobs(false));
    dealApi.list().then(setDeals).catch(() => setErrorDeals(true)).finally(() => setLoadingDeals(false));
    enumApi.regions().then((rs) => {
      const m: Record<string, string> = {};
      rs.forEach((r) => { m[r.code] = r.name_he; });
      setRegionMap(m);
    }).catch(() => {});
  }, []);

  const openJobs = jobs.filter((j) => j.status === 'open').length;
  const activeDeals = deals.filter((d) => d.status === 'active').length;
  const reportingDeals = deals.filter((d) => d.status === 'reporting').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">לוח בקרה</h2>
        <Button asChild>
          <Link href="/contractor/requests/new">
            <Plus className="h-4 w-4" />
            בקשה חדשה +
          </Link>
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">בקשות פתוחות</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingJobs ? (
              <SkeletonCard />
            ) : errorJobs ? (
              <p className="text-red-600 text-sm">שגיאה בטעינת נתונים</p>
            ) : (
              <div className="flex items-center gap-3">
                <FolderOpen className="h-8 w-8 text-brand-500" />
                <span className="text-3xl font-bold text-slate-900">{openJobs}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">עסקאות פעילות</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDeals ? (
              <SkeletonCard />
            ) : errorDeals ? (
              <p className="text-red-600 text-sm">שגיאה בטעינת נתונים</p>
            ) : (
              <div className="flex items-center gap-3">
                <Handshake className="h-8 w-8 text-green-500" />
                <span className="text-3xl font-bold text-slate-900">{activeDeals}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">עסקאות להשלמה</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingDeals ? (
              <SkeletonCard />
            ) : errorDeals ? (
              <p className="text-red-600 text-sm">שגיאה בטעינת נתונים</p>
            ) : (
              <div className="flex items-center gap-3">
                <AlertCircle className="h-8 w-8 text-amber-500" />
                <span className="text-3xl font-bold text-slate-900">{reportingDeals}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Two column tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent job requests */}
        <Card>
          <CardHeader>
            <CardTitle>בקשות עבודה אחרונות</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {errorJobs ? (
              <div className="flex items-center gap-2 p-6 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                שגיאה בטעינת נתונים
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500 text-start">
                      <th className="px-4 py-3 text-start font-medium">פרויקט</th>
                      <th className="px-4 py-3 text-start font-medium">אזור</th>
                      <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                      <th className="px-4 py-3 text-start font-medium">תאריך</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingJobs ? (
                      <SkeletonRows />
                    ) : jobs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          אין בקשות עדיין
                        </td>
                      </tr>
                    ) : (
                      jobs.slice(0, 5).map((j) => (
                        <tr
                          key={j.id}
                          className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-3 font-medium text-slate-900 truncate max-w-[160px]">
                            <Link
                              href={`/contractor/requests/${j.id}/match`}
                              className="hover:text-brand-600 hover:underline"
                            >
                              {j.project_name_he || j.project_name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{regionMap[j.region] || j.region || '—'}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={j.status} />
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(j.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent deals */}
        <Card>
          <CardHeader>
            <CardTitle>עסקאות אחרונות</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {errorDeals ? (
              <div className="flex items-center gap-2 p-6 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                שגיאה בטעינת נתונים
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500">
                      <th className="px-4 py-3 text-start font-medium">מספר עסקה</th>
                      <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                      <th className="px-4 py-3 text-start font-medium">תאריך</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingDeals ? (
                      <SkeletonRows />
                    ) : deals.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                          אין עסקאות עדיין
                        </td>
                      </tr>
                    ) : (
                      deals.slice(0, 5).map((d) => (
                        <tr
                          key={d.id}
                          className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-slate-700">
                            <Link
                              href={`/contractor/deals/${d.id}`}
                              className="hover:text-brand-600 hover:underline"
                            >
                              #{d.id.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={d.status} />
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(d.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
