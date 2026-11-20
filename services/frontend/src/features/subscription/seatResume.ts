'use client';

import { paymentApi } from '@/lib/api/payments';
import { writeBillingReturn } from '@/features/billing/billingReturn';
import type { SeatUpgradeDetail } from './SeatUpgradeModal';

const KEY = 'seat_resume';
export const SEAT_RESUME_PATH = '/contractor/users?resume=seats';

export interface InviteDraft {
  phone: string;
  role: string;
  jobTitle: string;
  firstName: string;
  lastName: string;
}

export interface SeatResume {
  count: number;
  detail: SeatUpgradeDetail;
  invite: InviteDraft | null;
}

export function seatsAddedLine(count: number): string {
  return count === 1 ? 'מושב אחד נוסף לחשבון. ' : `${count} מושבים נוספו לחשבון. `;
}

export function seatKey(): string {
  return `sk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function buySeatsAfterCard(resume: SeatResume): Promise<void> {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(resume));
  } catch {}
  writeBillingReturn({ to: SEAT_RESUME_PATH, tier: null, cardOnly: true });
  const { url } = await paymentApi.setupCard();
  window.location.assign(url);
}

export function takeSeatResume(): SeatResume | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const o = raw ? JSON.parse(raw) as SeatResume : null;
    return o && Number.isInteger(o.count) && o.count >= 1 && o.detail ? o : null;
  } catch {
    return null;
  }
}
