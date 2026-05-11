'use client';

// Wave 4 polish — deals page rendered as a tile/card grid instead of
// the dense row list. Each tile is a self-contained summary the
// contractor can scan at a glance: profession + region + worker count
// + status badge + date. Click anywhere on the tile → deal detail page.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle, Handshake, MessageSquare, Calendar, MapPin,
  Plus, ChevronDown, Loader2, CheckCircle2, XCircle,
} from 'lucide-react';
import { dealApi } from '@/lib/api';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal, Worker } from '@/types';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import {
  DEAL_FILTER_LABEL as FILTER_LABELS,
  dealMatchesFilter,
  type DealFilter as Filter,
} from '@/i18n/he';

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

const STATUS_CONTEXT: Record<string, string> = {
  proposed:         'נשלחה לתאגיד — ממתין לתגובה',
  corp_committed:   'התאגיד הגיב — בדוק את הצ׳אט',
  approved:         'אושר ע״י הקבלן — עובדים בשטח',
  closed:           'הושלמה',
  rejected:         'תאגיד דחה',
  cancelled_by_corp: 'בוטל ע״י תאגיד',
  expired:          'פג תוקף',
};

// Type-extension for fields the backend enriches the row with:
// profession_type / profession_he / region_he / worker_count /
// requested_count / created_at — see services/deal/app/routes/deals.py.
type EnrichedDeal = Deal & {
  profession_type?: string;
  profession_he?:   string;
  region_he?:       string;
  worker_count?:    number;
  requested_count?: number;
};

function DealTileSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 rounded-xl bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-200 rounded w-2/3" />
          <div className="h-3 bg-slate-100 rounded w-1/2" />
          <div className="h-3 bg-slate-100 rounded w-1/3" />
        </div>
      </div>
      <div className="h-7 bg-slate-100 rounded mt-4" />
    </div>
  );
}

const VALID_FILTERS: Filter[] = ['all', 'proposed', 'active', 'completed'];

