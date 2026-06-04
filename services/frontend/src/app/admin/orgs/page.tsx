'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, ChevronDown, ChevronLeft, Pencil, Mail, Phone, Hash, User,
  Building2, ShieldCheck, MapPin, CalendarDays, Info,
} from 'lucide-react';
import { adminApi, type PendingOrg } from '@/lib/adminApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableToolbar } from '@/components/table/TableToolbar';
import { useTableState } from '@/components/table/useTableState';
import { OrgSummaryHeader } from '@/components/admin/OrgSummaryHeader';

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

// Full row shape returned by /admin/orgs/{id} — superset of PendingOrg.
// Loosely typed because the endpoint returns the raw DB row.
type FullOrg = PendingOrg & {
  approval_status?: string | null;
  notes?: string | null;
  countries_of_origin?: string[] | string | null;
  minimum_contract_months?: number | null;
  tc_signed_at?: string | null;
  tc_version?: string | null;
  verification_tier?: string | null;
  verification_method?: string | null;
  gov_registry_source_year?: number | null;
  gov_registry_matched_at?: string | null;
  kablan_verified_at?: string | null;
  kvutza?: string | null;
  sivug?: number | null;
  gov_branch?: string | null;
  gov_company_status?: string | null;
  kablan_number?: string | null;
};

