'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search, ChevronLeft } from 'lucide-react';
import { adminApi, type PendingOrg } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type StatusFilter = 'all' | 'approved' | 'pending' | 'rejected' | 'suspended';
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all:       'הכל',
  approved:  'מאושרים',
  pending:   'ממתינים',
  rejected:  'נדחו',
  suspended: 'מושהים',
};

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
  approved:  { label: 'מאושר',      variant: 'success' },
  pending:   { label: 'ממתין',      variant: 'warning' },
  rejected:  { label: 'נדחה',       variant: 'destructive' },
  suspended: { label: 'מושהה',      variant: 'secondary' },
};

export default function AdminOrgsPage() {
  const [orgs, setOrgs] = useState<(PendingOrg & { approval_status?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'contractor' | 'corporation'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    adminApi.allOrgs()
      .then(data => setOrgs(data as any))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = orgs.filter(o => {
    const matchType   = typeFilter === 'all'   || o.org_type === typeFilter;
    const matchStatus = statusFilter === 'all' || (o as any).approval_status === statusFilter;
    const matchSearch = !search ||
      (o.company_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (o.contact_email || '').toLowerCase().includes(search.toLowerCase()) ||
      (o.business_number || '').includes(search);
    return matchType && matchStatus && matchSearch;
  });

  function fmt(iso?: string) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900">כל הארגונים</h2>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500 self-center me-1">סוג:</span>
          {(['all', 'contractor', 'corporation'] as const).map(f => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                typeFilter === f
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {f === 'all' ? 'הכל' : f === 'contractor' ? 'קבלנים' : 'תאגידים'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-xs text-slate-500 self-center me-1">סטטוס:</span>
          {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === f
                  ? 'bg-brand-600 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {STATUS_FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="חפש לפי שם או אימייל..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full ps-9 pe-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${filtered.length} ארגונים`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8">לא נמצאו ארגונים</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="pb-3 text-start font-medium">שם חברה</th>
                  <th className="pb-3 text-start font-medium">סוג</th>
                  <th className="pb-3 text-start font-medium">אימייל</th>
                  <th className="pb-3 text-start font-medium">סטטוס</th>
                  <th className="pb-3 text-start font-medium">נרשם</th>
                  <th className="pb-3 text-end font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const s = STATUS_MAP[(o as any).approval_status ?? 'pending'];
                  return (
                    <tr key={o.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="py-3 font-medium text-slate-900">
                        {o.company_name}
                        {o.company_name_he && (
                          <span className="block text-xs text-slate-400">{o.company_name_he}</span>
                        )}
                      </td>
                      <td className="py-3">
                        <Badge variant={o.org_type === 'contractor' ? 'default' : 'secondary'}>
                          {o.org_type === 'contractor' ? 'קבלן' : 'תאגיד'}
                        </Badge>
                      </td>
                      <td className="py-3 text-slate-600 text-xs">{o.contact_email}</td>
                      <td className="py-3">
                        <Badge variant={s?.variant ?? 'secondary'}>{s?.label ?? (o as any).approval_status}</Badge>
                      </td>
                      <td className="py-3 text-slate-500">{fmt(o.created_at)}</td>
                      <td className="py-3 text-end">
                        <Link
                          href={`/admin/orgs/${o.id}?type=${o.org_type}`}
                          className="inline-flex items-center gap-0.5 text-brand-600 text-xs font-medium hover:underline"
                        >
                          ערוך / צפה
                          <ChevronLeft className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
