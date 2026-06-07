'use client';

// /admin/deals — the admin's "where is every deal stuck" console.
// One row per deal in the system, party names + contacts inline so
// the admin can spot a stuck deal and reach out to the right person
// without leaving the table.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, AlertTriangle, Building2, HardHat, Phone, Mail, User,
  Filter as FilterIcon, ArrowDown, ArrowUp, Clock, X,
} from 'lucide-react';
import { adminApi, type AdminDealRow } from '@/lib/adminApi';
import { dealRef } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusBadge from '@/components/StatusBadge';

type StuckFilter   = 'all' | 'corp' | 'contractor' | 'system' | 'admin' | 'neither';
type StatusFilter  = 'all' | 'proposed' | 'corp_committed' | 'approved' | 'closed' | 'cancelled' | 'disputed';
type SortKey       = 'updated' | 'created' | 'stuck_hours' | 'amount';
type SortDir       = 'asc' | 'desc';

const STUCK_FILTERS: { key: StuckFilter; label: string; tone: string }[] = [
  { key: 'all',        label: 'הכל',              tone: 'bg-slate-900 text-white' },
  { key: 'corp',       label: 'תקוע אצל תאגיד',    tone: 'bg-amber-500 text-white' },
  { key: 'contractor', label: 'תקוע אצל קבלן',     tone: 'bg-sky-500 text-white' },
  { key: 'system',     label: 'ממתין למערכת',      tone: 'bg-navy-500 text-white' },
  { key: 'admin',      label: 'דורש טיפול אדמין',  tone: 'bg-rose-500 text-white' },
  { key: 'neither',    label: 'סגור / לא תקוע',    tone: 'bg-emerald-500 text-white' },
];

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',            label: 'כל הסטטוסים' },
  { key: 'proposed',       label: 'הצעה נכנסה' },
  { key: 'corp_committed', label: 'התאגיד הגיב' },
  { key: 'approved',       label: 'הקבלן אישר' },
  { key: 'closed',         label: 'נסגרה' },
  { key: 'cancelled',      label: 'בוטלה / נדחתה' },
  { key: 'disputed',       label: 'במחלוקת' },
];

// Cluster the "cancelled" filter across every cancellation variant
// so the admin doesn't have to remember the 5 db status strings.
const STATUS_GROUP: Record<string, string[]> = {
  cancelled: ['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired'],
};

// MySQL TIMESTAMP serializes without tz, but the DB stores UTC —
// normalise so "X hours ago" matches real elapsed regardless of
// the admin's browser locale.
function parseUtcMs(iso?: string | null): number {
  if (!iso) return NaN;
  let s = iso.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
  return new Date(s).getTime();
}

function fmtDate(iso?: string | null): string {
  const ms = parseUtcMs(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('he-IL');
}

function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 1)  return `${Math.round(h * 60)} דק׳`;
  if (h < 24) return `${Math.round(h)} שעות`;
  return `${Math.floor(h / 24)} ימים`;
}

// Escalate colour as the stuck-time grows. Soft warning at 24h,
// hard amber after 48h, rose past a week — covers the SLA windows
// in the customer flow doc (48h for corp, 48h for cancel window,
// 7 days for contractor approval).
function stuckToneFor(hours: number | null, owner: string): string {
  if (hours == null || owner === 'neither') return 'text-slate-400';
  if (hours >= 24 * 7) return 'text-rose-600 font-bold';
  if (hours >= 48)     return 'text-amber-700 font-semibold';
  if (hours >= 24)     return 'text-amber-600';
  return 'text-slate-500';
}

// Drives the chip colour next to the row's "stuck on X" label so
// the admin can spot the four flavours of stuck at a glance without
// reading the text.
const STUCK_CHIP: Record<string, string> = {
  corp:       'bg-amber-100 text-amber-800 border-amber-300',
  contractor: 'bg-sky-100 text-sky-800 border-sky-300',
  system:     'bg-navy-100 text-navy-800 border-navy-300',
  admin:      'bg-rose-100 text-rose-800 border-rose-300',
  neither:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  unknown:    'bg-slate-100 text-slate-700 border-slate-200',
};
const STUCK_LABEL: Record<string, string> = {
  corp:       'אצל התאגיד',
  contractor: 'אצל הקבלן',
  system:     'אצל המערכת',
  admin:      'דורש אדמין',
  neither:    '—',
  unknown:    '?',
};

interface ContactPopoverProps {
  kind:    'contractor' | 'corporation';
  name:    string | null;
  contact: { name: string | null; phone: string | null; email: string | null } | null;
  onClose: () => void;
}

