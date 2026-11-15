'use client';

// R37 4.1.5 · the charges made for marketplace plans, and the one thing
// an admin can do to one: return it to the card it came from.
//
// A refund moves money and nothing else. The plan it paid for is left
// as it is, because what a refunded plan should become is not decided;
// the confirm dialog says so before the admin confirms. The server
// allows a refund once, to an admin only, and writes an audit row
// whatever the outcome.

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RotateCcw } from 'lucide-react';

import { marketplaceChargesAdminApi, type AdminMarketplaceCharge } from '@/lib/api/payments';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const STATUS: Record<AdminMarketplaceCharge['status'], { label: string; cls: string }> = {
  charged:   { label: 'שולם',   cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  refunded:  { label: 'זוכה',   cls: 'border-slate-200 bg-slate-50 text-slate-700' },
  declined:  { label: 'נדחה',  cls: 'border-red-200 bg-red-50 text-red-800' },
  error:     { label: 'ללא תשובה מ-Cardcom', cls: 'border-amber-200 bg-amber-50 text-amber-900' },
  charging:  { label: 'חיוב לא הושלם · לבדוק ב-Cardcom', cls: 'border-amber-200 bg-amber-50 text-amber-900' },
  refunding: { label: 'זיכוי לא הושלם · לבדוק ב-Cardcom', cls: 'border-amber-200 bg-amber-50 text-amber-900' },
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function fmtPrice(nis: number): string {
  return `₪${Number(nis).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

type Notice = { kind: 'ok' | 'error'; text: string };

export function MarketplaceChargesAdmin() {
  const [charges, setCharges] = useState<AdminMarketplaceCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<AdminMarketplaceCharge | null>(null);
  const [busy, setBusy]       = useState(false);
  const [notice, setNotice]   = useState<Notice | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setCharges(await marketplaceChargesAdminApi.list());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function confirmRefund() {
    if (!pending) return;
    setBusy(true);
    setNotice(null);
    try {
      await marketplaceChargesAdminApi.refund(pending.id);
      setNotice({ kind: 'ok', text: `החיוב של ${pending.advertiser_name ?? 'המפרסם'} זוכה.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'הזיכוי נכשל.' });
    } finally {
      setPending(null);
      setBusy(false);
      await load();
    }
  }

  const refundMessage = pending
    ? [
        `${fmtPrice(pending.amount_nis)} יוחזרו לכרטיס של ${pending.advertiser_name ?? 'המפרסם'}.`,
        'המסלול עצמו לא משתנה: הוא נשאר כפי שהוא עד תאריך הסיום שלו.',
        'אי אפשר לבטל זיכוי אחרי שבוצע.',
        pending.mode === 'fake' ? 'החיוב נעשה במצב בדיקה, ולכן גם הזיכוי הוא במצב בדיקה ולא עובר כסף.' : '',
      ].filter(Boolean).join(' ')
    : '';

  return (
    <section aria-labelledby="plan-charges-admin" className="space-y-3">
      <div>
        <h2 id="plan-charges-admin" className="text-lg font-bold text-slate-900">חיובי מסלולים</h2>
        <p className="mt-1 text-sm text-slate-600">
          כל חיוב שנעשה עבור מסלול בשירותים הנלווים. זיכוי מחזיר את הסכום לכרטיס ואינו משנה את המסלול.
        </p>
      </div>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            notice.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {notice.kind === 'error'
            ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{notice.text}</span>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-24 items-center justify-center" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
          <span className="sr-only">טוען חיובים</span>
        </div>
      ) : loadFailed ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm text-slate-700">לא הצלחנו לטעון את החיובים.</p>
          <Button type="button" variant="outline" onClick={() => { setLoading(true); void load(); }}>נסו שוב</Button>
        </div>
      ) : charges.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
          עדיין לא נעשה חיוב עבור מסלול.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {charges.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {c.advertiser_name ?? c.entity_id}
                  <span className="font-normal text-slate-600">
                    {' · '}{c.category_name_he ?? c.category_code}{c.kind === 'renewal' ? ' · חידוש' : ' · רכישה'}
                  </span>
                </p>
                <p className="text-xs text-slate-600">
                  {fmtDate(c.created_at)} · <span dir="ltr">{fmtPrice(c.amount_nis)}</span>
                  {c.mode === 'fake' ? ' · מצב בדיקה' : ''}
                  {c.refunded_at ? ` · זוכה ב-${fmtDate(c.refunded_at)}` : ''}
                  {c.failure_reason && c.status !== 'charged' && c.status !== 'refunded' ? ` · ${c.failure_reason}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {c.invoice_url && (
                  <a
                    href={c.invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-800 underline underline-offset-2 focus-visible:rounded"
                  >
                    חשבונית{c.invoice_number ? ` ${c.invoice_number}` : ''}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">נפתח בחלון חדש</span>
                  </a>
                )}
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS[c.status].cls}`}>
                  {STATUS[c.status].label}
                </span>
                {c.status === 'charged' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => { setNotice(null); setPending(c); }}
                    aria-label={`זיכוי החיוב של ${c.advertiser_name ?? 'המפרסם'}, ${fmtPrice(c.amount_nis)}`}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    זיכוי
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pending}
        title="זיכוי חיוב"
        message={refundMessage}
        confirmLabel="זיכוי"
        cancelLabel="חזרה"
        variant="destructive"
        busy={busy}
        onConfirm={confirmRefund}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
