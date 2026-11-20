'use client';

import { sanitizeReturnTo } from '@/features/prospect/returnTo';
import type { SubscriptionTier } from '@/lib/api/payments';

const KEY = 'billing_return';
const TIERS: SubscriptionTier[] = ['basic', 'advanced', 'pro'];

export interface BillingReturn {
  to: string | null;
  tier: SubscriptionTier | null;
}

export function billingHref(returnTo: string): string {
  return `/billing?returnTo=${encodeURIComponent(returnTo)}`;
}

export function readBillingReturn(): BillingReturn {
  try {
    const raw = sessionStorage.getItem(KEY);
    const o = raw ? JSON.parse(raw) as { to?: string; tier?: string } : {};
    return {
      to:   sanitizeReturnTo(o.to ?? null),
      tier: TIERS.includes(o.tier as SubscriptionTier) ? o.tier as SubscriptionTier : null,
    };
  } catch {
    return { to: null, tier: null };
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

export function returnLine(to: string): string {
  const path = to.split('?')[0];
  if (path.startsWith('/corporation/ads/new')) return 'בסיום התשלום המודעה שלך תפורסם מיד.';
  if (to.includes('reveal=')) return 'בסיום התשלום פרטי הקשר שביקשת ייחשפו מיד.';
  if (path === '/corporation/ads') return 'בסיום התשלום נחזיר אותך למודעות שלך.';
  if (path.endsWith('/users')) return 'בסיום התשלום נחזיר אותך לניהול המשתמשים.';
  return 'בסיום התשלום נחזיר אותך לדף שממנו הגעת.';
}
