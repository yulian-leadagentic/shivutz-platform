'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, AlertCircle, Users, CheckCircle2, ArrowLeft } from 'lucide-react';
import { jobApi, dealApi } from '@/lib/api';
import type { MatchBundle } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/StatusBadge';

function formatDate(dateStr?: string) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('he-IL');
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const variant = pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'secondary';
  return <Badge variant={variant}>{pct}%</Badge>;
}

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [bundles, setBundles] = useState<MatchBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState('');
  const [creatingDeal, setCreatingDeal] = useState<string | null>(null);

  const runMatch = useCallback(async () => {
    setLoading(true);
    setError('');
    setTimedOut(false);

    const timeout = setTimeout(() => {
      setTimedOut(true);
      setLoading(false);
    }, 5000);

    try {
      const results = await jobApi.match(id);
      clearTimeout(timeout);
      setBundles(results);
    } catch (err) {
      clearTimeout(timeout);
      setError(err instanceof Error ? err.message : 'שגיאה בחיפוש התאמות');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    runMatch();
  }, [runMatch]);

  async function handleSelectBundle(bundle: MatchBundle) {
    setCreatingDeal(bundle.corporation_id);
    try {
      const deal = await dealApi.create({
        job_request_id: id,
        corporation_id: bundle.corporation_id,
        worker_ids: bundle.workers.map((w) => w.worker_id),
        workers_count: bundle.workers.length,
      });
      router.push(`/contractor/deals/${deal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה ביצירת עסקה');
      setCreatingDeal(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/contractor/dashboard">
            <ArrowLeft className="h-4 w-4" />
            חזרה
          </Link>
        </Button>
        <h2 className="text-2xl font-bold text-slate-900">תוצאות התאמה</h2>
      </div>

      {loading && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-12 w-12 text-brand-500 animate-spin" />
            <p className="text-slate-600 font-medium">מחפש התאמות... (עד 3 שניות)</p>
            <p className="text-slate-400 text-sm">מנוע ההתאמה מחפש את ההצעות הטובות ביותר עבורך</p>
          </CardContent>
        </Card>
      )}

      {timedOut && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500" />
            <p className="text-slate-700 font-medium">זמן החיפוש חרג — נסה שוב</p>
            <Button onClick={runMatch}>נסה שוב</Button>
          </CardContent>
        </Card>
      )}

      {error && !loading && !timedOut && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <p className="text-red-600 font-medium">{error}</p>
            <Button onClick={runMatch} variant="outline">נסה שוב</Button>
          </CardContent>
        </Card>
      )}

      {!loading && !timedOut && !error && bundles.length === 0 && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
            <Users className="h-12 w-12 text-slate-300" />
            <p className="text-slate-600 font-medium">לא נמצאו התאמות מתאימות</p>
            <p className="text-slate-400 text-sm">נסה לשנות את דרישות הבקשה</p>
            <Button variant="outline" asChild>
              <Link href="/contractor/requests/new">בקשה חדשה</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !timedOut && bundles.length > 0 && (
        <div className="space-y-4">
          <p className="text-slate-600 text-sm">נמצאו {bundles.length} הצעות מתאימות</p>
          {bundles.map((bundle) => (
            <Card key={bundle.corporation_id} className="overflow-hidden">
              <CardHeader className="bg-slate-50 border-b border-slate-100">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-lg">{bundle.corporation_name}</CardTitle>
                    <Badge variant={bundle.is_complete ? 'success' : 'warning'}>
                      {bundle.is_complete ? 'הצעה מלאה' : 'הצעה חלקית'}
                    </Badge>
                    <div className="flex items-center gap-1.5 text-sm text-slate-600">
                      <span>ציון:</span>
                      <ScoreBadge score={bundle.score} />
                    </div>
                  </div>
                  <Button
                    onClick={() => handleSelectBundle(bundle)}
                    disabled={creatingDeal !== null}
                    size="sm"
                  >
                    {creatingDeal === bundle.corporation_id ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /><span>יוצר עסקה...</span></>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4" /><span>בחר הצעה זו</span></>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500">
                        <th className="px-4 py-3 text-start font-medium">שם עובד</th>
                        <th className="px-4 py-3 text-start font-medium">מקצוע</th>
                        <th className="px-4 py-3 text-start font-medium">ניסיון</th>
                        <th className="px-4 py-3 text-start font-medium">ויזה בתוקף עד</th>
                        <th className="px-4 py-3 text-start font-medium">ציון</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.workers.map((w) => (
                        <tr key={w.worker_id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-900">{w.worker_name}</td>
                          <td className="px-4 py-3 text-slate-600">{w.profession_type}</td>
                          <td className="px-4 py-3 text-slate-600">—</td>
                          <td className="px-4 py-3 text-slate-600">{formatDate(w.visa_valid_until)}</td>
                          <td className="px-4 py-3">
                            <ScoreBadge score={w.score} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
