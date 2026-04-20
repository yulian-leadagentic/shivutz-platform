'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageSquare, ChevronLeft, AlertCircle, Handshake } from 'lucide-react';
import { dealApi } from '@/lib/api';
import type { Deal } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';

function fmt(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('he-IL');
}

type Filter = 'all' | 'proposed' | 'active' | 'completed';
const FILTER_LABELS: Record<Filter, string> = {
  all: 'הכל', proposed: 'ממתינות לתאגיד', active: 'פעילות', completed: 'הסתיימו',
};

const STATUS_CONTEXT: Record<string, string> = {
  proposed:         'נשלחה לתאגיד — ממתין לתגובה',
  counter_proposed: 'התאגיד הגיב — בדוק את הצ׳אט',
  accepted:         'אושר ע"י התאגיד — עסקה פעילה',
  active:           'עובדים בשטח',
  reporting:        'ממתין לדיווח ביצוע',
  completed:        'הושלם',
  disputed:         'במחלוקת — נדרשת התערבות',
  cancelled:        'בוטל',
};

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div key={i} className="px-4 py-4 animate-pulse border-b border-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <div className="h-4 bg-slate-200 rounded w-20" />
                <div className="h-4 bg-slate-200 rounded w-16" />
              </div>
              <div className="h-3 bg-slate-100 rounded w-48" />
              <div className="h-3 bg-slate-100 rounded w-32" />
            </div>
            <div className="h-8 bg-slate-200 rounded w-20" />
          </div>
        </div>
      ))}
    </>
  );
}

export default function ContractorDealsPage() {
  const [deals, setDeals]     = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [filter, setFilter]   = useState<Filter>('all');

  useEffect(() => {
    setLoading(true);
    setError(false);
    dealApi.list()
      .then(setDeals)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const filtered = deals.filter((d) => {
    if (filter === 'proposed')  return ['proposed', 'counter_proposed'].includes(d.status);
    if (filter === 'active')    return ['accepted', 'active', 'reporting'].includes(d.status);
    if (filter === 'completed') return ['completed', 'cancelled', 'disputed'].includes(d.status);
    return true;
  });

  const proposedCount = deals.filter(d => ['proposed','counter_proposed'].includes(d.status)).length;

  return (
    <div className="space-y-4 max-w-6xl">
      <h2 className="text-xl font-bold text-slate-900">עסקאות ופניות</h2>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-brand-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}>
            {FILTER_LABELS[f]}
            {f === 'proposed' && proposedCount > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full leading-none">
                {proposedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : error ? 'שגיאה' : `${filtered.length} עסקאות`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Error state */}
          {error && (
            <div className="flex flex-col items-center gap-3 py-12 text-center px-4">
              <AlertCircle className="h-10 w-10 text-red-400" />
              <p className="text-slate-700 font-medium">לא ניתן לטעון את העסקאות</p>
              <p className="text-slate-400 text-sm">בדוק את החיבור לאינטרנט ונסה שוב</p>
              <Button variant="outline" size="sm" onClick={() => {
                setLoading(true); setError(false);
                dealApi.list().then(setDeals).catch(() => setError(true)).finally(() => setLoading(false));
              }}>
                נסה שוב
              </Button>
            </div>
          )}

          {/* Loading */}
          {loading && !error && <SkeletonRows />}

          {/* Empty */}
          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center px-4">
              <Handshake className="h-10 w-10 text-slate-200" />
              <p className="text-slate-600 font-medium">
                {filter === 'all' ? 'עדיין אין עסקאות' : 'אין עסקאות בקטגוריה זו'}
              </p>
              {filter === 'all' && (
                <p className="text-slate-400 text-sm">
                  צור בקשת עבודה וחפש התאמות כדי לשלוח פנייה לתאגיד
                </p>
              )}
              {filter === 'all' && (
                <Button asChild variant="outline" size="sm">
                  <Link href="/contractor/requests/new">+ בקשה חדשה</Link>
                </Button>
              )}
            </div>
          )}

          {/* Deals list */}
          {!loading && !error && filtered.length > 0 && (
            <div className="divide-y divide-slate-50">
              {filtered.map((d) => (
                <div key={d.id} className="px-4 py-4 hover:bg-slate-50/60 transition-colors">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    {/* Left */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-slate-400">#{d.id.slice(0, 8)}</span>
                        <StatusBadge status={d.status} />
                        {d.agreed_price && (
                          <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            ₪{Number(d.agreed_price).toLocaleString('he-IL')}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500">
                        {STATUS_CONTEXT[d.status] ?? d.status}
                      </p>

                      <p className="text-xs text-slate-600">
                        <span className="font-medium">{d.workers_count}</span> עובדים
                        <span className="text-slate-300 mx-1.5">·</span>
                        <span className="text-slate-400">{fmt(d.created_at)}</span>
                      </p>

                      {d.notes && (
                        <div className="flex items-start gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 max-w-lg">
                          <MessageSquare className="h-3 w-3 shrink-0 mt-0.5 text-slate-400" />
                          <span className="line-clamp-2">{d.notes}</span>
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    <Link
                      href={`/contractor/deals/${d.id}`}
                      className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline shrink-0 mt-1"
                    >
                      פרטים וצ׳אט
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
