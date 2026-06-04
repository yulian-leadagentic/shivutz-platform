'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ChevronLeft } from 'lucide-react';
import { adminApi, type PendingOrg } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableToolbar } from '@/components/table/TableToolbar';
import { useTableState } from '@/components/table/useTableState';

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

  type OrgRow = PendingOrg & { approval_status?: string };
  const filterPredicate = useCallback((o: OrgRow) => {
    if (typeFilter !== 'all' && o.org_type !== typeFilter) return false;
    if (statusFilter !== 'all' && o.approval_status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !(o.company_name || '').toLowerCase().includes(q) &&
        !(o.contact_email || '').toLowerCase().includes(q) &&
        !(o.business_number || '').includes(search)
      ) return false;
    }
    return true;
  }, [typeFilter, statusFilter, search]);

  type OrgSortKey = 'created' | 'name' | 'status';
  const sortBy = useCallback((o: OrgRow, key: OrgSortKey) => {
    switch (key) {
      case 'created': return o.created_at ? new Date(o.created_at) : null;
      case 'name':    return o.company_name || '';
      case 'status':  return o.approval_status || '';
    }
  }, []);

  const { visible: filtered, sortKey, sortDir, setSortKey, flipSortDir } =
    useTableState<OrgRow, OrgSortKey>({
      rows: orgs,
      initialSortKey: 'created',
      initialSortDir: 'desc',
      filter: filterPredicate,
      sortBy,
    });

  const hasActiveFilter = typeFilter !== 'all' || statusFilter !== 'all' || search.trim() !== '';
  function clearFilters() { setTypeFilter('all'); setStatusFilter('all'); setSearch(''); }

  function fmt(iso?: string) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-900">כל הארגונים</h2>

      <TableToolbar
        pills={{
          options: [
            { key: 'all',         label: 'הכל',     count: orgs.length,                                                       tone: 'bg-slate-900 text-white' },
            { key: 'contractor',  label: 'קבלנים',  count: orgs.filter((o) => o.org_type === 'contractor').length,            tone: 'bg-brand-600 text-white' },
            { key: 'corporation', label: 'תאגידים', count: orgs.filter((o) => o.org_type === 'corporation').length,           tone: 'bg-navy-600 text-white' },
          ],
          active: typeFilter,
          onChange: setTypeFilter,
        }}
        selects={[
          {
            key: 'status',
            ariaLabel: 'סטטוס',
            value: statusFilter,
            onChange: (v) => setStatusFilter(v as StatusFilter),
            options: (Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((s) => ({
              value: s, label: STATUS_FILTER_LABEL[s],
            })),
          },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="חיפוש: שם / אימייל / ע.מ / ח.פ"
        sortOptions={[
          { key: 'created', label: 'תאריך רישום' },
          { key: 'name',    label: 'שם' },
          { key: 'status',  label: 'סטטוס' },
        ]}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortKeyChange={setSortKey}
        onSortDirToggle={flipSortDir}
        hasActiveFilter={hasActiveFilter}
        onClear={clearFilters}
      />

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
            <div className="-mx-4 sm:mx-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px] sm:min-w-0">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="pb-3 px-4 sm:px-0 text-start font-medium">שם חברה</th>
                  <th className="pb-3 px-4 sm:px-0 text-start font-medium">סוג</th>
                  <th className="pb-3 px-4 sm:px-0 text-start font-medium">אימייל</th>
                  <th className="pb-3 px-4 sm:px-0 text-start font-medium">סטטוס</th>
                  <th className="pb-3 px-4 sm:px-0 text-start font-medium">נרשם</th>
                  <th className="pb-3 px-4 sm:px-0 text-end font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const s = STATUS_MAP[(o as any).approval_status ?? 'pending'];
                  return (
                    <tr key={o.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="py-3 px-4 sm:px-0 font-medium text-slate-900">
                        {o.company_name}
                        {o.company_name_he && (
                          <span className="block text-xs text-slate-400">{o.company_name_he}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 sm:px-0">
                        <Badge variant={o.org_type === 'contractor' ? 'default' : 'secondary'}>
                          {o.org_type === 'contractor' ? 'קבלן' : 'תאגיד'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 sm:px-0 text-slate-600 text-xs">{o.contact_email}</td>
                      <td className="py-3 px-4 sm:px-0">
                        <Badge variant={s?.variant ?? 'secondary'}>{s?.label ?? (o as any).approval_status}</Badge>
                      </td>
                      <td className="py-3 px-4 sm:px-0 text-slate-500 whitespace-nowrap">{fmt(o.created_at)}</td>
                      <td className="py-3 px-4 sm:px-0 text-end">
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
