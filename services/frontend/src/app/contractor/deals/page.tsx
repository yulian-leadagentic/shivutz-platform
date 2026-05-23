'use client';

// /contractor/deals — unified list of every worker-search the
// contractor has opened plus the corp proposals (deals) attached
// to each. One card per search, rendered in 3 columns:
//   meta · centred state illustration · inline corp list
// The corp list is visible by default (no click-to-expand at
// the card level) so a contractor can scan "where is each
// request" in one pass.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CorpResponseCountdown } from '@/components/CorpResponseCountdown';

// corp_response_hours from payment_db.system_settings (migration
// 027). Kept as a constant for now — when an admin tunes the DB
// value the frontend still uses 48 until this constant is updated
// or we add a /enums/settings endpoint. Server-side timing (cron,
// internal queries) does read the DB value, so the admin-notify
// fires at the real deadline regardless.
const CORP_RESPONSE_HOURS = 48;
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle, Handshake, MessageSquare, Calendar, MapPin, Globe2,
  Plus, ChevronDown, Loader2, CheckCircle2, XCircle, Bell,
  Search, ArrowLeft, Users, MoreVertical, Trash2,
  Building2, Phone, Mail, Send, Lock,
} from 'lucide-react';
import { dealApi, searchApi } from '@/lib/api';
import { orgApi } from '@/lib/api/organizations';
import type { Corporation, Message } from '@/types';
import { enumApi } from '@/lib/api/enums';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal, Worker, WorkerSearch, Profession } from '@/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  DEAL_FILTER_LABEL,
  heOrigin,
  type DealFilter as Filter,
} from '@/i18n/he';

// ── Helpers ────────────────────────────────────────────────────

// MySQL TIMESTAMP columns serialize as "YYYY-MM-DD HH:MM:SS" with
// no `T` separator and no `Z` suffix. `new Date(...)` interprets
// such strings as *local* time, but the DB value is UTC. On a
// machine in UTC+3 a deal created two minutes ago shows up as
// "3 hours ago". Normalise here so every callsite is timezone-safe.
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

