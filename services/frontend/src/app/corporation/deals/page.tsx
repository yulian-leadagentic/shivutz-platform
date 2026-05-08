'use client';

// Wave 4 polish — corp-side deals rendered as a tile grid (was a
// dense table). Each tile is the corp's view of one inquiry: which
// profession, how many workers requested vs offered, status badge,
// region, date, and a CTA whose copy depends on whether the corp
// still owes a response (אשר / דחה) or it's already in progress (פרטים).

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Loader2, Calendar, MapPin, Users as UsersIcon,
  AlertCircle, Handshake, MessageSquare,
} from 'lucide-react';
import { dealApi } from '@/lib/api';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import type { Deal } from '@/types';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { DEAL_STATUS_GROUP, type DealFilter as Filter } from '@/i18n/he';

// Corp-side wording differs from the central DEAL_FILTER_LABEL
// (e.g. "ממתינות לאישור" vs "ממתינות לתאגיד") — kept local on purpose.
const FILTER_LABELS: Record<Filter, string> = {
  all:       'הכל',
  proposed:  'ממתינות לאישור',
  active:    'פעילות',
  completed: 'הושלמו',
};

const STATUS_CONTEXT: Record<string, string> = {
  proposed:          'נשלחה אליך — דרושה החלטה',
  corp_committed:    'הצעת עובדים נשלחה לקבלן',
  approved:          'אושר ע״י הקבלן — עובדים בשטח',
  closed:            'הושלמה',
  rejected:          'נדחתה',
  cancelled_by_corp: 'בוטלה על ידך',
  expired:           'פג תוקף',
};

type EnrichedDeal = Deal & {
  profession_type?: string;
  profession_he?:   string;
  region_he?:       string;
  worker_count?:    number;
  requested_count?: number;
};

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
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
    return (DEAL_STATUS_GROUP[filter] as string[]).includes(d.status);
  });
  const pendingCount = deals.filter((d) => d.status === 'proposed').length;

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

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {FILTER_LABELS[f]}
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
            <p className="text-slate-400 text-sm">
              קבלנים יוכלו לפנות אליך מתוך תוצאות החיפוש שלהם
            </p>
          )}
        </div>
      )}

      {/* Tile grid */}
      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => {
            const profCode  = d.profession_type ?? '';
            const profLabel = d.profession_he ?? d.profession_type ?? '—';
            const offered   = d.worker_count ?? 0;
            const requested = d.requested_count ?? 0;
            const isPending = d.status === 'proposed';
            return (
              <Link
                key={d.id}
                href={`/corporation/deals/${d.id}`}
                className={`group flex flex-col rounded-2xl bg-white p-4 sm:p-5 shadow-sm
                            hover:shadow-md active:scale-[0.99] transition ${
                              isPending
                                ? 'border-2 border-amber-300 ring-2 ring-amber-50'
                                : 'border border-slate-200 hover:border-brand-400'
                            }`}
              >
                {/* Header — icon + profession + status badge */}
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
                    <div className="mt-1.5"><StatusBadge status={d.status} /></div>
                  </div>
                </div>

                {/* Status context */}
                <p className={`text-xs mb-3 leading-relaxed line-clamp-2 ${
                  isPending ? 'text-amber-700 font-medium' : 'text-slate-600'
                }`}>
                  {STATUS_CONTEXT[d.status] ?? d.status}
                </p>

                {/* Meta — workers / region / date */}
                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-500 mb-3 pt-2 border-t border-slate-100">
                  <div className="flex flex-col items-center text-center">
                    <UsersIcon className="w-3.5 h-3.5 mb-0.5 text-slate-400" />
                    <span className="font-semibold text-slate-700">
                      {requested > 0 ? `${offered}/${requested}` : (offered || '—')}
                    </span>
                    <span className="text-[10px]">{requested > 0 ? 'הצעת/ביקש' : 'עובדים'}</span>
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
                    <span className="text-[10px]">נוצרה</span>
                  </div>
                </div>

                {/* Footer CTA */}
                <div className="mt-auto flex items-center justify-between pt-1">
                  <span className="font-mono text-[10px] text-slate-400">#{d.id.slice(0, 8)}</span>
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    isPending ? 'text-amber-600 group-hover:text-amber-700' : 'text-brand-600 group-hover:text-brand-700'
                  }`}>
                    {isPending ? <AlertCircle className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                    {isPending ? 'אשר / דחה' : 'פרטים וצ׳אט'}
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
