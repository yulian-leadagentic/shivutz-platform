'use client';

// Wave 4 polish — deals page rendered as a tile/card grid instead of
// the dense row list. Each tile is a self-contained summary the
// contractor can scan at a glance: profession + region + worker count
// + status badge + date. Click anywhere on the tile → deal detail page.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, Handshake, MessageSquare, Calendar, MapPin, Users as UsersIcon,
} from 'lucide-react';
import { dealApi } from '@/lib/api';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal } from '@/types';
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

export default function ContractorDealsPage() {
  const [deals, setDeals]     = useState<EnrichedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [filter, setFilter]   = useState<Filter>('all');

  function reload() {
    setLoading(true); setError(false);
    dealApi.list({ page_size: 200 })
      .then((res) => setDeals(res.items as EnrichedDeal[]))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  const filtered = deals.filter((d) => dealMatchesFilter(d.status, filter));
  const proposedCount = deals.filter((d) => dealMatchesFilter(d.status, 'proposed')).length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">עסקאות</h1>
        <p className="text-sm text-slate-600 mt-0.5">
          כל הפניות שלך לתאגידים — לחץ כדי לראות פרטים ולנהל את העסקה
        </p>
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

      {/* Tile grid */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => {
            const profCode = d.profession_type ?? '';
            const profLabel = d.profession_he ?? d.profession_type ?? '—';
            return (
              <Link
                key={d.id}
                href={`/contractor/deals/${d.id}`}
                className="group flex flex-col rounded-2xl border border-slate-200 bg-white
                           p-4 sm:p-5 shadow-sm hover:border-brand-400 hover:shadow-md
                           active:scale-[0.99] transition"
              >
                {/* Header — icon + profession + status */}
                <div className="flex items-start gap-3 mb-3">
                  {profCode && (
                    <ProfessionIcon
                      code={profCode}
                      size={56}
                      alt={profLabel}
                      className="shrink-0 object-contain"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-900 text-base truncate">
                      {profLabel}
                    </div>
                    <div className="mt-1.5">
                      <StatusBadge status={d.status} />
                    </div>
                  </div>
                </div>

                {/* Status context line */}
                <p className="text-xs text-slate-600 mb-3 leading-relaxed line-clamp-2">
                  {STATUS_CONTEXT[d.status] ?? d.status}
                </p>

                {/* Meta — workers / region / date */}
                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-500 mb-3 pt-2 border-t border-slate-100">
                  <div className="flex flex-col items-center text-center">
                    <UsersIcon className="w-3.5 h-3.5 mb-0.5 text-slate-400" />
                    <span className="font-semibold text-slate-700">
                      {d.worker_count ?? d.requested_count ?? '—'}
                    </span>
                    <span className="text-[10px]">עובדים</span>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <MapPin className="w-3.5 h-3.5 mb-0.5 text-slate-400" />
                    <span className="font-semibold text-slate-700 truncate w-full">
                      {d.region_he ?? '—'}
                    </span>
                    <span className="text-[10px]">אזור</span>
                  </div>
                  <div className="flex flex-col items-center text-center">
                    <Calendar className="w-3.5 h-3.5 mb-0.5 text-slate-400" />
                    <span className="font-semibold text-slate-700">{fmt(d.created_at)}</span>
                    <span className="text-[10px]">נשלחה</span>
                  </div>
                </div>

                {/* Footer CTA */}
                <div className="mt-auto flex items-center justify-between pt-1">
                  <span className="font-mono text-[10px] text-slate-400">#{d.id.slice(0, 8)}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 group-hover:text-brand-700">
                    <MessageSquare className="w-3.5 h-3.5" />
                    פרטים וצ׳אט
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
