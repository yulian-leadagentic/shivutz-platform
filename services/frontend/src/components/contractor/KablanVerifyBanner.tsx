'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { orgApi } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import type { Contractor } from '@/types';

/**
 * Banner above every contractor screen, shown only while the kablan
 * check is waiting on something:
 *
 *   approval_status === 'pending'  the number they typed did not match
 *       and an admin is reviewing it, or the registry could not be
 *       reached at registration ('registry_unreachable').
 *
 * R38 item 1: a contractor who is already approved and simply has no
 * kablan_verified_at used to get a third "upgrade" banner here, on
 * every screen. The dashboard's "אימות" card makes the same offer, so
 * it was said twice, the second time in a warning colour. That banner
 * is gone; the offer stays in the card.
 */
export function KablanVerifyBanner() {
  const { entityId, entityType } = useAuth();
  const [contractor, setContractor] = useState<Contractor | null>(null);

  useEffect(() => {
    if (entityType !== 'contractor' || !entityId) {
      setContractor(null);
      return;
    }
    let cancelled = false;
    orgApi.getContractor(entityId)
      .then((c) => { if (!cancelled) setContractor(c); })
      .catch(() => { /* no banner if the state cannot be read */ });
    return () => { cancelled = true; };
  }, [entityId, entityType]);

  if (!contractor) return null;
  if (contractor.kablan_verified_at) return null;
  // Only a check that is waiting gets a banner. 'pending' has two
  // sub-states (L2 §4c): the number did not match and is in review, or
  // data.gov.il was down at registration ('registry_unreachable'),
  // which is "try again", not a rejection.
  if (contractor.approval_status !== 'pending') return null;

  if (contractor.verification_method === 'registry_unreachable') {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
        <div className="flex-1 text-sm leading-relaxed">
          <p className="font-semibold">לא הצלחנו לאמת מול פנקס הקבלנים כרגע</p>
          <p>
            שירות הפנקס אינו זמין ברגע ההרשמה שלך. אנחנו ננסה שוב אוטומטית, או שאפשר לנסות עכשיו.{' '}
            <Link href="/contractor/verify-kablan" className="underline font-medium">
              נסה שוב עכשיו
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
      <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
      <div className="flex-1 text-sm leading-relaxed">
        <p className="font-semibold">בקשת האימות בבדיקה</p>
        <p>
          הזנת מספר רישיון הקבלן והוא בבדיקה מול פנקס הקבלנים, בדרך כלל תוך 48 שעות.
          נשלח אליך SMS לאחר האישור.{' '}
          <Link href="/contractor/verify-kablan" className="underline font-medium">
            עדכן את המספר
          </Link>
        </p>
      </div>
    </div>
  );
}