export default function ContractorDealsPage() {
  const searchParams = useSearchParams();
  // Allow `?filter=active` (etc.) so other pages — e.g. the manage
  // dashboard's KPI tiles — can deep-link straight into a filtered
  // view instead of bouncing through the "all" tab first.
  const initialFilter = (() => {
    const f = searchParams?.get('filter');
    return f && (VALID_FILTERS as string[]).includes(f) ? (f as Filter) : 'all';
  })();
  const [deals, setDeals]     = useState<EnrichedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [filter, setFilter]   = useState<Filter>(initialFilter);
  // Inline expansion — proposal rows open in-place instead of routing
  // to /contractor/deals/[id]. Workers are lazy-fetched on first
  // expand, cached per deal_id so re-toggling doesn't re-hit the API.
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [workersById, setWorkersById]   = useState<Record<string, Worker[]>>({});
  const [loadingWorkers, setLoadingWorkers] = useState<Record<string, boolean>>({});
  const [actingId, setActingId]         = useState<string | null>(null);
  const [actionError, setActionError]   = useState<Record<string, string>>({});

  function reload() {
    setLoading(true); setError(false);
    dealApi.list({ page_size: 200 })
      .then((res) => setDeals(res.items as EnrichedDeal[]))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  async function toggleExpand(dealId: string) {
    if (expandedId === dealId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(dealId);
    if (workersById[dealId]) return; // already fetched
    setLoadingWorkers((s) => ({ ...s, [dealId]: true }));
    try {
      const ws = await dealApi.workers(dealId);
      setWorkersById((s) => ({ ...s, [dealId]: ws }));
    } catch {
      setWorkersById((s) => ({ ...s, [dealId]: [] }));
    } finally {
      setLoadingWorkers((s) => ({ ...s, [dealId]: false }));
    }
  }

  async function handleApprove(dealId: string) {
    setActingId(dealId);
    setActionError((s) => ({ ...s, [dealId]: '' }));
    try {
      await dealApi.approve(dealId);
      reload();
    } catch (e) {
      setActionError((s) => ({ ...s, [dealId]: (e as Error).message || 'שגיאה באישור' }));
    } finally {
      setActingId(null);
    }
  }
  async function handleReject(dealId: string) {
    setActingId(dealId);
    setActionError((s) => ({ ...s, [dealId]: '' }));
    try {
      await dealApi.reject(dealId);
      reload();
    } catch (e) {
      setActionError((s) => ({ ...s, [dealId]: (e as Error).message || 'שגיאה בדחייה' }));
    } finally {
      setActingId(null);
    }
  }

  const filtered = deals.filter((d) => dealMatchesFilter(d.status, filter));
  const proposedCount = deals.filter((d) => dealMatchesFilter(d.status, 'proposed')).length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">עסקאות</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            כל הפניות שלך לתאגידים — לחץ על קוביה כדי לראות פרטים ולנהל את העסקה
          </p>
        </div>
        {/* Primary CTA — quick path back to opening a new request
            without having to leave the deals screen first. */}
        <Button asChild size="lg" className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-900 font-bold shadow-lg shadow-amber-500/20">
          <Link href="/contractor/find">
            <Plus className="h-5 w-5" />
            פתח בקשת עובדים חדשה
          </Link>
        </Button>
      </header>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {FILTER_LABELS[f]}
            {f === 'proposed' && proposedCount > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full leading-none">
                {proposedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="text-slate-700 font-medium">לא ניתן לטעון את העסקאות</p>
          <p className="text-slate-400 text-sm">בדוק את החיבור לאינטרנט ונסה שוב</p>
          <Button variant="outline" size="sm" onClick={reload}>נסה שוב</Button>
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <DealTileSkeleton /><DealTileSkeleton /><DealTileSkeleton />
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <Handshake className="h-10 w-10 text-slate-200" />
          <p className="text-slate-600 font-medium">
            {filter === 'all' ? 'עדיין אין עסקאות' : 'אין עסקאות בקטגוריה זו'}
          </p>
          {filter === 'all' && (
            <>
              <p className="text-slate-400 text-sm">
                צור חיפוש עובדים וחפש התאמות כדי לשלוח פנייה לתאגיד
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/contractor/find">+ חיפוש עובדים</Link>
              </Button>
            </>
          )}
        </div>
      )}

      {/* Aggregated request groups — one card per original search.
          A single 8-worker request can be filled by multiple corp
          proposals (e.g. 3 from corp A + 5 from corp B). The card
          shows the total ask, a fill bar across all proposals, and
          each proposal as a sub-row the contractor can act on. */}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-4">
          {Object.values(
            filtered.reduce<Record<string, EnrichedDeal[]>>((acc, d) => {
              const key = d.search_id || d.id;
              (acc[key] = acc[key] || []).push(d);
              return acc;
            }, {}),
          )
            // Sort groups by most recent proposal in each group, newest first
            .sort((a, b) => {
              const ta = Math.max(...a.map((d) => new Date(d.created_at).getTime()));
              const tb = Math.max(...b.map((d) => new Date(d.created_at).getTime()));
              return tb - ta;
            })
            .map((group) => {
              const head = group[0];
              const profCode = head.profession_type ?? '';
              const profLabel = head.profession_he ?? head.profession_type ?? '—';
              const requested = head.requested_count ?? group.reduce((s, d) => s + (d.worker_count ?? 0), 0);
              // Filled = sum of worker_count across proposals where the
              // corp committed to that count (proposed/corp_committed/
              // accepted/active are all "this many workers in flight").
              const COMMITTED_STATUSES = new Set([
                'proposed', 'corp_committed', 'counter_proposed',
                'accepted', 'active', 'reporting',
              ]);
              const filled = group
                .filter((d) => COMMITTED_STATUSES.has(d.status))
                .reduce((s, d) => s + (d.worker_count ?? 0), 0);
              const fillPct = requested > 0 ? Math.min(100, Math.round((filled / requested) * 100)) : 0;
              const isFull = filled >= requested && requested > 0;
              const oldest = group.reduce((min, d) =>
                new Date(d.created_at) < new Date(min.created_at) ? d : min, head);

              return (
                <div key={head.search_id || head.id}
                     className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  {/* Group header — original ask + composite fill bar */}
                  <div className="p-5 border-b border-slate-100">
                    <div className="flex items-start gap-3">
                      {profCode && (
                        <ProfessionIcon code={profCode} size={56} alt={profLabel}
                                        className="shrink-0 object-contain" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 text-lg truncate">
                              {profLabel}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                              {head.region_he && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {head.region_he}
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                בקשה משובצה {fmt(oldest.created_at)}
                              </span>
                            </div>
                          </div>
                          {/* Big composite fill — workers committed / requested */}
                          <div className="text-end">
                            <div className={`text-2xl font-extrabold leading-none ${isFull ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {filled}<span className="text-base text-slate-400 mx-0.5">/</span><span className="text-lg text-slate-500">{requested}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-1">עובדים שהוקצו</div>
                          </div>
                        </div>
                        {/* Fill bar */}
                        <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isFull ? 'bg-emerald-500' : 'bg-amber-500'}`}
                            style={{ width: `${fillPct}%` }}
                          />
                        </div>
                        {group.length > 1 && (
                          <p className="text-[11px] text-slate-500 mt-2">
                            הבקשה מורכבת מ-{group.length} הצעות תאגיד שונות.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Per-corp proposal rows. Click → expand in-place
                      (no navigation). The expanded panel shows the
                      workers list (anonymized pre-approval) + the
                      approve/reject actions inline. A small link at
                      the bottom of the panel routes to the full deal
                      page for the chat. */}
                  <ul className="divide-y divide-slate-100">
                    {group
                      // most-recent first so latest activity bubbles up
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .map((d, idx) => {
                        const REVEALED = ['accepted', 'active', 'reporting', 'completed', 'closed'];
                        const corpLabel = REVEALED.includes(d.status) && d.corporation_id
                          ? `תאגיד ${d.corporation_id.slice(0, 6)}`
                          : `תאגיד ${idx + 1}`;
                        const isOpen = expandedId === d.id;
                        const workers = workersById[d.id] || [];
                        const isLoadingW = !!loadingWorkers[d.id];
                        const canApprove = d.status === 'corp_committed';
                        return (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => toggleExpand(d.id)}
                              aria-expanded={isOpen}
                              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-start"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-slate-900 text-sm">{corpLabel}</span>
                                  <StatusBadge status={d.status} />
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                                  {STATUS_CONTEXT[d.status] ?? d.status}
                                </p>
                              </div>
                              <div className="text-end shrink-0">
                                <div className="text-base font-bold text-slate-900">
                                  {d.worker_count ?? '—'}
                                </div>
                                <div className="text-[10px] text-slate-500">עובדים</div>
                              </div>
                              <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Inline expansion panel */}
                            {isOpen && (
                              <div className="px-5 pb-4 pt-1 bg-slate-50 border-t border-slate-100">
                                {/* Workers list — anonymized pre-approval */}
                                {isLoadingW ? (
                                  <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    טוען רשימת עובדים...
                                  </div>
                                ) : workers.length === 0 ? (
                                  <p className="py-3 text-sm text-slate-500">אין עובדים זמינים להצגה.</p>
                                ) : (
                                  <div className="bg-white rounded-lg border border-slate-200 mt-3">
                                    <p className="text-[10px] uppercase tracking-widest text-slate-400 px-3 pt-2.5">
                                      רשימת עובדים שהוצעה ({workers.length})
                                    </p>
                                    <p className="text-[11px] text-slate-500 px-3 pb-2">
                                      {canApprove
                                        ? 'פרטי הזיהוי יוצגו לאחר אישור הרשימה. כעת מוצגים מקצוע, ניסיון וארץ מוצא בלבד.'
                                        : 'רשימת העובדים בעסקה.'}
                                    </p>
                                    <div className="divide-y divide-slate-50">
                                      {workers.map((w, wIdx) => {
                                        const wAny = w as unknown as { full_name?: string; experience_range?: string; years_in_israel?: number };
                                        const shouldHideName = canApprove; // pre-approval: hide identifying info
                                        const displayName = shouldHideName
                                          ? `עובד #${wIdx + 1}`
                                          : (wAny.full_name || `${w.first_name ?? ''} ${w.last_name ?? ''}`.trim() || `עובד #${wIdx + 1}`);
                                        return (
                                          <div key={w.id || wIdx} className="flex items-center gap-3 px-3 py-2">
                                            <div className="h-7 w-7 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700 shrink-0">
                                              {wIdx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <p className="text-sm font-medium text-slate-900 truncate">{displayName}</p>
                                              <p className="text-[11px] text-slate-500 truncate">
                                                {w.profession_type}
                                                {wAny.experience_range && <> · ניסיון {wAny.experience_range}</>}
                                                {!wAny.experience_range && w.experience_years != null && <> · {w.experience_years} שנים</>}
                                                {w.origin_country && <> · {w.origin_country}</>}
                                                {wAny.years_in_israel != null && <> · {wAny.years_in_israel} שנים בארץ</>}
                                              </p>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Inline error */}
                                {actionError[d.id] && (
                                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mt-3">
                                    {actionError[d.id]}
                                  </p>
                                )}

                                {/* Action row */}
                                <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
                                  <Link
                                    href={`/contractor/deals/${d.id}`}
                                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
                                  >
                                    <MessageSquare className="w-3.5 h-3.5" />
                                    צ׳אט מלא עם התאגיד
                                  </Link>
                                  {canApprove && (
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleReject(d.id)}
                                        disabled={actingId === d.id}
                                      >
                                        {actingId === d.id
                                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          : <><XCircle className="h-3.5 w-3.5" /> דחה</>}
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={() => handleApprove(d.id)}
                                        disabled={actingId === d.id || workers.length === 0}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                      >
                                        {actingId === d.id
                                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          : <><CheckCircle2 className="h-3.5 w-3.5" /> אשר רשימה ({workers.length})</>}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
