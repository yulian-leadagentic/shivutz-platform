'use client';

// R33 B.3 · where a service provider adds a plan in another category.
//
// A provider can publish in a category only while it holds an active
// plan there (Yulian, 15.11). Registration gives it one plan, in the
// category it picked. This page is how it gets a second: every
// category a provider may publish in, the plan it already holds there
// if any, and otherwise the plans it can add.
//
// What the purchase does is the server's call, and the page asks
// before it confirms (the quote): during the launch promo nothing is
// charged and the plan runs until the promo ends, the same row
// registration writes. The dialog says "לתקופת ניסיון" and no date
// (R37 D1); the quote's promo_end only decides whether it says so.
//
// R37 4.1.2 · after the promo the plan is paid for. The dialog then
// says what will be charged and that the plan renews. The server charges
// the card and answers with the plan only if the charge went through.
//
// One approval, then the flow runs to its end (Yulian, 20.11). With no
// card on file the dialog says the card comes next; confirming opens the
// card page, and back from it "מנוי ותשלום" buys the plan by itself.
// Either way the provider lands on the new listing form of the category.
//
// Prices shown are the tiers' own, from /admin/marketplace. Nothing
// here is hard-coded.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Plus } from 'lucide-react';

import {
  marketplaceSubscriptionsApi,
  type CatalogCategory,
  type CatalogTier,
  type Subscription,
  type SubscriptionQuote,
} from '@/lib/api/marketplaceSubscriptions';
import { ApiError } from '@/lib/api/client';
import { mapApiError } from '@/lib/api/errors';
import { paymentApi } from '@/lib/api/payments';
import { isProviderCategory, paidTiers } from '@/lib/providerCategories';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PLUS_VAT, breakdownText } from '@/lib/vat';
import { buyAfterCard, listingHref, savePlanAdded } from '@/features/billing/providerPurchase';

