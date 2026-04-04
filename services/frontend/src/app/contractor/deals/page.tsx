'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { dealApi } from '@/lib/api';
import type { Deal } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge from '@/components/StatusBadge';

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

type Filter = 'all' | 'proposed' | 'active' | 'completed';
const FILTER_LABELS: Record<Filter, string> = {
  all: 'הכל', proposed: 'הצעות', active: 'פעילות', completed: 'הושלמו',
};

export default function ContractorDealsPage() {
  const [deals, setDeals]   = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<Filter>('all');

  useEffect(() => {
    dealApi.list()
      .then(setDeals)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = deals.filter((d) => {
    if (filter === 'proposed')  return ['proposed', 'counter_proposed'].includes(d.status);
    if (filter === 'active')    return ['accepted', 'active', 'reporting'].includes(d.status);
    if (filter === 'completed') return ['completed', 'cancelled', 'disputed'].includes(d.status);
    return true;
  });

  return (
    <div className="space-y-4 max-w-6xl">
      <h2 className="text-xl font-bold text-slate-900">עסקאות</h2>

      <div className="flex gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-brand-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}>
            {FILTER_LABELS[f]}
          </button>
        ))}
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
                    <th className="px-4 py-3 text-start font-medium">עובדים</th>
                    <th className="px-4 py-3 text-start font-medium">מחיר</th>
                    <th className="px-4 py-3 text-start font-medium">נוצרה</th>
                    <th className="px-4 py-3 text-start font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={d.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">#{d.id.slice(0, 8)}</td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-3 text-center text-slate-600">{d.workers_count}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {d.agreed_price ? `₪${Number(d.agreed_price).toLocaleString('he-IL')}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{fmt(d.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/contractor/deals/${d.id}`}
                          className="text-xs font-medium text-brand-600 hover:underline">
                          פרטים
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
