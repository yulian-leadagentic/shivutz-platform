'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, X, AlertCircle } from 'lucide-react';
import { orgApi } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import type { Contractor } from '@/types';

/**
 * Banner shown on every contractor screen when the kablan_number has
 * not yet been verified against פנקס הקבלנים.
 *
 * Two states:
 *   approval_status === 'pending'  → "ממתין לאישור" — they typed a
 *       number, it didn't match, admin is reviewing. Not dismissible.
 *   kablan_verified_at IS NULL     → "השלם אימות מספר רישיון" — they
 *       never typed it (legacy registration). Dismissible per-session,
 *       reappears next visit.
 *
 * Skipped entirely once kablan_verified_at is set.
 */

const SESSION_KEY = 'kablan_banner_dismissed';

export function KablanVerifyBanner() {
  const { entityId, entityType } = useAuth();
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [dismissed, setDismissed]   = useState(false);

  useEffect(() => {
    if (entityType !== 'contractor' || !entityId) {
      setContractor(null);
      return;
    }
    // Read session-dismissed flag scoped to THIS contractor — switching
    // entities should re-evaluate from scratch.
    setDismissed(sessionStorage.getItem(`${SESSION_KEY}:${entityId}`) === '1');

    let cancelled = false;
    orgApi.getContractor(entityId)
      .then((c) => { if (!cancelled) setContractor(c); })
      .catch(() => { /* silent — no banner if we can't fetch state */ });
    return () => { cancelled = true; };
  }, [entityId, entityType]);

  if (!contractor) return null;
  if (contractor.kablan_verified_at) return null;     // already verified
  // approval_status='pending' is the mismatch case — show non-dismissible
  // "waiting for review" message instead of the regular nudge.
  const isPendingMismatch = contractor.approval_status === 'pending';
  if (!isPendingMismatch && dismissed) return null;

  function dismiss() {
    if (!entityId) return;
    sessionStorage.setItem(`${SESSION_KEY}:${entityId}`, '1');
    setDismissed(true);
  }

  if (isPendingMismatch) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
        <div className="flex-1 text-sm leading-relaxed">
          <p className="font-semibold">בקשת האימות בבדיקה</p>
          <p>
            הזנת מספר רישיון הקבלן והוא בבדיקה מול פנקס הקבלנים — בדרך כלל תוך 48 שעות.
            נשלח אליך SMS לאחר האישור.{' '}
            <Link href="/contractor/verify-kablan" className="underline font-medium">
              עדכן את המספר
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-brand-300 bg-brand-50 px-4 py-3 text-brand-900">
      <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0 text-brand-600" />
      <div className="flex-1 text-sm leading-relaxed">
        <p className="font-semibold">השלם אימות מול רשם הקבלנים</p>
        <p>
          הזן את מספר הרישיון שלך לאימות מול פנקס הקבלנים — שלב חיוני לפני חתימה על עסקאות.{' '}
          <Link href="/contractor/verify-kablan" className="underline font-medium">
            אמת עכשיו ←
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="הסתר"
        className="h-7 w-7 inline-flex items-center justify-center rounded-full text-brand-700 hover:bg-brand-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