// Relative time in Hebrew — used per corp response so the
// contractor can see "the second corp answered 10 minutes ago"
// at a glance, especially relevant when multiple corps respond
// at different times.
function timeAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - parseUtcMs(iso);
  if (ms < 60_000)         return 'הרגע';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60)           return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)          return `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  if (days < 7)            return `לפני ${days} ימים`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5)           return `לפני ${weeks} שבועות`;
  return new Date(parseUtcMs(iso)).toLocaleDateString('he-IL');
}

// True if the deal moved into corp_committed in the last 24h.
// Drives the "חדש" badge so a contractor can spot fresh responses
// when multiple corps reply at different times.
function isRecent(iso?: string): boolean {
  if (!iso) return false;
  return Date.now() - parseUtcMs(iso) < 24 * 60 * 60 * 1000;
}

// Aggregate a worker list by origin country so the inline
// drill-down reads as "2 אוקראינה, 1 רומניה" instead of three
// individual rows. Experience ranges are deduped per country.
type OriginAggregate = { country: string; count: number; experiences: string[] };
function aggregateByOrigin(workers: Worker[]): OriginAggregate[] {
  const map = new Map<string, OriginAggregate>();
  for (const w of workers) {
    const country = w.origin_country ? heOrigin(w.origin_country) : 'מוצא לא ידוע';
    const wAny = w as unknown as { experience_range?: string };
    const exp = wAny.experience_range
      ? wAny.experience_range
      : (w.experience_years != null ? `${w.experience_years}ש׳` : null);
    const entry = map.get(country) ?? { country, count: 0, experiences: [] };
    entry.count++;
    if (exp && !entry.experiences.includes(exp)) entry.experiences.push(exp);
    map.set(country, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

const STATUS_CONTEXT: Record<string, string> = {
  proposed:                'נשלחה לתאגיד — ממתין לתגובה',
  counter_proposed:        'הצעה נגדית — ממתין לתגובה',
  corp_committed:          'התאגיד הציע עובדים — בדוק ואשר',
  accepted:                'אושר ע״י הקבלן — עובדים בשטח',
  active:                  'עובדים בשטח',
  reporting:               'מדווח',
  closed:                  'הושלמה',
  completed:               'הושלמה',
  rejected:                'התאגיד דחה',
  cancelled_by_corp:       'בוטל ע״י התאגיד',
  cancelled_by_contractor: 'בוטל על ידך',
  expired:                 'פג תוקף',
};

// Fields the backend enriches onto a deal row.
type EnrichedDeal = Deal & {
  profession_type?: string;
  profession_he?:   string;
  region_he?:       string;
  worker_count?:    number;
  requested_count?: number;
};

// ── Filter taxonomy ────────────────────────────────────────────

const CONTRACTOR_FILTERS: Filter[] = ['all', 'awaiting_approval', 'proposed', 'completed', 'cancelled'];

const CONTRACTOR_STATUS_GROUP: Record<Exclude<Filter, 'all' | 'active'>, string[]> = {
  awaiting_approval: ['corp_committed'],
  proposed:          ['proposed', 'counter_proposed'],
  completed:         ['approved', 'accepted', 'active', 'reporting', 'completed', 'closed'],
  cancelled:         ['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired', 'disputed'],
};

function contractorMatchesFilter(status: string, filter: Filter): boolean {
  if (filter === 'all' || filter === 'active') return filter === 'all';
  return CONTRACTOR_STATUS_GROUP[filter].includes(status);
}

// Each filter gets its own colour so the row reads as a bar of
// distinct category chips rather than five identical pills.
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
  awaiting_approval: {
    active:   'bg-amber-500 text-white border-amber-500',
    idle:     'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100',
    badgeOn:  'bg-white/25 text-white',
    badgeOff: 'bg-amber-200 text-amber-900',
  },
  proposed: {
    active:   'bg-sky-600 text-white border-sky-600',
    idle:     'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
    badgeOn:  'bg-white/25 text-white',
    badgeOff: 'bg-sky-100 text-sky-700',
  },
  active: { // unused on contractor pills, included for type completeness
    active: '', idle: '', badgeOn: '', badgeOff: '',
  },
  completed: {
    active:   'bg-emerald-600 text-white border-emerald-600',
    idle:     'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
    badgeOn:  'bg-white/25 text-white',
    badgeOff: 'bg-emerald-100 text-emerald-700',
  },
  cancelled: {
    active:   'bg-rose-600 text-white border-rose-600',
    idle:     'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100',
    badgeOn:  'bg-white/25 text-white',
    badgeOff: 'bg-rose-100 text-rose-700',
  },
};

// ── Per-card state classification + visual meta ────────────────
//
// Follows the contractor's real workflow:
//   searching  → match-cache hasn't run yet
//   noMatch    → match-cache ran, found 0 workers
//   proposed   → match found, system pushed it to corps, no
//                corp has attached workers yet
//   awaiting   → corp attached workers — contractor needs to
//                view corp details (clicking the action calls
//                approve(), which reveals contact info)
//   toClose    → contractor has viewed corp details, only
//                step left is "אשר סגירת עסקה"
//   closed     → done
//   cancelled  → terminal-negative

type CardState =
  | 'searching'
  | 'noMatch'
  | 'proposed'
  | 'awaiting'
  | 'toClose'
  | 'closed'
  | 'cancelled';

// Priority drives sort order. Action-required states sit at top:
// 0 awaiting (view corp), 1 toClose (confirm close).
const CARD_STATE_PRIORITY: Record<CardState, number> = {
  awaiting: 0, toClose: 1, proposed: 2, searching: 3, noMatch: 4, closed: 5, cancelled: 6,
};

const ACTION_REQUIRED = new Set(['corp_committed']);
const PROPOSED        = new Set(['proposed', 'counter_proposed']);
// 'approved' is the backend's actual post-contractor-approve
// status (services/deal/app/routes/deals.py:484). 'accepted' is
// kept for backward-compat in case any legacy rows exist.
const IN_FIELD        = new Set(['approved', 'accepted', 'active', 'reporting']);
const CLOSED          = new Set(['completed', 'closed']);
const CANCELLED_S     = new Set(['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired', 'disputed']);

function classifyCard(deals: EnrichedDeal[], search?: WorkerSearch): CardState {
  // A search the contractor has explicitly deleted (DELETE
  // /searches/{id} → status='cancelled') reads as 'cancelled'
  // regardless of the deals still on it. The cascade should have
  // moved any open deals to cancelled_by_contractor already, but
  // we don't depend on that here — the search's own status is
  // the source of truth for the card's bucket.
  if (search?.status === 'cancelled')                   return 'cancelled';
  if (deals.some((d) => ACTION_REQUIRED.has(d.status))) return 'awaiting';
  if (deals.some((d) => IN_FIELD.has(d.status)))        return 'toClose';

  // Settled — at least one deal closed AND every non-cancelled deal
  // is closed. Cancelled siblings (rejected corps, withdrawn bids)
  // are cleanup; the headline is "you got this filled". Without this
  // branch a search with one closed + one cancelled deal falls into
  // the default 'proposed' bucket and shows the misleading "ממתין
  // לאישור התאגיד" badge even though everything is settled.
  const live = deals.filter((d) => !CANCELLED_S.has(d.status));
  if (live.length > 0 && live.every((d) => CLOSED.has(d.status))) return 'closed';

  if (deals.some((d) => PROPOSED.has(d.status))) return 'proposed';
  if (deals.length === 0) {
    // best_fill_pct: -1 = match not yet run, 0 = ran but no
    // matches, >0 = matched (this last case shouldn't sit here
    // for long because the system pushes to corps and creates
    // proposed deals automatically — but if it does we treat
    // it as "still searching").
    return (search?.best_fill_pct ?? -1) === 0 ? 'noMatch' : 'searching';
  }
  if (deals.every((d) => CANCELLED_S.has(d.status))) return 'cancelled';
  return 'proposed';
}

interface StateMeta {
  badge:    string;
  badgeCls: string;
  illoCls:  string;
  IlloIcon: typeof Bell;
  cardRing: string;
  // Optional accent strip painted along the card's left edge (visual
  // left — `end` side in RTL). Used by the closed/success state to
  // give the settled card a strong "this one's done" marker without
  // tinting the whole body.
  accentEdge?: string;
}

const STATE_META: Record<CardState, StateMeta> = {
  awaiting:  {
    // Corp committed workers, contractor hasn't yet clicked
    // "לחשיפת פרטי תאגיד". Amber = "action needed, you've got
    // good news waiting" but kept distinct from the post-approve
    // green so the contractor sees clear progress on click.
    badge: 'תאגיד אישר זמינות', badgeCls: 'bg-amber-100 text-amber-800',
    illoCls: 'bg-amber-500 text-white', IlloIcon: Bell,
    cardRing: 'border-amber-400 ring-2 ring-amber-200',
  },
  toClose:   {
    // Contractor has approved the engagement: corp contact info
    // is revealed and the only step left is reporting whether
    // the deal actually closed. Green to confirm progress.
    badge: 'התקשרות אושרה', badgeCls: 'bg-emerald-100 text-emerald-800',
    illoCls: 'bg-emerald-500 text-white', IlloIcon: CheckCircle2,
    cardRing: 'border-emerald-400 ring-2 ring-emerald-200',
  },
  proposed:  {
    badge: 'ממתין לאישור התאגיד', badgeCls: 'bg-sky-100 text-sky-800',
    illoCls: 'bg-sky-100 text-sky-700', IlloIcon: MessageSquare,
    cardRing: 'border-slate-200',
  },
  searching: {
    badge: 'מחפשים עובדים', badgeCls: 'bg-slate-100 text-slate-700',
    illoCls: 'bg-slate-100 text-slate-600', IlloIcon: Search,
    cardRing: 'border-slate-200',
  },
  noMatch:   {
    badge: 'לא נמצאו עובדים', badgeCls: 'bg-slate-100 text-slate-600',
    illoCls: 'bg-slate-100 text-slate-500', IlloIcon: AlertCircle,
    cardRing: 'border-slate-200',
  },
  closed:    {
    // Final state — corp delivered, contractor confirmed close.
    // Prominent emerald so a settled deal reads as a clear "done /
    // success" at-a-glance and isn't visually confused with the
    // sky-blue "waiting on corp" bucket.
    badge: 'עסקה נסגרה ואושרה', badgeCls: 'bg-emerald-500 text-white',
    illoCls: 'bg-emerald-500 text-white', IlloIcon: CheckCircle2,
    cardRing: 'border-emerald-400 ring-2 ring-emerald-200',
    accentEdge: 'bg-emerald-500',
  },
  cancelled: {
    badge: 'בוטל', badgeCls: 'bg-rose-100 text-rose-700',
    illoCls: 'bg-rose-50 text-rose-500', IlloIcon: XCircle,
    cardRing: 'border-slate-200 opacity-80',
  },
};

// Per-deal compact status pill (sits next to each corp's label).
const DEAL_STATUS_PILL: Record<string, { cls: string; label: string }> = {
  proposed:                { cls: 'bg-sky-50 text-sky-700 border-sky-200',                    label: 'ממתין לאישור התאגיד' },
  counter_proposed:        { cls: 'bg-sky-50 text-sky-700 border-sky-200',                    label: 'הצעה נגדית' },
  corp_committed:          { cls: 'bg-amber-500 text-white border-amber-500',                 label: 'התאגיד אישר' },
  approved:                { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'אושר' },
  accepted:                { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'אושר' },
  active:                  { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'אושר' },
  reporting:               { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'אושר' },
  closed:                  { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',        label: 'נסגרה' },
  completed:               { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',        label: 'נסגרה' },
  rejected:                { cls: 'bg-rose-50 text-rose-700 border-rose-200',                 label: 'התאגיד דחה' },
  cancelled_by_corp:       { cls: 'bg-rose-50 text-rose-700 border-rose-200',                 label: 'בוטל ע״י תאגיד' },
  cancelled_by_contractor: { cls: 'bg-rose-50 text-rose-700 border-rose-200',                 label: 'בוטל על ידך' },
  cancelled:               { cls: 'bg-rose-50 text-rose-700 border-rose-200',                 label: 'בוטל' },
  expired:                 { cls: 'bg-slate-100 text-slate-500 border-slate-200',             label: 'פג תוקף' },
};

function DealTileSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="md:col-span-4 space-y-2">
          <div className="h-4 w-1/3 bg-slate-200 rounded" />
          <div className="h-3 w-2/3 bg-slate-100 rounded" />
          <div className="h-3 w-1/2 bg-slate-100 rounded" />
        </div>
        <div className="md:col-span-4 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-slate-100" />
        </div>
        <div className="md:col-span-4 space-y-2">
          <div className="h-10 bg-slate-100 rounded" />
          <div className="h-10 bg-slate-100 rounded" />
        </div>
      </div>
    </div>
  );
}

// ── DealCard ───────────────────────────────────────────────────

interface DealCardProps {
  card: { searchId: string; search?: WorkerSearch; deals: EnrichedDeal[] };
  profMap:        Record<string, string>;
  regionMap:      Record<string, string>;
  originMap:      Record<string, string>;
  workersById:    Record<string, Worker[]>;
  loadingWorkers: Record<string, boolean>;
  expandedDealId: string | null;
  onToggleDeal:   (id: string) => void;
  actingId:       string | null;
  actionError:    Record<string, string>;
  onApprove:      (id: string) => void;
  onReject:       (id: string) => void;
  onConfirmClose: (id: string) => void;
  onCancelOthers: (dealIds: string[]) => void;
  cancellingOthers: boolean;
  onDeleteSearch: (dealIds: string[]) => void;
  deletingSearch:  boolean;
}

function DealCard({
  card, profMap, regionMap, originMap,
  workersById, loadingWorkers, expandedDealId, onToggleDeal,
  actingId, actionError, onApprove, onReject, onConfirmClose,
  onCancelOthers, cancellingOthers,
  onDeleteSearch, deletingSearch,
}: DealCardProps) {
  void onReject; // kept on the API for the deal-detail page; not surfaced here
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmCancelOthersOpen, setConfirmCancelOthersOpen] = useState(false);
  // Corp contact panel — lazy-fetched once per deal when its row
  // expands AND the deal is past the disclosure point.
  const [corpById, setCorpById] = useState<Record<string, Corporation>>({});
  const [loadingCorp, setLoadingCorp] = useState<Record<string, boolean>>({});
  const { searchId: _searchId, search, deals: group } = card;
  void _searchId;

  const head = group[0];
  const profCode  = head?.profession_type ?? search?.profession_type ?? '';
  const profLabel = head?.profession_he ?? profMap[profCode] ?? profCode ?? '—';
  const requested = head?.requested_count
                  ?? search?.quantity
                  ?? (group.length > 0
                       ? group.reduce((s, d) => s + (d.worker_count ?? 0), 0)
                       : 0);
  const regionLabel = head?.region_he
                   ?? (search?.region ? (regionMap[search.region] ?? search.region) : '');
  const startDate   = search?.start_date;
  const endDate     = search?.end_date;
  const originCodes = search?.origin_preference ?? [];

  const state = classifyCard(group, search);
  const meta  = STATE_META[state];
  const Illo  = meta.IlloIcon;

  const COMMITTED = new Set([
    'proposed', 'corp_committed', 'counter_proposed',
    'approved', 'accepted', 'active', 'reporting',
  ]);
  const filled  = group.filter((d) => COMMITTED.has(d.status))
                       .reduce((s, d) => s + (d.worker_count ?? 0), 0);
  const fillPct = requested > 0 ? Math.min(100, Math.round((filled / requested) * 100)) : 0;
  // Earliest created_at among the still-proposed deals — drives
  // the centre-circle countdown. The most-urgent proposed deal
  // expires first, so this is the timer the contractor should see.
  const proposedDeals = group.filter((d) => PROPOSED.has(d.status));
  const oldestProposedAt = proposedDeals.length > 0
    ? proposedDeals
        .map((d) => d.created_at)
        .filter((c): c is string => !!c)
        .sort()[0]
    : null;
  const matchPct      = search?.best_fill_pct ?? -1;
  const matchWorkers  = matchPct > 0 && requested > 0
    ? Math.min(requested, Math.round(matchPct / 100 * requested))
    : 0;

  // Identity reveal only after the contractor approves.
  const REVEALED = ['approved', 'accepted', 'active', 'reporting', 'completed', 'closed'];

  // Lazy-fetch corp contact info for whichever revealed deal is
  // currently expanded. One-shot per deal_id; cached in corpById.
  useEffect(() => {
    if (!expandedDealId) return;
    const deal = group.find((d) => d.id === expandedDealId);
    if (!deal || !REVEALED.includes(deal.status) || !deal.corporation_id) return;
    if (corpById[deal.id] || loadingCorp[deal.id]) return;
    setLoadingCorp((s) => ({ ...s, [deal.id]: true }));
    orgApi.getCorporation(deal.corporation_id)
      .then((c) => setCorpById((s) => ({ ...s, [deal.id]: c })))
      .catch(() => {/* leave empty — panel will show a fallback */})
      .finally(() => setLoadingCorp((s) => ({ ...s, [deal.id]: false })));
  }, [expandedDealId, group, corpById, loadingCorp]);

  // Hand-off target for the card-wide "בדוק ואשר" CTA.
  const awaitingDealId = group.find((d) => d.status === 'corp_committed')?.id;

  // Delete-search eligibility — option 2(c):
  //   * Allowed when nothing is in flight (no corp_committed,
  //     accepted, active, reporting).
  //   * Blocked otherwise — contractor must finish or withdraw
  //     those bids individually first.
  // When allowed, the cascade target is every proposed /
  // counter_proposed / corp_committed deal on this search (the
  // last one shouldn't exist at this point per the rule, but we
  // include it defensively).
  const isAlreadyCancelled  = state === 'cancelled';
  const inFlight = group.some((d) => IN_FIELD.has(d.status));
  const canDelete = !isAlreadyCancelled && !inFlight;
  const cancellableForDelete = group
    .filter((d) => PROPOSED.has(d.status) || d.status === 'corp_committed')
    .map((d) => d.id);

  // "סגור שאר ההצעות" logic.
  //
  // The full requested quantity is considered fulfilled once the sum
  // of worker_count across deals the contractor has already approved
  // (accepted/active/reporting + closed) reaches `requested`. When
  // that's true AND there are still corps in proposed / corp_committed
  // for the same search, those bids are irrelevant — we expose a
  // button to withdraw them in one click. If the fill is partial,
  // we leave the other bids open so the contractor can pick up the
  // remaining workers elsewhere.
  const SETTLED = new Set(['approved', 'accepted', 'active', 'reporting', 'completed', 'closed']);
  const settledFilled = group.filter((d) => SETTLED.has(d.status))
                             .reduce((s, d) => s + (d.worker_count ?? 0), 0);
  const isFullyFilled = requested > 0 && settledFilled >= requested;
  const cancellableOthers = group.filter((d) =>
    PROPOSED.has(d.status) || d.status === 'corp_committed',
  );
  const showCancelOthers = isFullyFilled && cancellableOthers.length > 0;

  return (
    <div className={`relative rounded-2xl border ${meta.cardRing} bg-white shadow-sm overflow-hidden`}>
      {meta.accentEdge && (
        // Visual left edge in RTL (`end` side) — solid colour strip.
        // The card's `overflow-hidden` clips it to the rounded corners.
        <div className={`absolute inset-y-0 end-0 w-1.5 ${meta.accentEdge}`} aria-hidden="true" />
      )}
      <div className="grid grid-cols-1 md:grid-cols-12">

        {/* ── Meta column (first in DOM → right in RTL) ────────── */}
        <div className="md:col-span-4 p-4 sm:p-5 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full ${meta.badgeCls}`}>
              {state === 'awaiting' && <Bell className="h-3 w-3 animate-pulse" />}
              {meta.badge}
            </span>

            {/* Kebab — currently only "מחק בקשה". Disabled when
                the search has deals in flight (option 2c). */}
            {!isAlreadyCancelled && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="עוד פעולות"
                  aria-expanded={menuOpen}
                  className="p-1 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <>
                    {/* Click-away shim — closes the menu when the
                        user clicks anywhere else. */}
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setMenuOpen(false)}
                      aria-hidden
                    />
                    <div
                      role="menu"
                      className="absolute end-0 top-full mt-1 min-w-[200px] z-40 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!canDelete || deletingSearch}
                        onClick={() => {
                          if (!canDelete) return;
                          const msg = cancellableForDelete.length === 0
                            ? 'למחוק את הבקשה? לא ניתן יהיה לשחזר.'
                            : `למחוק את הבקשה? ${cancellableForDelete.length} הצעות שטרם אושרו יבוטלו אוטומטית והעובדים והאשראי ישוחררו לתאגידים.`;
                          if (!confirm(msg)) return;
                          setMenuOpen(false);
                          onDeleteSearch(cancellableForDelete);
                        }}
                        title={canDelete ? undefined : 'לא ניתן למחוק בקשה כאשר יש עסקה פעילה. סיים או בטל אותה תחילה.'}
                        className={`w-full text-start flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                          canDelete
                            ? 'text-rose-700 hover:bg-rose-50'
                            : 'text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {deletingSearch
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                        מחק בקשה
                      </button>
                      {!canDelete && (
                        <p className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100 leading-snug">
                          לא ניתן למחוק בקשה כאשר יש עסקה פעילה.
                          סיים או בטל אותה תחילה.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-start gap-3">
            {profCode && (
              <ProfessionIcon code={profCode} size={40} alt={profLabel}
                              className="shrink-0 object-contain" />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-slate-900 leading-tight truncate">{profLabel}</h3>
              <p className="text-sm font-semibold text-slate-700 mt-1 inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-slate-400" />
                <span><span className="text-slate-900">{requested}</span> עובדים</span>
              </p>
            </div>
          </div>

          <div className="space-y-1.5 text-sm text-slate-700">
            {(startDate || endDate) && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                <span dir="ltr" className="text-slate-800">
                  {startDate ? fmt(startDate) : '—'}
                  {endDate && <> – {fmt(endDate)}</>}
                </span>
              </div>
            )}
            {originCodes.length > 0 ? (
              <div className="flex items-start gap-2">
                <Globe2 className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                <span className="text-slate-800 leading-snug">
                  {originCodes.map((c) => originMap[c] ?? heOrigin(c)).join(', ')}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-400">
                <Globe2 className="h-4 w-4 shrink-0" />
                <span>ללא העדפת מוצא</span>
              </div>
            )}
            {regionLabel && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-slate-800">{regionLabel}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Centre column: state illustration + blurb ─────────── */}
        <div className="md:col-span-4 p-4 sm:p-5 flex flex-col items-center justify-center gap-3 text-center bg-slate-50/40 md:border-s md:border-e md:border-slate-100 border-t md:border-t-0">
          {/* When the deal(s) are in `proposed` and at least one
              proposed deal exists, the centre circle becomes the
              corp-response countdown (HH:MM:SS). 48h from the
              earliest proposed deal's created_at. After 0 it
              renders 00:00:00 with an "admin notified" line. */}
          {state === 'proposed' && oldestProposedAt ? (
            <div className="w-24 h-24 rounded-full bg-amber-50 border-4 border-amber-200 flex items-center justify-center">
              <CorpResponseCountdown
                createdAtIso={oldestProposedAt}
                responseHours={CORP_RESPONSE_HOURS}
                size="compact"
                tone="amber"
              />
            </div>
          ) : (
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${meta.illoCls}`}>
              <Illo className={`h-7 w-7 ${state === 'awaiting' ? 'animate-pulse' : ''}`} />
            </div>
          )}
          <CentreBlurb
            state={state}
            awaitingN={group.filter((d) => d.status === 'corp_committed').length}
            proposedN={group.filter((d) => PROPOSED.has(d.status)).length}
            inFieldN={group.filter((d) => IN_FIELD.has(d.status)).length}
            corpsTotal={group.length}
            oldestProposedAt={oldestProposedAt}
          />
        </div>

        {/* ── Corp list column (last in DOM → left in RTL) ─────── */}
        <div className="md:col-span-4 p-4 sm:p-5 space-y-2 bg-white border-t md:border-t-0">
          {group.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 inline-flex items-start gap-2">
              <MessageSquare className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-700 leading-snug">
                {state === 'noMatch'
                  ? 'נשלחה הודעה לכל התאגידים הרשומים'
                  : <>הדרישה שלך לעובדים בתחום <span className="font-bold text-slate-900">{profLabel}</span> הופצה לכל התאגידים הרשומים אצלינו</>}
              </p>
            </div>
          ) : (
            <>
              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                תאגידים ({group.length})
              </div>
              {group
                .slice()
                .sort((a, b) => parseUtcMs(b.created_at) - parseUtcMs(a.created_at))
                .map((d, idx) => {
                  // Anonymous "תאגיד N" until the contractor approves
                  // → then swap to the real company name once the
                  // corp record has been lazy-fetched (see corpById).
                  // Falls back to a short-id stub while the fetch is
                  // in flight so the label doesn't flicker.
                  const corpInfo  = corpById[d.id];
                  const revealed  = REVEALED.includes(d.status);
                  // Per user's spec:
                  //   Pre-approve  → "תאגיד 1/2/…" (anonymous index).
                  //   Post-approve → "תאגיד {company_name_he} אישר X עובדים".
                  const realCorpName = corpInfo?.company_name_he || corpInfo?.company_name;
                  const corpLabel = revealed
                    ? `תאגיד ${realCorpName
                        || (d.corporation_id ? d.corporation_id.slice(0, 6) : idx + 1)}`
                    : `תאגיד ${idx + 1}`;
                  const corpSuffix = revealed && d.worker_count != null
                    ? `אישר ${d.worker_count} עובדים`
                    : null;
                  const pill = DEAL_STATUS_PILL[d.status] ?? {
                    cls: 'bg-slate-100 text-slate-600 border-slate-200',
                    label: d.status,
                  };
                  const proposalOpen = expandedDealId === d.id;
                  const workers      = workersById[d.id] ?? [];
                  const isLoadingW   = !!loadingWorkers[d.id];
                  const canViewCorp     = d.status === 'corp_committed';
                  const canConfirmClose = IN_FIELD.has(d.status);
                  const fresh = canViewCorp && isRecent(d.created_at);
                  // Pre-approve = amber ("action needed, good news");
                  // post-approve = emerald ("approved, in motion").
                  const rowRing = canViewCorp
                    ? 'border-amber-400 bg-amber-50/70 ring-2 ring-amber-100'
                    : canConfirmClose
                      ? 'border-emerald-400 bg-emerald-50/70 ring-2 ring-emerald-100'
                      : 'border-slate-200';
                  return (
                    <div key={d.id}
                         className={`rounded-lg border overflow-hidden ${rowRing}`}>
                      <button
                        type="button"
                        onClick={() => onToggleDeal(d.id)}
                        aria-expanded={proposalOpen}
                        className="w-full text-start px-3 py-2.5 hover:bg-slate-50/50 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 text-sm">{corpLabel}</span>
                            {corpSuffix && (
                              <span className="text-sm text-emerald-700 font-semibold">{corpSuffix}</span>
                            )}
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${pill.cls}`}>
                              {pill.label}
                            </span>
                            {fresh && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">
                                חדש
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 inline-flex items-center gap-1.5">
                            <span>{timeAgo(d.created_at)}</span>
                            {/* For pre-approve only, surface the
                                pending worker count under the
                                anonymous label so the contractor
                                sees scale before clicking the
                                reveal button. */}
                            {!revealed && d.worker_count != null && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span><span className="font-bold text-slate-700">{d.worker_count}</span> עובדים</span>
                              </>
                            )}
                          </p>
                        </div>
                        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 shrink-0 transition-transform ${proposalOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {proposalOpen && (
                        <div className="px-3 pb-3 pt-1 bg-slate-50 border-t border-slate-100 space-y-2">
                          {/* Inline corp contact panel — only after
                              contractor has approved the deal (status
                              accepted/active/reporting/closed). */}
                          {REVEALED.includes(d.status) && (
                            <CorpContactPanel
                              corp={corpById[d.id]}
                              loading={!!loadingCorp[d.id] && !corpById[d.id]}
                            />
                          )}

                          {/* Workers list (aggregated by origin) */}
                          {isLoadingW ? (
                            <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> טוען רשימת עובדים…
                            </div>
                          ) : workers.length === 0 ? (
                            <p className="py-2 text-xs text-slate-500">אין עובדים זמינים להצגה.</p>
                          ) : (
                            <ul className="bg-white rounded-md border border-slate-200 divide-y divide-slate-100">
                              {aggregateByOrigin(workers).map((agg) => (
                                <li key={agg.country} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm">
                                  <div className="min-w-0 flex items-baseline gap-2">
                                    <span className="font-bold text-slate-900">{agg.count}</span>
                                    <span className="text-slate-800">{agg.country}</span>
                                  </div>
                                  {agg.experiences.length > 0 && (
                                    <span className="text-xs text-slate-500 truncate">
                                      ניסיון {agg.experiences.join(', ')}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}

                          {/* Inline chat — locked banner until the
                              contractor has approved, then full thread.
                              Cancelled / rejected deals don't get chat. */}
                          {REVEALED.includes(d.status) ? (
                            <DealChat dealId={d.id} />
                          ) : canViewCorp ? (
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 flex items-center gap-2 text-xs text-slate-600">
                              <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              <span>הצ׳אט יפתח לאחר לחיצה על <strong>לחשיפת פרטי תאגיד</strong></span>
                            </div>
                          ) : null}

                          {actionError[d.id] && (
                            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
                              {actionError[d.id]}
                            </p>
                          )}

                          {/* Action area per stage:
                              · canViewCorp (corp_committed) → green
                                "לחשיפת פרטי תאגיד" button → approve()
                              · canConfirmClose (accepted/active/
                                reporting) → "האם נסגרה עסקה?" prompt
                              · other states → nothing extra */}
                          {canConfirmClose ? (
                            <div className="rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2.5 space-y-2">
                              <p className="text-sm font-bold text-violet-900 text-center">
                                האם נסגרה עסקה?
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="flex-1 h-9 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                                  onClick={() => onConfirmClose(d.id)}
                                  disabled={actingId === d.id}
                                >
                                  {actingId === d.id
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <><CheckCircle2 className="h-4 w-4" /> כן, נסגרה</>}
                                </Button>
                                <Button
                                  asChild
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-9 text-sm border-rose-300 text-rose-700 hover:bg-rose-50 font-bold"
                                >
                                  <Link href={`/contractor/deals/${d.id}?action=decline`}>
                                    <XCircle className="h-4 w-4" /> לא נסגרה
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          ) : canViewCorp ? (
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                className="h-9 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm shadow-emerald-200"
                                onClick={() => onApprove(d.id)}
                                disabled={actingId === d.id}
                              >
                                {actingId === d.id
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : <>לחשיפת פרטי תאגיד <ArrowLeft className="h-4 w-4" /></>}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}

          {/* Card-wide green CTA for stage 2 — fastest path to the
              corp the contractor should call. The per-row buttons
              still exist for multi-corp situations where the
              contractor wants to pick a specific corp. */}
          {state === 'awaiting' && (
            <Button asChild className="w-full mt-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm shadow-emerald-200">
              <Link href={`/contractor/deals/${group.find((d) => d.status === 'corp_committed')?.id}`}>
                לחשיפת פרטי תאגיד
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          )}
          {/* Stage 3 doesn't need a card-wide CTA — the per-row
              "האם נסגרה עסקה?" question is exact enough. */}

          {/* Close-other-bids prompt. Visible only when the quantity
              is fully filled by deals the contractor has already
              approved AND there are still pending corps. One click
              withdraws every other proposed / corp_committed deal
              for this search so the corps can release their workers
              and credit. */}
          {showCancelOthers && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2.5 space-y-2">
              <p className="text-xs text-rose-900 leading-snug">
                <span className="font-bold">הדרישה מולאה</span> — {cancellableOthers.length === 1
                  ? 'נשארה הצעה אחת ממתינה'
                  : `נשארו ${cancellableOthers.length} הצעות ממתינות`} שכבר אינן רלוונטיות.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-xs border-rose-300 text-rose-700 hover:bg-rose-100 font-bold"
                onClick={() => setConfirmCancelOthersOpen(true)}
                disabled={cancellingOthers}
              >
                {cancellingOthers
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <><XCircle className="h-3.5 w-3.5" /> סגור שאר ההצעות</>}
              </Button>
              <ConfirmDialog
                open={confirmCancelOthersOpen}
                title="סגירת שאר ההצעות"
                message="הפעולה תשחרר לתאגידים האחרים את העובדים. האם להמשיך?"
                confirmLabel="סגור הצעות"
                cancelLabel="ביטול"
                variant="destructive"
                onConfirm={() => {
                  setConfirmCancelOthersOpen(false);
                  onCancelOthers(cancellableOthers.map((d) => d.id));
                }}
                onCancel={() => setConfirmCancelOthersOpen(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CorpContactPanel ───────────────────────────────────────────
// Inline reveal of the corporation's real identity + contact
// channels, shown on a deal row's expand once the contractor has
// approved (status accepted/active/reporting/closed).

function CorpContactPanel({ corp, loading }: { corp?: Corporation; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-3 flex items-center gap-2 text-sm text-emerald-800">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        טוען פרטי תאגיד…
      </div>
    );
  }
  if (!corp) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        פרטי תאגיד לא זמינים כרגע. נסה לרענן את העמוד.
      </div>
    );
  }
  const name = corp.company_name_he || corp.company_name || '—';
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-emerald-700 shrink-0" />
        <span className="text-sm font-bold text-slate-900">{name}</span>
      </div>
      {corp.contact_name && (
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <Users className="h-3.5 w-3.5 text-emerald-700/70 shrink-0" />
          <span>{corp.contact_name}</span>
        </div>
      )}
      {corp.contact_phone && (
        <div className="flex items-center gap-2 text-sm">
          <Phone className="h-3.5 w-3.5 text-emerald-700/70 shrink-0" />
          <a href={`tel:${corp.contact_phone}`} dir="ltr"
             className="font-semibold text-emerald-800 hover:underline">
            {corp.contact_phone}
          </a>
        </div>
      )}
      {corp.contact_email && (
        <div className="flex items-center gap-2 text-sm">
          <Mail className="h-3.5 w-3.5 text-emerald-700/70 shrink-0" />
          <a href={`mailto:${corp.contact_email}`} dir="ltr"
             className="text-emerald-800 hover:underline truncate">
            {corp.contact_email}
          </a>
        </div>
      )}
    </div>
  );
}

// ── DealChat ───────────────────────────────────────────────────
// Inline message thread between contractor and corp for a given
// deal. Lazy-loads on mount, polls every 10s for incoming corp
// messages, and exposes a tiny send box. Mounts ONLY when the
// caller decides chat is allowed (post-approval); otherwise the
// caller renders the locked banner instead.

function DealChat({ dealId }: { dealId: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loading, setLoading]   = useState(true);
  const [draft, setDraft]       = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load once + poll every 10s while mounted.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function fetchOnce() {
      try {
        const ms = await dealApi.messages(dealId);
        if (!cancelled) setMessages(ms);
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchOnce();
    timer = setInterval(fetchOnce, 10_000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [dealId]);

  // Auto-scroll to the latest message on update.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await dealApi.sendMsg(dealId, content);
      setMessages((prev) => [...(prev ?? []), msg]);
      setDraft('');
    } catch (e) {
      setError((e as Error).message || 'שגיאה בשליחת ההודעה');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-100 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3" />
          צ׳אט עם התאגיד
        </span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
      </div>

      <div ref={scrollRef} className="max-h-[240px] overflow-y-auto px-3 py-2 space-y-2 bg-slate-50/40">
        {messages === null || (loading && (messages?.length ?? 0) === 0) ? (
          <p className="text-xs text-slate-400 text-center py-4">טוען…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">אין הודעות עדיין — שלח את ההודעה הראשונה.</p>
        ) : (
          messages.map((m) => {
            const isMine    = m.sender_role === 'contractor';
            const isSystem  = m.content_type === 'system' || m.sender_role === 'admin';
            const time      = new Date(m.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
            if (isSystem) {
              return (
                <div key={m.id} className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-1 text-center">
                  {m.content}
                </div>
              );
            }
            return (
              <div key={m.id} className={`flex flex-col gap-0.5 ${isMine ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-1.5 text-sm whitespace-pre-line ${
                  isMine ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-800'
                }`}>
                  {m.content}
                </div>
                <span className="text-[10px] text-slate-400">{time}</span>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p className="px-3 py-1 text-[11px] text-rose-600 bg-rose-50 border-t border-rose-100">{error}</p>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        className="flex items-center gap-2 px-2.5 py-2 border-t border-slate-100"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="כתוב הודעה…"
          className="flex-1 text-sm rounded-md border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          maxLength={1000}
        />
        <Button
          type="submit"
          size="sm"
          className="h-8 px-3 text-xs bg-brand-600 hover:bg-brand-700 text-white"
          disabled={sending || !draft.trim()}
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </form>
    </div>
  );
}

function CentreBlurb({ state, awaitingN, proposedN, inFieldN, corpsTotal, oldestProposedAt }: {
  state:             CardState;
  awaitingN:         number; // corps in corp_committed
  proposedN:         number; // corps still in proposed/counter_proposed
  inFieldN:          number; // corps in accepted/active/reporting
  corpsTotal:        number; // total corps reached
  oldestProposedAt?: string | null; // earliest created_at of a still-proposed deal
}) {
  // Centre-circle countdown lives at the call site (replaces the
  // icon visually) — here we just describe what the contractor
  // is looking at + handle the expired-state copy switch.
  const expired = !!oldestProposedAt
    && (new Date(oldestProposedAt).getTime() + CORP_RESPONSE_HOURS * 3_600_000) <= Date.now();

  switch (state) {
    // Stage 1 — corps notified, none has committed workers yet.
    case 'proposed':
      return expired ? (
        <div className="space-y-1">
          <p className="text-base font-bold text-slate-700">
            {corpsTotal === 1 ? 'תאגיד אחד' : `${corpsTotal} תאגידים`} עברו את חלון התגובה
          </p>
          <p className="text-xs text-slate-500">לא התקבל מענה — נטפל בזה</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-base font-bold text-slate-900">
            {corpsTotal === 1 ? 'נמצא תאגיד מתאים' : `נמצאו ${corpsTotal} תאגידים מתאימים`}
          </p>
          <p className="text-xs text-slate-500">תאגיד יענה בתוך חלון הזמן הבא</p>
        </div>
      );
    // Stage 2 — at least one corp committed workers, contractor's turn.
    case 'awaiting':
      return (
        <div className="space-y-1">
          <p className="text-base font-extrabold text-amber-700">
            {awaitingN === 1 ? 'תאגיד אחד ממתין לפנייתך' : `${awaitingN} תאגידים ממתינים לפנייתך`}
          </p>
          <p className="text-xs text-amber-600 font-semibold">לחץ &quot;לחשיפת פרטי תאגיד&quot; ליד התאגיד</p>
        </div>
      );
    // Stage 3 — contractor approved engagement; corp details
    // revealed; report whether the deal actually closed.
    case 'toClose':
      return (
        <div className="space-y-1">
          <p className="text-base font-extrabold text-emerald-700">
            {corpsTotal === 1 ? 'נמצא תאגיד מתאים' : `נמצאו ${corpsTotal} תאגידים מתאימים`}
          </p>
          <p className="text-xs text-emerald-600 font-semibold">פרטי התקשרות נחשפו · עדכן כשנסגרה עסקה</p>
        </div>
      );
    case 'searching':
      return (
        <div className="space-y-1">
          <p className="text-base font-bold text-slate-900">מחפשים עובדים</p>
          <p className="text-xs text-slate-500">נעדכן אותך ברגע שתימצא התאמה</p>
        </div>
      );
    case 'noMatch':
      return (
        <div className="space-y-1.5">
          <p className="text-base font-bold text-slate-800">לא נמצאו התאמות זמינות</p>
          <p className="text-xs text-slate-600">המערכת ממשיכה לחפש עבורך עובדים</p>
          <p className="text-[11px] text-slate-500 leading-snug">
            תקבל עדכון למספר הרשום אצלינו ברגע שתימצא התאמה
          </p>
        </div>
      );
    case 'closed':
      return <p className="text-base font-bold text-emerald-700">העסקה נסגרה</p>;
    case 'cancelled':
      return <p className="text-base font-bold text-rose-600">העסקה בוטלה</p>;
  }
  void proposedN;
}

// ── Page ───────────────────────────────────────────────────────

export default function ContractorDealsPage() {
  const searchParams = useSearchParams();
  const initialFilter = (() => {
    const f = searchParams?.get('filter');
    return f && (CONTRACTOR_FILTERS as string[]).includes(f) ? (f as Filter) : 'all';
  })();
  const [deals, setDeals]                   = useState<EnrichedDeal[]>([]);
  const [searches, setSearches]             = useState<WorkerSearch[]>([]);
  const [profMap, setProfMap]               = useState<Record<string, string>>({});
  const [regionMap, setRegionMap]           = useState<Record<string, string>>({});
  const [originMap, setOriginMap]           = useState<Record<string, string>>({});
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(false);
  const [filter, setFilter]                 = useState<Filter>(initialFilter);
  const [query, setQuery]                   = useState('');
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);
  const [workersById, setWorkersById]       = useState<Record<string, Worker[]>>({});
  const [loadingWorkers, setLoadingWorkers] = useState<Record<string, boolean>>({});
  const [actingId, setActingId]             = useState<string | null>(null);
  const [actionError, setActionError]       = useState<Record<string, string>>({});

  function reload() {
    setLoading(true); setError(false);
    Promise.all([
      dealApi.list({ page_size: 200 }).then((r) => setDeals(r.items as EnrichedDeal[])),
      searchApi.list().then(setSearches),
    ])
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, []);

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

  async function toggleDealExpand(dealId: string) {
    if (expandedDealId === dealId) { setExpandedDealId(null); return; }
    setExpandedDealId(dealId);
    if (workersById[dealId]) return;
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
    } finally { setActingId(null); }
  }
  async function handleReject(dealId: string) {
    setActingId(dealId);
    setActionError((s) => ({ ...s, [dealId]: '' }));
    try {
      await dealApi.reject(dealId);
      reload();
    } catch (e) {
      setActionError((s) => ({ ...s, [dealId]: (e as Error).message || 'שגיאה בדחייה' }));
    } finally { setActingId(null); }
  }
  // Close-the-loop step: contractor confirms the deal actually
  // happened (status accepted/active/reporting → closed).
  async function handleConfirmClose(dealId: string) {
    setActingId(dealId);
    setActionError((s) => ({ ...s, [dealId]: '' }));
    try {
      await dealApi.contractorConfirmClosed(dealId);
      reload();
    } catch (e) {
      setActionError((s) => ({ ...s, [dealId]: (e as Error).message || 'שגיאה בסגירת העסקה' }));
    } finally { setActingId(null); }
  }
  // "סגור שאר ההצעות" — withdraw every pending bid for a search
  // once the requested quantity has been fulfilled by another corp.
  // Runs all cancels in parallel, single reload at the end.
  const [cancellingSearchId, setCancellingSearchId] = useState<string | null>(null);
  async function handleCancelOthers(searchId: string, dealIds: string[]) {
    setCancellingSearchId(searchId);
    try {
      await Promise.allSettled(
        dealIds.map((id) => dealApi.contractorCancel(id, 'התקבלה הצעה אחרת')),
      );
      reload();
    } finally { setCancellingSearchId(null); }
  }

  // Delete-search (cascade) — option 1(b): also fan out
  // contractor-cancel to every proposed / corp_committed deal on
  // this search so corps release workers + credit, then mark the
  // search itself as cancelled. Gated upstream by option 2(c):
  // the card's kebab disables this when any deal is already
  // accepted/active/reporting (the contractor must finish/withdraw
  // those individually first).
  const [deletingSearchId, setDeletingSearchId] = useState<string | null>(null);
  async function handleDeleteSearch(searchId: string, dealIds: string[]) {
    setDeletingSearchId(searchId);
    try {
      if (dealIds.length > 0) {
        await Promise.allSettled(
          dealIds.map((id) => dealApi.contractorCancel(id, 'הבקשה נמחקה ע״י הקבלן')),
        );
      }
      await searchApi.cancel(searchId);
      reload();
    } finally { setDeletingSearchId(null); }
  }

  // Count per filter pill — totals come from the deals list,
  // except "הכל" which counts unique searches (one card each).
  const counts = useMemo(() => {
    const out: Record<Filter, number> = {
      all: 0, awaiting_approval: 0, proposed: 0, active: 0, completed: 0, cancelled: 0,
    };
    out.all = searches.length;
    for (const d of deals) {
      if (contractorMatchesFilter(d.status, 'awaiting_approval')) out.awaiting_approval++;
      else if (contractorMatchesFilter(d.status, 'proposed'))     out.proposed++;
      else if (contractorMatchesFilter(d.status, 'completed'))    out.completed++;
      else if (contractorMatchesFilter(d.status, 'cancelled'))    out.cancelled++;
    }
    // Cancelled searches (deleted by the contractor) also live
    // under the "בוטל" pill — count them too.
    out.cancelled += searches.filter((s) => s.status === 'cancelled').length;
    return out;
  }, [deals, searches]);

  // Compose the card list: one card per search, with its deals.
  const cards = useMemo(() => {
    const bySearch = deals.reduce<Record<string, EnrichedDeal[]>>((acc, d) => {
      const k = d.search_id || d.id;
      (acc[k] = acc[k] || []).push(d);
      return acc;
    }, {});
    return searches.map((s) => ({
      searchId: s.id,
      search:   s,
      deals:    bySearch[s.id] || [],
    }));
  }, [deals, searches]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter !== 'all') {
        const dealMatches   = c.deals.some((d) => contractorMatchesFilter(d.status, filter));
        // A search the contractor deleted (search.status='cancelled')
        // surfaces under the "בוטל" pill alongside cancelled deals.
        const searchMatches = filter === 'cancelled' && c.search?.status === 'cancelled';
        if (!dealMatches && !searchMatches) return false;
      }
      if (q) {
        const profLabel = c.deals[0]?.profession_he
                       ?? profMap[c.search?.profession_type ?? ''] ?? '';
        const region = c.deals[0]?.region_he
                    ?? regionMap[c.search?.region ?? ''] ?? '';
        const origins = (c.search?.origin_preference ?? []).map((o) => originMap[o] ?? o).join(' ');
        const hay = `${profLabel} ${region} ${origins}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, filter, query, profMap, regionMap, originMap]);

  const sorted = useMemo(() => {
    const ts = (c: typeof visible[number]) => {
      const fromDeals = c.deals.length > 0
        ? Math.max(...c.deals.map((d) => parseUtcMs(d.created_at)))
        : 0;
      const fromSearch = c.search?.created_at ? parseUtcMs(c.search.created_at) : 0;
      return Math.max(fromDeals, fromSearch);
    };
    return [...visible].sort((a, b) => {
      const pa = CARD_STATE_PRIORITY[classifyCard(a.deals, a.search)];
      const pb = CARD_STATE_PRIORITY[classifyCard(b.deals, b.search)];
      if (pa !== pb) return pa - pb;
      return ts(b) - ts(a);
    });
  }, [visible]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">עסקאות</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            כל הפניות שלך לתאגידים — ההצעות מוצגות לצד כל בקשה
          </p>
        </div>
        <Button asChild size="lg" className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-900 font-bold shadow-lg shadow-amber-500/20">
          <Link href="/contractor/find">
            <Plus className="h-5 w-5" />
            פתח בקשת עובדים חדשה
          </Link>
        </Button>
      </header>

      {/* Filter row — coloured count pills + search input */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {CONTRACTOR_FILTERS.map((f) => {
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
                <span>{DEAL_FILTER_LABEL[f]}</span>
              </button>
            );
          })}
        </div>

        <div className="relative sm:w-72">
          <Search className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש מקצוע, אזור, מוצא"
            className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 bg-white"
          />
        </div>
      </div>

      {error && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <AlertCircle className="h-10 w-10 text-rose-400" />
          <p className="text-slate-700 font-medium">לא ניתן לטעון את העסקאות</p>
          <p className="text-slate-400 text-sm">בדוק את החיבור לאינטרנט ונסה שוב</p>
          <Button variant="outline" size="sm" onClick={reload}>נסה שוב</Button>
        </div>
      )}

      {loading && !error && (
        <div className="space-y-3">
          <DealTileSkeleton /><DealTileSkeleton /><DealTileSkeleton />
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <Handshake className="h-10 w-10 text-slate-200" />
          <p className="text-slate-600 font-medium">
            {filter === 'all' && !query ? 'עדיין אין בקשות' : 'אין עסקאות בקטגוריה זו'}
          </p>
          {filter === 'all' && !query && (
            <>
              <p className="text-slate-400 text-sm">פתח בקשת עובדים חדשה כדי להתחיל</p>
              <Button asChild variant="outline" size="sm">
                <Link href="/contractor/find">+ פתח בקשת עובדים חדשה</Link>
              </Button>
            </>
          )}
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="space-y-3">
          {sorted.map((card) => (
            <DealCard
              key={card.searchId}
              card={card}
              profMap={profMap}
              regionMap={regionMap}
              originMap={originMap}
              workersById={workersById}
              loadingWorkers={loadingWorkers}
              expandedDealId={expandedDealId}
              onToggleDeal={toggleDealExpand}
              actingId={actingId}
              actionError={actionError}
              onApprove={handleApprove}
              onReject={handleReject}
              onConfirmClose={handleConfirmClose}
              onCancelOthers={(ids) => handleCancelOthers(card.searchId, ids)}
              cancellingOthers={cancellingSearchId === card.searchId}
              onDeleteSearch={(ids) => handleDeleteSearch(card.searchId, ids)}
              deletingSearch={deletingSearchId === card.searchId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
