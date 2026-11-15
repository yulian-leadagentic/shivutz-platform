'use client';

// R37 4.1.1 · the card an entity pays with: what is on file, and the
// way to add or replace it.
//
// The card is never typed here. "הוספת כרטיס" asks the payment service
// for a card page and sends the browser to it (Cardcom's page). Cardcom
// sends the browser back to this same page with ?card_setup=<id>, and
// the block then asks the server whether the card was saved. The server
// answers by asking Cardcom, so nothing in the address bar decides it.
//
// What is shown of a card is what the server keeps of it: brand, last
// four digits, expiry, holder name.
//
// Used by the provider's "מנוי ותשלום" page. It reads the caller's
// entity from the session, so it can sit on any entity's billing page.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, CreditCard, Loader2 } from 'lucide-react';

import { paymentApi } from '@/lib/api/payments';
import type { PaymentMethod } from '@/types';
import { Button } from '@/components/ui/button';

const BRAND: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  americanexpress: 'American Express',
  isracard: 'ישראכרט',
  diners: 'Diners',
  maestro: 'Maestro',
  discover: 'Discover',
  privatecard: 'כרטיס אשראי',
  fake: 'כרטיס בדיקה',
};

const TAP = 'min-h-11';
const HEBREW = /[֐-׿]/;

type Notice = { kind: 'ok' | 'error' | 'wait'; text: string };

function expiry(card: PaymentMethod): string {
  if (!card.expiry_month || !card.expiry_year) return '';
  return `${String(card.expiry_month).padStart(2, '0')}/${String(card.expiry_year % 100).padStart(2, '0')}`;
}

export function PaymentCardBlock({
  onCard,
}: {
  /** Told whenever the card on file is known or changes. */
  onCard?: (card: PaymentMethod | null) => void;
}) {
  const router   = useRouter();
  const pathname = usePathname();
  const params   = useSearchParams();
  const setupId  = params?.get('card_setup') || null;

  const [card, setCard]       = useState<PaymentMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pendingSetup, setPendingSetup] = useState<string | null>(null);
  const [notice, setNotice]   = useState<Notice | null>(null);
  const handled = useRef<string | null>(null);
  const box     = useRef<HTMLElement | null>(null);

  const onCardRef = useRef(onCard);
  useEffect(() => { onCardRef.current = onCard; }, [onCard]);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const methods = await paymentApi.methods();
      const current = methods.find((m) => m.is_default && m.status === 'active')
        ?? methods.find((m) => m.status === 'active') ?? null;
      setCard(current);
      onCardRef.current?.(current);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const check = useCallback(async (id: string) => {
    setChecking(true);
    setNotice(null);
    try {
      const out = await paymentApi.confirmCardSetup(id);
      if (out.status === 'completed') {
        setPendingSetup(null);
        setNotice({ kind: 'ok', text: 'הכרטיס נשמר.' });
        await load();
      } else if (out.status === 'pending') {
        setPendingSetup(id);
        setNotice({ kind: 'wait', text: 'הכרטיס עדיין לא אושר. אם סיימת להזין את הפרטים, אפשר לבדוק שוב.' });
      } else {
        setPendingSetup(null);
        const said = out.reason && HEBREW.test(out.reason) ? ` (${out.reason})` : '';
        setNotice({ kind: 'error', text: `הכרטיס לא נשמר${said}. אפשר לנסות שוב.` });
      }
    } catch (e) {
      setPendingSetup(id);
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'לא הצלחנו לבדוק את הכרטיס. נסו שוב.' });
    } finally {
      setChecking(false);
    }
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  // Back from the card page: ask once, then take the marker out of the
  // address so a reload does not ask again.
  useEffect(() => {
    if (!setupId || handled.current === setupId) return;
    handled.current = setupId;
    void check(setupId);
    const rest = new URLSearchParams(params?.toString() ?? '');
    rest.delete('card_setup');
    rest.delete('card_result');
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : (pathname ?? '/'), { scroll: false });
  }, [setupId, check, params, pathname, router]);

  // The answer about a card is shown inside this block, which sits
  // under the plans. Brought into view when there is one to read.
  useEffect(() => {
    if (notice) box.current?.scrollIntoView({ block: 'center' });
  }, [notice]);

  async function open() {
    setOpening(true);
    setNotice(null);
    try {
      const { url } = await paymentApi.setupCard();
      window.location.assign(url);
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'לא הצלחנו לפתוח את עמוד הכרטיס. נסו שוב.' });
      setOpening(false);
    }
  }

  const busy = opening || checking;
  const brand = card ? (BRAND[(card.card_brand ?? '').toLowerCase()] ?? 'כרטיס אשראי') : '';
  const until = card ? expiry(card) : '';

  return (
    <section ref={box} aria-labelledby="payment-card-title" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <h2 id="payment-card-title" className="text-lg font-bold text-slate-900">אמצעי תשלום</h2>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            notice.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800'
              : notice.kind === 'wait' ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {notice.kind === 'ok'
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{notice.text}</span>
        </div>
      )}

      {loading || (checking && !card) ? (
        <div className="mt-4 flex min-h-11 items-center gap-2 text-sm text-slate-600" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />
          {checking ? 'בודקים את הכרטיס מול חברת הסליקה' : 'טוען אמצעי תשלום'}
        </div>
      ) : loadFailed ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700">לא הצלחנו לטעון את אמצעי התשלום.</p>
          <Button type="button" variant="outline" className={TAP} onClick={() => { setLoading(true); void load(); }}>
            נסו שוב
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {card ? (
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <CreditCard className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {brand}
                  {card.last_4_digits && (
                    <>
                      {' '}
                      <span dir="ltr" className="font-mono">•••• {card.last_4_digits}</span>
                    </>
                  )}
                </p>
                <p className="text-xs text-slate-600">
                  {until && <>בתוקף עד <span dir="ltr">{until}</span></>}
                  {until && card.card_holder_name ? ' · ' : ''}
                  {card.card_holder_name}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-700">אין כרטיס שמור.</p>
          )}

          <div className="flex flex-wrap gap-2">
            {pendingSetup && (
              <Button type="button" variant="outline" className={TAP} disabled={busy} onClick={() => void check(pendingSetup)}>
                {checking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                בדיקה שוב
              </Button>
            )}
            <Button type="button" variant={card ? 'outline' : 'default'} className={TAP} disabled={busy} onClick={() => void open()}>
              {opening && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {card ? 'החלפת כרטיס' : 'הוספת כרטיס'}
            </Button>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        פרטי הכרטיס מוזנים בעמוד התשלום של Cardcom. מספר הכרטיס המלא אינו נשמר במערכת.
      </p>
    </section>
  );
}
