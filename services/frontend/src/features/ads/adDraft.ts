'use client';

import type { AdCreateInput, AdType } from '@/lib/api/ads';

const KEY = 'ad_draft_pending';

export function saveAdDraft(draft: AdCreateInput): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {}
}

export function readAdDraft(type: AdType): AdCreateInput | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const draft = raw ? JSON.parse(raw) as AdCreateInput : null;
    return draft && draft.ad_type === type && typeof draft.title_he === 'string' ? draft : null;
  } catch {
    return null;
  }
}

export function clearAdDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

export function wantsResume(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('resume') === '1';
  } catch {
    return false;
  }
}

export function formInitial<T>(draft: AdCreateInput): Partial<T> {
  return Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => key !== 'ad_type' && value !== undefined && value !== null),
  ) as Partial<T>;
}
