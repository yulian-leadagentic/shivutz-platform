'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, MapPin, Users, CheckCircle2, Phone, Calendar,
  Home, Wrench, Briefcase, MoreHorizontal, AlertCircle, Share2,
  Building2, Sparkles, X,
} from 'lucide-react';
import { marketplaceApi } from '@/lib/api';
import type { MarketplaceListing } from '@/types';
import { Button } from '@/components/ui/button';
import { CATEGORY_HE_FALLBACK, PRICE_UNIT_HE, labelFor } from '@/lib/labels';
import {
  ListingInlineSponsor,
  ListingRailSponsor,
} from '@/features/advertising/MarketplaceSponsors';

// R32 S5 · the listing body, lifted out of /marketplace/[id]/page.tsx
// so the home page can show it without sending the visitor to another
// route. The route keeps its own page chrome and renders this inside;
// `ListingDetailDrawer` below wraps the same body in a dialog.
//
// Nothing inside the body changed in the move except two things the
// panel context requires, both marked R32 below: the login returnTo
// now carries the query string (on the home page the path alone is
// just `/`), and the "back to all listings" link becomes a close
// button when there is no page to go back to.

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  housing: Home, equipment: Wrench, services: Briefcase, other: MoreHorizontal,
};
const STATUS_HE: Record<string, { label: string; color: string }> = {
  active:  { label: 'זמין', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  rented:  { label: 'מושכר', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  sold:    { label: 'נמכר', color: 'text-slate-600 bg-slate-100 border-slate-200' },
  paused:  { label: 'מושהה', color: 'text-slate-500 bg-slate-50 border-slate-200' },
};

function daysAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (diff === 0) return 'היום';
  if (diff === 1) return 'אתמול';
  if (diff < 7)  return `לפני ${diff} ימים`;
  if (diff < 30) return `לפני ${Math.floor(diff / 7)} שבועות`;
  return `לפני ${Math.floor(diff / 30)} חודשים`;
}

export interface ListingDetailPanelProps {
  listingId: string;
  /** Panel mode only. Closes the dialog instead of linking away. */
  onClose?: () => void;
  /**
   * R32 S5.4 · run a worker search for this listing's area without
   * leaving the page. Offered on housing listings, where "I found beds,
   * now I need the crew" is the next question.
   */
  onCrossSearch?: (listing: MarketplaceListing) => void;
  /** Rail sponsor is a page-layout slot; the drawer has no gutter. */
  showRailSponsor?: boolean;
}

export default function ListingDetailPanel({
  listingId,
  onClose,
  onCrossSearch,
  showRailSponsor = true,
}: ListingDetailPanelProps) {
  const router = useRouter();
  const [listing, setListing] = useState<MarketplaceListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);
  // R15 §3c · reveal state. `revealed` holds the response of the
  // POST /marketplace/{id}/reveal call once the viewer has clicked
  // "הצג פרטים". `revealError` shows a plain message when the
  // reveal call comes back 401/403.
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed]   = useState<{
    contact_phone:    string | null;
    contact_name:     string | null;
    corporation_name: string | null;
  } | null>(null);
  const [revealError, setRevealError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setRevealed(null);
    setRevealError('');
    marketplaceApi.get(listingId)
      .then((l) => { if (!cancelled) setListing(l); })
      .catch(() => { if (!cancelled) setError('המודעה לא נמצאה'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listingId]);

  async function handleReveal() {
    setRevealError('');
    setRevealing(true);
    try {
      const r = await marketplaceApi.reveal(listingId);
      setRevealed({
        contact_phone:    r.contact_phone,
        contact_name:     r.contact_name,
        corporation_name: r.corporation_name,
      });
    } catch (e) {
      // R15 §3c · 401 sends anon to login; 403 shows the "בחשבון בבדיקה" copy.
      //
      // R32 S5 · the status is on `ApiError.cause.status`, not on the
      // error itself. The old check read `e.status`, which is always
      // undefined, so an anonymous visitor who asked for contact
      // details was told to make sure their account was approved —
      // advice with no account behind it. Both shapes are read here so
      // a plain `{status}` rejection still works.
      const err = e as { status?: number; cause?: { status?: number } } | undefined;
      const status = err?.cause?.status ?? err?.status;
      if (status === 401) {
        // R32 S5 · the search and the open panel both live in the
        // query string, so returnTo has to carry it or the visitor
        // comes back from login to a blank home page.
        const returnTo = window.location.pathname + window.location.search;
        router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }
      setRevealError('החשבון שלך אינו מורשה לצפות בפרטי קשר. אנא ודא שהחשבון אושר.');
    } finally {
      setRevealing(false);
    }
  }

  function handleShare() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin me-2" />טוען מודעה…
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-slate-500">
        <AlertCircle className="h-10 w-10 text-slate-300" />
        <p className="text-lg font-medium">{error || 'המודעה לא נמצאה'}</p>
        {onClose ? (
          <Button variant="outline" onClick={onClose}>סגירה</Button>
        ) : (
          <Link href="/?type=services">
            <Button variant="outline">חזור לשירותים נלווים</Button>
          </Link>
        )}
      </div>
    );
  }

  const Icon = CATEGORY_ICONS[listing.category] ?? MoreHorizontal;
  const catHe = labelFor(CATEGORY_HE_FALLBACK, listing.category);
  const statusInfo = STATUS_HE[listing.status];
  const catColor = listing.category === 'housing' ? 'bg-brand-500' :
                   listing.category === 'equipment' ? 'bg-amber-500' :
                   listing.category === 'services'  ? 'bg-emerald-500' : 'bg-slate-400';

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Main content */}
      <div className="lg:col-span-2 space-y-5">
        {/* Image gallery — first image as hero, rest as a horizontal
            strip below for quick browse. Falls back to the category
            color bar when no images. */}
        {Array.isArray(listing.images_json) && listing.images_json.length > 0 ? (
          <div className="space-y-2">
            <div className="aspect-[16/10] rounded-2xl overflow-hidden bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={listing.images_json[0]}
                alt={listing.title}
                className="w-full h-full object-cover"
                loading="eager"
              />
            </div>
            {listing.images_json.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {listing.images_json.slice(1).map((url, idx) => (
                  <div
                    key={url + idx}
                    className="shrink-0 h-20 w-28 rounded-lg overflow-hidden bg-slate-100 border border-slate-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={listing.title ?? ''} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`h-2 w-full ${catColor} rounded-full`} />
        )}

        {/* Title card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap gap-2 mb-3">
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                  listing.category === 'housing'   ? 'bg-brand-100 text-brand-700' :
                  listing.category === 'equipment' ? 'bg-amber-100 text-amber-700' :
                  listing.category === 'services'  ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  <Icon className="h-3 w-3" />
                  {catHe}
                </span>
                {statusInfo && (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statusInfo.color}`}>
                    {statusInfo.label}
                  </span>
                )}
                {!!listing.is_corporation_verified && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                    <CheckCircle2 className="h-3 w-3" />
                    תאגיד מאומת
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold text-slate-900 leading-snug">{listing.title}</h2>
            </div>
            <button onClick={handleShare} className="shrink-0 p-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-slate-500 hover:text-slate-700" title="שתף">
              <Share2 className="h-4 w-4" />
            </button>
          </div>
          {copied && <p className="text-xs text-emerald-600">הקישור הועתק ✓</p>}

          {/* Meta chips */}
          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            {listing.city && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-slate-400" />
                {listing.city}
              </span>
            )}
            {/* R30 §12a · MySQL TINYINT + JSX && trap.
                `is_furnished` comes back as 0/1 from MySQL, and
                `0 && <span/>` renders as the digit "0". `capacity`
                had the same shape. Coerce both before the guard. */}
            {listing.capacity != null && listing.capacity > 0 && (
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-slate-400" />
                עד {listing.capacity} עובדים
              </span>
            )}
            {!!listing.is_furnished && (
              <span className="text-emerald-700 font-medium">מרוהטת</span>
            )}
            {listing.available_from && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-slate-400" />
                זמין מ-{new Date(listing.available_from).toLocaleDateString('he-IL')}
              </span>
            )}
          </div>

          {/* Price */}
          {(listing.price != null || listing.price_unit === 'negotiable') && (
            <div className="pt-2 border-t border-slate-100">
              {listing.price != null ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold text-slate-900">
                    ₪{Number(listing.price).toLocaleString('he-IL')}
                  </span>
                  {listing.price_unit && listing.price_unit !== 'negotiable' && (
                    <span className="text-sm text-slate-500">{labelFor(PRICE_UNIT_HE, listing.price_unit)}</span>
                  )}
                </div>
              ) : (
                <span className="text-lg font-semibold text-slate-700">מחיר למשא ומתן</span>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        {listing.description && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6">
            <h3 className="text-base font-bold text-slate-900 mb-3">תיאור</h3>
            <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{listing.description}</p>
          </div>
        )}

        {/* R30 §12b · listing_inline, under the description.
            Category-targeted: a housing listing draws housing
            advertisers only, and when nothing matches the slot
            renders nothing rather than falling back to a generic ad. */}
        <ListingInlineSponsor category={listing.category} />

        {/* Posted date */}
        <p className="text-xs text-slate-400 text-center">
          פורסם {daysAgo(listing.created_at)}
        </p>
      </div>

      {/* Sidebar — contact card */}
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-4">
          {/* R15 §3a · corporation name rides the reveal endpoint —
              until the visitor clicks "הצג פרטים" they see only the
              identity-free trust badge. */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-slate-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">פורסם על ידי</p>
              <p className="text-sm font-semibold text-slate-900">
                {revealed?.corporation_name || listing.corporation_name || 'תאגיד'}
              </p>
              {!!listing.is_corporation_verified && (
                <p className="text-xs text-emerald-700 mt-0.5 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  תאגיד מאומת
                </p>
              )}
            </div>
          </div>

          {/* R15 §3c · reveal flow. Three states: the owner's own row,
              a viewer who already revealed this session, and a visitor
              who hasn't. 401 redirects to /login with returnTo; 403
              shows the "חשבון לא מאושר" message. */}
          {(listing.contact_name || listing.contact_phone) ? (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              {listing.contact_name && (
                <div className="text-sm text-slate-700">
                  <span className="text-xs text-slate-400 block mb-0.5">איש קשר</span>
                  {listing.contact_name}
                </div>
              )}
              {listing.contact_phone && (
                <a
                  href={`tel:${listing.contact_phone}`}
                  className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
                >
                  <Phone className="h-4 w-4" />
                  <span dir="ltr">{listing.contact_phone}</span>
                </a>
              )}
            </div>
          ) : revealed ? (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              {revealed.contact_name && (
                <div className="text-sm text-slate-700">
                  <span className="text-xs text-slate-400 block mb-0.5">איש קשר</span>
                  {revealed.contact_name}
                </div>
              )}
              {revealed.contact_phone && (
                <a
                  href={`tel:${revealed.contact_phone}`}
                  className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
                >
                  <Phone className="h-4 w-4" />
                  <span dir="ltr">{revealed.contact_phone}</span>
                </a>
              )}
            </div>
          ) : (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <button
                type="button"
                onClick={handleReveal}
                disabled={revealing}
                className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors min-h-[44px]"
              >
                {revealing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                הצג פרטי קשר
              </button>
              {revealError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {revealError}
                </p>
              )}
            </div>
          )}

          {/* R32 S5.4 · cross-flow discovery, in place. Beds found,
              crew still missing — so this runs a worker search for the
              same area instead of sending the visitor to another page.
              Housing only; "I need workers" is not the next thought
              after reading about scaffolding hire. */}
          {onCrossSearch && listing.category === 'housing' && (
            <button
              type="button"
              onClick={() => onCrossSearch(listing)}
              className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-brand-800 hover:text-brand-900 pt-1"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              מחפשים גם עובדים? חפשו כאן
            </button>
          )}

          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="block w-full text-center text-xs text-slate-400 hover:text-brand-800 transition-colors pt-1"
            >
              ← חזרה לתוצאות
            </button>
          ) : (
            <Link href="/?type=services" className="block text-center text-xs text-slate-400 hover:text-brand-600 transition-colors pt-1">
              ← חזור לכל המודעות
            </Link>
          )}
        </div>

        {/* R30 §12b · listing_rail, under the contact card. Desktop
            ≥1440 only (the component self-gates), category-targeted.
            Not drawn inside the drawer, which has no gutter to fill. */}
        {showRailSponsor && <ListingRailSponsor category={listing.category} />}
      </div>
    </div>
  );
}

// ─── Drawer shell (R32 S5.2 + S5.3) ──────────────────────────────────
//
// Side drawer from the inline-end at ≥lg, bottom sheet below. The
// dialog rules are the design system's: role="dialog" + aria-modal,
// focus trapped inside while open, Esc closes, and focus returns to
// whatever opened it.

export function ListingDetailDrawer({
  listingId,
  onClose,
  onCrossSearch,
}: {
  listingId: string;
  onClose: () => void;
  onCrossSearch?: (listing: MarketplaceListing) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Whatever had focus when the drawer opened — restored on close, so
  // a keyboard user lands back on the card they activated.
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
    // The panel itself takes focus first; its content arrives async, so
    // focusing a child here would race the fetch.
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
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
    // Hold the page still behind the drawer.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [focusables, onClose]);

  return (
    <div className="listing-drawer" role="presentation">
      <div
        className="listing-drawer__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="פרטי מודעה"
        tabIndex={-1}
        className="listing-drawer__panel"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3">
          <span className="text-sm font-semibold text-slate-700">פרטי מודעה</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת פרטי המודעה"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-5">
          <ListingDetailPanel
            listingId={listingId}
            onClose={onClose}
            onCrossSearch={onCrossSearch}
            showRailSponsor={false}
          />
        </div>
      </div>
    </div>
  );
}
