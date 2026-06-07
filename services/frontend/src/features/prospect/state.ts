// Prospect session — represents a phone that has passed OTP but doesn't
// yet have a user record (no JWT). We persist this in sessionStorage so
// the trial pages (/try/contractor/*) and the prospect-aware register
// page can all read the same source of truth without re-doing the OTP.
//
// Created by /login on the prospect response from POST /auth/login/otp.
// Cleared by /register/contractor on successful registration (we also
// auto-purge after `expires_at` on read).

'use client';

import { useEffect, useState } from 'react';

export interface ProspectSession {
  phone: string;
  intent: 'contractor' | 'corporation';
  /** ISO string — backend grants 15 minutes of "register" OTP grace.
   *  We mirror that on the client so a stale tab can detect expiry
   *  without round-tripping to the API. */
  expires_at: string;
}

/** Pending search the prospect filled in /try/contractor. We replay it
 *  against POST /searches as soon as registration succeeds. */
export interface PendingSearch {
  recruitment_type: 'domestic' | 'foreign';
  profession_type: string;
  quantity: number;
  start_date: string;
  end_date?: string;
  region?: string;
  min_experience: number;
  origin_preference: string[];
  required_languages: string[];
}

const PROSPECT_KEY = 'prospect';
const PENDING_SEARCH_KEY = 'pending_search';

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; }
  catch { return null; }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function clear(key: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(key);
}

export function readProspect(): ProspectSession | null {
  const p = readJson<ProspectSession>(PROSPECT_KEY);
  if (!p) return null;
  // Auto-expire stale sessions — the backend OTP grace is 15 min, so
  // anything past expires_at can't successfully register anyway.
  if (new Date(p.expires_at).getTime() < Date.now()) {
    clear(PROSPECT_KEY);
    return null;
  }
  return p;
}

export function clearProspect() { clear(PROSPECT_KEY); }

export function readPendingSearch(): PendingSearch | null {
  return readJson<PendingSearch>(PENDING_SEARCH_KEY);
}
export function writePendingSearch(s: PendingSearch) {
  writeJson(PENDING_SEARCH_KEY, s);
}
export function clearPendingSearch() { clear(PENDING_SEARCH_KEY); }

/** React hook — reads prospect from sessionStorage on mount, returns
 *  null during SSR. Returns null after expiry too. */
export function useProspect(): ProspectSession | null {
  const [p, setP] = useState<ProspectSession | null>(null);
  useEffect(() => { setP(readProspect()); }, []);
  return p;
}
