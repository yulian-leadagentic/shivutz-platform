'use client';

// Wave 4 polish — corp-side deals rendered as a tile grid (was a
// dense table). Each tile is the corp's view of one inquiry: which
// profession, how many workers requested vs offered, status badge,
// region, date, and a CTA whose copy depends on whether the corp
// still owes a response (אשר / דחה) or it's already in progress (פרטים).

import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2, Calendar, MapPin, Users as UsersIcon,
  AlertCircle, Handshake, MessageSquare, CheckCircle2, XCircle, Bell,
  Lock, UserPlus, ArrowLeft, Globe2,
} from 'lucide-react';
import { dealApi, workerApi } from '@/lib/api';
import { searchApi, type OpenSearchRow } from '@/lib/api/jobs';
import { dealRef } from '@/lib/utils';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { useEnums } from '@/features/enums/EnumsContext';
import type { Deal } from '@/types';
import { Button } from '@/components/ui/button';
import { type DealFilter } from '@/i18n/he';
import { CorpResponseCountdown } from '@/components/CorpResponseCountdown';

// Mirrors CORP_RESPONSE_HOURS on the contractor page. Server-side
// uses the DB setting; this constant matches the migration default.
const CORP_RESPONSE_HOURS = 48;

// R17 — corp-side staleness cut-off. Items the corp has had visibility
// on for longer than this without acting (proposed deals + open
// browseable searches) are hidden from the page. corp_committed and
// downstream states don't count — the corp already acted there, the
// wait is now on the contractor / payment flow.
const STALE_DAYS_THRESHOLD   = 7;
const STALE_THRESHOLD_MS     = STALE_DAYS_THRESHOLD * 86_400_000;

// Corp side uses a tighter, locally-owned filter set. The shared
// DealFilter is a superset that also covers contractor-side
// awaiting/cancelled buckets — corp doesn't surface those as pills.
// R12 adds a fifth pill 'no_workers' — populated only when the corp
// has zero workers AND there are open searches they could otherwise
// engage with; it's the corp's "you'd be acting on these if you had
// workers" slice.
type Filter =
  | Extract<DealFilter, 'all' | 'proposed' | 'active' | 'completed'>
  | 'no_workers';

// Filter labels. The semantics from the corp's perspective:
//   proposed  = your turn (you owe a first response)
//   active    = corp committed — list sent, waiting on the contractor
//               to approve. Label rewritten from the old ambiguous
//               "בעבודה" so it names exactly who's blocking.
//   completed = past corp + contractor action (accepted / in-field /
//               closed / cancelled).
const FILTER_LABELS: Record<Filter, string> = {
  all:        'הכל',
  proposed:   'דרישות ממתינות לאישורך',
  active:     'ממתין לאישור קבלן',
  completed:  'הושלמו',
  no_workers: 'דרישות ללא עובדים זמינים',
};

// Corp-specific status groupings. Diverges from the shared
// DEAL_STATUS_GROUP because the labels above mean different things
// on the corp side. corp_committed is its own bucket here, not
// rolled into either neighbour. The no_workers pill isn't a deal-
// status bucket at all — it only filters open searches — so it's an
// empty array here and the rendering layer treats it specially.
const CORP_STATUS_GROUP: Record<Exclude<Filter, 'all'>, string[]> = {
  proposed:   ['proposed', 'counter_proposed'],
  active:     ['corp_committed'],
  // 'approved' was missing — meant any deal the contractor approved
  // dropped out of every bucket and out of `counts.all` entirely,
  // leaving the corp side thinking the deal had vanished. Now it
  // groups with 'accepted'/'active' as a contractor-approved-and-
  // running deal.
  completed:  ['approved', 'accepted', 'active', 'reporting', 'completed', 'closed'],
  no_workers: [],
};

// Each filter gets its own colour so the bar reads as distinct
// chips, not identical buttons:
//   proposed  = AMBER (your turn, act now)
//   active    = SKY   (passive — waiting on contractor)
//   completed = EMERALD (past corp + contractor action)
//   all       = neutral
const FILTER_TONE: Record<Filter, {
  active:   string;
  idle:     string;
  badgeOn:  string;
  badgeOff: string;
}> = {
  all: {
    active:   'bg-slate-900 text-white border-slate-900',
    idle:     'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
    badgeOn:  'bg-white/20 text-white',
    badgeOff: 'bg-slate-100 text-slate-600',
  },
  proposed: {
    active:   'bg-amber-500 text-white border-amber-500',
    idle:     'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100',
    badgeOn:  'bg-white/25 text-white',
    badgeOff: 'bg-amber-200 text-amber-900',
  },
  active: {
    active:   'bg-sky-600 text-white border-sky-600',
    idle:     'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
    badgeOn:  'bg-white/25 text-white',
    badgeOff: 'bg-sky-100 text-sky-700',
  },
  completed: {
    active:   'bg-emerald-600 text-white border-emerald-600',
    idle:     'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
    badgeOn:  'bg-white/25 text-white',
    badgeOff: 'bg-emerald-100 text-emerald-700',
  },
  no_workers: {
    active:   'bg-rose-600 text-white border-rose-600',
    idle:     'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100',
    badgeOn:  'bg-white/25 text-white',
    badgeOff: 'bg-rose-100 text-rose-700',
  },
};

