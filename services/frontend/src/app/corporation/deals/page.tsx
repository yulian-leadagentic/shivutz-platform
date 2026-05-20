'use client';

// Wave 4 polish — corp-side deals rendered as a tile grid (was a
// dense table). Each tile is the corp's view of one inquiry: which
// profession, how many workers requested vs offered, status badge,
// region, date, and a CTA whose copy depends on whether the corp
// still owes a response (אשר / דחה) or it's already in progress (פרטים).

import { useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Loader2, Calendar, MapPin, Users as UsersIcon,
  AlertCircle, Handshake, MessageSquare, CheckCircle2, XCircle, Bell,
} from 'lucide-react';
import { dealApi } from '@/lib/api';
import { dealRef } from '@/lib/utils';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal } from '@/types';
import { Button } from '@/components/ui/button';
import { DEAL_STATUS_GROUP, type DealFilter } from '@/i18n/he';
import { CorpResponseCountdown } from '@/components/CorpResponseCountdown';

// Mirrors CORP_RESPONSE_HOURS on the contractor page. Server-side
// uses the DB setting; this constant matches the migration default.
const CORP_RESPONSE_HOURS = 48;

// Corp side uses a tighter, locally-owned filter set. The shared
// DealFilter is a superset that also covers contractor-side
// awaiting/cancelled buckets — corp doesn't surface those as pills.
type Filter = Extract<DealFilter, 'all' | 'proposed' | 'active' | 'completed'>;

// Filter labels. "proposed" = corp owes a response (the urgent
// bucket the corp must work first). "active" = corp committed,
// contractor's turn (passive wait). Keep wording local because
// it's semantically different from the shared/contractor copy.
const FILTER_LABELS: Record<Filter, string> = {
  all:       'הכל',
  proposed:  'ממתינות לאישורך',
  active:    'בעבודה',
  completed: 'הושלמו',
};

// Each filter gets its own colour so the bar reads as five
// distinct chips, not five identical buttons. Mirrors the
// contractor-side tone palette but with semantics for the
// corp's perspective:
//   proposed  = AMBER (your turn, act now)
//   active    = SKY   (passive — waiting on contractor)
//   completed = EMERALD (done)
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
};

