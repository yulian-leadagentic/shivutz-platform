'use client';

// Surfaces the corp's "official record" data from the
// רשות האוכלוסין וההגירה annual manpower-corps list.
//
// Three states:
//   1. Never matched (gov_registry_source_year is NULL)
//      → render nothing (a corp can still be tier_2 via the admin-
//        approval path; we don't want to make them feel inadequate).
//   2. Matched against the current latest year on file
//      → green panel showing the source year + matched_at + key fields.
//   3. Matched against an OLDER year than the latest on file
//      → amber warning: 'התאגיד לא מופיע ברשימה העדכנית של רשות האוכלוסין'
//        with a link to refresh.
//
// The latest-year-on-file is fetched from /admin/gov-corps-registry/years
// — that endpoint is public-read for any logged-in user (the data is
// already public via gov.il). If the fetch fails the section degrades
// gracefully (no warning shown, just the corp's own gov_registry_source_year).

import { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, CalendarDays, Phone, MapPin } from 'lucide-react';
import { adminApi } from '@/lib/adminApi';
import { orgApi } from '@/lib/api';
import type { Corporation } from '@/types';

interface Props {
  corpId: string;
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return iso; }
}

export function GovRegistrySection({ corpId }: Props) {
  const [corp, setCorp]       = useState<Corporation | null>(null);
  const [latestYear, setLatestYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!corpId) return;
    setLoading(true);
    Promise.all([
      orgApi.getCorporation(corpId).catch(() => null),
      adminApi.listGovCorpYears()
        .then((r) => r.years[0]?.source_year ?? null)
        .catch(() => null),
    ])
      .then(([c, y]) => {
        setCorp(c as Corporation | null);
        setLatestYear(y);
      })
      .finally(() => setLoading(false));
  }, [corpId]);

  if (loading) return null;
  if (!corp) return null;
  const matchedYear = corp.gov_registry_source_year ?? null;
  // Never matched → hide the section entirely. Corp got here through
  // the admin manual-approval path; we don't need to draw attention
  // to the gov list at all.
  if (matchedYear == null) return null;

  const isStale = latestYear != null && matchedYear < latestYear;

  return (
    <section className={`rounded-2xl border-2 p-4 sm:p-5 space-y-3 ${
      isStale
        ? 'border-amber-300 bg-amber-50/40'
        : 'border-emerald-300 bg-emerald-50/30'
    }`}>
      <header className="flex items-start gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
          isStale ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
        }`}>
          {isStale ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900">
            רשות האוכלוסין וההגירה
          </h3>
          <p className="text-sm text-slate-700 leading-relaxed">
            {isStale ? (
              <>
                התאגיד מאומת לפי רשימת קבלני כוח אדם לשנת <strong>{matchedYear}</strong>{' '}
                אך אינו מופיע ברשימה העדכנית של שנת <strong>{latestYear}</strong>.
                יש לוודא חידוש ההיתר מול הרשות.
              </>
            ) : (
              <>
                תאגיד מאושר ברשימת קבלני כוח אדם של רשות האוכלוסין וההגירה — היתר להעסיק עובדים זרים בענף הבניין,
                שנת <strong>{matchedYear}</strong>.
              </>
            )}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm pt-1">
        <Field icon={<CalendarDays className="h-4 w-4" />} label="שנת הרשימה" value={String(matchedYear)} />
        <Field icon={<CalendarDays className="h-4 w-4" />} label="עודכן במערכת" value={fmtDate(corp.gov_registry_matched_at)} />
        {corp.contact_phone && (
          <Field icon={<Phone className="h-4 w-4" />} label="טלפון נייד" value={corp.contact_phone} ltr />
        )}
        {corp.phone_landline && (
          <Field icon={<Phone className="h-4 w-4" />} label="טלפון משרד" value={corp.phone_landline} ltr />
        )}
        {corp.phone_mobile_secondary && (
          <Field icon={<Phone className="h-4 w-4" />} label="טלפון נוסף" value={corp.phone_mobile_secondary} ltr />
        )}
        {/* The address is held on the corporations row only when the
            gov list matched (we prefill it on registration). We don't
            have a dedicated address column on the model yet — when we
            add one this section will pick it up automatically. */}
        {(corp as unknown as { address?: string }).address && (
          <Field
            icon={<MapPin className="h-4 w-4" />}
            label="כתובת רשומה"
            value={(corp as unknown as { address: string }).address}
          />
        )}
      </div>
    </section>
  );
}

function Field({ icon, label, value, ltr }: {
  icon: React.ReactNode; label: string; value: string; ltr?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 bg-white/60 rounded-lg px-3 py-2">
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`font-semibold text-slate-900 truncate ${ltr ? 'ms-auto' : 'ms-auto'}`} dir={ltr ? 'ltr' : undefined}>{value}</span>
    </div>
  );
}
