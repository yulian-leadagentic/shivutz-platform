'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertTriangle } from 'lucide-react';
import { adminApi } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatusBadge from '@/components/StatusBadge';
import type { Deal } from '@/types';

export default function AdminDealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'disputed' | 'active'>('all');

  useEffect(() => {
    adminApi.allDeals()
      .then(setDeals)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = deals.filter(d => {
    if (filter === 'disputed') return d.status === 'disputed';
    if (filter === 'active')   return ['active', 'reporting'].includes(d.status);
    return true;
  });

  function fmt(iso?: string) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-900">כל העסקאות</h2>
        <div className="flex gap-2">
          {(['all', 'active', 'disputed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {f === 'all' ? 'הכל' : f === 'active' ? 'פעילות' : 'במחלוקת'}
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
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8">אין עסקאות תואמות</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="pb-3 text-start font-medium">מזהה</th>
                  <th className="pb-3 text-start font-medium">סטטוס</th>
                  <th className="pb-3 text-start font-medium">קבלן</th>
                  <th className="pb-3 text-start font-medium">תאגיד</th>
                  <th className="pb-3 text-start font-medium">עובדים</th>
                  <th className="pb-3 text-start font-medium">נוצר</th>
                  <th className="pb-3 text-start font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr key={d.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="py-3 font-mono text-xs text-slate-600">
                      {d.id.slice(0, 8)}
                      {(d as any).discrepancy_flag && (
                        <AlertTriangle className="inline h-3 w-3 text-red-500 ms-1" />
                      )}
                    </td>
                    <td className="py-3"><StatusBadge status={d.status} /></td>
                    <td className="py-3 text-slate-600 text-xs truncate max-w-[120px]">{d.contractor_id?.slice(0, 8)}</td>
                    <td className="py-3 text-slate-600 text-xs truncate max-w-[120px]">{d.corporation_id?.slice(0, 8)}</td>
                    <td className="py-3 text-center">{d.workers_count}</td>
                    <td className="py-3 text-slate-500">{fmt(d.created_at)}</td>
                    <td className="py-3">
                      <Link
                        href={`/admin/deals/${d.id}`}
                        className="text-brand-600 hover:underline text-xs"
                      >
                        פרטים
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
