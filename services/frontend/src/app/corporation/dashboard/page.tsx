'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Users, Handshake, Clock } from 'lucide-react';
import { dealApi, workerApi } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';
import type { Deal, Worker } from '@/types';
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
        </tr>
      ))}
    </>
  );
}

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

export default function CorporationDashboard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const { professionMap: profMap } = useEnums();
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [loadingWorkers, setLoadingWorkers] = useState(true);

  useEffect(() => {
    dealApi.list()
      .then((res) => setDeals(res.items))
      .catch(console.error)
      .finally(() => setLoadingDeals(false));

    workerApi.list()
      .then(setWorkers)
      .catch(console.error)
      .finally(() => setLoadingWorkers(false));
  }, []);

  const incomingDeals = deals.filter((d) => d.status === 'proposed');
  const activeDeals   = deals.filter((d) => ['active', 'reporting'].includes(d.status));
  const availWorkers  = workers.filter((w) => w.status === 'available');

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">לוח בקרה — תאגיד</h2>
        <Button asChild variant="outline">
          <Link href="/corporation/workers/new">+ עובד חדש</Link>
        </Button>
      </div>

      {/* Pending proposals alert banner */}
      {!loadingDeals && incomingDeals.length > 0 && (
        <Link href="/corporation/deals?filter=proposed">
          <div className="flex items-center justify-between bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 hover:bg-amber-100 transition-colors cursor-pointer shadow-sm">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-600 shrink-0" />
              <div>
                <p className="font-semibold text-amber-900 text-sm">
                  יש לך {incomingDeals.length} {incomingDeals.length === 1 ? 'הצעה שממתינה' : 'הצעות שממתינות'} לתגובה שלך
                </p>
                <p className="text-amber-700 text-xs mt-0.5">לחץ לצפייה ואישור / דחיית ההצעות</p>
              </div>
            </div>
            <span className="text-amber-700 text-sm font-medium whitespace-nowrap">לצפייה ←</span>
          </div>
        </Link>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/corporation/deals?filter=proposed" className="block group">
          <Card className="cursor-pointer group-hover:border-amber-300 group-hover:shadow-md transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">הצעות ממתינות</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingDeals ? <SkeletonCard /> : (
                <div className="flex items-center gap-3">
                  <Clock className="h-8 w-8 text-amber-500" />
                  <span className="text-3xl font-bold text-slate-900">{incomingDeals.length}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/corporation/deals?filter=active" className="block group">
          <Card className="cursor-pointer group-hover:border-green-300 group-hover:shadow-md transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">עסקאות פעילות</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingDeals ? <SkeletonCard /> : (
                <div className="flex items-center gap-3">
                  <Handshake className="h-8 w-8 text-green-500" />
                  <span className="text-3xl font-bold text-slate-900">{activeDeals.length}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/corporation/workers?status=available" className="block group">
          <Card className="cursor-pointer group-hover:border-brand-300 group-hover:shadow-md transition-all">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">עובדים זמינים</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingWorkers ? <SkeletonCard /> : (
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-brand-500" />
                  <span className="text-3xl font-bold text-slate-900">{availWorkers.length}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Two column tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Incoming proposals */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>הצעות נכנסות</CardTitle>
              {incomingDeals.length > 0 && (
                <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-1 rounded-full">
                  {incomingDeals.length} ממתינות
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="px-4 py-3 text-start font-medium">מזהה</th>
                    <th className="px-4 py-3 text-start font-medium">עובדים</th>
                    <th className="px-4 py-3 text-start font-medium">תאריך</th>
                    <th className="px-4 py-3 text-start font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {loadingDeals ? (
                    <SkeletonRows />
                  ) : incomingDeals.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        אין הצעות ממתינות
                      </td>
                    </tr>
                  ) : (
                    incomingDeals.slice(0, 5).map((d) => (
                      <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">#{d.id.slice(0, 8)}</td>
                        <td className="px-4 py-3 text-center">{d.workers_count}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{fmt(d.created_at)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/corporation/deals/${d.id}`}
                            className="text-amber-600 hover:underline text-xs font-medium"
                          >
                            בדוק
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Active deals */}
        <Card>
          <CardHeader>
            <CardTitle>עסקאות פעילות</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="px-4 py-3 text-start font-medium">מזהה</th>
                    <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                    <th className="px-4 py-3 text-start font-medium">תאריך</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingDeals ? (
                    <SkeletonRows />
                  ) : activeDeals.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                        אין עסקאות פעילות
                      </td>
                    </tr>
                  ) : (
                    activeDeals.slice(0, 5).map((d) => (
                      <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">
                          <Link
                            href={`/corporation/deals/${d.id}`}
                            className="hover:text-brand-600 hover:underline"
                          >
                            #{d.id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{fmt(d.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workers snapshot */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>עובדים זמינים</CardTitle>
            <Link href="/corporation/workers" className="text-sm text-brand-600 hover:underline">
              כל העובדים ←
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="px-4 py-3 text-start font-medium">שם</th>
                  <th className="px-4 py-3 text-start font-medium">מקצוע</th>
                  <th className="px-4 py-3 text-start font-medium">ניסיון</th>
                  <th className="px-4 py-3 text-start font-medium">ויזה עד</th>
                  <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {loadingWorkers ? (
                  <SkeletonRows />
                ) : availWorkers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      אין עובדים זמינים
                    </td>
                  </tr>
                ) : (
                  availWorkers.slice(0, 6).map((w) => (
                    <tr key={w.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {w.first_name} {w.last_name}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{profMap[w.profession_type] ?? w.profession_type}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{w.experience_range ?? `${w.experience_years}y`}</td>
                      <td className="px-4 py-3 text-slate-600">{fmt(w.visa_valid_until)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          זמין
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loadingWorkers && availWorkers.length > 6 && (
            <div className="px-4 py-3 border-t border-slate-100 text-center">
              <Link href="/corporation/workers" className="text-sm text-brand-600 hover:underline">
                הצג עוד {availWorkers.length - 6} עובדים
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alert: workers with expiring visas */}
      {!loadingWorkers && workers.some((w) => {
        const daysLeft = (new Date(w.visa_valid_until).getTime() - Date.now()) / 86_400_000;
        return daysLeft >= 0 && daysLeft <= 30;
      }) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-amber-800 text-sm">ויזות פגות תוך 30 יום</p>
              <p className="text-amber-700 text-xs mt-0.5">
                {workers.filter((w) => {
                  const daysLeft = (new Date(w.visa_valid_until).getTime() - Date.now()) / 86_400_000;
                  return daysLeft >= 0 && daysLeft <= 30;
                }).length} עובדים דורשים חידוש ויזה בקרוב.{' '}
                <Link href="/corporation/workers" className="underline font-medium">
                  צפה ברשימה
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
