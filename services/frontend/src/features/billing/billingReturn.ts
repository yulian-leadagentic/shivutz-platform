'use client';

import { sanitizeReturnTo } from '@/features/prospect/returnTo';
import type { SubscriptionTier } from '@/lib/api/payments';

const KEY = 'billing_return';
const TIERS: SubscriptionTier[] = ['basic', 'advanced', 'pro'];

export interface BillingReturn {
  to: string | null;
  tier: SubscriptionTier | null;
  /** The flow needed only a card: once it is saved, go back. */
  cardOnly: boolean;
}

export function billingHref(returnTo: string): string {
  return `/billing?returnTo=${encodeURIComponent(returnTo)}`;
}

export function readBillingReturn(): BillingReturn {
  try {
    const raw = sessionStorage.getItem(KEY);
    const o = raw ? JSON.parse(raw) as { to?: string; tier?: string; cardOnly?: boolean } : {};
    return {
      to:       sanitizeReturnTo(o.to ?? null),
      tier:     TIERS.includes(o.tier as SubscriptionTier) ? o.tier as SubscriptionTier : null,
      cardOnly: o.cardOnly === true,
    };
  } catch {
    return { to: null, tier: null, cardOnly: false };
  }
}

export function writeBillingReturn(patch: Partial<BillingReturn>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...readBillingReturn(), ...patch }));
  } catch {}
}

export function clearBillingReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

export function returnLine(to: string, cardOnly = false): string {
  const path = to.split('?')[0];
  if (cardOnly) return 'בסיום הזנת הכרטיס נחזיר אותך להמשך הפעולה.';
  if (path.startsWith('/corporation/ads/new')) return 'בסיום התשלום המודעה שלך תפורסם מיד.';
  if (to.includes('reveal=')) return 'בסיום התשלום פרטי הקשר שביקשת ייחשפו מיד.';
  if (path === '/corporation/ads') return 'בסיום התשלום נחזיר אותך למודעות שלך.';
  if (path.endsWith('/users')) return 'בסיום התשלום נחזיר אותך לניהול המשתמשים.';
  return 'בסיום התשלום נחזיר אותך לדף שממנו הגעת.';
}
