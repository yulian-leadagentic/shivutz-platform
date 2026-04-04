'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Search, Zap } from 'lucide-react';
import { jobApi } from '@/lib/api';
import type { JobRequest } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';

function formatDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('he-IL');
}

const STATUS_ORDER = ['open', 'matched', 'in_negotiation', 'fulfilled', 'draft', 'cancelled'];

export default function RequestsPage() {
  const [requests, setRequests] = useState<JobRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    jobApi.list()
      .then(setRequests)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = requests.filter((r) => {
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      (r.project_name_he || r.project_name).toLowerCase().includes(q) ||
      (r.region || '').toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const statusCounts = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const activeStatuses = STATUS_ORDER.filter((s) => statusCounts[s]);

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-900">בקשות עבודה</h2>
        <Button asChild>
          <Link href="/contractor/requests/new">
            <Plus className="h-4 w-4" />
            בקשה חדשה
          </Link>
        </Button>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            statusFilter === 'all'
              ? 'bg-brand-600 text-white'
              : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          הכל ({requests.length})
        </button>
        {activeStatuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <StatusBadge status={s} /> ({statusCounts[s]})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="חפש לפי שם פרויקט, אזור..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full ps-9 pe-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${filtered.length} בקשות`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-2">
              <p>לא נמצאו בקשות</p>
              {requests.length === 0 && (
                <Button asChild variant="outline" size="sm">
                  <Link href="/contractor/requests/new">
                    <Plus className="h-4 w-4" />
                    צור בקשה ראשונה
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="px-4 py-3 text-start font-medium">פרויקט</th>
                    <th className="px-4 py-3 text-start font-medium">אזור</th>
                    <th className="px-4 py-3 text-start font-medium">תאריך יצירה</th>
                    <th className="px-4 py-3 text-start font-medium">סטטוס</th>
                    <th className="px-4 py-3 text-start font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <Link
                          href={`/contractor/requests/${r.id}/match`}
                          className="hover:text-brand-600 hover:underline"
                        >
                          {r.project_name_he || r.project_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.region || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(r.created_at)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3">
                        {(r.status === 'open' || r.status === 'matched') && (
                          <Link
                            href={`/contractor/requests/${r.id}/match`}
                            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                          >
                            <Zap className="h-3 w-3" />
                            הצג התאמות
                          </Link>
                        )}
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
