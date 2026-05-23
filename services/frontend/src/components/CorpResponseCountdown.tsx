'use client';

// HH:MM:SS countdown to the corp-response deadline for a
// `proposed` deal. Format: 47:59:23. After the deadline the
// component renders the user-approved option-A copy:
//   "00:00:00" + a small line — "לא התקבל מענה — נטפל בזה"
// (contractor side) or "חרגת מזמן התגובה — פנייה דחופה"
// (corp side).
//
// The hook hand-rolls the math so a multi-day deadline (e.g. an
// admin viewing a deal that's been overdue for 3 days) doesn't
// roll into a "negative" string. Hour overflow is shown as
// "73:00:00" rather than capping at 24, because deadlines this
// long are rare and the contractor / corp wants to see the
// real number, not a wrapped one.

import { useNow } from '@/hooks/useNow';

// MySQL TIMESTAMP columns serialize without timezone info ("2026-05-20
// 08:17:48"). `new Date(...)` reads such strings as LOCAL time, but
// the DB stores UTC. Normalise to keep the countdown honest no matter
// what shape the backend hands us.
function parseUtcMs(iso: string): number {
  let s = iso.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
  return new Date(s).getTime();
}

interface CorpResponseCountdownProps {
  /** Server-side deal.created_at — ISO string. The deadline is
   *  created_at + responseHours. */
  createdAtIso?:    string | null;
  /** corp_response_hours setting (server-supplied, default 48). */
  responseHours?:   number;
  /** Audience-specific copy under the clock when expired. */
  expiredLabel?:    string;
  /** Audience-specific copy under the clock when still running. */
  runningLabel?:    string;
  /** Compact size variant — drops the labels, just shows numbers.
   *  Use on the per-row corp dashboard where space is tight. */
  size?:            'lg' | 'compact';
  /** Override tone — defaults to amber while running, slate when
   *  expired. Pass 'emerald' on rows that have already moved on
   *  (corp committed late — keep the row visually "resolved"). */
  tone?:            'amber' | 'emerald' | 'rose';
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmt(remainingMs: number): { hh: string; mm: string; ss: string; expired: boolean } {
  if (remainingMs <= 0) return { hh: '00', mm: '00', ss: '00', expired: true };
  const totalSec = Math.floor(remainingMs / 1000);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return { hh: pad(hh), mm: pad(mm), ss: pad(ss), expired: false };
}

export function CorpResponseCountdown({
  createdAtIso,
  responseHours = 48,
  expiredLabel,
  runningLabel,
  size = 'lg',
  tone = 'amber',
}: CorpResponseCountdownProps) {
  // Tick every second so seconds visibly count down. useNow returns
  // 0 during SSR + the first client render to keep hydration HTML
  // identical — skip the countdown render until the effect has
  // populated a real timestamp, otherwise we'd briefly paint a
  // bogus huge "remaining" value computed against now=0.
  const now = useNow(1000);
  if (!createdAtIso || now === 0) return null;
  const created = parseUtcMs(createdAtIso);
  if (!Number.isFinite(created)) return null;
  const deadline   = created + responseHours * 3_600_000;
  const remaining  = deadline - now;
  const { hh, mm, ss, expired } = fmt(remaining);

  const activeTone = expired
    ? 'text-slate-500'
    : tone === 'emerald' ? 'text-emerald-700'
    : tone === 'rose'    ? 'text-rose-600'
                         : 'text-amber-700';

  if (size === 'compact') {
    return (
      <span dir="ltr" className={`font-mono font-bold ${activeTone}`}>
        {hh}:{mm}:{ss}
      </span>
    );
  }

  return (
    <div className="space-y-0.5 text-center">
      <div
        dir="ltr"
        className={`font-mono font-extrabold tabular-nums text-2xl leading-none ${activeTone}`}
      >
        {hh}:{mm}:{ss}
      </div>
      <p className={`text-[11px] font-semibold ${expired ? 'text-slate-500' : 'text-slate-600'}`}>
        {expired ? expiredLabel : runningLabel}
      </p>
    </div>
  );
}