const STATUS_CONTEXT: Record<string, string> = {
  proposed:          'נשלחה אליך — דרושה החלטה',
  corp_committed:    'הצעת עובדים נשלחה לקבלן',
  approved:          'אושר ע״י הקבלן — עובדים בשטח',
  active:            'בעבודה',
  reporting:         'מדווח',
  closed:            'הושלמה',
  completed:         'הושלמה',
  rejected:          'נדחתה',
  cancelled_by_corp: 'בוטלה על ידך',
  cancelled_by_contractor: 'בוטל ע״י הקבלן',
  expired:           'פג תוקף',
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
// the deals where they owe a response.
const CARD_RING: Record<CorpCardState, string> = {
  actionNeeded: 'border-amber-400 ring-2 ring-amber-100',
  committed:    'border-sky-300 ring-1 ring-sky-100',
  engaged:      'border-emerald-400 ring-2 ring-emerald-100',
  closed:       'border-slate-200',
  cancelled:    'border-slate-200 opacity-80',
  unknown:      'border-slate-200',
};

const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  proposed:                { cls: 'bg-amber-500 text-white border-amber-500',                 label: 'דרושה החלטה' },
  counter_proposed:        { cls: 'bg-amber-100 text-amber-800 border-amber-300',             label: 'הצעה נגדית' },
  corp_committed:          { cls: 'bg-sky-100 text-sky-800 border-sky-200',                   label: 'נשלחה לקבלן' },
  approved:                { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'אושר' },
  accepted:                { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'אושר' },
  active:                  { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'פעיל' },
  reporting:               { cls: 'bg-emerald-500 text-white border-emerald-500',             label: 'מדווח' },
  closed:                  { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',        label: 'נסגרה' },
  completed:               { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',        label: 'הושלמה' },
  rejected:                { cls: 'bg-rose-50 text-rose-700 border-rose-200',                 label: 'נדחתה' },
  cancelled_by_corp:       { cls: 'bg-rose-50 text-rose-700 border-rose-200',                 label: 'בוטלה על ידך' },
  cancelled_by_contractor: { cls: 'bg-rose-50 text-rose-700 border-rose-200',                 label: 'בוטל ע״י קבלן' },
  cancelled:               { cls: 'bg-rose-50 text-rose-700 border-rose-200',                 label: 'בוטלה' },
  expired:                 { cls: 'bg-slate-100 text-slate-500 border-slate-200',             label: 'פג תוקף' },
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

function CorporationDealsPageContent() {
  const searchParams = useSearchParams();
  const urlFilter    = searchParams.get('filter') as Filter | null;

  const [deals, setDeals]     = useState<EnrichedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [filter, setFilter]   = useState<Filter>(
    urlFilter && Object.keys(FILTER_LABELS).includes(urlFilter) ? urlFilter : 'all'
  );

  function reload() {
    setLoading(true); setError(false);
    dealApi.list({ page_size: 200 })
      .then((res) => setDeals(res.items as EnrichedDeal[]))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, []);

  // Corp-side "proposed" is stricter than the shared grouping — only deals
  // still awaiting the corp's initial response.
  const filtered = deals.filter((d) => {
    if (filter === 'all')      return true;
    if (filter === 'proposed') return d.status === 'proposed';
    const group = DEAL_STATUS_GROUP[filter as Exclude<DealFilter, 'all'>];
    return group ? group.includes(d.status) : false;
  });
  // Sort: proposed deals first, ordered by oldest created_at (so
  // the corp deals with the smallest time-remaining are at the top
  // and they handle the most-urgent contractor requests first).
  // Non-proposed deals keep their natural reverse-chrono order.
  const sortedFiltered = [...filtered].sort((a, b) => {
    const aIsProposed = a.status === 'proposed';
    const bIsProposed = b.status === 'proposed';
    if (aIsProposed && !bIsProposed) return -1;
    if (!aIsProposed && bIsProposed) return 1;
    if (aIsProposed && bIsProposed) {
      // Older first → smaller remaining time first.
      return parseUtcMs(a.created_at) - parseUtcMs(b.created_at);
    }
    return parseUtcMs(b.created_at) - parseUtcMs(a.created_at);
  });
  const pendingCount = deals.filter((d) => d.status === 'proposed').length;

  // Per-filter counts for the pill badges.
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: 0, proposed: 0, active: 0, completed: 0 };
    out.all = deals.length;
    for (const d of deals) {
      if (d.status === 'proposed') out.proposed++;
      else if (DEAL_STATUS_GROUP.active.includes(d.status))    out.active++;
      else if (DEAL_STATUS_GROUP.completed.includes(d.status)) out.completed++;
    }
    return out;
  }, [deals]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">עסקאות</h1>
          {pendingCount > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-1 rounded-full">
              {pendingCount} ממתינות לאישור
            </span>
          )}
        </div>
      </header>

      {/* Filter pills — coloured per category with count badges.
          Mirrors the contractor-side design so the corp sees the
          same "five distinct chips" layout. */}
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
      {!loading && !error && sortedFiltered.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 py-12 text-center px-4">
          <Handshake className="h-10 w-10 text-slate-200" />
          <p className="text-slate-600 font-medium">
            {filter === 'all' ? 'עדיין אין עסקאות' : 'אין עסקאות בקטגוריה זו'}
          </p>
          {filter === 'all' && (
            <p className="text-slate-400 text-sm">
              קבלנים יוכלו לפנות אליך מתוך תוצאות החיפוש שלהם
            </p>
          )}
        </div>
      )}

      {/* 3-column horizontal cards — same layout the contractor
          /deals page uses. One card per row, full-width:
            Right  (4)  meta — profession + workers + dates + region + status pill
            Centre (4)  illustration / countdown for proposed
            Left   (4)  action area — CTA button + deal ref
          sortedFiltered puts proposed cards at the top, ordered
          by oldest created_at (smallest time remaining first). */}
      {!loading && !error && sortedFiltered.length > 0 && (
        <div className="space-y-3">
          {sortedFiltered.map((d) => {
            const profCode  = d.profession_type ?? '';
            const profLabel = d.profession_he ?? d.profession_type ?? '—';
            const offered   = d.worker_count ?? 0;
            const requested = d.requested_count ?? 0;
            const cardState = classifyCorpDeal(d.status);
            const isPending = cardState === 'actionNeeded';
            const pill      = STATUS_PILL[d.status] ?? {
              cls: 'bg-slate-100 text-slate-700 border-slate-200',
              label: d.status,
            };
            // Countdown state for the centre column on proposed
            // cards — corp can still respond after the window
            // (the cron just notifies admin), so the post-zero copy
            // softens to "החלון נסגר — חשוב לענות בהקדם" instead
            // of the harsher "exceeded" wording.
            const remainingMs   = parseUtcMs(d.created_at) + CORP_RESPONSE_HOURS * 3_600_000 - Date.now();
            const stillInWindow = remainingMs > 0;
            const isFresh       = isPending && Date.now() - parseUtcMs(d.created_at) < 12 * 60 * 60 * 1000;
            return (
              <Link
                key={d.id}
                href={`/corporation/deals/${d.id}`}
                className={`group relative block rounded-2xl bg-white shadow-sm
                            hover:shadow-md transition border-2 overflow-hidden ${CARD_RING[cardState]}`}
              >
                {/* "חדש" badge — sits above the card top edge */}
                {isFresh && (
                  <span className="absolute -top-2 end-4 inline-flex items-center gap-1
                                  bg-rose-500 text-white text-[10px] font-bold
                                  uppercase tracking-wide px-2 py-0.5 rounded-full
                                  shadow-sm z-10">
                    <Bell className="w-3 h-3" /> חדש
                  </span>
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

                  {/* ── Centre column: countdown for proposed, state
                       illustration otherwise ── */}
                  <div className="md:col-span-4 p-4 sm:p-5 flex flex-col items-center justify-center gap-3 text-center bg-slate-50/40 md:border-s md:border-e md:border-slate-100 border-t md:border-t-0">
                    {isPending ? (
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
                    ) : (
                      <>
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                          cardState === 'committed'   ? 'bg-sky-100 text-sky-700'
                          : cardState === 'engaged'   ? 'bg-emerald-500 text-white'
                          : cardState === 'closed'    ? 'bg-emerald-50 text-emerald-600'
                          : cardState === 'cancelled' ? 'bg-rose-50 text-rose-500'
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
                          : cardState === 'cancelled' ? 'text-rose-600'
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
                      isPending                    ? 'bg-amber-500 text-white group-hover:bg-amber-600'
                      : cardState === 'engaged'    ? 'bg-emerald-500 text-white group-hover:bg-emerald-600'
                      : cardState === 'committed'  ? 'bg-sky-100 text-sky-800 border border-sky-200 group-hover:bg-sky-200'
                      : cardState === 'cancelled'  ? 'bg-slate-100 text-slate-600 border border-slate-200 group-hover:bg-slate-200'
                                                   : 'bg-white text-slate-700 border border-slate-300 group-hover:bg-slate-50'
                    }`}>
                      {isPending                   ? <><AlertCircle className="w-4 h-4" /> אשר / דחה</>
                       : cardState === 'engaged'   ? <><CheckCircle2 className="w-4 h-4" /> פרטים וצ׳אט</>
                       : cardState === 'committed' ? <><MessageSquare className="w-4 h-4" /> ממתין לקבלן</>
                       : cardState === 'cancelled' ? <><XCircle className="w-4 h-4" /> פרטי העסקה</>
                                                   : <><MessageSquare className="w-4 h-4" /> פרטים וצ׳אט</>}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
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
