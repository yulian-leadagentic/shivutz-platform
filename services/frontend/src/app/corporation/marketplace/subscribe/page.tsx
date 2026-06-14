'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, CheckCircle2, Info, ArrowRight } from 'lucide-react';
import {
  marketplaceSubscriptionsApi,
  type CatalogCategory,
  type CatalogTier,
  type Subscription,
} from '@/lib/api/marketplaceSubscriptions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

function fmtPrice(nis: number): string {
  return `₪${nis.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function fmtDate(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('he-IL');
}

export default function SubscribePage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
      <SubscribePageInner />
    </Suspense>
  );
}

function SubscribePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const presetCategory = params.get('category') || null;

  const [catalog, setCatalog]               = useState<CatalogCategory[]>([]);
  const [mySubs, setMySubs]                 = useState<Subscription[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [purchasingTier, setPurchasingTier] = useState<string | null>(null);
  // Two-step purchase confirm — replaces the legacy native confirm()
  // which prefixed messages with "staging.buildupai.net says".
  const [pendingBuy, setPendingBuy] = useState<{ tier: CatalogTier; autoRenew: boolean } | null>(null);

  async function reload() {
    setLoading(true); setError(null);
    try {
      const [cats, mine] = await Promise.all([
        marketplaceSubscriptionsApi.catalog(),
        marketplaceSubscriptionsApi.mine().catch(() => [] as Subscription[]),
      ]);
      setCatalog(cats);
      setMySubs(mine);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  const activeByCategory = useMemo(() => {
    const m: Record<string, Subscription | undefined> = {};
    for (const s of mySubs) {
      if (s.status === 'active') m[s.category_code] = s;
    }
    return m;
  }, [mySubs]);

  function handleBuy(tier: CatalogTier, autoRenew: boolean) {
    setPendingBuy({ tier, autoRenew });
  }

  async function confirmBuy() {
    if (!pendingBuy) return;
    const { tier, autoRenew } = pendingBuy;
    setPurchasingTier(tier.id); setError(null);
    try {
      await marketplaceSubscriptionsApi.purchase(tier.id, autoRenew);
      setPendingBuy(null);
      // Push back to the user's marketplace dashboard with the new sub active
      router.push(`/corporation/marketplace?subscribed=${tier.category_code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הרכישה נכשלה');
    } finally {
      setPurchasingTier(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // Re-order so the preset category comes first.
  const orderedCats = presetCategory
    ? [...catalog].sort((a, b) =>
        a.code === presetCategory ? -1 : b.code === presetCategory ? 1 : 0,
      )
    : catalog;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">רכישת מנוי לשירותים נלווים</h1>
        <p className="text-sm text-slate-500 mt-1">
          בחר קטגוריה ומסלול. כל מסלול מאפשר מספר מודעות פעילות בו-זמנית למשך תקופה מוגדרת.
          ברירת המחדל היא חידוש אוטומטי בתום התקופה — אפשר לבטל מאוחר יותר מהגדרות החשבון.
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {orderedCats.map((cat) => {
        const active = activeByCategory[cat.code];
        return (
          <Card key={cat.code}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  {cat.name_he}
                  <span className="text-xs text-slate-400 font-mono" dir="ltr">{cat.code}</span>
                </CardTitle>
                {active && (
                  <Badge variant="default" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                    <CheckCircle2 className="h-3 w-3 me-1" />
                    מנוי פעיל עד {fmtDate(active.expires_at)}
                  </Badge>
                )}
              </div>
              {active && (
                <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  שימוש: {active.slots_used ?? 0}/{active.slot_count} מודעות.
                  לרכוש מסלול אחר רק לאחר תום המנוי הנוכחי או ביטולו.
                </p>
              )}
            </CardHeader>
            <CardContent>
              {cat.tiers.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">
                  עדיין אין מסלולים פעילים בקטגוריה זו.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cat.tiers.map((tier) => {
                    const blocked = !!active;
                    const busy    = purchasingTier === tier.id;
                    return (
                      <div
                        key={tier.id}
                        className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3 hover:border-brand-300 transition-colors"
                      >
                        <div>
                          <div className="font-medium text-slate-900">{tier.name_he}</div>
                          <div className="text-xs text-slate-500" dir="ltr">{tier.name_en}</div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900" dir="ltr">
                          {fmtPrice(tier.price_nis)}
                        </div>
                        <ul className="text-sm text-slate-600 space-y-1">
                          <li>{tier.slot_count} מודעות פעילות בו-זמנית</li>
                          <li>{tier.duration_days} ימי פרסום</li>
                        </ul>
                        <div className="flex gap-2 mt-2">
                          <Button
                            size="sm" disabled={busy || blocked}
                            onClick={() => handleBuy(tier, true)}
                            className="flex-1"
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            רכוש (חידוש אוטומטי)
                          </Button>
                          <Button
                            size="sm" variant="outline" disabled={busy || blocked}
                            onClick={() => handleBuy(tier, false)}
                          >
                            חד-פעמי
                          </Button>
                        </div>
                        {blocked && (
                          <p className="text-xs text-amber-700 -mt-1">
                            יש מנוי פעיל בקטגוריה זו
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex justify-end">
        <Link href="/corporation/marketplace">
          <Button variant="outline">
            חזרה לניהול המודעות
            <ArrowRight className="h-4 w-4 me-1" />
          </Button>
        </Link>
      </div>

      <ConfirmDialog
        open={!!pendingBuy}
        title="אישור רכישה"
        message={pendingBuy
          ? `לרכוש את "${pendingBuy.tier.name_he}" ב-${fmtPrice(pendingBuy.tier.price_nis)} ${pendingBuy.autoRenew ? 'עם חידוש אוטומטי' : 'ללא חידוש אוטומטי'}?`
          : ''}
        confirmLabel="אשר רכישה"
        variant="primary"
        busy={purchasingTier !== null}
        onConfirm={confirmBuy}
        onCancel={() => setPendingBuy(null)}
      />
    </div>
  );
}
