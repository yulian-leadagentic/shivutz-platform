'use client';

// Shown once a deal's J5 hold has been captured (payment_status =
// 'captured'). Replaces the GraceBadge — its "החיוב מתבצע כעת"
// copy reads as misleading after the money has already moved.
//
// Surfaces, from the captured transaction record:
//   * charged amount (matches what was authorized at commit time)
//   * clearance auth code (provider_response_code from Cardcom)
//   * "הורד חשבונית" button → invoice_url
//   * "חשבונית נשלחה ל-{email}" line — corp's contact email,
//     which is where Cardcom mailed the receipt at capture time.

import { CheckCircle2, FileText, Mail, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  /** Amount actually captured, in ILS. Comes from
   *  transaction.amount, or as a fallback from the deal record
   *  (payment_amount_estimated → commission_amount). */
  amount?: number | null;
  /** Cardcom clearance response code (provider_response_code).
   *  Treated as the human-readable "authorization number" — what a
   *  bookkeeper would quote when reconciling. */
  authCode?: string | null;
  /** Pre-signed invoice URL from Cardcom (invoice_url). When null,
   *  the download button is hidden — receipt still went out by email. */
  invoiceUrl?: string | null;
  /** Invoice number from Cardcom — shown alongside the auth code. */
  invoiceNumber?: string | null;
  /** Recipient email — the corp's contact_email, which is where
   *  the receipt was mailed at capture time. */
  recipientEmail?: string | null;
  /** ISO timestamp of the actual capture moment (charged_at). */
  chargedAtIso?: string | null;
}

// MySQL TIMESTAMP comes back without timezone but is UTC.
// Normalise so the displayed capture time matches real elapsed.
function parseUtcMs(iso: string): number {
  let s = iso.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
  return new Date(s).getTime();
}

function formatChargedAt(iso: string): string {
  return new Date(parseUtcMs(iso)).toLocaleString('he-IL', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function formatIls(n: number): string {
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CapturedBadge({
  amount,
  authCode,
  invoiceUrl,
  invoiceNumber,
  recipientEmail,
  chargedAtIso,
}: Props) {
  return (
    <div className="bg-emerald-50 border border-emerald-300 rounded-2xl px-4 py-3.5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-2">
          {/* Headline: charge happened + amount */}
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              ✓ הסכום חויב
              {amount != null && (
                <span className="ms-1 font-extrabold">— {formatIls(Number(amount))}</span>
              )}
            </p>
            {chargedAtIso && (
              <p className="text-[11px] text-emerald-700/80 mt-0.5">
                חויב ב-<span className="font-semibold">{formatChargedAt(chargedAtIso)}</span>
              </p>
            )}
          </div>

          {/* Auth + invoice numbers — quoted by bookkeepers when
              reconciling, so prominent + monospace. */}
          {(authCode || invoiceNumber) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {authCode && (
                <span className="inline-flex items-center gap-1.5 text-emerald-800">
                  <Receipt className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-emerald-700">מס׳ אישור סליקה:</span>
                  <span className="font-mono font-semibold tabular-nums" dir="ltr">{authCode}</span>
                </span>
              )}
              {invoiceNumber && (
                <span className="inline-flex items-center gap-1.5 text-emerald-800">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-emerald-700">חשבונית:</span>
                  <span className="font-mono font-semibold tabular-nums" dir="ltr">{invoiceNumber}</span>
                </span>
              )}
            </div>
          )}

          {/* Where the receipt was emailed. Skip line if we don't
              know the recipient — better than printing a fake. */}
          {recipientEmail && (
            <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              חשבונית נשלחה ל-<span className="font-semibold" dir="ltr">{recipientEmail}</span>
            </p>
          )}
        </div>

        {invoiceUrl && (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-100 shrink-0"
          >
            <a href={invoiceUrl} target="_blank" rel="noopener noreferrer">
              <FileText className="h-3.5 w-3.5" />
              הורד חשבונית
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
