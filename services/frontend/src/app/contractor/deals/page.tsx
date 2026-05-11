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
  Search, ArrowLeft, Hammer,
} from 'lucide-react';
import { dealApi, searchApi } from '@/lib/api';
import { enumApi } from '@/lib/api/enums';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal, Worker, WorkerSearch, Profession } from '@/types';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import {
  DEAL_FILTER_LABEL,
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

// Contractor-side filter pills the user can choose between. Order
// matters — pills render in this order.
const CONTRACTOR_FILTERS: Filter[] = ['all', 'awaiting_approval', 'proposed', 'completed', 'cancelled'];

// Local matcher: contractor side rolls accepted/active/reporting
// into the "נסגרו" bucket because once the contractor has approved,
// the request is no longer something they need to track on this
// screen. The shared `dealMatchesFilter` keeps "active" distinct for
// corp-side use; contractor needs a slightly different grouping.
const CONTRACTOR_STATUS_GROUP: Record<Exclude<Filter, 'all' | 'active'>, string[]> = {
  awaiting_approval: ['corp_committed'],
  proposed:          ['proposed', 'counter_proposed'],
  completed:         ['accepted', 'active', 'reporting', 'completed', 'closed'],
  cancelled:         ['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired', 'disputed'],
};

function contractorMatchesFilter(status: string, filter: Filter): boolean {
  if (filter === 'all' || filter === 'active') return filter === 'all';
  return CONTRACTOR_STATUS_GROUP[filter].includes(status);
}

export default function ContractorDealsPage() {
  const searchParams = useSearchParams();
  // Allow `?filter=active` (etc.) so other pages — e.g. the manage
  // dashboard's KPI tiles — can deep-link straight into a filtered
  // view instead of bouncing through the "all" tab first.
  const initialFilter = (() => {
    const f = searchParams?.get('filter');
    return f && (CONTRACTOR_FILTERS as string[]).includes(f) ? (f as Filter) : 'all';
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

  const filtered = deals.filter((d) => contractorMatchesFilter(d.status, filter));
  const awaitingCount = deals.filter((d) => contractorMatchesFilter(d.status, 'awaiting_approval')).length;

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

      {/* Filter pills. The "ממתינות לאישורך" pill is the one that
          should pull attention — that's the only bucket where the
          contractor must act, so it gets a red dot + count when
          non-zero. Other pills stay neutral. */}
      <div className="flex gap-2 flex-wrap">
        {CONTRACTOR_FILTERS.map((f) => {
          const isAwaiting = f === 'awaiting_approval';
          const showBadge  = isAwaiting && awaitingCount > 0;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? isAwaiting
                    ? 'bg-amber-500 text-white'
                    : 'bg-brand-600 text-white'
                  : showBadge
                    ? 'bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {DEAL_FILTER_LABEL[f]}
              {showBadge && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full leading-none font-bold ${
                  filter === f ? 'bg-white/30 text-white' : 'bg-amber-200 text-amber-900'
                }`}>
                  {awaitingCount}
                </span>
              )}
            </button>
          );
        })}
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

            // Per-card "tier" — determines section, banner content, and
            // visual prominence. Six buckets matching the contractor-side
            // status taxonomy (no separate "active" tier — that's rolled
            // into "in-work" for sectioning but doesn't get its own pill).
            type Tier = 0 | 1 | 2 | 3 | 4 | 5;
            // 0 = awaiting contractor approval (corp_committed)
            // 1 = proposed, awaiting corp response
            // 2 = no proposals yet
            // 3 = in-flight (accepted/active/reporting)
            // 4 = closed cleanly
            // 5 = cancelled / rejected / expired
            const ACTION_REQUIRED = new Set(['corp_committed']);
            const PROPOSED        = new Set(['proposed', 'counter_proposed']);
            const IN_FLIGHT       = new Set(['accepted', 'active', 'reporting']);
            const CLOSED          = new Set(['completed', 'closed']);
            const CANCELLED       = new Set(['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired', 'disputed']);

            function tierOf(c: Card): Tier {
              if (c.deals.some((d) => ACTION_REQUIRED.has(d.status))) return 0;
              if (c.deals.some((d) => PROPOSED.has(d.status)))        return 1;
              if (c.deals.length === 0)                                return 2;
              if (c.deals.some((d) => IN_FLIGHT.has(d.status)))        return 3;
              if (c.deals.every((d) => CLOSED.has(d.status)))          return 4;
              if (c.deals.every((d) => CANCELLED.has(d.status)))       return 5;
              return 1; // mixed / fallback
            }
            function activityTime(c: Card): number {
              const fromDeals = c.deals.length > 0
                ? Math.max(...c.deals.map((d) => new Date(d.created_at).getTime()))
                : 0;
              const fromSearch = c.search?.created_at ? new Date(c.search.created_at).getTime() : 0;
              return Math.max(fromDeals, fromSearch);
            }

            const grouped: Record<Tier, Card[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
            for (const c of cards) grouped[tierOf(c)].push(c);
            for (const t of [0, 1, 2, 3, 4, 5] as Tier[]) {
              grouped[t].sort((a, b) => activityTime(b) - activityTime(a));
            }

            const TIER_META: Array<{ tier: Tier; label: string; headerTone: string }> = [
              { tier: 0, label: 'דורש פעולה',        headerTone: 'text-amber-700' },
              { tier: 1, label: 'ממתינות לתאגיד',     headerTone: 'text-slate-700' },
              { tier: 2, label: 'מחפשים תאגידים',     headerTone: 'text-slate-500' },
              { tier: 3, label: 'בעבודה',             headerTone: 'text-emerald-700' },
              { tier: 4, label: 'נסגרו',              headerTone: 'text-emerald-600' },
              { tier: 5, label: 'בוטל',               headerTone: 'text-slate-400' },
            ];

            // Banner = the single most prominent visual element per
            // card. Tells the contractor exactly what state the
            // request is in and what (if anything) they should do.
            type BannerSpec = {
              cls:   string;       // wrapper colors (bg + text + border)
              Icon:  React.ComponentType<{ className?: string }>;
              text:  string;       // primary copy
              cta?:  string;       // optional inline CTA (rendered with arrow)
              pulse?: boolean;     // animate icon for awaiting tier
            };
            function bannerFor(t: Tier, group: EnrichedDeal[]): BannerSpec {
              switch (t) {
                case 0: {
                  const n = group.filter((d) => d.status === 'corp_committed').length;
                  return {
                    cls:   'bg-amber-100 text-amber-900 border-amber-300',
                    Icon:  Bell,
                    text:  n === 1
                      ? 'ממתינה לאישורך · הצעת תאגיד אחת'
                      : `ממתינות לאישורך · ${n} הצעות מתאגידים`,
                    cta:   'בדוק ואשר',
                    pulse: true,
                  };
                }
                case 1: {
                  const n = group.filter((d) => PROPOSED.has(d.status)).length;
                  return {
                    cls:  'bg-sky-50 text-sky-800 border-sky-200',
                    Icon: MessageSquare,
                    text: n === 1
                      ? 'נשלחה לתאגיד · ממתין לתגובה'
                      : `${n} הצעות נשלחו לתאגידים · ממתין לתגובה`,
                  };
                }
                case 2:
                  return {
                    cls:  'bg-slate-50 text-slate-700 border-slate-200',
                    Icon: Search,
                    text: 'מחפשים תאגידים עם עובדים מתאימים',
                  };
                case 3: {
                  const n = group
                    .filter((d) => IN_FLIGHT.has(d.status))
                    .reduce((s, d) => s + (d.worker_count ?? 0), 0);
                  return {
                    cls:  'bg-emerald-50 text-emerald-800 border-emerald-200',
                    Icon: Hammer,
                    text: n > 0 ? `${n} עובדים בשטח` : 'העסקה אושרה · עובדים בשטח',
                  };
                }
                case 4:
                  return {
                    cls:  'bg-emerald-50 text-emerald-700 border-emerald-100',
                    Icon: CheckCircle2,
                    text: 'העסקה נסגרה',
                  };
                case 5:
                  return {
                    cls:  'bg-rose-50 text-rose-700 border-rose-200',
                    Icon: XCircle,
                    text: 'בוטלה',
                  };
              }
            }

            return TIER_META.filter((t) => grouped[t.tier].length > 0).map(({ tier, label, headerTone }) => (
              <section key={tier} className="space-y-2">
                <div className="flex items-center gap-2">
                  {tier === 0 && <Bell className="h-4 w-4 text-amber-600" />}
                  <h2 className={`text-xs font-bold uppercase tracking-widest ${headerTone}`}>
                    {label} <span className="text-slate-400 font-semibold">({grouped[tier].length})</span>
                  </h2>
                </div>
                <div className="space-y-3">
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
              // Region label: deal row carries region_he; bare search
              // row carries `region` code that we resolve via regionMap.
              const regionLabel = head?.region_he
                ?? (search?.region ? (regionMap[search.region] ?? search.region) : '');

              // Search-derived meta for the secondary line.
              // origin_preference is now returned by /searches so an
              // empty array means "any" (contractor said no preference),
              // a populated one is the explicit list.
              const startDate = search?.start_date;
              const endDate   = search?.end_date;
              const originCodes = search?.origin_preference ?? [];
              const originLabel = originCodes.length === 0
                ? 'ללא העדפת מוצא'
                : originCodes.map((c) => originMap[c] ?? c).join(', ');

              const isOpen = expandedSearches.has(searchId);
              const banner = bannerFor(tier, group);
              // Cards in tier 0 also get a left-edge accent so even
              // the cards above the fold scream "act on me".
              const cardBorderClass = tier === 0
                ? 'border-amber-300 ring-2 ring-amber-200/40'
                : tier === 5
                  ? 'border-slate-200 opacity-90'
                  : 'border-slate-200';

              return (
                <div key={searchId}
                     className={`rounded-xl border ${cardBorderClass} bg-white shadow-sm overflow-hidden`}>
                  <button
                    type="button"
                    onClick={() => toggleSearch(searchId)}
                    aria-expanded={isOpen}
                    className="w-full text-start hover:bg-slate-50/60 transition-colors"
                  >
                    {/* Meta strip — profession, qty, dates, origin,
                        region. Quieter than the banner below. */}
                    <div className="flex items-center gap-3 px-4 pt-3 pb-2.5">
                      {profCode && (
                        <ProfessionIcon code={profCode} size={44} alt={profLabel}
                                        className="shrink-0 object-contain" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-base truncate">
                            {profLabel}
                          </span>
                          <span className="text-sm text-slate-400">·</span>
                          <span className="text-sm font-semibold text-slate-700">
                            {requested} עובדים
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                          {(startDate || endDate) && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              {startDate ? fmt(startDate) : '—'}
                              {endDate && <> ← {fmt(endDate)}</>}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Globe2 className="w-3.5 h-3.5 text-slate-400" />
                            {originLabel}
                          </span>
                          {regionLabel && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <MapPin className="w-3.5 h-3.5 text-slate-400" />
                              {regionLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </div>

                    {/* ACTION BANNER — the dominant visual element.
                        Tells the contractor exactly what state this
                        request is in + what to do (when relevant). */}
                    <div className={`flex items-center gap-2.5 px-4 py-2.5 border-t ${banner.cls}`}>
                      <banner.Icon className={`h-4 w-4 shrink-0 ${banner.pulse ? 'animate-pulse' : ''}`} aria-hidden />
                      <div className="flex-1 min-w-0 text-sm font-bold leading-tight">
                        {banner.text}
                      </div>
                      {banner.cta && (
                        <div className="inline-flex items-center gap-1 text-sm font-extrabold whitespace-nowrap">
                          {banner.cta}
                          <ArrowLeft className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Empty-state hint — only when card is expanded. */}
                  {isOpen && group.length === 0 && (
                    <div className="px-4 pb-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                      נשלחה הודעה לתאגידים רלוונטיים — נעדכן אותך ברגע שתתקבל הצעה.
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
