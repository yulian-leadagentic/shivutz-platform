'use client';

// Public list of contractor searches waiting for a corp response.
// Phase 1 uses hand-written mock rows so we can ship the funnel before
// the backend exposes a redacted public-search endpoint. Phase 2 swaps
// MOCK_REQUESTS for a fetch to (e.g.) /api/searches/public-waiting,
// the row shape stays the same.
//
// The corp can browse anonymously — names + contact details are
// redacted to "קבלן N" + a small "לחשיפת פרטים" gate per row.
// Clicking any "השב לדרישה" CTA pops a register prompt; from there the
// existing /register/corporation flow takes over (skipping the OTP
// step since the prospect's phone is already verified).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, Users, MapPin, Calendar, Globe2, Lock,
  AlertCircle, UserPlus, ArrowLeft,
} from 'lucide-react';
import { ProfessionIcon } from '@/features/searches/ProfessionIcon';
import { readProspect } from '@/features/prospect/state';
import { HomeLink } from '@/components/HomeLink';

interface MockRequest {
  id: string;
  anon_contractor: string;         // "קבלן 1" / "קבלן 2" / ...
  profession_code: string;
  profession_he: string;
  quantity: number;
  region_he: string;
  origin_he?: string;              // optional country preference
  start_date_he: string;           // "בעוד שבועיים" / "מיידי" / ...
  posted_he: string;               // "לפני 2 שעות" / "היום" / ...
}

const MOCK_REQUESTS: MockRequest[] = [
  {
    id: 'r1', anon_contractor: 'קבלן 1',
    profession_code: 'skeleton', profession_he: 'פועלי שלד',
    quantity: 10, region_he: 'מרכז',
    start_date_he: 'בעוד שבועיים', posted_he: 'לפני 2 שעות',
  },
  {
    id: 'r2', anon_contractor: 'קבלן 2',
    profession_code: 'flooring', profession_he: 'ריצופים',
    quantity: 5, region_he: 'צפון', origin_he: 'אוקראינה',
    start_date_he: 'מיידי', posted_he: 'לפני 5 שעות',
  },
  {
    id: 'r3', anon_contractor: 'קבלן 3',
    profession_code: 'painting', profession_he: 'פועלי גמרים',
    quantity: 8, region_he: 'דרום',
    start_date_he: 'בעוד 30 יום', posted_he: 'היום',
  },
  {
    id: 'r4', anon_contractor: 'קבלן 4',
    profession_code: 'scaffolding', profession_he: 'רתכים',
    quantity: 4, region_he: 'מרכז', origin_he: 'מולדובה',
    start_date_he: 'בעוד שבוע', posted_he: 'אתמול',
  },
  {
    id: 'r5', anon_contractor: 'קבלן 5',
    profession_code: 'plumbing', profession_he: 'אינסטלטורים',
    quantity: 3, region_he: 'ירושלים',
    start_date_he: 'מיידי', posted_he: 'לפני 2 ימים',
  },
  {
    id: 'r6', anon_contractor: 'קבלן 6',
    profession_code: 'plastering', profession_he: 'טייחים',
    quantity: 12, region_he: 'צפון', origin_he: 'תאילנד',
    start_date_he: 'בעוד 10 ימים', posted_he: 'לפני 3 ימים',
  },
];

export default function TryCorporationImmediatePage() {
  const router = useRouter();
  const [openGate, setOpenGate] = useState<MockRequest | null>(null);

  // Stale-tab guard.
  useEffect(() => {
    if (typeof window !== 'undefined' && !readProspect()) {
      router.replace('/login?intent=corporation');
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6" dir="rtl">
      <div className="max-w-3xl mx-auto space-y-5">

        <div className="flex justify-end">
          <HomeLink />
        </div>

        <header className="space-y-1">
          <Link
            href="/try/corporation"
            className="inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
          >
            <ChevronRight className="w-3 h-3 me-1" /> חזרה
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">דרישות פתוחות לעובדים</h1>
          <p className="text-sm text-slate-600">
            קבלנים שמחפשים עובדים זמינים.
          </p>
        </header>

        {/* List of mock requests */}
        <div className="space-y-3">
          {MOCK_REQUESTS.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-4"
            >
              <ProfessionIcon
                code={r.profession_code}
                size={56}
                className="shrink-0 object-contain"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-bold text-slate-900">
                    {r.anon_contractor}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                    <Lock className="h-3 w-3" />
                    מוסתר עד להרשמה
                  </span>
                  <span className="text-xs text-slate-400">· {r.posted_he}</span>
                </div>
                <p className="text-sm text-slate-700 font-semibold">
                  <Users className="inline h-3.5 w-3.5 text-slate-400 -mt-0.5 me-1" />
                  {r.quantity} {r.profession_he}
                  {r.origin_he && ` מ${r.origin_he}`}
                </p>
                <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> אזור {r.region_he}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> {r.start_date_he}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenGate(r)}
                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors self-start sm:self-center"
              >
                השב לדרישה
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Quiet footnote about scale */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-start gap-2.5">
          <Globe2 className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500 leading-relaxed">
            רואה רק חלק קטן מהדרישות הפעילות בפלטפורמה. הרישום נותן גישה
            לכל הקבלנים, התראות SMS על דרישה חדשה שתואמת לעובדים שלך,
            ויכולת להגיש הצעות לעובדים זרים מחו"ל.
          </p>
        </div>
      </div>

      {/* Registration gate modal — fires when the corp clicks any
          "השב לדרישה" CTA. Same copy across all rows; the row itself
          is just context. */}
      {openGate && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
          onClick={() => setOpenGate(null)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  כדי להשיב לדרישה — צריך להירשם
                </h2>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">
                  לאחר הרשמה תוכל להעלות למערכת את העובדים הזמינים שלך
                  ולשלוח הצעות לקבלנים.
                </p>
              </div>
            </div>
            <Link
              href="/register/corporation?from=trial"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-base shadow-md transition-colors"
            >
              <UserPlus className="h-5 w-5" />
              המשך להרשמה
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={() => setOpenGate(null)}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700 py-1"
            >
              לא כרגע
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
