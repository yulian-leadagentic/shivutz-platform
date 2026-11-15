'use client';

// R34 5a · "מנוי ותשלום": the plans a service provider holds, one per
// category, and what it can do with each.
//
// Everything shown comes from the plan row and the tier catalog: the
// plan's name and size, how many of its listings are published, when
// it runs out, its price. Nothing here is hard-coded.
//
// What the three actions do is the server's call
// (routes/marketplace_subscriptions.py):
//   * renewal on / off   a flag on the plan.
//   * upgrade            the same plan on a bigger tier of the category.
//                        Free while the launch promo runs. A plan that
//                        was paid for is not offered it: what the move
//                        costs mid-period is not decided (R37 4.1.2).
//   * cancel             the plan ends now and its listings are paused,
//                        not deleted. Not offered on a paid plan either;
//                        its owner turns renewal off instead.
//
// R37 4.1.1 · the card block under the plans is the shared
// PaymentCardBlock: the card on file, and adding or replacing it on
// Cardcom's page. Under it, the charges made for the plans and their
// invoices (R37 4.1.2).

import { Suspense, useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowUpCircle, CheckCircle2, Layers, Loader2, Plus } from 'lucide-react';

import {
  marketplaceSubscriptionsApi,
  type CatalogCategory,
  type CatalogTier,
  type Subscription,
  type SubscriptionQuote,
} from '@/lib/api/marketplaceSubscriptions';
import { paidTiers } from '@/lib/providerCategories';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PaymentCardBlock } from '@/components/billing/PaymentCardBlock';
import { MarketplaceCharges } from '@/components/billing/MarketplaceCharges';

