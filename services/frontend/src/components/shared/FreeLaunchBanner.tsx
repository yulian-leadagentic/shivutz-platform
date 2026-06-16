import { Sparkles } from 'lucide-react';

const FREE_LAUNCH_UNTIL = process.env.NEXT_PUBLIC_FREE_LAUNCH_UNTIL?.trim() || null;

function parseCutoff(): Date | null {
  if (!FREE_LAUNCH_UNTIL) return null;
  const d = new Date(FREE_LAUNCH_UNTIL);
  return isNaN(d.getTime()) ? null : d;
}

const CUTOFF = parseCutoff();

export function FreeLaunchBanner() {
  if (!CUTOFF || new Date() >= CUTOFF) return null;

  const fmt = CUTOFF.toLocaleDateString('he-IL', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  });

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
      <Sparkles className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
      <div className="leading-tight">
        <span className="font-semibold">תקופת השקה — לא ייגבה חיוב </span>
        <span>עד {fmt}. עסקאות מאושרות בלי תשלום במהלך התקופה.</span>
      </div>
    </div>
  );
}