// Secondary line rendered under the centre illustration. Keep
// wording aligned with the customer-facing flow document — every
// settled-success deal reads "עסקה נסגרה", every dead deal reads
// the same Hebrew phrase as the status pill ("לא נסגרה") so the
// corp doesn't see two different names for the same outcome.
const STATUS_CONTEXT: Record<string, string> = {
  proposed:          'נשלחה אליך — דרושה החלטה',
  corp_committed:    'הצעת עובדים נשלחה לקבלן',
  approved:          'אושר ע״י הקבלן — עובדים בשטח',
  active:            'בעבודה',
  reporting:         'מדווח',
  closed:            'עסקה נסגרה',
  completed:         'עסקה נסגרה',
  rejected:          'נדחתה ע״י הקבלן',
  cancelled_by_corp: 'בוטלה על ידך',
  cancelled_by_contractor: 'בוטל ע״י הקבלן',
  expired:           'בוטלה עקב חוסר תגובה',
};

// Corp-perspective state classifier — drives the card ring,
// status pill colour, and the "action needed" copy.
//   actionNeeded → 'proposed'                       — corp owes a response (AMBER)
//   committed    → 'corp_committed'                 — corp committed, contractor's turn (SKY, passive)
//   engaged      → approved/active/reporting        — contractor approved, deal in motion (EMERALD)
//   closed       → completed/closed                 — done
//   cancelled    → cancelled_*/rejected/expired
type CorpCardState = 'actionNeeded' | 'committed' | 'engaged' | 'closed' | 'cancelled' | 'unknown';

const ENGAGED_S   = new Set(['approved', 'accepted', 'active', 'reporting']);
const CLOSED_S    = new Set(['completed', 'closed']);
const CANCELLED_S = new Set(['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired', 'disputed']);

function classifyCorpDeal(status: string): CorpCardState {
  if (status === 'proposed' || status === 'counter_proposed') return 'actionNeeded';
  if (status === 'corp_committed')                              return 'committed';
  if (ENGAGED_S.has(status))                                    return 'engaged';
  if (CLOSED_S.has(status))                                     return 'closed';
  if (CANCELLED_S.has(status))                                  return 'cancelled';
  return 'unknown';
}

// Per-card ring + small status pill — colour-coded to the
// CorpCardState. AMBER stands out so the corp's eye lands on
// the deals where they owe a response. Settled outcomes
// (closed / cancelled) get a prominent ring + accent edge
// too so the corp scans wins and losses at a glance.
const CARD_RING: Record<CorpCardState, string> = {
  actionNeeded: 'border-amber-400 ring-2 ring-amber-100',
  committed:    'border-sky-300 ring-1 ring-sky-100',
  engaged:      'border-emerald-400 ring-2 ring-emerald-100',
  closed:       'border-emerald-400 ring-2 ring-emerald-200',
  cancelled:    'border-rose-400 ring-2 ring-rose-100',
  unknown:      'border-slate-200',
};

// Saturated coloured edge bar on the visual left side (RTL `end`),
// keyed to CorpCardState. Empty string = no bar painted.
const CARD_ACCENT: Record<CorpCardState, string> = {
  actionNeeded: '',
  committed:    '',
  engaged:      '',
  closed:       'bg-emerald-500',
  cancelled:    'bg-rose-500',
  unknown:      '',
};

const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  proposed:                { cls: 'bg-amber-500 text-white border-amber-500',                 label: 'דרושה החלטה' },
  counter_proposed:        { cls: 'bg-amber-100 text-amber-800 border-amber-300',             label: 'הצעה נגדית' },
  corp_committed:          { cls: 'bg-sky-100 text-sky-800 border-sky-200',                   label: 'נשלחה לקבלן' },
  approved:                { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'אושר' },
  accepted:                { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'אושר' },
  active:                  { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'פעיל' },
  reporting:               { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'מדווח' },
  closed:                  { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'עסקה נסגרה' },
  completed:               { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'עסקה נסגרה' },
  rejected:                { cls: 'bg-rose-500 text-white border-rose-500',                   label: 'לא נסגרה' },
  cancelled_by_corp:       { cls: 'bg-rose-500 text-white border-rose-500',                   label: 'לא נסגרה' },
  cancelled_by_contractor: { cls: 'bg-rose-500 text-white border-rose-500',                   label: 'לא נסגרה' },
  cancelled:               { cls: 'bg-rose-500 text-white border-rose-500',                   label: 'לא נסגרה' },
  expired:                 { cls: 'bg-rose-500 text-white border-rose-500',                   label: 'לא נסגרה' },
};

type EnrichedDeal = Deal & {
  profession_type?: string;
  profession_he?:   string;
  region_he?:       string;
  worker_count?:    number;
  requested_count?: number;
};

// MySQL TIMESTAMP serializes as "YYYY-MM-DD HH:MM:SS" (no Z) and
// JS parses such strings as local time — but the DB value is UTC.
// Normalise so deal age / sort positions reflect real elapsed time
// regardless of the browser's locale.
function parseUtcMs(iso?: string): number {
  if (!iso) return NaN;
  let s = iso.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
  return new Date(s).getTime();
}

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(parseUtcMs(iso)).toLocaleDateString('he-IL');
}

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

