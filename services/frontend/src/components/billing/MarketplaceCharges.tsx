'use client';

// R37 4.1.2 · the charges made for an entity's marketplace plans, with
// the invoice Cardcom issued for each. The caller's own only: the
// server reads the entity from the session.
//
// Shows nothing until there is a charge to show.

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { marketplaceChargesApi, type MarketplaceCharge } from '@/lib/api/payments';

const STATUS: Record<MarketplaceCharge['status'], { label: string; cls: string }> = {
  charged:  { label: 'שולם',  cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  refunded: { label: 'זוכה',  cls: 'border-slate-200 bg-slate-50 text-slate-700' },
  declined: { label: 'נדחה', cls: 'border-red-200 bg-red-50 text-red-800' },
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function fmtPrice(nis: number): string {
  return `₪${Number(nis).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

export function MarketplaceCharges() {
  const [charges, setCharges] = useState<MarketplaceCharge[]>([]);

  useEffect(() => {
    let cancelled = false;
    marketplaceChargesApi.mine()
      .then((rows) => { if (!cancelled) setCharges(rows); })
      // The plans above are the page; a list that did not load is left out.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (charges.length === 0) return null;

  return (
    <section aria-labelledby="plan-charges" className="space-y-2">
      <h2 id="plan-charges" className="text-sm font-semibold text-slate-700">חיובים וחשבוניות</h2>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {charges.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">
                {c.category_name_he ?? c.category_code}
                {c.kind === 'renewal' ? ' · חידוש' : ''}
              </p>
              <p className="text-xs text-slate-600">
                {fmtDate(c.created_at)} · <span dir="ltr">{fmtPrice(c.amount_nis)}</span>
                {c.mode === 'fake' ? ' · מצב בדיקה, לא בוצע חיוב' : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
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
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
