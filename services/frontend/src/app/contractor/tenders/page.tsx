'use client';

// Contractor's foreign-import tenders list.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Globe2, Plus, AlertCircle, ArrowLeft } from 'lucide-react';
import { tenderApi, type Tender } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { TableToolbar } from '@/components/table/TableToolbar';
import { useTableState } from '@/components/table/useTableState';

const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  pending_admin:  { cls: 'bg-slate-200 text-slate-700 border-slate-300',     label: 'ממתין לאישור פרסום' },
  open:           { cls: 'bg-sky-100 text-sky-800 border-sky-200',           label: 'פתוח להצעות' },
  awaiting_admin: { cls: 'bg-amber-500 text-white border-amber-500',         label: 'בקשת קשר — ממתין למנהל' },
  in_progress:    { cls: 'bg-emerald-500 text-white border-emerald-500',     label: 'בתהליך' },
  closed:         { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'הושלם' },
  cancelled:      { cls: 'bg-rose-50 text-rose-700 border-rose-200',         label: 'בוטל' },
  frozen:         { cls: 'bg-sky-100 text-sky-700 border-sky-200',           label: 'מוקפא' },
  rejected:       { cls: 'bg-rose-100 text-rose-700 border-rose-200',        label: 'נדחה' },
};

function fmt(iso?: string | null) {
  if (!iso) return '—';
  const s = iso.includes(' ') && !iso.includes('T') ? iso.replace(' ', 'T') : iso;
  const z = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z';
  return new Date(z).toLocaleDateString('he-IL');
}

export default function ContractorTendersPage() {
  const { professionMap, originMap } = useEnums();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  useEffect(() => {
    tenderApi.listMine()
      .then(setTenders)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // ── Filter + sort ───────────────────────────────────────────────
  type TenderStatus = 'all' | 'active' | 'in_progress' | 'closed' | 'cancelled';
  const [statusFilter, setStatusFilter] = useState<TenderStatus>('all');
  const [search, setSearch] = useState('');

  const tenderFilter = useCallback((t: Tender) => {
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && !['pending_admin', 'open', 'awaiting_admin'].includes(t.status)) return false;
      if (statusFilter === 'in_progress' && t.status !== 'in_progress') return false;
      if (statusFilter === 'closed' && t.status !== 'closed') return false;
      if (statusFilter === 'cancelled' && !['cancelled', 'rejected', 'frozen'].includes(t.status)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const title = (t.title || '').toLowerCase();
      if (!title.includes(q) && !t.id.toLowerCase().includes(q)) return false;
    }
    return true;
  }, [statusFilter, search]);

  type TenderSortKey = 'created' | 'bids' | 'status';
  const tenderSortBy = useCallback((t: Tender, key: TenderSortKey) => {
    switch (key) {
      case 'created': return t.created_at ? new Date(t.created_at) : null;
      case 'bids':    return t.bid_count ?? 0;
      case 'status':  return t.status || '';
    }
  }, []);

  const { visible: visibleTenders, sortKey, sortDir, setSortKey, flipSortDir } =
    useTableState<Tender, TenderSortKey>({
      rows: tenders,
      initialSortKey: 'created',
      initialSortDir: 'desc',
      filter: tenderFilter,
      sortBy: tenderSortBy,
    });

  const hasActiveFilter = statusFilter !== 'all' || search.trim() !== '';
  function clearFilters() { setStatusFilter('all'); setSearch(''); }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Globe2 className="h-6 w-6 text-brand-600" />
          <h1 className="text-2xl font-bold text-slate-900">בקשות ייבוא עובדים</h1>
        </div>
        <Button asChild>
          <Link href="/contractor/tenders/new"><Plus className="h-4 w-4" /> בקשה חדשה</Link>
        </Button>
      </header>

      {loading && (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      )}

      {error && !loading && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="text-slate-700 font-medium">לא ניתן לטעון את הבקשות</p>
        </div>
      )}

      {!loading && !error && tenders.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <Globe2 className="h-10 w-10 text-slate-200" />
          <p className="text-slate-600 font-medium">עדיין אין בקשות</p>
          <p className="text-slate-400 text-sm">פרסם בקשה כדי לקבל הצעות מתאגידים לייבוא עובדים מחו״ל</p>
          <Button asChild variant="outline" size="sm" className="mt-1">
            <Link href="/contractor/tenders/new">+ פרסם בקשה ראשון</Link>
          </Button>
        </div>
      )}

      {!loading && !error && tenders.length > 0 && (
        <TableToolbar
          pills={{
            options: [
              { key: 'all',         label: 'הכל',     count: tenders.length,                                                                                  tone: 'bg-slate-900 text-white' },
              { key: 'active',      label: 'פעילות',  count: tenders.filter((t) => ['pending_admin','open','awaiting_admin'].includes(t.status)).length,         tone: 'bg-sky-500 text-white' },
              { key: 'in_progress', label: 'בתהליך',  count: tenders.filter((t) => t.status === 'in_progress').length,                                           tone: 'bg-emerald-500 text-white' },
              { key: 'closed',      label: 'הושלמו',  count: tenders.filter((t) => t.status === 'closed').length,                                                tone: 'bg-slate-600 text-white' },
              { key: 'cancelled',   label: 'בוטלו',   count: tenders.filter((t) => ['cancelled','rejected','frozen'].includes(t.status)).length,                 tone: 'bg-rose-500 text-white' },
            ],
            active: statusFilter,
            onChange: setStatusFilter,
          }}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="חיפוש: כותרת / מזהה"
          sortOptions={[
            { key: 'created', label: 'תאריך פתיחה' },
            { key: 'bids',    label: 'מספר הצעות' },
            { key: 'status',  label: 'סטטוס' },
          ]}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortKeyChange={setSortKey}
          onSortDirToggle={flipSortDir}
          hasActiveFilter={hasActiveFilter}
          onClear={clearFilters}
        />
      )}

      {!loading && !error && tenders.length > 0 && visibleTenders.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl py-12 text-center text-slate-500">
          אין בקשות תואמות לסינון
        </div>
      )}

      {!loading && !error && visibleTenders.length > 0 && (
        <div className="space-y-3">
          {visibleTenders.map((t) => {
            const pill = STATUS_PILL[t.status] ?? { cls: 'bg-slate-100 text-slate-700 border-slate-200', label: t.status };
            const totalWorkers = t.items.reduce((s, i) => s + i.quantity, 0);
            return (
              <Link key={t.id} href={`/contractor/tenders/${t.id}`}
                className="block rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md hover:border-brand-300 transition p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900 truncate">
                        {t.title || `בקשה ל-${totalWorkers} עובדים`}
                      </h3>
                      <span className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full border ${pill.cls}`}>
                        {pill.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {t.items.map((i) => (
                        <span key={i.id}
                          className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                          <span className="font-bold text-base text-slate-900">
                            {professionMap[i.profession_type] ?? i.profession_type}
                          </span>
                          <span className="font-bold text-base text-brand-700">× {i.quantity}</span>
                          {i.origin_country && (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                              <Globe2 className="h-3.5 w-3.5" />
                              {originMap[i.origin_country] ?? i.origin_country}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5">פורסם: {fmt(t.created_at)}</p>
                  </div>
                  <div className="text-center shrink-0">
                    <div className="text-2xl font-extrabold text-brand-600">{t.bid_count ?? 0}</div>
                    <div className="text-[11px] text-slate-500">הצעות</div>
                  </div>
                  <ArrowLeft className="h-5 w-5 text-slate-300 shrink-0 mt-1" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
