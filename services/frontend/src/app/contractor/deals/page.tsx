'use client';

// /contractor/deals — unified list of every worker-search the
// contractor has opened plus the corp proposals (deals) attached
// to each. One card per search, rendered in 3 columns:
//   meta · centred state illustration · inline corp list
// The corp list is visible by default (no click-to-expand at
// the card level) so a contractor can scan "where is each
// request" in one pass.

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle, Handshake, MessageSquare, Calendar, MapPin, Globe2,
  Plus, ChevronDown, Loader2, CheckCircle2, XCircle, Bell,
  Search, ArrowLeft, Hammer, Sparkles, Users,
} from 'lucide-react';
import { dealApi, searchApi } from '@/lib/api';
import { enumApi } from '@/lib/api/enums';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal, Worker, WorkerSearch, Profession } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DEAL_FILTER_LABEL,
  heOrigin,
  type DealFilter as Filter,
} from '@/i18n/he';

// ── Helpers ────────────────────────────────────────────────────

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

// ISO 3166-1 alpha-2 → flag emoji. Works for every uppercase
// 2-letter code via Unicode regional indicators.
function flagEmoji(code?: string): string {
  if (!code || code.length !== 2) return '';
  const a = code.toUpperCase().charCodeAt(0);
  const b = code.toUpperCase().charCodeAt(1);
  if (a < 65 || a > 90 || b < 65 || b > 90) return '';
  return String.fromCodePoint(0x1F1E6 + a - 65, 0x1F1E6 + b - 65);
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
  completed:         ['accepted', 'active', 'reporting', 'completed', 'closed'],
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

type CardState =
  | 'awaiting'   // any corp_committed — action required
  | 'proposed'   // proposed/counter_proposed only
  | 'matching'   // no deals + match_cache positive
  | 'searching'  // no deals + no match yet
  | 'inField'    // accepted/active/reporting
  | 'closed'     // all closed/completed
  | 'cancelled'; // all cancelled/rejected/expired

const CARD_STATE_PRIORITY: Record<CardState, number> = {
  awaiting: 0, proposed: 1, matching: 2, searching: 3, inField: 4, closed: 5, cancelled: 6,
};

const ACTION_REQUIRED = new Set(['corp_committed']);
const PROPOSED        = new Set(['proposed', 'counter_proposed']);
const IN_FIELD        = new Set(['accepted', 'active', 'reporting']);
const CLOSED          = new Set(['completed', 'closed']);
const CANCELLED_S     = new Set(['cancelled', 'cancelled_by_corp', 'cancelled_by_contractor', 'rejected', 'expired', 'disputed']);

function classifyCard(deals: EnrichedDeal[], search?: WorkerSearch): CardState {
  if (deals.some((d) => ACTION_REQUIRED.has(d.status))) return 'awaiting';
  if (deals.some((d) => PROPOSED.has(d.status)))        return 'proposed';
  if (deals.length === 0) {
    return (search?.best_fill_pct ?? -1) > 0 ? 'matching' : 'searching';
  }
  if (deals.some((d) => IN_FIELD.has(d.status))) return 'inField';
  if (deals.every((d) => CLOSED.has(d.status))) return 'closed';
  if (deals.every((d) => CANCELLED_S.has(d.status))) return 'cancelled';
  return 'proposed';
}

interface StateMeta {
  badge:    string;
  badgeCls: string;
  illoCls:  string;
  IlloIcon: typeof Bell;
  cardRing: string;
}

const STATE_META: Record<CardState, StateMeta> = {
  awaiting:  {
    badge: 'ממתין לאישורך',  badgeCls: 'bg-amber-100 text-amber-800',
    illoCls: 'bg-amber-100 text-amber-700', IlloIcon: Bell,
    cardRing: 'border-amber-200 ring-1 ring-amber-100',
  },
  proposed:  {
    badge: 'ממתין לתאגיד',   badgeCls: 'bg-sky-100 text-sky-800',
    illoCls: 'bg-sky-100 text-sky-700', IlloIcon: MessageSquare,
    cardRing: 'border-slate-200',
  },
  matching:  {
    badge: 'בהתאמה',         badgeCls: 'bg-teal-100 text-teal-800',
    illoCls: 'bg-teal-100 text-teal-700', IlloIcon: Sparkles,
    cardRing: 'border-slate-200',
  },
  searching: {
    badge: 'מחפשים תאגידים', badgeCls: 'bg-slate-100 text-slate-700',
    illoCls: 'bg-slate-100 text-slate-600', IlloIcon: Search,
    cardRing: 'border-slate-200',
  },
  inField:   {
    badge: 'בעבודה',         badgeCls: 'bg-emerald-100 text-emerald-800',
    illoCls: 'bg-emerald-100 text-emerald-700', IlloIcon: Hammer,
    cardRing: 'border-slate-200',
  },
  closed:    {
    badge: 'נסגרה',          badgeCls: 'bg-emerald-100 text-emerald-800',
    illoCls: 'bg-emerald-100 text-emerald-700', IlloIcon: CheckCircle2,
    cardRing: 'border-slate-200',
  },
  cancelled: {
    badge: 'בוטל',           badgeCls: 'bg-rose-100 text-rose-700',
    illoCls: 'bg-rose-50 text-rose-500', IlloIcon: XCircle,
    cardRing: 'border-slate-200 opacity-80',
  },
};

// Per-deal compact status pill (inside each corp row).
const DEAL_STATUS_PILL: Record<string, { cls: string; label: string }> = {
  proposed:                { cls: 'bg-sky-50 text-sky-700 border-sky-200',           label: 'הוצע' },
  counter_proposed:        { cls: 'bg-sky-50 text-sky-700 border-sky-200',           label: 'הצעה נגדית' },
  corp_committed:          { cls: 'bg-amber-100 text-amber-800 border-amber-300',    label: 'דרוש אישור' },
  accepted:                { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'אושר' },
  active:                  { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'פעיל' },
  reporting:               { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'מדווח' },
  closed:                  { cls: 'bg-slate-100 text-slate-700 border-slate-200',     label: 'נסגר' },
  completed:               { cls: 'bg-slate-100 text-slate-700 border-slate-200',     label: 'הושלם' },
  rejected:                { cls: 'bg-rose-50 text-rose-700 border-rose-200',         label: 'נדחה' },
  cancelled_by_corp:       { cls: 'bg-rose-50 text-rose-700 border-rose-200',         label: 'בוטל ע״י תאגיד' },
  cancelled_by_contractor: { cls: 'bg-rose-50 text-rose-700 border-rose-200',         label: 'בוטל על ידך' },
  cancelled:               { cls: 'bg-rose-50 text-rose-700 border-rose-200',         label: 'בוטל' },
  expired:                 { cls: 'bg-slate-100 text-slate-500 border-slate-200',     label: 'פג תוקף' },
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
}

function DealCard({
  card, profMap, regionMap, originMap,
  workersById, loadingWorkers, expandedDealId, onToggleDeal,
  actingId, actionError, onApprove, onReject,
}: DealCardProps) {
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
    'accepted', 'active', 'reporting',
  ]);
  const filled  = group.filter((d) => COMMITTED.has(d.status))
                       .reduce((s, d) => s + (d.worker_count ?? 0), 0);
  const fillPct = requested > 0 ? Math.min(100, Math.round((filled / requested) * 100)) : 0;
  const matchPct      = search?.best_fill_pct ?? -1;
  const matchWorkers  = matchPct > 0 && requested > 0
    ? Math.min(requested, Math.round(matchPct / 100 * requested))
    : 0;

  // Identity reveal only after the contractor approves.
  const REVEALED = ['accepted', 'active', 'reporting', 'completed', 'closed'];

  // Hand-off target for the card-wide "בדוק ואשר" CTA.
  const awaitingDealId = group.find((d) => d.status === 'corp_committed')?.id;

  return (
    <div className={`rounded-2xl border ${meta.cardRing} bg-white shadow-sm overflow-hidden`}>
      <div className="grid grid-cols-1 md:grid-cols-12">

        {/* ── Meta column (first in DOM → right in RTL) ────────── */}
        <div className="md:col-span-4 p-4 sm:p-5 space-y-2.5">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full ${meta.badgeCls}`}>
            {state === 'awaiting' && <Bell className="h-3 w-3 animate-pulse" />}
            {meta.badge}
          </span>

          <div className="flex items-start gap-3">
            {profCode && (
              <ProfessionIcon code={profCode} size={40} alt={profLabel}
                              className="shrink-0 object-contain" />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-slate-900 leading-tight truncate">{profLabel}</h3>
              <p className="text-xs text-slate-500 mt-0.5 inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {requested} עובדים
              </p>
            </div>
          </div>

          <div className="space-y-1 text-xs text-slate-600">
            {(startDate || endDate) && (
              <div className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <span dir="ltr">
                  {startDate ? fmt(startDate) : '—'}
                  {endDate && <> – {fmt(endDate)}</>}
                </span>
              </div>
            )}
            {originCodes.length > 0 ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Globe2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                {originCodes.map((c, i) => (
                  <React.Fragment key={c}>
                    {i > 0 && <span className="text-slate-300">·</span>}
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden>{flagEmoji(c)}</span>
                      <span>{originMap[c] ?? heOrigin(c)}</span>
                    </span>
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 text-slate-400">
                <Globe2 className="h-3.5 w-3.5" /> ללא העדפת מוצא
              </div>
            )}
            {regionLabel && (
              <div className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                {regionLabel}
              </div>
            )}
          </div>
        </div>

        {/* ── Centre column: state illustration + blurb ─────────── */}
        <div className="md:col-span-4 p-4 sm:p-5 flex flex-col items-center justify-center gap-3 text-center bg-slate-50/40 md:border-s md:border-e md:border-slate-100 border-t md:border-t-0">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${meta.illoCls}`}>
            <Illo className={`h-7 w-7 ${state === 'awaiting' ? 'animate-pulse' : ''}`} />
          </div>
          <CentreBlurb
            state={state}
            matchWorkers={matchWorkers}
            matchPct={matchPct}
            filled={filled}
            requested={requested}
            fillPct={fillPct}
            awaitingN={group.filter((d) => d.status === 'corp_committed').length}
            proposedN={group.filter((d) => PROPOSED.has(d.status)).length}
          />
          {(state === 'matching' || state === 'searching') && (
            <Button asChild variant="outline" size="sm" className="text-xs">
              <Link href="/contractor/find">הרחב חיפוש</Link>
            </Button>
          )}
        </div>

        {/* ── Corp list column (last in DOM → left in RTL) ─────── */}
        <div className="md:col-span-4 p-4 sm:p-5 space-y-2 bg-white border-t md:border-t-0">
          {group.length === 0 ? (
            <div className="text-xs text-slate-500 leading-relaxed">
              נשלחה הודעה לתאגידים רלוונטיים — נעדכן אותך ברגע שתתקבל הצעה.
            </div>
          ) : (
            <>
              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                תאגידים ({group.length})
              </div>
              {group
                .slice()
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((d, idx) => {
                  const corpLabel = REVEALED.includes(d.status) && d.corporation_id
                    ? `תאגיד ${d.corporation_id.slice(0, 6)}`
                    : `תאגיד ${idx + 1}`;
                  const pill = DEAL_STATUS_PILL[d.status] ?? {
                    cls: 'bg-slate-100 text-slate-600 border-slate-200',
                    label: d.status,
                  };
                  const proposalOpen = expandedDealId === d.id;
                  const workers   = workersById[d.id] ?? [];
                  const isLoadingW = !!loadingWorkers[d.id];
                  const canApprove = d.status === 'corp_committed';
                  return (
                    <div key={d.id}
                         className={`rounded-lg border overflow-hidden ${canApprove ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}`}>
                      <button
                        type="button"
                        onClick={() => onToggleDeal(d.id)}
                        aria-expanded={proposalOpen}
                        className="w-full text-start px-3 py-2.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 text-sm">{corpLabel}</span>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${pill.cls}`}>
                              {pill.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">
                            {STATUS_CONTEXT[d.status] ?? d.status}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {d.worker_count != null && (
                            <span className="text-xs text-slate-600 whitespace-nowrap">
                              <span className="font-bold text-slate-900">{d.worker_count}</span> עובדים
                            </span>
                          )}
                          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${proposalOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {proposalOpen && (
                        <div className="px-3 pb-3 pt-1 bg-slate-50 border-t border-slate-100 space-y-2">
                          {isLoadingW ? (
                            <div className="flex items-center gap-2 py-3 text-xs text-slate-500">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> טוען רשימת עובדים…
                            </div>
                          ) : workers.length === 0 ? (
                            <p className="py-2 text-xs text-slate-500">אין עובדים זמינים להצגה.</p>
                          ) : (
                            <div className="bg-white rounded-md border border-slate-200">
                              <p className="text-[10px] text-slate-500 px-2.5 pt-2">
                                מוצגים מוצא וותק בלבד — שמות אינם נדרשים להחלטה.
                              </p>
                              <ul className="divide-y divide-slate-50">
                                {workers.map((w, wIdx) => {
                                  const wAny = w as unknown as { experience_range?: string };
                                  const origin = w.origin_country ? heOrigin(w.origin_country) : null;
                                  const flag   = w.origin_country ? flagEmoji(w.origin_country) : null;
                                  const exp = wAny.experience_range
                                    ? `ניסיון ${wAny.experience_range}`
                                    : (w.experience_years != null ? `${w.experience_years} שנות ניסיון` : null);
                                  return (
                                    <li key={w.id || wIdx} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                                      <span className="h-5 w-5 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700 shrink-0">
                                        {wIdx + 1}
                                      </span>
                                      <div className="flex-1 min-w-0 inline-flex items-center gap-1.5 flex-wrap">
                                        {flag && <span aria-hidden>{flag}</span>}
                                        {origin && <span className="font-medium text-slate-900">{origin}</span>}
                                        {origin && exp && <span className="text-slate-300">·</span>}
                                        {exp && <span className="text-slate-600">{exp}</span>}
                                        {!origin && !exp && <span className="text-slate-400">—</span>}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}

                          {actionError[d.id] && (
                            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
                              {actionError[d.id]}
                            </p>
                          )}

                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <Link
                              href={`/contractor/deals/${d.id}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              צ׳אט מלא
                            </Link>
                            {canApprove && (
                              <div className="flex gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => onReject(d.id)}
                                  disabled={actingId === d.id}
                                >
                                  {actingId === d.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <><XCircle className="h-3 w-3" /> דחה</>}
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => onApprove(d.id)}
                                  disabled={actingId === d.id || workers.length === 0}
                                >
                                  {actingId === d.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <><CheckCircle2 className="h-3 w-3" /> אשר</>}
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}

          {state === 'awaiting' && awaitingDealId && (
            <Button asChild className="w-full mt-1 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold">
              <Link href={`/contractor/deals/${awaitingDealId}`}>
                <ArrowLeft className="h-4 w-4" />
                בדוק ואשר עכשיו
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CentreBlurb({ state, matchWorkers, matchPct, filled, requested, fillPct, awaitingN, proposedN }: {
  state: CardState;
  matchWorkers: number;
  matchPct:     number;
  filled:       number;
  requested:    number;
  fillPct:      number;
  awaitingN:    number;
  proposedN:    number;
}) {
  switch (state) {
    case 'awaiting':
      return (
        <div className="space-y-1">
          <p className="text-sm font-bold text-slate-900">
            {awaitingN === 1 ? 'תאגיד הציע עובדים' : `${awaitingN} תאגידים הציעו עובדים`}
          </p>
          <p className="text-xs text-amber-700 font-semibold">ממתינות לאישורך</p>
        </div>
      );
    case 'proposed':
      return (
        <div className="space-y-1">
          <p className="text-sm font-bold text-slate-900">
            {proposedN === 1 ? 'ההצעה אצל התאגיד' : `${proposedN} הצעות בידי התאגידים`}
          </p>
          <p className="text-xs text-slate-500">ממתין לתגובה</p>
        </div>
      );
    case 'matching':
      return (
        <div className="space-y-1.5 w-full">
          <p className="text-sm font-bold text-slate-900">
            נמצאו {matchWorkers} עובדים מתאימים
          </p>
          <FillBar pct={matchPct} requested={requested} filled={matchWorkers} tone="teal" />
        </div>
      );
    case 'searching':
      return (
        <div className="space-y-1">
          <p className="text-sm font-bold text-slate-900">מחפשים תאגידים מתאימים</p>
          <p className="text-xs text-slate-500">נעדכן אותך ברגע שתימצא התאמה</p>
        </div>
      );
    case 'inField':
      return (
        <div className="space-y-1.5 w-full">
          <p className="text-sm font-bold text-emerald-700">העובדים בשטח</p>
          <FillBar pct={fillPct} requested={requested} filled={filled} tone="emerald" />
        </div>
      );
    case 'closed':
      return <p className="text-sm font-bold text-emerald-700">העסקה נסגרה בהצלחה</p>;
    case 'cancelled':
      return <p className="text-sm font-bold text-rose-600">העסקה בוטלה</p>;
  }
}

function FillBar({ pct, requested, filled, tone = 'sky' }: {
  pct: number; requested: number; filled: number; tone?: 'sky' | 'emerald' | 'teal';
}) {
  const fg = tone === 'emerald' ? 'bg-emerald-500'
         : tone === 'teal'     ? 'bg-teal-500'
                               : 'bg-sky-500';
  return (
    <div className="w-full max-w-[180px] mx-auto">
      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${fg} transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <p className="text-[10px] text-slate-500 mt-1">
        <span className="font-bold text-slate-700">{filled}</span> / {requested} עובדים
      </p>
    </div>
  );
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
        if (!c.deals.some((d) => contractorMatchesFilter(d.status, filter))) return false;
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
        ? Math.max(...c.deals.map((d) => new Date(d.created_at).getTime()))
        : 0;
      const fromSearch = c.search?.created_at ? new Date(c.search.created_at).getTime() : 0;
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