// QA-R4 R9 — helpers for the "open contractor searches" section that
// the page now hosts alongside the corp's own deals lifecycle. Same
// shape as the prospect /try/corporation/immediate cards.
function timeAgoHe(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffMin = Math.max(1, Math.round((Date.now() - t) / 60_000));
  if (diffMin < 60) return `לפני ${diffMin} דק׳`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `לפני ${h} ${h === 1 ? 'שעה' : 'שעות'}`;
  const d = Math.round(h / 24);
  if (d < 7) return `לפני ${d} ${d === 1 ? 'יום' : 'ימים'}`;
  return new Date(t).toLocaleDateString('he-IL');
}
function startLabelHe(iso: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const days = Math.round((t - Date.now()) / 86_400_000);
  if (days <= 0) return 'מיידי';
  if (days <= 14) return `בעוד ${days} ${days === 1 ? 'יום' : 'ימים'}`;
  return new Date(t).toLocaleDateString('he-IL');
}

function CorporationDealsPageContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const urlFilter    = searchParams.get('filter') as Filter | null;
  const { professionMap, regionMap, originMap } = useEnums();

  const [deals, setDeals]     = useState<EnrichedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  // R15 — default to 'proposed' (the corp's-turn bucket) so the
  // landing view foregrounds what they need to act on. ?filter=…
  // in the URL still overrides for direct-link cases (e.g. the
  // dashboard tile that targets a specific slice).
  const [filter, setFilter]   = useState<Filter>(
    urlFilter && Object.keys(FILTER_LABELS).includes(urlFilter) ? urlFilter : 'proposed'
  );

  // R9 merge — open searches the corp can volunteer for + worker count
  // gate. Both fetches are independent of the deal list and resolve in
  // their own time; the page renders progressively.
  const [openSearches, setOpenSearches] = useState<OpenSearchRow[] | null>(null);
  const [workerCount, setWorkerCount]   = useState<number | null>(null);
  // R14 — Set of professions the corp can currently staff (only
  // `available` workers — assigned/on_leave/deactivated don't count).
  // Drives the no_workers filter per-request: a request is in
  // no_workers iff its profession_type is NOT in this set.
  const [corpProfessions, setCorpProfessions] = useState<Set<string> | null>(null);
  const [openSearchBusy, setOpenSearchBusy] = useState<string | null>(null);
  const [gateModalSearch, setGateModalSearch] = useState<OpenSearchRow | null>(null);

  // R18 — user-selectable sort. 'default' keeps the urgency-aware sort
  // (proposed → corp_committed → everything else). The others apply a
  // single ordering across the whole visible list (both open searches
  // and deals).
  type SortKey = 'default' | 'newest' | 'oldest' | 'quantity';
  const [sortBy, setSortBy] = useState<SortKey>('default');

  // `inFlight` tracks the latest reload() invocation so an older,
  // slower response can't clobber the state set by a newer one. Two
  // failure modes this defends against:
  //   1. React 19 StrictMode fires the mount effect twice in dev;
  //      both fetches resolve in arbitrary order. Without this, the
  //      later-resolving response wins, and if it failed (rate-limit,
  //      transient 401, anything), the user saw deals briefly then
  //      the error banner replaced them.
  //   2. User mashes the "נסה שוב" retry button; old + new requests
  //      race the same way.
  const inFlightRef = useRef(0);

  function reload() {
    const myToken = ++inFlightRef.current;
    setLoading(true); setError(false);
    dealApi.list({ page_size: 200 })
      .then((res) => {
        if (inFlightRef.current !== myToken) return; // stale
        setDeals(res.items as EnrichedDeal[]);
      })
      .catch((err) => {
        if (inFlightRef.current !== myToken) return; // stale
        // Log so we can actually diagnose the next failure — the
        // generic "לא ניתן לטעון את העסקאות" copy on its own
        // tells the user nothing and tells us less.
        console.error('[corporation/deals] list failed:', err);
        setError(true);
      })
      .finally(() => {
        if (inFlightRef.current !== myToken) return; // stale
        setLoading(false);
      });
  }
  useEffect(() => { reload(); }, []);

  // Refetch when the tab becomes visible again. Without this, a corp
  // that committed workers + completed J5 auth on the /[id] detail
  // page would navigate back to this list and see the deal still
  // pinned to 'proposed' — the list state was captured on first
  // mount and never refreshed. Most reports of "the deal didn't
  // transition to 'ממתין לאישור קבלן'" trace back here.
  useEffect(() => {
    function onVis() { if (document.visibilityState === 'visible') reload(); }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R9 — open searches list + worker count, independent of the deal
  // list. Each renders the moment it arrives so a slow workers fetch
  // can't block the searches list (which is the headline content now).
  // R14 — also derives the SET of professions the corp can currently
  // staff (only `available` workers count; assigned/on_leave/deactivated
  // workers can't take a new posting). Used by the per-request
  // no_workers filter logic below.
  useEffect(() => {
    let cancelled = false;
    searchApi.listOpen()
      .then((s) => { if (!cancelled) setOpenSearches(s); })
      .catch((err) => { if (!cancelled) console.error('[corporation/deals] listOpen failed:', err); });
    workerApi.list()
      .then((rs) => {
        if (cancelled) return;
        const available = rs.filter((w) => w.status === 'available');
        setWorkerCount(available.length);
        setCorpProfessions(new Set(available.map((w) => w.profession_type)));
      })
      .catch(() => {
        if (cancelled) return;
        setWorkerCount(0);
        setCorpProfessions(new Set());
      });
    return () => { cancelled = true; };
  }, []);

  // null = workers still loading. `corpCanFulfill` returns true during
  // the loading window so requests don't flash into no_workers and back
  // out as soon as the fetch resolves.
  function corpCanFulfill(profession: string): boolean {
    if (corpProfessions === null) return true;
    return corpProfessions.has(profession);
  }

  // Open searches the corp hasn't engaged with yet — exclude any search
  // that already has a deal row for this corp (the matched/auto-created
  // ones show in the deals list below; no point listing them twice).
  // R17 also strips searches older than STALE_DAYS_THRESHOLD that the
  // corp hasn't engaged with — they go quiet from the corp's view.
  const myDealSearchIds = useMemo(
    () => new Set(deals.map((d) => d.search_id).filter(Boolean) as string[]),
    [deals],
  );
  const browseSearches = useMemo(
    () => (openSearches ?? []).filter((s) => {
      if (myDealSearchIds.has(s.id)) return false;
      const ageMs = Date.now() - parseUtcMs(s.created_at);
      return ageMs < STALE_THRESHOLD_MS;
    }),
    [openSearches, myDealSearchIds],
  );

  // Click "השב לדרישה" on an open-search card.
  // R14 — gate per-profession instead of total worker count. The corp
  // may have plenty of workers, but if none match this request's
  // profession the proposal can't carry meaningful workers — bounce
  // them into /workers/new with the gate modal.
  async function handleOpenSearchClick(s: OpenSearchRow) {
    if (!corpCanFulfill(s.profession_type)) {
      setGateModalSearch(s);
      return;
    }
    setOpenSearchBusy(s.id);
    try {
      const { id: dealId } = await dealApi.fromSearch(s.id);
      router.push(`/corporation/deals/${dealId}`);
    } catch (err) {
      console.error('[corporation/deals] fromSearch failed:', err);
      setOpenSearchBusy(null);
    }
  }

  // Corp-side filter resolution — uses CORP_STATUS_GROUP, not the
  // shared one, because the corp's "active" means "waiting on
  // contractor" (just corp_committed), not the engaged/in-field
  // bucket that the contractor + shared groupings use.
  // R14 — proposed deals split between 'proposed' and 'no_workers'
  // based on PER-PROFESSION match against the corp's available worker
  // pool (not a binary count check). A corp with 5 plasterers sees
  // plumbing requests in no_workers and plasterer requests in proposed.
  // active / completed are worker-agnostic.
  // R17 — proposed/counter_proposed deals older than STALE_DAYS_THRESHOLD
  // get hidden across every filter. Other statuses are kept because
  // 'old' doesn't mean 'no action': corp_committed deals are waiting on
  // the contractor, completed deals are history we still want visible.
  const filtered = deals.filter((d) => {
    const inProposedGroup = CORP_STATUS_GROUP.proposed.includes(d.status);
    if (inProposedGroup) {
      const ageMs = Date.now() - parseUtcMs(d.created_at);
      if (ageMs >= STALE_THRESHOLD_MS) return false;
    }
    if (filter === 'all') return true;
    if (filter === 'proposed') {
      return inProposedGroup && corpCanFulfill(d.profession_type ?? '');
    }
    if (filter === 'no_workers') {
      return inProposedGroup && !corpCanFulfill(d.profession_type ?? '');
    }
    const group = CORP_STATUS_GROUP[filter];
    return group ? group.includes(d.status) : false;
  });
  // Sort buckets, top → bottom:
  //   1. proposed         — your turn, most urgent (oldest first so
  //                         the deal closest to its deadline floats up)
  //   2. corp_committed   — waiting on the contractor; still on your
  //                         radar so it shouldn't get buried under
  //                         settled deals (oldest first → "longest
  //                         we've been waiting" surfaces)
  //   3. everything else  — settled, in flight, cancelled: natural
  //                         reverse-chrono order
  const sortPriority = (s: string): number => {
    if (s === 'proposed')       return 0;
    if (s === 'corp_committed') return 1;
    return 2;
  };
  // R18 — sort key overrides the urgency bucketing when set. 'default'
  // keeps the historical behaviour; other keys apply a flat order.
  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortBy === 'newest') {
      return parseUtcMs(b.created_at) - parseUtcMs(a.created_at);
    }
    if (sortBy === 'oldest') {
      return parseUtcMs(a.created_at) - parseUtcMs(b.created_at);
    }
    if (sortBy === 'quantity') {
      const qa = a.requested_count ?? a.worker_count ?? 0;
      const qb = b.requested_count ?? b.worker_count ?? 0;
      return qb - qa;  // most workers first
    }
    // default — preserve the urgency-aware sort.
    const pa = sortPriority(a.status);
    const pb = sortPriority(b.status);
    if (pa !== pb) return pa - pb;
    if (pa < 2) return parseUtcMs(a.created_at) - parseUtcMs(b.created_at);
    return parseUtcMs(b.created_at) - parseUtcMs(a.created_at);
  });
  // (pendingCount is computed below after `counts`, so the header chip
  //  always tracks the proposed pill exactly. Single source of truth.)

  // R14 — open searches split per-profession too. Searches whose
  // profession the corp can staff go under 'proposed'; the rest go
  // under 'no_workers'. Both still sum into 'all'.
  // R18 — sort applies to this list too so newest/oldest/quantity
  // sorts span the whole visible page, not just the deal half.
  const unsortedVisibleOpenSearches =
    filter === 'all'        ? browseSearches :
    filter === 'proposed'   ? browseSearches.filter((s) => corpCanFulfill(s.profession_type)) :
    filter === 'no_workers' ? browseSearches.filter((s) => !corpCanFulfill(s.profession_type)) :
    [];
  const visibleOpenSearches = [...unsortedVisibleOpenSearches].sort((a, b) => {
    if (sortBy === 'newest')   return parseUtcMs(b.created_at) - parseUtcMs(a.created_at);
    if (sortBy === 'oldest')   return parseUtcMs(a.created_at) - parseUtcMs(b.created_at);
    if (sortBy === 'quantity') return (b.quantity ?? 0) - (a.quantity ?? 0);
    // default — newest first for the browse feed (the deal list has its
    // own urgency-aware default sort below).
    return parseUtcMs(b.created_at) - parseUtcMs(a.created_at);
  });

  // R14 — pill counts mirror the per-profession split. For each
  // proposed-status item (deal or open-search), check whether the
  // corp can staff that profession. Items where the corp can → 'proposed'.
  // Items where the corp can't → 'no_workers'. active / completed stay
  // worker-agnostic. R17 — stale proposed items are pre-filtered
  // before counting so badge numbers match what the list shows.
  const counts = useMemo(() => {
    const out: Record<Filter, number> = {
      all: 0, proposed: 0, active: 0, completed: 0, no_workers: 0,
    };
    let visibleDealCount = 0;
    for (const d of deals) {
      if (CORP_STATUS_GROUP.proposed.includes(d.status)) {
        const ageMs = Date.now() - parseUtcMs(d.created_at);
        if (ageMs >= STALE_THRESHOLD_MS) continue;  // R17 skip stale
        visibleDealCount++;
        if (corpCanFulfill(d.profession_type ?? '')) out.proposed++;
        else                                          out.no_workers++;
      } else if (CORP_STATUS_GROUP.active.includes(d.status)) {
        out.active++;
        visibleDealCount++;
      } else if (CORP_STATUS_GROUP.completed.includes(d.status)) {
        out.completed++;
        visibleDealCount++;
      }
    }
    // browseSearches is already stale-filtered upstream — no need to
    // re-check here.
    for (const s of browseSearches) {
      if (corpCanFulfill(s.profession_type)) out.proposed++;
      else                                    out.no_workers++;
    }
    out.all = visibleDealCount + browseSearches.length;
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, browseSearches, corpProfessions]);

  // R19 — header chip mirrors the proposed-pill count exactly so the
  // "3 דרישות ממתינות לאישורך" claim above the filter pills can't drift
  // away from the "1" the pill actually shows. Items the corp can't
  // fulfill (no matching profession) live under no_workers and aren't
  // semantically "waiting on the corp's approval" anyway.
  const pendingCount = counts.proposed;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">קבלנים מחפשים עובדים בזמינות מיידית</h1>
          {pendingCount > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-1 rounded-full">
              {pendingCount} דרישות ממתינות לאישורך
            </span>
          )}
        </div>
      </header>

      {/* R9 no-workers gate — fires as soon as workerApi.list() resolves
          with zero workers. Sits above everything else so the corp sees
          the call-to-action without having to scroll or click. */}
      {workerCount === 0 && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Bell className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-amber-900">
                אין לך עובדים זמינים בכדי לתת מענה לדרישות בקטגוריה זו
              </p>
              <p className="text-sm text-amber-800 mt-1">
                טען את העובדים שלך למערכת ותוכל להגיש הצעות לכל הדרישות הפתוחות.
              </p>
              <Link
                href="/corporation/workers/new"
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                לחץ כאן לצורך העלאת עובדים למערכת
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Filter pills (right side in RTL) + sort dropdown (left side) —
          two controls share the row so the corp can switch view and
          ordering side by side. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => {
          const tone  = FILTER_TONE[f];
          const isOn  = filter === f;
          const count = counts[f];
          const cls   = isOn ? tone.active   : tone.idle;
          const badge = isOn ? tone.badgeOn  : tone.badgeOff;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${cls}`}
            >
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full leading-none ${badge}`}>
                {count}
              </span>
              <span>{FILTER_LABELS[f]}</span>
            </button>
          );
        })}
        </div>

        {/* R18 — sort dropdown. Stays compact so the filter pills keep
            primary visual weight; styled as a quiet outline select with
            an icon affordance. */}
        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">מיין לפי:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
          >
            <option value="default">ברירת מחדל (לפי דחיפות)</option>
            <option value="newest">חדשות תחילה</option>
            <option value="oldest">ישנות תחילה</option>
            <option value="quantity">כמות עובדים</option>
          </select>
        </label>
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

      {/* Empty — only fires when there's nothing in either bucket
          (no deals matching the filter AND no open searches to
          surface here). */}
      {!loading && !error && sortedFiltered.length === 0 && visibleOpenSearches.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <Handshake className="h-10 w-10 text-slate-200" />
          <p className="text-slate-600 font-medium">
            {filter === 'all' ? 'עדיין אין דרישות ועסקאות' : 'אין עסקאות בקטגוריה זו'}
          </p>
          {filter === 'all' && (
            <p className="text-slate-400 text-sm">
              ברגע שקבלן יפרסם דרישה חדשה היא תופיע כאן.
            </p>
          )}
        </div>
      )}

      {/* Unified tile list (R11) — open-search cards render at the top
          of the same column flow as the deal tiles. They share the
          rounded-2xl card shell so they read as part of the עסקאות
          list, not a separate section above it. Filter gating in
          visibleOpenSearches keeps "ממתין לאישור קבלן" / "הושלמו"
          views clean of unrelated open requests. */}
      {!loading && !error && (visibleOpenSearches.length > 0 || sortedFiltered.length > 0) && (
        <div className="space-y-3">

          {/* Open-search cards — visually match the deal-tile 3-column
              horizontal layout (meta | center | action) so the unified
              list reads as one consistent feed. The center column shows
              either:
                - corp has 0 workers → a 48h countdown; after expiry
                  the card switches to a "no matching workers found"
                  status with an inline Load-workers CTA.
                - corp has ≥1 worker → a passive "ממתינה להגשת עובדים"
                  illustration; the action button leads straight into
                  the allocation flow. */}
          {visibleOpenSearches.map((r) => {
            const profCode    = r.profession_type;
            const profLabel   = professionMap[r.profession_type] ?? r.profession_type;
            const regionLabel = r.region ? (regionMap[r.region] ?? r.region) : '';
            const originsHe   = (r.origin_preference ?? [])
              .map((c) => originMap[c] ?? c)
              .filter(Boolean);
            // R14 — per-profession check, not a blanket worker-count.
            // A corp with 5 plasterers gets the countdown only on
            // plumbing requests (or whatever profession they can't staff).
            const noWorkers   = !corpCanFulfill(r.profession_type);
            const remainingMs = parseUtcMs(r.created_at) + CORP_RESPONSE_HOURS * 3_600_000 - Date.now();
            const expired     = noWorkers && remainingMs <= 0;
            return (
              <div
                key={`open-${r.id}`}
                className={`relative rounded-2xl bg-white shadow-sm border-2 overflow-hidden ${
                  expired
                    ? 'border-rose-400 ring-2 ring-rose-100'
                    : noWorkers
                      ? 'border-amber-300 ring-2 ring-amber-100'
                      : 'border-slate-200'
                }`}
              >
                <div className="grid grid-cols-1 md:grid-cols-12">

                  {/* ── Meta column (first in DOM → right in RTL) ── */}
                  <div className="md:col-span-4 p-4 sm:p-5 space-y-2.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full border ${
                      expired
                        ? 'bg-rose-500 text-white border-rose-500'
                        : 'bg-amber-500 text-white border-amber-500'
                    }`}>
                      {expired ? 'לא נמצאו עובדים מתאימים' : 'דרישה פתוחה'}
                    </span>

                    <div className="flex items-start gap-3">
                      <ProfessionIcon
                        code={profCode}
                        size={44}
                        alt={profLabel}
                        className="shrink-0 object-contain"
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-slate-900 leading-tight truncate">{profLabel}</h3>
                        <p className="text-sm font-semibold text-slate-700 mt-1 inline-flex items-center gap-1.5">
                          <UsersIcon className="h-4 w-4 text-slate-400" />
                          <span>
                            <span className="text-slate-900">{r.quantity}</span>{' '}
                            עובדים{originsHe.length > 0 ? ` מ${originsHe.join(' / ')}` : ''}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-sm text-slate-700">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="text-slate-800">{startLabelHe(r.start_date)}</span>
                      </div>
                      {regionLabel && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                          <span className="text-slate-800">אזור {regionLabel}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                          <Lock className="h-3 w-3" />
                          {r.anon_label}
                        </span>
                        <span className="text-xs text-slate-400">· {timeAgoHe(r.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Centre column ── */}
                  <div className="md:col-span-4 p-4 sm:p-5 flex flex-col items-center justify-center gap-3 text-center bg-slate-50/40 md:border-s md:border-e md:border-slate-100 border-t md:border-t-0">
                    {expired ? (
                      <>
                        <div className="w-16 h-16 rounded-full bg-rose-500 text-white flex items-center justify-center">
                          <XCircle className="h-7 w-7" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-extrabold text-rose-700 leading-snug">
                            לא נמצאו עובדים מתאימים לענות על הדרישה
                          </p>
                          <p className="text-xs text-rose-600 font-semibold leading-snug">
                            בכדי להתקדם עליך לטעון עובדים למערכת
                          </p>
                        </div>
                      </>
                    ) : noWorkers ? (
                      <>
                        <div className="w-24 h-24 rounded-full bg-amber-50 border-4 border-amber-200 flex items-center justify-center">
                          <CorpResponseCountdown
                            createdAtIso={r.created_at}
                            responseHours={CORP_RESPONSE_HOURS}
                            size="compact"
                            tone="amber"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-sm font-extrabold text-amber-700">חלון הגשה</p>
                          <p className="text-xs text-amber-600 font-semibold">טען עובדים כדי לתת מענה</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                          <Handshake className="h-7 w-7" />
                        </div>
                        <p className="text-sm font-bold text-amber-700">ממתינה להגשת עובדים</p>
                      </>
                    )}
                  </div>

                  {/* ── Action column (last in DOM → left in RTL) ── */}
                  <div className="md:col-span-4 p-4 sm:p-5 flex flex-col justify-between gap-3 bg-white border-t md:border-t-0">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                      דרישה פתוחה
                    </div>

                    {expired ? (
                      <Link
                        href="/corporation/workers/new"
                        className="flex items-center justify-center gap-1.5 w-full rounded-lg py-3 px-4 font-bold text-sm bg-rose-600 hover:bg-rose-700 text-white transition"
                      >
                        <UserPlus className="w-4 h-4" />
                        טען עובדים למערכת
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenSearchClick(r)}
                        disabled={openSearchBusy === r.id}
                        className="flex items-center justify-center gap-1.5 w-full rounded-lg py-3 px-4 font-bold text-sm bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300 text-white transition"
                      >
                        {openSearchBusy === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <AlertCircle className="w-4 h-4" />
                            השב לדרישה
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Deal tiles — unchanged 3-column horizontal layout. */}
          {sortedFiltered.map((d) => {
            const profCode  = d.profession_type ?? '';
            const profLabel = d.profession_he ?? d.profession_type ?? '—';
            const offered   = d.worker_count ?? 0;
            const requested = d.requested_count ?? 0;
            const cardState = classifyCorpDeal(d.status);
            const isPending = cardState === 'actionNeeded';
            // R16 — proposed deal where corp has no matching profession
            // workers. Renders with the same no-workers treatment as the
            // open-search cards so the rose pill + red X + "load workers"
            // CTA are consistent across both surfaces; clicking the card
            // goes to /workers/new instead of the (un-actionable) deal
            // detail.
            const dealNoWorkers = isPending && !corpCanFulfill(profCode);
            const pill      = dealNoWorkers
              ? { cls: 'bg-rose-500 text-white border-rose-500', label: 'לא נמצאו עובדים מתאימים' }
              : (STATUS_PILL[d.status] ?? {
                  cls: 'bg-slate-100 text-slate-700 border-slate-200',
                  label: d.status,
                });
            // Countdown state for the centre column on proposed
            // cards — corp can still respond after the window
            // (the cron just notifies admin), so the post-zero copy
            // softens to "החלון נסגר — חשוב לענות בהקדם" instead
            // of the harsher "exceeded" wording.
            const remainingMs   = parseUtcMs(d.created_at) + CORP_RESPONSE_HOURS * 3_600_000 - Date.now();
            const stillInWindow = remainingMs > 0;
            const isFresh       = isPending && !dealNoWorkers && Date.now() - parseUtcMs(d.created_at) < 12 * 60 * 60 * 1000;
            const accent = CARD_ACCENT[cardState];
            const ringClass = dealNoWorkers
              ? 'border-rose-400 ring-2 ring-rose-100'
              : CARD_RING[cardState];
            const cardHref = dealNoWorkers
              ? '/corporation/workers/new'
              : `/corporation/deals/${d.id}`;
            return (
              // Outer wrapper — `relative` for positioning but NO
              // overflow-hidden so the "חדש" badge can spill above
              // the card top edge. The inner div carries the rounded
              // border + overflow-hidden so the accent-edge strip
              // still gets clipped to the corners.
              <Link
                key={d.id}
                href={cardHref}
                className="group relative block"
              >
                {/* "חדש" badge — sits above the card top edge.
                    Outside the overflow-hidden inner div so the
                    negative `-top-2` doesn't get clipped (previous
                    bug — the bell icon was cut in half). */}
                {isFresh && (
                  <span className="absolute -top-2 end-4 inline-flex items-center gap-1
                                  bg-rose-500 text-white text-[10px] font-bold
                                  uppercase tracking-wide px-2 py-0.5 rounded-full
                                  shadow-sm z-10">
                    <Bell className="w-3 h-3" /> חדש
                  </span>
                )}

                <div className={`relative rounded-2xl bg-white shadow-sm
                                hover:shadow-md transition border-2 overflow-hidden ${ringClass}`}>
                  {accent && !dealNoWorkers && (
                    // Coloured strip along the card's visual left edge
                    // (`end` in RTL). Marks settled outcomes (closed
                    // emerald / cancelled rose) so the corp can scan
                    // the list and spot wins vs losses immediately.
                    <div className={`absolute inset-y-0 end-0 w-1.5 ${accent}`} aria-hidden="true" />
                  )}

                <div className="grid grid-cols-1 md:grid-cols-12">

                  {/* ── Meta column (first in DOM → right in RTL) ── */}
                  <div className="md:col-span-4 p-4 sm:p-5 space-y-2.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full border ${pill.cls}`}>
                      {pill.label}
                    </span>

                    <div className="flex items-start gap-3">
                      {profCode && (
                        <ProfessionIcon
                          code={profCode}
                          size={44}
                          alt={profLabel}
                          className="shrink-0 object-contain"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-slate-900 leading-tight truncate">{profLabel}</h3>
                        <p className="text-sm font-semibold text-slate-700 mt-1 inline-flex items-center gap-1.5">
                          <UsersIcon className="h-4 w-4 text-slate-400" />
                          <span>
                            <span className="text-slate-900">{requested > 0 ? `${offered}/${requested}` : offered}</span>{' '}
                            עובדים
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-sm text-slate-700">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="text-slate-800">נוצרה: {fmt(d.created_at)}</span>
                      </div>
                      {d.region_he && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                          <span className="text-slate-800">{d.region_he}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Centre column: countdown for proposed AND for
                       corp_committed (where the corp is waiting on the
                       contractor's 7-day approval window). Static state
                       illustration for everything else. R16 — no-workers
                       proposed deals get the red X "no matching workers"
                       fork shared with the open-search cards. ── */}
                  <div className="md:col-span-4 p-4 sm:p-5 flex flex-col items-center justify-center gap-3 text-center bg-slate-50/40 md:border-s md:border-e md:border-slate-100 border-t md:border-t-0">
                    {dealNoWorkers ? (
                      <>
                        <div className="w-16 h-16 rounded-full bg-rose-500 text-white flex items-center justify-center">
                          <XCircle className="h-7 w-7" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-extrabold text-rose-700 leading-snug">
                            לא נמצאו עובדים מתאימים לענות על הדרישה
                          </p>
                          <p className="text-xs text-rose-600 font-semibold leading-snug">
                            בכדי להתקדם עליך לטעון עובדים למערכת
                          </p>
                        </div>
                      </>
                    ) : isPending ? (
                      <>
                        <div className="w-24 h-24 rounded-full bg-amber-50 border-4 border-amber-200 flex items-center justify-center">
                          <CorpResponseCountdown
                            createdAtIso={d.created_at}
                            responseHours={CORP_RESPONSE_HOURS}
                            size="compact"
                            tone="amber"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-sm font-extrabold text-amber-700">
                            {stillInWindow ? 'נשאר לך להגיב' : 'החלון נסגר — חשוב לענות בהקדם'}
                          </p>
                          <p className="text-xs text-amber-600 font-semibold">
                            {STATUS_CONTEXT[d.status] ?? 'דרושה החלטה'}
                          </p>
                        </div>
                      </>
                    ) : cardState === 'committed' && d.expires_at ? (
                      <>
                        <div className="w-24 h-24 rounded-full bg-sky-50 border-4 border-sky-200 flex items-center justify-center">
                          <CorpResponseCountdown
                            deadlineIso={d.expires_at}
                            size="compact"
                            tone="sky"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-sm font-extrabold text-sky-700">
                            ממתין לאישור הקבלן
                          </p>
                          <p className="text-xs text-sky-600 font-semibold">
                            {STATUS_CONTEXT[d.status] ?? 'הצעת עובדים נשלחה לקבלן'}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                          cardState === 'committed'   ? 'bg-sky-100 text-sky-700'
                          : cardState === 'engaged'   ? 'bg-emerald-500 text-white'
                          : cardState === 'closed'    ? 'bg-emerald-500 text-white'
                          : cardState === 'cancelled' ? 'bg-rose-500 text-white'
                                                      : 'bg-slate-100 text-slate-500'
                        }`}>
                          {cardState === 'committed'   ? <MessageSquare className="h-7 w-7" />
                           : cardState === 'engaged'   ? <CheckCircle2 className="h-7 w-7" />
                           : cardState === 'closed'    ? <CheckCircle2 className="h-7 w-7" />
                           : cardState === 'cancelled' ? <XCircle className="h-7 w-7" />
                                                       : <Handshake className="h-7 w-7" />}
                        </div>
                        <p className={`text-sm font-bold ${
                          cardState === 'engaged'    ? 'text-emerald-700'
                          : cardState === 'closed'   ? 'text-emerald-700'
                          : cardState === 'cancelled' ? 'text-rose-700'
                                                      : 'text-slate-800'
                        }`}>
                          {STATUS_CONTEXT[d.status] ?? d.status}
                        </p>
                      </>
                    )}
                  </div>

                  {/* ── Action column (last in DOM → left in RTL) ── */}
                  <div className="md:col-span-4 p-4 sm:p-5 flex flex-col justify-between gap-3 bg-white border-t md:border-t-0">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                      עסקה #{dealRef(d.id)}
                    </div>

                    <div className={`flex items-center justify-center gap-1.5 w-full rounded-lg py-3 px-4 font-bold text-sm transition ${
                      dealNoWorkers                ? 'bg-rose-600 text-white group-hover:bg-rose-700'
                      : isPending                  ? 'bg-amber-500 text-white group-hover:bg-amber-600'
                      : cardState === 'engaged'    ? 'bg-emerald-500 text-white group-hover:bg-emerald-600'
                      : cardState === 'committed'  ? 'bg-sky-100 text-sky-800 border border-sky-200 group-hover:bg-sky-200'
                      : cardState === 'cancelled'  ? 'bg-slate-100 text-slate-600 border border-slate-200 group-hover:bg-slate-200'
                                                   : 'bg-white text-slate-700 border border-slate-300 group-hover:bg-slate-50'
                    }`}>
                      {dealNoWorkers               ? <><UserPlus className="w-4 h-4" /> טען עובדים למערכת</>
                       : isPending                 ? <><AlertCircle className="w-4 h-4" /> אשר / דחה</>
                       : cardState === 'engaged'   ? <><CheckCircle2 className="w-4 h-4" /> פרטים וצ׳אט</>
                       : cardState === 'committed' ? <><MessageSquare className="w-4 h-4" /> ממתין לקבלן</>
                       : cardState === 'cancelled' ? <><XCircle className="w-4 h-4" /> פרטי העסקה</>
                                                   : <><MessageSquare className="w-4 h-4" /> פרטים וצ׳אט</>}
                    </div>
                  </div>
                </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Per-row click-gate modal — fallback when the corp scrolls past
          the top-of-page banner and tries to engage with a request
          while having no workers. Same copy as the banner so the user
          sees consistent messaging in both surfaces. */}
      {gateModalSearch && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
          onClick={() => setGateModalSearch(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  אין לך עובדים זמינים בכדי לתת מענה לדרישה זו
                </h2>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  טען את העובדים שלך למערכת ותוכל להגיש הצעות לכל הדרישות הפתוחות.
                </p>
              </div>
            </div>
            <Link
              href="/corporation/workers/new"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-base shadow-md transition-colors"
            >
              <UserPlus className="h-5 w-5" />
              לחץ כאן לצורך העלאת עובדים למערכת
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={() => setGateModalSearch(null)}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700 py-1"
            >
              לא כרגע
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CorporationDealsPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    }>
      <CorporationDealsPageContent />
    </Suspense>
  );
}