function ContactPopover({ kind, name, contact, onClose }: ContactPopoverProps) {
  // ESC dismiss; backdrop click dismiss. Same pattern as the
  // ConfirmDialog primitive we already use for cancellations.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const Icon = kind === 'corporation' ? Building2 : HardHat;
  const heading = kind === 'corporation' ? 'פרטי תאגיד' : 'פרטי קבלן';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-brand-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest font-bold text-slate-400">{heading}</p>
              <h2 className="text-base font-bold text-slate-900 truncate">{name || '—'}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition rounded p-1 -mt-0.5 -me-1"
            aria-label="סגירה"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {contact?.name && (
            <div className="flex items-center gap-3 text-sm">
              <User className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="text-slate-700">איש קשר:</span>
              <span className="font-semibold text-slate-900">{contact.name}</span>
            </div>
          )}
          {contact?.phone && (
            <div className="flex items-center gap-3 text-sm">
              <Phone className="h-4 w-4 text-slate-400 shrink-0" />
              <a
                href={`tel:${contact.phone.replace(/\s+/g, '')}`}
                dir="ltr"
                className="font-mono font-semibold text-brand-700 hover:underline"
              >
                {contact.phone}
              </a>
            </div>
          )}
          {contact?.email && (
            <div className="flex items-center gap-3 text-sm">
              <Mail className="h-4 w-4 text-slate-400 shrink-0" />
              <a
                href={`mailto:${contact.email}`}
                dir="ltr"
                className="text-brand-700 hover:underline break-all"
              >
                {contact.email}
              </a>
            </div>
          )}
          {!contact?.phone && !contact?.email && (
            <p className="text-sm text-slate-400">לא נמצאו פרטי קשר</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminDealsPage() {
  const [deals, setDeals]       = useState<AdminDealRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [stuckFilter, setStuckFilter]   = useState<StuckFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchText, setSearchText]     = useState('');
  const [sortKey, setSortKey]   = useState<SortKey>('updated');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');
  const [popoverContact, setPopoverContact] = useState<ContactPopoverProps | null>(null);

  function reload() {
    setLoading(true); setError(false);
    adminApi.allDealsForAdmin()
      .then((res) => setDeals(res.items))
      .catch((err) => {
        console.error('[admin/deals] load failed:', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, []);

  // Client-side filter + sort. Cheap with 65 rows; if this grows
  // past ~500 we should push the sort/search to the backend too.
  const filtered = useMemo(() => {
    let rows = deals;
    if (stuckFilter !== 'all') {
      rows = rows.filter((d) => d.stuck_on === stuckFilter);
    }
    if (statusFilter !== 'all') {
      const expanded = STATUS_GROUP[statusFilter] ?? [statusFilter];
      rows = rows.filter((d) => expanded.includes(d.status));
    }
    if (searchText.trim()) {
      const needle = searchText.trim().toLowerCase();
      rows = rows.filter((d) =>
        (d.contractor_name  || '').toLowerCase().includes(needle) ||
        (d.corporation_name || '').toLowerCase().includes(needle) ||
        (d.profession_he   || '').toLowerCase().includes(needle) ||
        dealRef(d.id).includes(needle) ||
        d.id.toLowerCase().includes(needle)
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va < vb ? -1 * dir : 1 * dir;
    });
    return rows;
  }, [deals, stuckFilter, statusFilter, searchText, sortKey, sortDir]);

  function sortValue(d: AdminDealRow, key: SortKey): number | null {
    switch (key) {
      case 'updated':     return parseUtcMs(d.updated_at);
      case 'created':     return parseUtcMs(d.created_at);
      case 'stuck_hours': return d.hours_in_stage ?? null;
      case 'amount':      return d.payment_amount_estimated ?? d.commission_amount ?? null;
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  // Counts by stuck-stage so each filter chip can show "stuck on
  // corp (12)" — the admin gets the priority signal before clicking.
  const stuckCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of deals) c[d.stuck_on] = (c[d.stuck_on] || 0) + 1;
    return c;
  }, [deals]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">לוח עסקאות — אדמין</h2>
          <p className="text-xs text-slate-500 mt-0.5">{deals.length} עסקאות במערכת</p>
        </div>
      </div>

      {/* Stuck-stage filter chips — primary axis the admin scans on */}
      <div className="flex gap-2 flex-wrap">
        {STUCK_FILTERS.map((f) => {
          const count = f.key === 'all' ? deals.length : (stuckCounts[f.key] || 0);
          const active = stuckFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStuckFilter(f.key)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                active
                  ? f.tone + ' border-transparent'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full leading-none ${
                active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'
              }`}>{count}</span>
              <span>{f.label}</span>
            </button>
          );
        })}
      </div>

      {/* Secondary filters: status + free-text search */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <FilterIcon className="h-4 w-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          <Input
            placeholder="חיפוש — שם תאגיד, קבלן, מקצוע, מס׳ עסקה"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="flex-1 min-w-[280px]"
          />

          {(stuckFilter !== 'all' || statusFilter !== 'all' || searchText) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setStuckFilter('all'); setStatusFilter('all'); setSearchText(''); }}
            >
              נקה סינון
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Data table */}
      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center px-4">
              <AlertTriangle className="h-8 w-8 text-rose-400" />
              <p className="text-slate-700 font-medium">לא ניתן לטעון את העסקאות</p>
              <Button variant="outline" size="sm" onClick={reload}>נסה שוב</Button>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-12">אין עסקאות תואמות לסינון</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 bg-slate-50/60">
                    <th className="py-2.5 px-3 text-start font-bold">עסקה</th>
                    <th className="py-2.5 px-3 text-start font-bold">סטטוס</th>
                    <th className="py-2.5 px-3 text-start font-bold">תקוע ב</th>
                    <SortableTh label="זמן בשלב" k="stuck_hours" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <th className="py-2.5 px-3 text-start font-bold">קבלן</th>
                    <th className="py-2.5 px-3 text-start font-bold">תאגיד</th>
                    <th className="py-2.5 px-3 text-start font-bold">מקצוע</th>
                    <th className="py-2.5 px-3 text-center font-bold">עובדים</th>
                    <SortableTh label="סכום" k="amount" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <SortableTh label="עדכון אחרון" k="updated" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                    <th className="py-2.5 px-3 text-start font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="py-3 px-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                        #{dealRef(d.id)}
                        {d.status === 'disputed' && (
                          <AlertTriangle className="inline h-3.5 w-3.5 text-rose-500 ms-1" />
                        )}
                      </td>
                      <td className="py-3 px-3"><StatusBadge status={d.status} /></td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${STUCK_CHIP[d.stuck_on]}`}>
                          {STUCK_LABEL[d.stuck_on]}
                        </span>
                      </td>
                      <td className={`py-3 px-3 whitespace-nowrap ${stuckToneFor(d.hours_in_stage, d.stuck_on)}`}>
                        {d.stuck_on === 'neither' ? '—' : (
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {fmtHours(d.hours_in_stage)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => setPopoverContact({
                            kind: 'contractor',
                            name: d.contractor_name,
                            contact: d.contractor_contact,
                            onClose: () => setPopoverContact(null),
                          })}
                          className="text-start text-slate-800 hover:text-brand-700 hover:underline truncate max-w-[180px] inline-flex items-center gap-1.5"
                          title={d.contractor_name || ''}
                        >
                          <HardHat className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          {d.contractor_name || '—'}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => setPopoverContact({
                            kind: 'corporation',
                            name: d.corporation_name,
                            contact: d.corporation_contact,
                            onClose: () => setPopoverContact(null),
                          })}
                          className="text-start text-slate-800 hover:text-brand-700 hover:underline truncate max-w-[180px] inline-flex items-center gap-1.5"
                          title={d.corporation_name || ''}
                        >
                          <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          {d.corporation_name || '—'}
                        </button>
                      </td>
                      <td className="py-3 px-3 text-slate-700 truncate max-w-[120px]" title={d.profession_he || ''}>
                        {d.profession_he || '—'}
                      </td>
                      <td className="py-3 px-3 text-center text-slate-700">
                        {d.requested_count != null
                          ? `${d.worker_count ?? 0}/${d.requested_count}`
                          : (d.worker_count ?? 0)}
                      </td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                        {d.payment_amount_estimated != null
                          ? `₪${Number(d.payment_amount_estimated).toLocaleString('he-IL', { maximumFractionDigits: 0 })}`
                          : (d.commission_amount != null
                              ? `₪${Number(d.commission_amount).toLocaleString('he-IL', { maximumFractionDigits: 0 })}`
                              : '—')}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-500 whitespace-nowrap">
                        {fmtDate(d.updated_at)}
                      </td>
                      <td className="py-3 px-3">
                        <Link
                          href={`/admin/deals/${d.id}`}
                          className="text-brand-600 hover:underline text-xs whitespace-nowrap"
                        >
                          פרטי עסקה →
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

      {popoverContact && <ContactPopover {...popoverContact} />}
    </div>
  );
}

function SortableTh({ label, k, sortKey, sortDir, onClick }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const Arrow = sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="py-2.5 px-3 text-start font-bold">
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 hover:text-brand-700 ${active ? 'text-brand-700' : ''}`}
      >
        {label}
        {active && <Arrow className="h-3 w-3" />}
      </button>
    </th>
  );
}