function fmtPrice(nis: number): string {
  return `₪${Number(nis).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

// Built from the string for a date-only value, so a viewer west of
// Greenwich does not read the day before.
function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

const TAP = 'min-h-11';

export default function ProviderBillingPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
      <ProviderBillingInner />
    </Suspense>
  );
}

type Notice = { kind: 'ok' | 'error'; text: string };

function ProviderBillingInner() {
  const preset = useSearchParams()?.get('category') || null;

  const [plans, setPlans]     = useState<Subscription[]>([]);
  const [catalog, setCatalog] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice]   = useState<Notice | null>(null);

  // The plan whose bigger tiers are listed. A provider sent here by a
  // full plan (?category=) arrives with that plan's list already open.
  const [upgradeOpen, setUpgradeOpen] = useState<string | null>(null);
  const [quoting, setQuoting]   = useState<string | null>(null);   // tier id being quoted
  const [pendingUpgrade, setPendingUpgrade] = useState<{ plan: Subscription; quote: SubscriptionQuote } | null>(null);
  const [pendingCancel, setPendingCancel]   = useState<Subscription | null>(null);
  const [busy, setBusy]         = useState(false);
  const [renewBusy, setRenewBusy] = useState<string | null>(null); // plan id being switched

  const load = useCallback(async (first = false) => {
    if (first) setLoading(true);
    setLoadFailed(false);
    try {
      const [subs, cats] = await Promise.all([
        marketplaceSubscriptionsApi.mine(),
        // The catalog only feeds the upgrade lists. Without it the
        // plans are still worth showing.
        marketplaceSubscriptionsApi.catalog().catch((): CatalogCategory[] => []),
      ]);
      setPlans(subs);
      setCatalog(cats);
      return subs;
    } catch {
      setLoadFailed(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(true).then((subs) => {
      if (cancelled || !subs || !preset) return;
      const target = subs.find((s) => s.is_current && s.category_code === preset);
      if (target) setUpgradeOpen(target.id);
    });
    return () => { cancelled = true; };
  }, [load, preset]);

  const running = useMemo(() => {
    const list = plans.filter((s) => s.is_current);
    return preset
      ? [...list].sort((a, b) => Number(b.category_code === preset) - Number(a.category_code === preset))
      : list;
  }, [plans, preset]);

  // R37 4.1.4 · paid plans whose renewal charge failed and is being
  // tried again. Not running, and not over either.
  const pastDue = useMemo(() => plans.filter((s) => s.status === 'past_due'), [plans]);

  // The latest ended plan of each category that has no running one.
  const ended = useMemo(() => {
    const withPlan = new Set([...running, ...pastDue].map((s) => s.category_code));
    const seen = new Set<string>();
    return plans.filter((s) => {
      if (s.is_current || withPlan.has(s.category_code) || seen.has(s.category_code)) return false;
      seen.add(s.category_code);
      return true;
    });
  }, [plans, running, pastDue]);

  function biggerTiers(plan: Subscription): CatalogTier[] {
    const cat = catalog.find((c) => c.code === plan.category_code);
    return cat ? paidTiers(cat).filter((t) => t.slot_count > plan.slot_count) : [];
  }

  async function switchRenewal(plan: Subscription) {
    setNotice(null); setRenewBusy(plan.id);
    try {
      if (plan.auto_renew) await marketplaceSubscriptionsApi.cancelAutoRenew(plan.id);
      else                 await marketplaceSubscriptionsApi.enableAutoRenew(plan.id);
      setPlans((prev) => prev.map((s) => (s.id === plan.id ? { ...s, auto_renew: !plan.auto_renew } : s)));
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'העדכון נכשל. נסו שוב.' });
    } finally {
      setRenewBusy(null);
    }
  }

  // Asks the server first, so the dialog can say whether the launch
  // promo still covers this move before the provider confirms it.
  async function askUpgrade(plan: Subscription, tier: CatalogTier) {
    setNotice(null); setQuoting(tier.id);
    try {
      setPendingUpgrade({ plan, quote: await marketplaceSubscriptionsApi.quote(tier.id) });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'לא הצלחנו לבדוק את המסלול. נסו שוב.' });
    } finally {
      setQuoting(null);
    }
  }

  async function confirmUpgrade() {
    if (!pendingUpgrade) return;
    const { plan, quote } = pendingUpgrade;
    setBusy(true);
    try {
      await marketplaceSubscriptionsApi.upgrade(plan.id, quote.tier.tier_id);
      setPendingUpgrade(null); setUpgradeOpen(null);
      await load();
      setNotice({ kind: 'ok', text: 'המסלול שודרג.' });
    } catch (e) {
      setPendingUpgrade(null);
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'השדרוג נכשל. נסו שוב.' });
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!pendingCancel) return;
    setBusy(true);
    try {
      const out = await marketplaceSubscriptionsApi.cancel(pendingCancel.id);
      setPendingCancel(null); setUpgradeOpen(null);
      await load();
      const n = out.listings_paused;
      setNotice({
        kind: 'ok',
        text: n === 0 ? 'המסלול בוטל.'
          : n === 1 ? 'המסלול בוטל. מודעה אחת ירדה מהפרסום.'
          : `המסלול בוטל. ${n} מודעות ירדו מהפרסום.`,
      });
    } catch (e) {
      setPendingCancel(null);
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'הביטול נכשל. נסו שוב.' });
    } finally {
      setBusy(false);
    }
  }

  const upgradeMessage = pendingUpgrade
    ? [
        `מעבר למסלול "${pendingUpgrade.quote.tier.name_he}" בקטגוריית ${pendingUpgrade.quote.tier.category_name_he}: עד ${pendingUpgrade.quote.tier.slot_count} מודעות.`,
        `מחיר המסלול ${fmtPrice(pendingUpgrade.quote.tier.price_nis)} לתקופה של ${pendingUpgrade.quote.tier.duration_days} ימים.`,
        pendingUpgrade.quote.promo_end
          ? 'הפרסום ללא עלות לתקופת ניסיון. לא נחייב אותך ללא הודעה מראש.'
          : '',
      ].filter(Boolean).join(' ')
    : '';

  const cancelUsed = pendingCancel?.slots_used ?? 0;
  const cancelMessage = pendingCancel
    ? [
        `המסלול בקטגוריית ${pendingCancel.category_name_he ?? ''} יסתיים מיד.`,
        cancelUsed === 1
          ? 'המודעה שפרסמת בקטגוריה תרד מהפרסום ותישמר בחשבון.'
          : cancelUsed > 1
            ? `${cancelUsed} המודעות שפרסמת בקטגוריה יירדו מהפרסום ויישמרו בחשבון.`
            : '',
        'כדי לפרסם שוב בקטגוריה יהיה צורך במסלול פעיל.',
      ].filter(Boolean).join(' ')
    : '';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">מנוי ותשלום</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            המסלולים שלך, לפי קטגוריה. אפשר לפרסם רק בקטגוריה שיש בה מסלול פעיל.
          </p>
        </div>
        <Button asChild variant="outline" className={TAP}>
          <Link href="/provider/marketplace/subscribe">
            <Layers className="h-4 w-4" aria-hidden="true" />
            הוספת קטגוריה
          </Link>
        </Button>
      </div>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            notice.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {notice.kind === 'error'
            ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{notice.text}</span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
          <span className="sr-only">טוען מסלולים</span>
        </div>
      ) : loadFailed ? (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-red-400" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700">לא הצלחנו לטעון את המסלולים.</p>
          <Button type="button" className={TAP} onClick={() => void load(true)}>נסו שוב</Button>
        </div>
      ) : (
        <>
          {pastDue.length > 0 && (
            <ul className="space-y-3">
              {pastDue.map((plan) => (
                <li key={plan.id} role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5">
                  <p className="flex items-center gap-2 text-base font-bold text-red-900">
                    <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {plan.category_name_he} · החידוש לא הצליח
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-red-900">
                    לא הצלחנו לחייב את הכרטיס השמור עבור חידוש המסלול.
                    {plan.next_attempt_at && <> ננסה שוב ב-{fmtDate(plan.next_attempt_at)}.</>}
                    {' '}אם הכרטיס הוחלף, החיוב ייעשה בכרטיס החדש.
                    אם גם הניסיונות הבאים לא יצליחו, המסלול יסתיים והמודעות שבו יירדו מהפרסום.
                  </p>
                </li>
              ))}
            </ul>
          )}

          {running.length === 0 && pastDue.length > 0 ? null : running.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
              <p className="text-base font-semibold text-slate-900">אין לך מסלול פעיל</p>
              <p className="text-sm text-slate-600">כדי לפרסם מודעה יש להוסיף מסלול בקטגוריה.</p>
              <Button asChild className={TAP}>
                <Link href="/provider/marketplace/subscribe">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  הוספת מסלול
                </Link>
              </Button>
            </div>
          ) : (
            <ul className="space-y-4">
              {running.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  tiers={biggerTiers(plan)}
                  upgradeOpen={upgradeOpen === plan.id}
                  onToggleUpgrade={() => setUpgradeOpen((open) => (open === plan.id ? null : plan.id))}
                  onPickTier={(tier) => void askUpgrade(plan, tier)}
                  onCancel={() => { setNotice(null); setPendingCancel(plan); }}
                  onSwitchRenewal={() => void switchRenewal(plan)}
                  renewBusy={renewBusy === plan.id}
                  quoting={quoting}
                  busy={busy}
                />
              ))}
            </ul>
          )}

          <PaymentCardBlock />

          <MarketplaceCharges />

          {ended.length > 0 && (
            <section aria-labelledby="ended-plans" className="space-y-2">
              <h2 id="ended-plans" className="text-sm font-semibold text-slate-700">מסלולים שהסתיימו</h2>
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {ended.map((plan) => (
                  <li key={plan.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{plan.category_name_he}</p>
                      <p className="text-xs text-slate-500">
                        {plan.status === 'cancelled' && plan.cancelled_at
                          ? `בוטל ב-${fmtDate(plan.cancelled_at)}`
                          : `הסתיים ב-${fmtDate(plan.expires_at)}`}
                      </p>
                    </div>
                    <Link
                      href={`/provider/marketplace/subscribe?category=${encodeURIComponent(plan.category_code)}`}
                      className={`${TAP} inline-flex items-center text-sm font-semibold text-brand-800 underline underline-offset-2 focus-visible:rounded`}
                    >
                      הוספת מסלול בקטגוריה
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!pendingUpgrade}
        title="שדרוג המסלול"
        message={upgradeMessage}
        confirmLabel="אישור"
        variant="primary"
        busy={busy}
        onConfirm={confirmUpgrade}
        onCancel={() => setPendingUpgrade(null)}
      />
      <ConfirmDialog
        open={!!pendingCancel}
        title="ביטול המסלול"
        message={cancelMessage}
        confirmLabel="ביטול המסלול"
        cancelLabel="חזרה"
        variant="destructive"
        busy={busy}
        onConfirm={confirmCancel}
        onCancel={() => setPendingCancel(null)}
      />
    </div>
  );
}

function PlanCard({
  plan, tiers, upgradeOpen, onToggleUpgrade, onPickTier, onCancel, onSwitchRenewal, renewBusy, quoting, busy,
}: {
  plan: Subscription;
  tiers: CatalogTier[];
  upgradeOpen: boolean;
  onToggleUpgrade: () => void;
  onPickTier: (tier: CatalogTier) => void;
  onCancel: () => void;
  onSwitchRenewal: () => void;
  renewBusy: boolean;
  quoting: string | null;
  busy: boolean;
}) {
  const titleId = useId();
  const renewLabelId = useId();
  const upgradeListId = useId();
  const used  = plan.slots_used ?? 0;
  const total = plan.slot_count;
  const full  = used >= total;
  // A plan a charge paid for. Moving it to a bigger tier and ending it
  // early are both undecided for a paid plan, and the server refuses
  // both, so neither is offered.
  const paidPlan = !!plan.payment_transaction_id;
  const share = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold text-slate-900">{plan.category_name_he}</h2>
          <p className="text-sm text-slate-600">
            {plan.tier_name_he ? `מסלול ${plan.tier_name_he} · ` : ''}עד {total} מודעות
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          פעיל
        </span>
      </div>

      <div className="mt-4 space-y-1.5">
        <p className="text-sm font-medium text-slate-900">{used} מתוך {total} מודעות בשימוש</p>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div
            className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-emerald-600'}`}
            style={{ width: `${share}%` }}
          />
        </div>
        {full && (
          <p className="text-xs text-amber-800">
            כל המודעות במסלול בשימוש. כדי לפרסם מודעה נוספת יש לשדרג את המסלול או להשהות מודעה קיימת.
          </p>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-slate-500">{plan.auto_renew ? 'מועד חידוש' : 'בתוקף עד'}</dt>
        <dd className="font-medium text-slate-900">{fmtDate(plan.expires_at)}</dd>
        <dt className="text-slate-500">מחיר המסלול</dt>
        <dd className="font-medium text-slate-900">
          <span dir="ltr">{fmtPrice(plan.price_nis)}</span> לתקופה של {plan.duration_days} ימים
        </dd>
      </dl>

      {plan.promo_note && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          הפרסום ללא עלות לתקופת ניסיון. לא נחייב אותך ללא הודעה מראש.
        </p>
      )}
      {paidPlan && plan.auto_renew && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          במועד החידוש יחויב הכרטיס השמור במחיר המסלול באותו מועד. כיבוי החידוש האוטומטי מונע את החיוב.
        </p>
      )}

      <div className="mt-3 flex min-h-11 items-center justify-between gap-3 border-t border-slate-100 pt-2">
        <span id={renewLabelId} className="text-sm font-medium text-slate-900">חידוש אוטומטי</span>
        <button
          type="button"
          role="switch"
          aria-checked={plan.auto_renew}
          aria-labelledby={`${renewLabelId} ${titleId}`}
          disabled={renewBusy}
          onClick={onSwitchRenewal}
          className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg focus-visible:rounded-lg disabled:opacity-60"
        >
          <span
            className={`flex h-6 w-11 items-center rounded-full px-0.5 ${
              plan.auto_renew ? 'justify-end bg-emerald-600' : 'justify-start bg-slate-300'
            }`}
          >
            <span className="h-5 w-5 rounded-full bg-white shadow" />
          </span>
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {!full && (
          <Button asChild className={TAP}>
            <Link href={`/provider/marketplace/new?category=${encodeURIComponent(plan.category_code)}`}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              פרסום מודעה
            </Link>
          </Button>
        )}
        {tiers.length > 0 && !paidPlan && (
          <Button
            type="button"
            variant="outline"
            className={TAP}
            aria-expanded={upgradeOpen}
            aria-controls={upgradeListId}
            onClick={onToggleUpgrade}
          >
            <ArrowUpCircle className="h-4 w-4" aria-hidden="true" />
            שדרוג המסלול
          </Button>
        )}
        {!paidPlan && (
          <Button
            type="button"
            variant="ghost"
            className={`${TAP} text-red-700 hover:bg-red-50 hover:text-red-800`}
            disabled={busy}
            onClick={onCancel}
          >
            ביטול המסלול
          </Button>
        )}
      </div>

      {tiers.length > 0 && !paidPlan && (
        <ul id={upgradeListId} hidden={!upgradeOpen} className="mt-3 space-y-2">
          {tiers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{t.name_he}</p>
                <p className="text-xs text-slate-500">
                  עד {t.slot_count} מודעות · לתקופה של {t.duration_days} ימים
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="whitespace-nowrap text-sm font-bold text-slate-900" dir="ltr">{fmtPrice(t.price_nis)}</span>
                <Button type="button" className={TAP} disabled={quoting !== null || busy} onClick={() => onPickTier(t)}>
                  {quoting === t.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  מעבר למסלול
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
