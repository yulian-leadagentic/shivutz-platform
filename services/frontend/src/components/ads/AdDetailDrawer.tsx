'use client';

// R38 item 6 · the ad screen a "פרסום חדש בפורטל" card opens.
//
// A card used to link to `/?reveal=<id>`, which ran the reveal at once:
// for a signed-in contractor that spent a reveal from the monthly quota
// and showed the result on a search row the home page does not have, so
// nothing visible happened. A card now opens this screen, and a reveal
// happens only on its "הצג פרטים" button, through the page's own reveal
// flow (quota, paywall, anonymous to registration), unchanged.
//
// Same drawer as the listing drawer (R32 S5): a side panel on desktop,
// a bottom sheet on a phone, Esc and the backdrop close it, focus stays
// inside while it is open and goes back to the card on close.
//
// What it shows is what the search already shows of an ad: the trade,
// the number of workers, origin, region, experience, the description and
// the "תאגיד רשום" badge for a worker ad; city, beds and price for
// housing. Never who the corporation is: that is what the reveal is for
// (decision of 19.09).

import { useCallback, useEffect, useRef } from 'react';
import { BadgeCheck, Home as HomeIcon, Loader2, Phone, Users, X } from 'lucide-react';

import type { ContactReveal } from '@/lib/api/search';

export interface AdScreenAd {
  id: string;
  ad_type: 'worker' | 'housing';
  title_he: string;
  body_he: string | null;
  region: string | null;
  profession_code: string | null;
  origin_country: string | null;
  quantity: number | null;
  experience_min_months?: number | null;
  city: string | null;
  available_beds: number | null;
  total_beds?: number | null;
  price_per_bed_nis: number | null;
  amenities?: string[] | null;
  published_at: string;
  trust_level?: string | null;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function experience(months?: number | null): string | null {
  if (!months || months <= 0) return null;
  if (months < 12) return months === 1 ? 'חודש אחד לפחות' : `${months} חודשים לפחות`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'שנה לפחות' : `${years} שנים לפחות`;
}

export function AdDetailDrawer({
  adId,
  ad,
  loading,
  failed,
  labels,
  revealed,
  revealing,
  onReveal,
  onClose,
}: {
  /** The id from `?ad=`, for the way back after logging in. */
  adId: string;
  ad: AdScreenAd | null;
  loading: boolean;
  /** The ad could not be loaded: gone, or the visitor may not see it. */
  failed: 'gone' | 'login' | 'error' | null;
  labels: { profession: (c: string) => string; origin: (c: string) => string; region: (c: string) => string };
  revealed: ContactReveal | null;
  revealing: boolean;
  onReveal: (adId: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const focusables = useCallback((): HTMLElement[] => {
    if (!panelRef.current) return [];
    return Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last  = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [focusables, onClose]);

  const isHousing = ad?.ad_type === 'housing';
  const rows: [string, string][] = [];
  if (ad && !isHousing) {
    if (ad.profession_code) rows.push(['מקצוע', labels.profession(ad.profession_code)]);
    if (ad.quantity) rows.push(['כמות', `${ad.quantity} עובדים`]);
    if (ad.origin_country) rows.push(['מוצא', labels.origin(ad.origin_country)]);
    if (ad.region) rows.push(['אזור', labels.region(ad.region)]);
    const exp = experience(ad.experience_min_months);
    if (exp) rows.push(['ניסיון', exp]);
  } else if (ad) {
    if (ad.city) rows.push(['עיר', ad.city]);
    if (ad.region) rows.push(['אזור', labels.region(ad.region)]);
    if (ad.available_beds) rows.push(['מיטות פנויות', ad.total_beds ? `${ad.available_beds} מתוך ${ad.total_beds}` : String(ad.available_beds)]);
    if (ad.price_per_bed_nis) rows.push(['מחיר למיטה', `₪${ad.price_per_bed_nis} לחודש`]);
  }

  return (
    <div className="listing-drawer" role="presentation">
      <div className="listing-drawer__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ad?.title_he ? `מודעה: ${ad.title_he}` : 'פרטי מודעה'}
        tabIndex={-1}
        className="listing-drawer__panel"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <span className="text-sm font-semibold text-slate-700">פרטי מודעה</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת פרטי המודעה"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-4 py-5">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
              <span className="sr-only">טוען את המודעה</span>
            </div>
          ) : !ad ? (
            <div role="alert" className="space-y-4 py-6 text-center">
              <p className="text-sm font-medium text-slate-700">
                {failed === 'gone'
                  ? 'המודעה כבר לא זמינה.'
                  : failed === 'login'
                    ? 'כדי לראות את המודעה יש להתחבר.'
                    : 'לא הצלחנו לטעון את המודעה. נסו שוב.'}
              </p>
              {failed === 'login' && adId && (
                <a
                  href={`/login?next=${encodeURIComponent(`/?ad=${adId}`)}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand-800 px-5 text-sm font-semibold text-white hover:bg-brand-900"
                >
                  להתחברות
                </a>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isHousing ? 'bg-slate-100 text-slate-700' : 'bg-brand-50 text-brand-800'}`}>
                  {isHousing ? <HomeIcon className="h-5 w-5" aria-hidden="true" /> : <Users className="h-5 w-5" aria-hidden="true" />}
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold leading-snug text-slate-900">{ad.title_he}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>פורסם ב-{fmtDate(ad.published_at)}</span>
                    {!isHousing && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        תאגיד רשום
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {rows.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {rows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="font-medium text-slate-900">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {isHousing && Array.isArray(ad.amenities) && ad.amenities.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="מה יש בדירה">
                  {ad.amenities.map((a) => (
                    <li key={a} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{a}</li>
                  ))}
                </ul>
              )}

              {ad.body_he && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{ad.body_he}</p>
              )}

              <div className="border-t border-slate-100 pt-4">
                {revealed ? (
                  <div className="space-y-2">
                    {revealed.company_name && <p className="text-sm font-semibold text-slate-900">{revealed.company_name}</p>}
                    {revealed.phone && (
                      <a href={`tel:${revealed.phone}`} dir="ltr" className="inline-flex min-h-[44px] items-center gap-2 text-base font-semibold text-slate-900">
                        <Phone className="h-4 w-4" aria-hidden="true" />
                        {revealed.phone}
                      </a>
                    )}
                    {revealed.email && (
                      <a href={`mailto:${revealed.email}`} dir="ltr" className="block text-sm text-brand-800 underline underline-offset-2">
                        {revealed.email}
                      </a>
                    )}
                    <p className="pt-1 text-xs text-slate-500">נשמר לך: לא ייגבו חשיפות נוספות על מודעה זו.</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onReveal(ad.id)}
                    disabled={revealing}
                    // The same button as on a result row.
                    className="results-cta min-h-[44px]"
                  >
                    {revealing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
                    הצג פרטים
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
