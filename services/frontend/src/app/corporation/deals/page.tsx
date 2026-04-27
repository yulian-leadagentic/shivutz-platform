'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { dealApi } from '@/lib/api';
import type { Deal } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge from '@/components/StatusBadge';
import { DEAL_STATUS_GROUP, type DealFilter as Filter } from '@/i18n/he';

// Corporation-side wording differs from the central DEAL_FILTER_LABEL
// (e.g. "ממתינות לאישור" vs. "ממתינות לתאגיד") — kept local on purpose.
const FILTER_LABELS: Record<Filter, string> = {
  all: 'הכל',
  proposed: 'ממתינות לאישור',
  active: 'פעילות',
  completed: 'הושלמו',
};

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

function CorporationDealsPageContent() {
  const searchParams = useSearchParams();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const urlFilter = searchParams.get('filter') as Filter | null;
  const [filter, setFilter] = useState<Filter>(
    urlFilter && Object.keys(FILTER_LABELS).includes(urlFilter) ? urlFilter : 'all'
  );

  useEffect(() => {
    dealApi.list()
      .then((res) => setDeals(res.items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Corp-side "proposed" is stricter than the shared grouping — only deals still
  // awaiting the corp's initial response (counter_proposed is already their ball).
  const filtered = deals.filter((d) => {
    if (filter === 'all') return true;
    if (filter === 'proposed') return d.status === 'proposed';
    return (DEAL_STATUS_GROUP[filter] as string[]).includes(d.status);
  });
  const pendingCount = deals.filter((d) => d.status === 'proposed').length;

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-slate-900">עסקאות</h2>
          {pendingCount > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-1 rounded-full">
              {pendingCount} ממתינות לאישור
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${filtered.length} עסקאות`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8">אין עסקאות תואמות</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="px-4 py-3 text-start font-medium">מזהה</th>
                    <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                    <th className="px-4 py-3 text-start font-medium">מקצוע</th>
                    <th className="px-4 py-3 text-start font-medium">עובדים</th>
                    <th className="px-4 py-3 text-start font-medium">אזור</th>
                    <th className="px-4 py-3 text-start font-medium">נוצרה</th>
                    <th className="px-4 py-3 text-start font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => {
                    const offered  = d.worker_count ?? 0;
                    const requested = d.requested_count ?? 0;
                    return (
                      <tr
                        key={d.id}
                        className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 ${
                          d.status === 'proposed' ? 'bg-amber-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">
                          #{d.id.slice(0, 8)}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                        <td className="px-4 py-3 text-slate-700 font-medium">
                          {d.profession_he || '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {requested > 0
                            ? <span><span className="font-medium text-slate-700">{offered}</span><span className="text-slate-400"> / {requested} ביקש</span></span>
                            : (offered || '—')}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{d.region_he || '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{fmt(d.created_at)}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/corporation/deals/${d.id}`}
                            className={`text-xs font-medium hover:underline ${
                              d.status === 'proposed' ? 'text-amber-600' : 'text-brand-600'
                            }`}
                          >
                            {d.status === 'proposed' ? 'אשר / דחה' : 'פרטים'}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function CorporationDealsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}>
      <CorporationDealsPageContent />
    </Suspense>
  );
}