function fmtPrice(nis: number): string {
  return `₪${nis.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

// Built from the string for a date-only value, so a viewer west of
// Greenwich does not read the day before.
function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export default function ProviderSubscribePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
      <ProviderSubscribeInner />
    </Suspense>
  );
}

function ProviderSubscribeInner() {
  const preset = useSearchParams()?.get('category') || null;
  const router = useRouter();

  const [catalog, setCatalog] = useState<CatalogCategory[]>([]);
  const [mine, setMine]       = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null);   // tier id being quoted
  const [pending, setPending] = useState<SubscriptionQuote | null>(null);
  // A paid plan with no card on file: confirming opens the card page.
  const [needsCard, setNeedsCard] = useState(false);
  const [buying, setBuying]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setLoadFailed(false);
    try {
      const [cats, subs] = await Promise.all([
        marketplaceSubscriptionsApi.catalog(),
        marketplaceSubscriptionsApi.mine(),
      ]);
      setCatalog(cats.filter((c) => isProviderCategory(c.code)));
      setMine(subs);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const activeByCategory = useMemo(() => {
    const map: Record<string, Subscription> = {};
    // is_current, not status: nothing flips status when a plan lapses,
    // and the server sells a new plan from that moment on.
    for (const s of mine) if (s.is_current) map[s.category_code] = s;
    return map;
  }, [mine]);

  // The category the provider came for is shown first.
  const ordered = useMemo(
    () => (preset ? [...catalog].sort((a, b) => Number(b.code === preset) - Number(a.code === preset)) : catalog),
    [catalog, preset],
  );

  async function ask(tier: CatalogTier) {
    setError(null); setQuoting(tier.id);
    try {
      const quote = await marketplaceSubscriptionsApi.quote(tier.id);
      // A purchase that will be charged needs a card. Asked before the
      // dialog, so the dialog can say the card comes next.
      let noCard = false;
      if (!quote.promo_end) {
        const cards = await paymentApi.methods();
        noCard = !cards.some((c) => c.status === 'active');
      }
      setNeedsCard(noCard);
      setPending(quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא הצלחנו לבדוק את המסלול. נסו שוב.');
    } finally {
      setQuoting(null);
    }
  }

  async function toCardPage(quote: SubscriptionQuote) {
    try {
      await buyAfterCard({ tierId: quote.tier.tier_id, category: quote.tier.category_code });
    } catch (e) {
      setPending(null); setBuying(false);
      setError(e instanceof Error ? e.message : 'לא הצלחנו לפתוח את עמוד הכרטיס. נסו שוב.');
    }
  }

  async function confirm() {
    if (!pending) return;
    setBuying(true); setError(null);
    if (needsCard) { await toCardPage(pending); return; }
    try {
      const plan = await marketplaceSubscriptionsApi.purchase(pending.tier.tier_id, true);
      savePlanAdded({
        category:      pending.tier.category_code,
        nis:           plan.charged_nis ?? null,
        invoiceUrl:    plan.invoice_url ?? null,
        invoiceNumber: plan.invoice_number ?? null,
      });
      router.push(listingHref(pending.tier.category_code));
    } catch (e) {
      const details = e instanceof ApiError
        ? (e.cause.details as { code?: string } | undefined)
        : undefined;
      if (details?.code === 'no_payment_method') {
        await toCardPage(pending);
        return;
      }
      setPending(null); setBuying(false);
      setError(mapApiError(e));
    }
  }

  const confirmMessage = pending
    ? [
        `מסלול "${pending.tier.name_he}" בקטגוריית ${pending.tier.category_name_he}: עד ${pending.tier.slot_count} מודעות.`,
        `מחיר המסלול ${fmtPrice(Number(pending.tier.price_nis))} ${PLUS_VAT} לתקופה של ${pending.tier.duration_days} ימים.`,
        pending.promo_end
          ? 'הפרסום ללא עלות לתקופת ניסיון. לא נחייב אותך ללא הודעה מראש.'
          : [
              needsCard
                ? 'בשלב הבא מזינים כרטיס אשראי בעמוד המאובטח של קארדקום, והמסלול מתווסף מיד כשהכרטיס מאושר.'
                : '',
              pending.vat
                ? `${needsCard ? 'החיוב' : 'באישור יחויב הכרטיס השמור שלך'}: ${breakdownText({ net: pending.vat.net_nis, percent: pending.vat.vat_percent, vat: pending.vat.vat_nis, total: pending.vat.total_nis })}.`
                : `${needsCard ? 'החיוב' : 'באישור יחויב הכרטיס השמור שלך'}: ${fmtPrice(Number(pending.tier.price_nis))} ${PLUS_VAT}.`,
              `המסלול מתחדש אוטומטית בכל ${pending.tier.duration_days} ימים, בחיוב הכרטיס במחיר המסלול באותו מועד ועוד מע"מ.`,
              'אפשר לכבות את החידוש האוטומטי בעמוד מנוי ותשלום.',
            ].filter(Boolean).join(' '),
      ].filter(Boolean).join(' ')
    : '';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">הוספת קטגוריה</h1>
        <p className="mt-1 text-sm text-slate-600 leading-relaxed">
          אפשר לפרסם רק בקטגוריה שיש בה מסלול פעיל. לכל קטגוריה מסלול משלה.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
          <span className="sr-only">טוען קטגוריות</span>
        </div>
      ) : loadFailed ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-red-400" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700">לא הצלחנו לטעון את הקטגוריות.</p>
          <Button type="button" onClick={() => void load()}>נסו שוב</Button>
        </div>
      ) : ordered.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-600">
          אין כרגע קטגוריות פתוחות לספקי שירות.
        </p>
      ) : (
        <ul className="space-y-4">
          {ordered.map((cat) => {
            const active = activeByCategory[cat.code];
            const tiers  = paidTiers(cat);
            return (
              <li key={cat.code} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-900">{cat.name_he}</h2>
                  {active && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      מסלול פעיל עד {fmtDate(active.expires_at)}
                    </span>
                  )}
                </div>

                {active ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-600">
                      {active.slots_used ?? 0} מתוך {active.slot_count} מודעות בשימוש
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/provider/marketplace/new?category=${encodeURIComponent(cat.code)}`}>פרסום מודעה</Link>
                    </Button>
                  </div>
                ) : tiers.length === 0 ? (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    אין מסלול זמין כרגע בקטגוריה זו.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {tiers.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{t.name_he}</p>
                          <p className="text-xs text-slate-500">
                            עד {t.slot_count} מודעות · לתקופה של {t.duration_days} ימים
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-slate-900 whitespace-nowrap"><span dir="ltr">{fmtPrice(t.price_nis)}</span> {PLUS_VAT}</span>
                          <Button type="button" size="sm" disabled={quoting !== null || buying} onClick={() => void ask(t)}>
                            {quoting === t.id
                              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              : <Plus className="h-4 w-4" aria-hidden="true" />}
                            הוספת מסלול
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!pending}
        title="הוספת מסלול"
        message={confirmMessage}
        confirmLabel={!pending || pending.promo_end ? 'אישור' : needsCard ? 'אישור והמשך להזנת כרטיס' : 'אישור וחיוב'}
        variant="primary"
        busy={buying}
        onConfirm={confirm}
        onCancel={() => { if (!buying) setPending(null); }}
      />
    </div>
  );
}
