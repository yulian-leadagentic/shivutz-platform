'use client';

// R34 5c · the numbers on the service-provider dashboard.
//
// A provider pays for a category and until now had no way to tell
// whether anyone saw what it published. This block answers four
// questions for the last 30 or 7 days: how often the listings were
// shown, how often one was opened, how many people asked for the
// contact details, and how many searches there were for what the
// provider sells.
//
// Self-contained on purpose: it fetches its own data and owns its
// loading, empty and error states, so the dashboard page mounts it
// with one line and a failure here cannot take the listings above it
// down with it.
//
// Everything shown is a count. The endpoint returns no viewer and no
// search text, and nothing here should ever try to add them back.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Eye, MousePointerClick, Phone, Search } from 'lucide-react';

import {
  providerStatsApi,
  type ProviderStatsDay,
  type ProviderStatsDays,
  type ProviderStatsResponse,
} from '@/lib/api/providerStats';
import { useEnums } from '@/features/enums/EnumsContext';
import { BidiText } from '@/lib/bidi';
import { Button } from '@/components/ui/button';

const WINDOWS: ProviderStatsDays[] = [30, 7];

// A listing that is not live keeps its history, so it stays in the
// table. The label says why its numbers have stopped moving.
const INACTIVE_STATUS_HE: Record<string, string> = {
  paused: 'מושהית',
  rented: 'הושכרה',
  sold:   'נמכרה',
};

function formatCount(n: number): string {
  return n.toLocaleString('he-IL');
}

