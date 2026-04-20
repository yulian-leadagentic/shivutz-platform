'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Plus, Search, Zap, Pencil, Users, Briefcase, Calendar,
  CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Handshake,
} from 'lucide-react';
import { jobApi, dealApi, enumApi } from '@/lib/api';
import type { JobRequest, Deal } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d?: string) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return d; }
}

const STATUS_ORDER = ['open', 'matched', 'in_negotiation', 'fulfilled', 'draft', 'cancelled'];
const EDITABLE_STATUSES  = new Set(['draft', 'open', 'matched']);
const MATCHABLE_STATUSES = new Set(['draft', 'open', 'matched']);

/** Deal status labels shown on the request card */
const DEAL_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  proposed:         { label: 'פנייה נשלחה לתאגיד',  color: 'text-blue-600 bg-blue-50 border-blue-200' },
  counter_proposed: { label: 'תאגיד הגיב — בדוק צ׳אט', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  accepted:         { label: 'תאגיד אישר — ממתין לאישורך', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  active:           { label: 'עסקה פעילה — עובדים בשטח', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  reporting:        { label: 'שלב דיווח',             color: 'text-amber-600 bg-amber-50 border-amber-200' },
  completed:        { label: 'הושלמה',                color: 'text-slate-500 bg-slate-50 border-slate-200' },
  disputed:         { label: 'במחלוקת',               color: 'text-red-600 bg-red-50 border-red-200' },
  cancelled:        { label: 'בוטלה',                  color: 'text-slate-400 bg-slate-50 border-slate-200' },
};

function MatchQualityBadge({ fillPct, isComplete }: { fillPct: number; isComplete: boolean }) {
  if (fillPct < 0) return null;
  if (isComplete)
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><CheckCircle2 className="h-3 w-3" />התאמה מלאה</span>;
  if (fillPct >= 60)
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><AlertCircle className="h-3 w-3" />{Math.round(fillPct)}% מולא</span>;
  if (fillPct > 0)
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">{Math.round(fillPct)}% מולא</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 border border-red-100 rounded-full px-2 py-0.5">לא נמצאו התאמות</span>;
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div key={i} className="px-4 py-4 animate-pulse border-b border-slate-100 space-y-2">
          <div className="flex gap-2"><div className="h-5 bg-slate-200 rounded w-40" /><div className="h-4 bg-slate-100 rounded w-20" /></div>
          <div className="flex gap-2"><div className="h-4 bg-slate-100 rounded w-24" /><div className="h-4 bg-slate-100 rounded w-20" /></div>
          <div className="flex gap-2"><div className="h-6 bg-slate-100 rounded-full w-28" /><div className="h-6 bg-slate-100 rounded-full w-28" /></div>
        </div>
      ))}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RequestsPage() {
  const [requests, setRequests]         = useState<JobRequest[]>([]);
  const [deals, setDeals]               = useState<Deal[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [regionMap, setRegionMap]       = useState<Record<string, string>>({});
  const [profMap, setProfMap]           = useState<Record<string, string>>({});
  const [expanded, setExpanded]         = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      jobApi.list(),
      dealApi.list().catch(() => []),
      enumApi.regions().catch(() => []),
      enumApi.professions().catch(() => []),
    ]).then(([reqs, dealsData, regions, profs]) => {
      setRequests(reqs);
      setDeals(dealsData as Deal[]);
      const rm: Record<string, string> = {};
      (regions as { code: string; name_he: string }[]).forEach((r) => { rm[r.code] = r.name_he; });
      setRegionMap(rm);
      const pm: Record<string, string> = {};
      (profs as { code: string; name_he: string }[]).forEach((p) => { pm[p.code] = p.name_he; });
      setProfMap(pm);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Map: line_item_id → best deal for that line item
  const dealByLineItem = deals.reduce<Record<string, Deal>>((acc, d) => {
    const existing = acc[d.request_line_item_id];
    // Prefer active/accepted deals over proposed
    const priority = ['active', 'reporting', 'completed', 'accepted', 'counter_proposed', 'proposed', 'cancelled', 'disputed'];
    if (!existing || priority.indexOf(d.status) < priority.indexOf(existing.status)) {
      acc[d.request_line_item_id] = d;
    }
    return acc;
  }, {});

  // Map: request_id → best deal across its line items (for overall status banner)
  const dealByRequest = requests.reduce<Record<string, Deal | null>>((acc, req) => {
    const lineItems = (req as unknown as { line_items?: { id: string }[] }).line_items ?? [];
    let best: Deal | null = null;
    const priority = ['active', 'reporting', 'completed', 'accepted', 'counter_proposed', 'proposed', 'cancelled', 'disputed'];
    for (const li of lineItems) {
      const d = dealByLineItem[li.id];
      if (!d) continue;
      if (!best || priority.indexOf(d.status) < priority.indexOf(best.status)) best = d;
    }
    acc[req.id] = best;
    return acc;
  }, {});

  const filtered = requests.filter((r) => {
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    const q = search.toLowerCase();
    const regionLabel = regionMap[r.region] ?? r.region ?? '';
    const matchSearch =
      !q ||
      (r.project_name_he || r.project_name || '').toLowerCase().includes(q) ||
      regionLabel.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const statusCounts = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const activeStatuses = STATUS_ORDER.filter((s) => statusCounts[s]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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
            statusFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          הכל ({requests.length})
        </button>
        {activeStatuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              statusFilter === s ? 'bg-brand-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <StatusBadge status={s} />
            <span className="text-slate-400 text-xs">({statusCounts[s]})</span>
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
          className="w-full ps-9 pe-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
            <SkeletonRows />
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-3">
              <Briefcase className="h-10 w-10 text-slate-200 mx-auto" />
              <p>לא נמצאו בקשות</p>
              {requests.length === 0 && (
                <Button asChild variant="outline" size="sm">
                  <Link href="/contractor/requests/new">
                    <Plus className="h-4 w-4" />צור בקשה ראשונה
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filtered.map((r) => {
                const regionLabel  = regionMap[r.region] ?? r.region ?? '—';
                const startFmt     = formatDate(r.project_start_date);
                const endFmt       = formatDate(r.project_end_date);
                const fillPct      = r.best_fill_pct ?? -1;
                const isComplete   = r.best_is_complete ?? false;
                const isExpanded   = expanded.has(r.id);
                const lineItems    = (r as unknown as { line_items?: { id: string; profession_type: string; quantity: number; status: string }[] }).line_items ?? [];
                const bestDeal     = dealByRequest[r.id];

                return (
                  <div key={r.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* ── Main row ── */}
                    <div className="px-4 py-3.5">
                      <div className="flex items-start gap-3">
                        {/* Main content */}
                        <div className="flex-1 min-w-0 space-y-2">
                          {/* Title + badges */}
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/contractor/requests/${r.id}/match`}
                              className="text-sm font-semibold text-slate-900 hover:text-brand-600 hover:underline"
                            >
                              {r.project_name_he || r.project_name || '—'}
                            </Link>
                            <StatusBadge status={r.status} />
                            <MatchQualityBadge fillPct={fillPct} isComplete={isComplete} />
                          </div>

                          {/* Meta row */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span className="font-medium text-slate-700">{regionLabel}</span>
                            {lineItems.length > 0 && (
                              <span className="flex items-center gap-1">
                                <Briefcase className="h-3 w-3" />
                                {lineItems.length} {lineItems.length === 1 ? 'מקצוע' : 'מקצועות'}
                              </span>
                            )}
                            {(r.total_workers ?? 0) > 0 && (
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {r.total_workers} עובדים
                              </span>
                            )}
                            {startFmt && (
                              <span className="flex items-center gap-1" dir="ltr">
                                <Calendar className="h-3 w-3" />
                                {startFmt}{endFmt ? ` – ${endFmt}` : ''}
                              </span>
                            )}
                            <span className="text-slate-400">נוצר {formatDate(r.created_at)}</span>
                          </div>

                          {/* Deal status banner (if exists) */}
                          {bestDeal && DEAL_STATUS_LABEL[bestDeal.status] && (
                            <Link
                              href={`/contractor/deals/${bestDeal.id}`}
                              className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-lg px-2.5 py-1 transition-opacity hover:opacity-80 ${DEAL_STATUS_LABEL[bestDeal.status].color}`}
                            >
                              <Handshake className="h-3 w-3 shrink-0" />
                              {DEAL_STATUS_LABEL[bestDeal.status].label}
                            </Link>
                          )}

                          {/* Professions inline chips */}
                          {lineItems.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-0.5">
                              {lineItems.map((li) => {
                                const deal = dealByLineItem[li.id];
                                const profName = profMap[li.profession_type] ?? li.profession_type;
                                return (
                                  <span
                                    key={li.id}
                                    className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 rounded-full px-2.5 py-0.5 border border-slate-200"
                                  >
                                    <span className="font-medium">{profName}</span>
                                    <span className="text-slate-400">×{li.quantity}</span>
                                    {deal && (
                                      <span className={`ms-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold border ${DEAL_STATUS_LABEL[deal.status]?.color ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                        {DEAL_STATUS_LABEL[deal.status]?.label ?? deal.status}
                                      </span>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Actions column */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {MATCHABLE_STATUSES.has(r.status) && (
                            <Link
                              href={`/contractor/requests/${r.id}/match`}
                              className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium border border-brand-200 rounded-lg px-2.5 py-1.5 hover:bg-brand-50 transition-colors"
                            >
                              <Zap className="h-3 w-3" />
                              {fillPct >= 0 ? 'עדכן התאמות' : 'חפש התאמות'}
                            </Link>
                          )}
                          {EDITABLE_STATUSES.has(r.status) && (
                            <Link
                              href={`/contractor/requests/${r.id}/edit`}
                              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 font-medium border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 transition-colors"
                            >
                              <Pencil className="h-3 w-3" />ערוך
                            </Link>
                          )}
                          {/* Expand toggle (only if has deal history) */}
                          {deals.some(d => lineItems.some(li => li.id === d.request_line_item_id)) && (
                            <button
                              onClick={() => toggleExpand(r.id)}
                              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 font-medium px-1 py-1"
                            >
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              {isExpanded ? 'הסתר' : 'עסקאות'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ── Expanded deals list ── */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 px-4 py-3 space-y-2">
                        <p className="text-xs font-semibold text-slate-500 mb-1">עסקאות שנוצרו לבקשה זו:</p>
                        {lineItems.map((li) => {
                          const deal = dealByLineItem[li.id];
                          if (!deal) return null;
                          const profName = profMap[li.profession_type] ?? li.profession_type;
                          return (
                            <Link
                              key={li.id}
                              href={`/contractor/deals/${deal.id}`}
                              className="flex items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 px-3 py-2.5 hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Handshake className="h-4 w-4 text-slate-400 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-800 truncate">{profName} — {deal.workers_count} עובדים</p>
                                  <p className="text-xs text-slate-400">עסקה #{deal.id.slice(0, 8)} · {new Date(deal.created_at).toLocaleDateString('he-IL')}</p>
                                </div>
                              </div>
                              <StatusBadge status={deal.status} />
                            </Link>
                          );
                        }).filter(Boolean)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
