'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api/client';

// Fixes list ג, item 6 (Yulian, 18.11): every price in the system is
// before VAT, and a charge is the price plus VAT. The rate is the one in
// force today (payment_db.vat_periods, edited from the admin settings
// page); the payment service charges with the same rounding as here.

export const PLUS_VAT = '+ מע"מ';

export interface VatBreakdown {
  net: number;
  percent: number;
  vat: number;
  total: number;
}

// VAT to the agora, half up: agorot of VAT = price in shekels × percent.
export function withVat(net: number, percent: number): VatBreakdown {
  const netAgorot = Math.round(net * 100);
  const vatAgorot = Math.round(net * percent);
  return { net: netAgorot / 100, percent, vat: vatAgorot / 100, total: (netAgorot + vatAgorot) / 100 };
}

export function fmtNis(n: number): string {
  const whole = Number.isInteger(n);
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// "₪150 לפני מע"מ, מע"מ 18% ₪27, סה"כ לחיוב ₪177"
export function breakdownText(b: VatBreakdown): string {
  return `${fmtNis(b.net)} לפני מע"מ, מע"מ ${b.percent}% ${fmtNis(b.vat)}, סה"כ לחיוב ${fmtNis(b.total)}`;
}

export const vatApi = {
  current: () => apiFetch<{ percent: number }>('/payments/settings/vat'),
};

// The rate for a confirm step. null while loading or when it could not be
// read; the page then shows the price with "+ מע"מ" and no total.
export function useVatPercent(): number | null {
  const [percent, setPercent] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    vatApi.current().then((r) => { if (live) setPercent(r.percent); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return percent;
}