// Built from the string, not through Date: `new Date('2026-11-09')` is
// UTC midnight and would print the day before for a viewer west of
// Greenwich.
function shortDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)}.${Number(month)}`;
}

export interface ProviderStatsProps {
  /**
   * Where "publish a listing" leads from the empty state. The dashboard
   * already builds this link (it carries the provider's category), so
   * it is passed in rather than rebuilt here. Omit to show no button.
   */
  newListingHref?: string;
  className?: string;
}

export default function ProviderStats({ newListingHref, className = '' }: ProviderStatsProps) {
  const { regionMap } = useEnums();
  const [days, setDays]       = useState<ProviderStatsDays>(30);
  const [data, setData]       = useState<ProviderStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    providerStatsApi.get(days)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, attempt]);

  const regionLabel = (code: string) => regionMap[code] ?? code;

  return (
    <section
      aria-labelledby="provider-stats-title"
      className={`bg-white rounded-2xl border border-slate-200 shadow-card p-4 sm:p-5 space-y-4 ${className}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 id="provider-stats-title" className="text-lg font-bold text-slate-900">
            הנתונים שלך
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {days} הימים האחרונים
          </p>
        </div>
        <div
          role="group"
          aria-label="טווח הזמן של הנתונים"
          className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5"
        >
          {WINDOWS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`min-h-[44px] px-4 rounded-lg text-sm font-semibold ${
                days === d
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {d} ימים
            </button>
          ))}
        </div>
      </div>

      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-red-400" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700">לא הצלחנו לטעון את הנתונים.</p>
          <Button type="button" size="lg" onClick={() => setAttempt((n) => n + 1)}>
            נסו שוב
          </Button>
        </div>
      ) : !data ? (
        <StatsSkeleton />
      ) : (
        // While the other window loads, the previous numbers stay in
        // place and dim instead of collapsing to a skeleton: the block
        // keeps its height and the page under it does not jump.
        <div
          aria-busy={loading}
          className={`space-y-4 transition-opacity duration-200 motion-reduce:transition-none ${
            loading ? 'opacity-50' : 'opacity-100'
          }`}
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile
              icon={Eye}
              label="חשיפות"
              value={data.totals.impressions}
              hint="פעמים שהמודעות שלך הוצגו לגולשים"
            />
            <Tile
              icon={MousePointerClick}
              label="כניסות למודעה"
              value={data.totals.opens}
              hint="פעמים שנפתחו פרטי המודעה"
            />
            <Tile
              icon={Phone}
              label="פניות לפרטי קשר"
              value={data.totals.reveals}
              hint="גולשים שביקשו את פרטי הקשר שלך"
            />
            <Tile
              icon={Search}
              label="חיפושים בתחום שלך"
              value={data.totals.searches}
              hint="חיפושים באתר בקטגוריות ובאזורים שלך"
            />
          </div>

          {data.search_scope.categories.length > 0 && (
            <p className="text-xs text-slate-500 leading-relaxed">
              {data.search_scope.source === 'primary_category'
                ? 'עדיין אין מודעה פעילה, לכן החיפושים נספרים לפי הקטגוריה שנרשמת בה: '
                : 'החיפושים נספרים לפי: '}
              {data.search_scope.categories
                .map((c) => `${c.name} (${
                  c.regions ? c.regions.map(regionLabel).join(', ') : 'כל הארץ'
                })`)
                .join(' · ')}
            </p>
          )}

          {data.listings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center space-y-3">
              <p className="text-sm text-slate-600">
                עדיין לא פרסמת מודעה, ולכן אין נתוני צפייה להציג.
              </p>
              {newListingHref && (
                <Button asChild size="lg">
                  <Link href={newListingHref}>פרסום מודעה ראשונה</Link>
                </Button>
              )}
            </div>
          ) : (
            <>
              <TrendLine series={data.series} days={data.days} />

              <div>
                <h3 className="text-sm font-bold text-slate-900 mb-1">לפי מודעה</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-100">
                      <th scope="col" className="text-start font-semibold py-2 pe-2">מודעה</th>
                      <th scope="col" className="text-end font-semibold py-2 px-2 whitespace-nowrap">חשיפות</th>
                      <th scope="col" className="text-end font-semibold py-2 px-2 whitespace-nowrap">כניסות</th>
                      <th scope="col" className="text-end font-semibold py-2 ps-2 whitespace-nowrap">פניות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.listings.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100 last:border-b-0">
                        {/* max-w-0 + w-full is what lets a table cell
                            truncate: without it a long title widens
                            the column and pushes the numbers off a
                            390px screen. */}
                        <th scope="row" className="text-start font-normal py-2.5 pe-2 max-w-0 w-full">
                          <p className="font-medium text-slate-900 truncate">
                            <BidiText>{l.title}</BidiText>
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {l.category_name}
                            {' · '}
                            {l.region ? regionLabel(l.region) : 'כל הארץ'}
                            {INACTIVE_STATUS_HE[l.status] && (
                              <span className="text-amber-800"> · {INACTIVE_STATUS_HE[l.status]}</span>
                            )}
                          </p>
                        </th>
                        <td className="text-end tabular-nums py-2.5 px-2 text-slate-900">{formatCount(l.impressions)}</td>
                        <td className="text-end tabular-nums py-2.5 px-2 text-slate-900">{formatCount(l.opens)}</td>
                        <td className="text-end tabular-nums py-2.5 ps-2 text-slate-900">{formatCount(l.reveals)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="text-xs text-slate-500">
            מוצגים מספרים מצטברים בלבד. פרטי הגולשים שצפו במודעות אינם נחשפים.
          </p>
        </div>
      )}
    </section>
  );
}

function Tile({
  icon: Icon, label, value, hint,
}: {
  icon:  React.ElementType;
  label: string;
  value: number;
  hint:  string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span className="h-8 w-8 shrink-0 rounded-lg bg-brand-50 text-brand-800 flex items-center justify-center">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="text-xs font-semibold text-slate-600 leading-tight">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-extrabold text-slate-900 tabular-nums">{formatCount(value)}</p>
      <p className="mt-0.5 text-xs text-slate-500 leading-snug">{hint}</p>
    </div>
  );
}

// One line: impressions per day. Impressions rather than opens or
// reveals because it is the only one of the three with enough volume
// to draw a shape at this scale; the other two are in the tiles.
//
// Hand-rolled SVG, no chart library: it is one polyline. The viewBox
// stretches to the container (preserveAspectRatio="none") and
// vector-effect keeps the stroke at 2px however wide that gets.
//
// Time runs left to right even though the page is RTL. That is how
// every chart a provider has seen elsewhere reads, and the two dates
// under the line say which end is which.
function TrendLine({ series, days }: { series: ProviderStatsDay[]; days: number }) {
  const W = 300;
  const H = 56;
  const PAD = 4;
  const values = series.map((p) => p.impressions);
  const peak = Math.max(0, ...values);
  const total = values.reduce((sum, v) => sum + v, 0);
  const step = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = PAD + i * step;
      const y = H - PAD - (peak > 0 ? v / peak : 0) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${PAD},${H - PAD} ${points} ${W - PAD},${H - PAD}`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-sm font-bold text-slate-900">חשיפות לפי יום</h3>
        {peak > 0 && (
          <span className="text-xs text-slate-500">שיא יומי: {formatCount(peak)}</span>
        )}
      </div>
      {peak === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-5 text-center text-sm text-slate-600">
          עדיין לא נרשמו חשיפות בתקופה הזו. המספרים יתעדכנו כשגולשים יראו את המודעות שלך.
        </p>
      ) : (
        <div dir="ltr">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`חשיפות לפי יום ב-${days} הימים האחרונים. סך הכל ${formatCount(total)}, שיא יומי ${formatCount(peak)}.`}
            className="block w-full h-14"
          >
            <polygon points={area} className="fill-brand-100" />
            <polyline
              points={points}
              fill="none"
              className="stroke-brand-700"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {series.length > 1 && (
            <div className="flex justify-between text-[11px] text-slate-500 tabular-nums mt-1">
              <span>{shortDay(series[0].day)}</span>
              <span>{shortDay(series[series.length - 1].day)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">טוען נתונים</span>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[104px] rounded-xl bg-slate-100 animate-pulse motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="h-20 rounded-xl bg-slate-100 animate-pulse motion-reduce:animate-none" />
    </div>
  );
}
