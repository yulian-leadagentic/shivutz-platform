'use client';

import { paymentApi } from '@/lib/api/payments';

const PENDING = 'provider_purchase';
const ADDED   = 'provider_plan_added';

export interface PendingPurchase {
  tierId: string;
  category: string;
  /** Set when the card is for paying this past_due plan, not buying. */
  planId?: string;
}

export interface PlanAdded {
  category: string;
  nis: number | null;
  invoiceUrl: string | null;
  invoiceNumber: string | null;
}

export function listingHref(category: string): string {
  return `/provider/marketplace/new?category=${encodeURIComponent(category)}`;
}

// Saves the plan the provider confirmed and opens the card page. The
// card page comes back to /provider/billing, which buys the plan once
// the card is saved.
export async function buyAfterCard(p: PendingPurchase): Promise<void> {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify(p));
  } catch {}
  const { url } = await paymentApi.setupCard();
  window.location.assign(url);
}

export function readPendingPurchase(): PendingPurchase | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    const o = raw ? JSON.parse(raw) as Partial<PendingPurchase> : null;
    if (!o || typeof o.tierId !== 'string' || typeof o.category !== 'string') return null;
    return typeof o.planId === 'string'
      ? { tierId: o.tierId, category: o.category, planId: o.planId }
      : { tierId: o.tierId, category: o.category };
  } catch {
    return null;
  }
}

export function clearPendingPurchase(): void {
  try {
    sessionStorage.removeItem(PENDING);
  } catch {}
}

export function savePlanAdded(p: PlanAdded): void {
  try {
    sessionStorage.setItem(ADDED, JSON.stringify(p));
  } catch {}
}

// Read once: the notice is shown on arrival and not on a later visit.
export function takePlanAdded(category: string): PlanAdded | null {
  try {
    const raw = sessionStorage.getItem(ADDED);
    sessionStorage.removeItem(ADDED);
    const o = raw ? JSON.parse(raw) as PlanAdded : null;
    return o && o.category === category ? o : null;
  } catch {
    return null;
  }
}