export default function AdminOrgsPage() {
  const [orgs, setOrgs] = useState<(PendingOrg & { approval_status?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'contractor' | 'corporation'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Inline-expand state. Single-open accordion: clicking another row
  // closes the previous. Details are lazy-loaded and cached by id so
  // re-opening doesn't refetch.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, FullOrg>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string>('');

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

  function fmt(iso?: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('he-IL');
  }
  function fmtDateTime(iso?: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('he-IL');
  }

  async function toggleRow(o: OrgRow) {
    setDetailError('');
    // Same row → collapse.
    if (expandedId === o.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(o.id);
    if (detailCache[o.id]) return; // cached, no fetch needed
    setDetailLoadingId(o.id);
    try {
      const data = await adminApi.getOrg(o.id, o.org_type);
      const row = data as unknown as FullOrg;
      // countries_of_origin may come back as a JSON string — normalize.
      let coo = row.countries_of_origin;
      if (typeof coo === 'string') {
        try { coo = JSON.parse(coo); } catch { coo = []; }
      }
      setDetailCache(prev => ({
        ...prev,
        [o.id]: { ...row, countries_of_origin: Array.isArray(coo) ? coo : [] },
      }));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'שגיאה בטעינת פרטים');
    } finally {
      setDetailLoadingId(null);
    }
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
                  <th className="pb-3 px-4 sm:px-0 w-6"></th>
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
                  const isOpen = expandedId === o.id;
                  return (
                    <Fragment key={o.id}>
                    <tr
                      onClick={() => toggleRow(o)}
                      className={`border-b border-slate-50 last:border-0 cursor-pointer transition-colors ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="py-3 px-4 sm:px-0 text-slate-400">
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                      </td>
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
                      <td className="py-3 px-4 sm:px-0 text-end" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/admin/orgs/${o.id}?type=${o.org_type}`}
                          aria-label="ערוך"
                          title="ערוך פרטים"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-500 hover:text-brand-600 hover:bg-white border border-transparent hover:border-slate-200"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="px-4 sm:px-2 pb-4 pt-1">
                          {detailLoadingId === o.id && !detailCache[o.id] ? (
                            <div className="flex items-center justify-center py-8 text-slate-400">
                              <Loader2 className="h-5 w-5 animate-spin" />
                            </div>
                          ) : detailError && !detailCache[o.id] ? (
                            <div className="text-sm text-red-600 py-4">{detailError}</div>
                          ) : detailCache[o.id] ? (
                            <ExpandedDetail
                              org={detailCache[o.id]}
                              fmtDateTime={fmtDateTime}
                            />
                          ) : null}
                        </td>
                      </tr>
                    )}
                    </Fragment>
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

// ─── Read-only inline detail panel ────────────────────────────────────
function ExpandedDetail({
  org,
  fmtDateTime,
}: {
  org: FullOrg;
  fmtDateTime: (iso?: string | null) => string;
}) {
  const isContractor = org.org_type === 'contractor';
  const coo = Array.isArray(org.countries_of_origin) ? org.countries_of_origin : [];

  return (
    <div className="space-y-4">
      {/* KPI strip + recent deals — same component used on /admin/orgs/{id} */}
      <OrgSummaryHeader orgId={org.id} orgType={org.org_type} />

      {/* Basic + registry fields, read-only */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">פרטי הארגון</h3>
          <Link
            href={`/admin/orgs/${org.id}?type=${org.org_type}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
          >
            <Pencil className="h-3.5 w-3.5" />
            ערוך פרטים
            <ChevronLeft className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <DetailRow icon={<Building2 className="h-3.5 w-3.5" />} label="שם (עברית)" value={org.company_name_he || '—'} />
          <DetailRow icon={<Building2 className="h-3.5 w-3.5" />} label="שם (אנגלית)" value={org.company_name || '—'} ltr />
          <DetailRow icon={<Hash className="h-3.5 w-3.5" />} label="ח.פ / ע.מ" value={org.business_number || '—'} ltr />
          <DetailRow icon={<User className="h-3.5 w-3.5" />}  label="איש קשר"    value={org.contact_name || '—'} />
          <DetailRow icon={<Mail className="h-3.5 w-3.5" />}  label="אימייל"     value={org.contact_email || '—'} ltr />
          <DetailRow icon={<Phone className="h-3.5 w-3.5" />} label="טלפון"      value={org.contact_phone || '—'} ltr />
          <DetailRow icon={<CalendarDays className="h-3.5 w-3.5" />} label="נרשם" value={fmtDateTime(org.created_at)} />
          <DetailRow
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            label="רמת אימות"
            value={
              <span>
                <code dir="ltr" className="font-mono text-slate-700">{org.verification_tier || '—'}</code>
                {org.verification_method && (
                  <span className="text-xs text-slate-400 ms-2" dir="ltr">{org.verification_method}</span>
                )}
              </span>
            }
          />
          {org.commission_per_worker_amount != null && (
            <DetailRow
              icon={<Info className="h-3.5 w-3.5" />}
              label="עמלת פלטפורמה לעובד"
              value={`${Number(org.commission_per_worker_amount).toLocaleString('he-IL')} ₪`}
            />
          )}
        </div>

        {/* Type-specific registry block */}
        {isContractor && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-2">פרטי רישום קבלן</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="מספר קבלן"            value={org.kablan_number || '—'} ltr />
              <DetailRow label="קבוצה"                value={org.kvutza || '—'} />
              <DetailRow label="סיווג"                value={org.sivug != null ? String(org.sivug) : '—'} />
              <DetailRow label="ענף"                  value={org.gov_branch || '—'} />
              <DetailRow label="סטטוס רשם החברות"     value={org.gov_company_status || '—'} />
              <DetailRow label="אומת מול רשם הקבלנים" value={org.kablan_verified_at ? fmtDateTime(org.kablan_verified_at) : '—'} />
            </div>
          </div>
        )}

        {!isContractor && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-2">פרטי תאגיד</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <DetailRow
                icon={<MapPin className="h-3.5 w-3.5" />}
                label="מדינות מוצא"
                value={coo.length ? coo.join(', ') : '—'}
                ltr
              />
              <DetailRow label="חוזה מינימום (חודשים)" value={org.minimum_contract_months != null ? String(org.minimum_contract_months) : '—'} />
              <DetailRow label="ברשימת רשות האוכלוסין" value={org.gov_registry_source_year ? `${org.gov_registry_source_year}` : '—'} />
              <DetailRow label="עודכן מול הרשימה"      value={org.gov_registry_matched_at ? fmtDateTime(org.gov_registry_matched_at) : '—'} />
              <DetailRow label="חתימה על תנאי שימוש"   value={org.tc_signed_at ? fmtDateTime(org.tc_signed_at) : 'לא נחתם'} />
              {org.tc_version && <DetailRow label="גרסת T&C" value={org.tc_version} ltr />}
            </div>
          </div>
        )}

        {org.notes && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-1">הערות</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{org.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon, label, value, ltr,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  ltr?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-slate-400 mb-0.5">
        {icon}
        <span>{label}</span>
      </p>
      <p className="text-slate-700 font-medium truncate" dir={ltr ? 'ltr' : undefined}>
        {value}
      </p>
    </div>
  );
}
