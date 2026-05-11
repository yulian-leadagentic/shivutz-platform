'use client';

// Wave 4 polish — deals page rendered as a tile/card grid instead of
// the dense row list. Each tile is a self-contained summary the
// contractor can scan at a glance: profession + region + worker count
// + status badge + date. Click anywhere on the tile → deal detail page.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle, Handshake, MessageSquare, Calendar, MapPin, Globe2,
  Plus, ChevronDown, Loader2, CheckCircle2, XCircle, Bell,
} from 'lucide-react';
import { dealApi, searchApi } from '@/lib/api';
import { enumApi } from '@/lib/api/enums';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal, Worker, WorkerSearch, Profession } from '@/types';
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
  const [deals, setDeals]       = useState<EnrichedDeal[]>([]);
  // Wave 5: the unified screen also shows searches with no
  // proposals yet — previously they only lived on /contractor/
  // searches, which doubled as a parallel index of the same data.
  // Fetching both means /contractor/searches can go away entirely.
  const [searches, setSearches] = useState<WorkerSearch[]>([]);
  const [profMap, setProfMap]   = useState<Record<string, string>>({});
  const [regionMap, setRegionMap] = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [filter, setFilter]     = useState<Filter>(initialFilter);
  // Inline expansion — proposal rows open in-place instead of routing
  // to /contractor/deals/[id]. Workers are lazy-fetched on first
  // expand, cached per deal_id so re-toggling doesn't re-hit the API.
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  // Card-level expand: which search-card has its proposal sub-rows
  // visible. Multi-open is allowed (Set) so the contractor can
  // compare proposals across two requests side by side.
  const [expandedSearches, setExpandedSearches] = useState<Set<string>>(new Set());
  function toggleSearch(id: string) {
    setExpandedSearches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [workersById, setWorkersById]   = useState<Record<string, Worker[]>>({});
  const [loadingWorkers, setLoadingWorkers] = useState<Record<string, boolean>>({});
  const [actingId, setActingId]         = useState<string | null>(null);
  const [actionError, setActionError]   = useState<Record<string, string>>({});

  function reload() {
    setLoading(true); setError(false);
    Promise.all([
      dealApi.list({ page_size: 200 }).then((res) => setDeals(res.items as EnrichedDeal[])),
      searchApi.list().then(setSearches),
    ])
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  const [originMap, setOriginMap] = useState<Record<string, string>>({});
  // Reference data so the request card can show Hebrew labels even
  // when a search has no proposals yet (the deal-enriched rows carry
  // profession_he/region_he, but bare WorkerSearch rows don't).
  useEffect(() => {
    Promise.all([
      enumApi.professions().catch(() => [] as Profession[]),
      enumApi.regions().catch(() => [] as { code: string; name_he: string }[]),
      enumApi.origins().catch(() => [] as { code: string; name_he: string }[]),
    ]).then(([profs, regions, origins]) => {
      const pm: Record<string, string> = {};
      for (const p of profs) pm[p.code] = p.name_he;
      const rm: Record<string, string> = {};
      for (const r of regions) rm[r.code] = r.name_he;
      const om: Record<string, string> = {};
      for (const o of origins) om[o.code] = o.name_he;
      setProfMap(pm); setRegionMap(rm); setOriginMap(om);
    });
  }, []);

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
      {!loading && !error && (
        (filter === 'all' ? searches.length === 0 : filtered.length === 0)
      ) && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <Handshake className="h-10 w-10 text-slate-200" />
          <p className="text-slate-600 font-medium">
            {filter === 'all' ? 'עדיין אין בקשות' : 'אין עסקאות בקטגוריה זו'}
          </p>
          {filter === 'all' && (
            <>
              <p className="text-slate-400 text-sm">
                פתח בקשת עובדים חדשה כדי להתחיל
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/contractor/find">+ פתח בקשת עובדים חדשה</Link>
              </Button>
            </>
          )}
        </div>
      )}

      {/* Tiered list — one card per original search.
          Sort tiers:
            1. דורש פעולה (corp_committed)         — amber accent
            2. בעבודה (proposed/approved/active)  — neutral
            3. ממתינות להצעות (no deals yet)       — slate
            4. הושלמו / בוטלו                        — neutral, default expanded
          Within a tier: most-recent activity first.
          Cards are compact (~90px collapsed); whole card clickable
          to expand and reveal the proposal sub-rows + actions. */}
      {!loading && !error && (
        (filter === 'all' ? searches.length > 0 : filtered.length > 0)
      ) && (
        <div className="space-y-6">
          {(() => {
            // Group filtered deals by search_id
            const dealsBySearch = filtered.reduce<Record<string, EnrichedDeal[]>>((acc, d) => {
              const k = d.search_id || d.id;
              (acc[k] = acc[k] || []).push(d);
              return acc;
            }, {});

            // Compose final card list: when filter='all' we walk
            // `searches` so empty searches are included; otherwise
            // we only iterate the filtered deals' groups.
            type Card = { searchId: string; search?: WorkerSearch; deals: EnrichedDeal[] };
            const cards: Card[] = filter === 'all'
              ? searches.map((s) => ({
                  searchId: s.id,
                  search:   s,
                  deals:    dealsBySearch[s.id] || [],
                }))
              : Object.entries(dealsBySearch).map(([sid, ds]) => ({
                  searchId: sid,
                  search:   searches.find((s) => s.id === sid),
                  deals:    ds,
                }));

            // Per-card "tier" classification → visual + sort priority
            const ACTION_REQUIRED = new Set(['corp_committed']);
            const IN_PROGRESS     = new Set(['proposed', 'counter_proposed', 'approved', 'active', 'reporting']);
            const COMPLETED       = new Set(['closed', 'completed', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired']);

            function tierOf(c: Card): 0 | 1 | 2 | 3 {
              if (c.deals.some((d) => ACTION_REQUIRED.has(d.status))) return 0;
              if (c.deals.some((d) => IN_PROGRESS.has(d.status))) return 1;
              if (c.deals.length === 0) return 2;
              // If all deals are terminal — completed tier
              if (c.deals.every((d) => COMPLETED.has(d.status))) return 3;
              return 1; // safe default
            }
            function activityTime(c: Card): number {
              const fromDeals = c.deals.length > 0
                ? Math.max(...c.deals.map((d) => new Date(d.created_at).getTime()))
                : 0;
              const fromSearch = c.search?.created_at ? new Date(c.search.created_at).getTime() : 0;
              return Math.max(fromDeals, fromSearch);
            }

            const grouped: Record<0|1|2|3, Card[]> = { 0: [], 1: [], 2: [], 3: [] };
            for (const c of cards) grouped[tierOf(c)].push(c);
            for (const t of [0,1,2,3] as const) {
              grouped[t].sort((a, b) => activityTime(b) - activityTime(a));
            }

            const TIER_META: Array<{ tier: 0|1|2|3; label: string; tone: 'amber'|'slate'|'mute'|'dim' }> = [
              { tier: 0, label: 'דורש פעולה', tone: 'amber' },
              { tier: 1, label: 'בעבודה',      tone: 'slate' },
              { tier: 2, label: 'ממתינות להצעות', tone: 'mute' },
              { tier: 3, label: 'הושלמו / בוטלו', tone: 'dim' },
            ];

            return TIER_META.filter((t) => grouped[t.tier].length > 0).map(({ tier, label, tone }) => (
              <section key={tier} className="space-y-2">
                <div className="flex items-center gap-2">
                  {tier === 0 && <Bell className="h-3.5 w-3.5 text-amber-600" />}
                  <h2 className={`text-[11px] font-bold uppercase tracking-widest ${
                    tone === 'amber' ? 'text-amber-700' :
                    tone === 'slate' ? 'text-slate-700' :
                    tone === 'mute'  ? 'text-slate-500' :
                                       'text-slate-400'
                  }`}>{label} ({grouped[tier].length})</h2>
                </div>
                <div className="space-y-2">
                  {grouped[tier].map(({ searchId, search, deals: group }) => {
              const head = group[0];
              // Prefer info from the deal row (enriched by backend);
              // fall back to the underlying search row for empty groups.
              const profCode = head?.profession_type ?? search?.profession_type ?? '';
              const profLabel = head?.profession_he
                ?? profMap[profCode]
                ?? profCode
                ?? '—';
              const requested = head?.requested_count
                ?? search?.quantity
                ?? (group.length > 0 ? group.reduce((s, d) => s + (d.worker_count ?? 0), 0) : 0);
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
              // Earliest activity timestamp — for empty searches use
              // the search row's created_at directly.
              const oldestDate = group.length > 0
                ? group.reduce((min, d) =>
                    new Date(d.created_at) < new Date(min.created_at) ? d : min, group[0]).created_at
                : search?.created_at;
              // Region label: deal row carries region_he; bare search
              // row carries `region` code that we resolve via regionMap.
              const regionLabel = head?.region_he
                ?? (search?.region ? (regionMap[search.region] ?? search.region) : '');

              // Search-derived meta for the secondary line
              const startDate = search?.start_date;
              const endDate   = search?.end_date;
              const originCodes = search?.origin_preference ?? [];
              const originLabel = originCodes.length === 0
                ? 'כל מוצא'
                : originCodes.map((c) => originMap[c] ?? c).join(', ');

              const isOpen = expandedSearches.has(searchId);
              const proposalCount = group.length;
              // Show inline "X proposals" affordance text on the
              // collapsed row so the contractor knows what they'd see
              // by expanding.
              const proposalsLine = proposalCount === 0
                ? null
                : proposalCount === 1
                  ? 'הצעת תאגיד אחת'
                  : `${proposalCount} הצעות מתאגידים`;

              // Tier-driven left-edge accent — only the
              // action-required tier gets a colored strip.
              const accentClass = tier === 0
                ? 'border-amber-300 ring-1 ring-amber-200/50'
                : tier === 3
                  ? 'border-slate-100 bg-slate-50/40'
                  : 'border-slate-200';

              return (
                <div key={searchId}
                     className={`rounded-xl border ${accentClass} bg-white shadow-sm overflow-hidden`}>
                  {/* Compact summary row — single full-width button.
                      Click anywhere to toggle the proposal sub-list. */}
                  <button
                    type="button"
                    onClick={() => toggleSearch(searchId)}
                    aria-expanded={isOpen}
                    className="w-full text-start flex items-center gap-3 px-3.5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    {/* Tier dot — at-a-glance accent before the icon */}
                    {tier === 0 && (
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" aria-hidden />
                    )}
                    {profCode && (
                      <ProfessionIcon code={profCode} size={44} alt={profLabel}
                                      className="shrink-0 object-contain" />
                    )}

                    <div className="flex-1 min-w-0">
                      {/* Line 1 — profession + qty + filled/requested */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-base truncate">
                            {profLabel}
                          </span>
                          <span className="text-xs text-slate-500">· {requested} עובדים</span>
                          {tier === 0 && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 leading-none whitespace-nowrap">
                              בדוק עכשיו
                            </span>
                          )}
                        </div>
                        <div className="text-end shrink-0">
                          <div className={`text-base font-extrabold leading-none ${isFull ? 'text-emerald-600' : tier === 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                            {filled}<span className="text-xs text-slate-400 mx-0.5">/</span><span className="text-sm text-slate-500">{requested}</span>
                          </div>
                        </div>
                      </div>
                      {/* Line 2 — secondary meta: dates · origin · region · proposals */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                        {(startDate || endDate) && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Calendar className="w-3 h-3" />
                            {startDate ? fmt(startDate) : '—'}
                            {endDate && <> ← {fmt(endDate)}</>}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <Globe2 className="w-3 h-3" />
                          {originLabel}
                        </span>
                        {regionLabel && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <MapPin className="w-3 h-3" />
                            {regionLabel}
                          </span>
                        )}
                        {proposalsLine && (
                          <span className={`inline-flex items-center gap-1 whitespace-nowrap font-medium ${tier === 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                            <MessageSquare className="w-3 h-3" />
                            {proposalsLine}
                          </span>
                        )}
                        {fillPct > 0 && fillPct < 100 && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-slate-500">
                            {fillPct}% התאמה
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Empty state — inline + compact, only when card
                      is expanded (avoids per-card vertical bloat). */}
                  {isOpen && group.length === 0 && (
                    <div className="px-4 pb-3 pt-2 border-t border-slate-100 text-xs text-slate-500">
                      מחפשים תאגידים עם עובדים מתאימים — נעדכן אותך ברגע שתתקבל הצעה.
                      <span className="block text-slate-400 mt-0.5">
                        בנוסף נשלחה הודעה לתאגידים רלוונטיים.
                      </span>
                    </div>
                  )}

                  {/* Per-corp proposal rows — visible only when the
                      outer card is expanded. Click any proposal row
                      to drill into its workers list + inline action
                      buttons (approve/reject when corp_committed). */}
                  {isOpen && group.length > 0 && (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {group
                      // most-recent first so latest activity bubbles up
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .map((d, idx) => {
                        const REVEALED = ['accepted', 'active', 'reporting', 'completed', 'closed'];
                        const corpLabel = REVEALED.includes(d.status) && d.corporation_id
                          ? `תאגיד ${d.corporation_id.slice(0, 6)}`
                          : `תאגיד ${idx + 1}`;
                        const proposalOpen = expandedId === d.id;
                        const workers = workersById[d.id] || [];
                        const isLoadingW = !!loadingWorkers[d.id];
                        const canApprove = d.status === 'corp_committed';
                        return (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => toggleExpand(d.id)}
                              aria-expanded={proposalOpen}
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
                              <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${proposalOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Inline expansion panel */}
                            {proposalOpen && (
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
                                          : <><CheckCircle2 className="h-3.5 w-3.5" /> הצג פרטי תאגיד ({workers.length})</>}
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
                  )}
                </div>
              );
            })}
            </div>
          </section>
        ));
      })()}
        </div>
      )}
    </div>
  );
}
