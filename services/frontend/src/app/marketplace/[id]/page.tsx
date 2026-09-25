'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, ArrowRight, MapPin, Users, CheckCircle2,
  Phone, Calendar, Home, Wrench, Briefcase, MoreHorizontal,
  AlertCircle, Share2, Building2,
} from 'lucide-react';
import { marketplaceApi } from '@/lib/api';
import type { MarketplaceListing } from '@/types';
import { Button } from '@/components/ui/button';
import { CATEGORY_HE_FALLBACK, PRICE_UNIT_HE, labelFor } from '@/lib/labels';
import {
  SponsorProvider,
  ListingInlineSponsor,
  ListingRailSponsor,
} from '@/features/advertising/MarketplaceSponsors';

// U8 §1 — CATEGORY_HE_FALLBACK and PRICE_UNIT_HE moved to
// lib/labels.ts. The icons stay local (they aren't labels, and the
// icon set is shared only within the marketplace domain).
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

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router  = useRouter();
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
    marketplaceApi.get(id).then(setListing).catch(() => setError('המודעה לא נמצאה')).finally(() => setLoading(false));
  }, [id]);

  async function handleReveal() {
    setRevealError('');
    setRevealing(true);
    try {
      const r = await marketplaceApi.reveal(id);
      setRevealed({
        contact_phone:    r.contact_phone,
        contact_name:     r.contact_name,
        corporation_name: r.corporation_name,
      });
    } catch (e) {
      // R15 §3c · 401 sends anon to login; 403 shows the "בחשבון בבדיקה" copy.
      const err = e as { status?: number } | undefined;
      if (err?.status === 401) {
        const returnTo = window.location.pathname;
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
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin me-2" />טוען מודעה…
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-slate-500">
        <AlertCircle className="h-10 w-10 text-slate-300" />
        <p className="text-lg font-medium">{error || 'המודעה לא נמצאה'}</p>
        <Link href="/marketplace">
          <Button variant="outline">חזור לשירותים נלווים</Button>
        </Link>
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
    // R30 §12b · SponsorProvider so the two listing slots dedupe
    // against each other — without it an advertiser who bought both
    // listing_rail and listing_inline would appear twice on one page
    // (the R29 §5 rule: an ad in two placements shows once).
    <SponsorProvider>
    <div className="min-h-screen bg-slate-50">
      {/* Header bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
            <ArrowRight className="h-4 w-4" />
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <Link href="/marketplace" className="text-sm text-slate-500 hover:text-brand-600 transition-colors">
            שירותים נלווים
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-sm text-slate-700 truncate font-medium">{listing.title}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
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
                  <h1 className="text-xl font-bold text-slate-900 leading-snug">{listing.title}</h1>
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
                    `0 && <span/>` renders as the digit "0" — the
                    stray zero Yulian screenshotted in the meta row.
                    `capacity` had the same shape (a 0 count would
                    render "0"). Coerce both to boolean before the
                    guard. */}
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
                <h2 className="text-base font-bold text-slate-900 mb-3">תיאור</h2>
                <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{listing.description}</p>
              </div>
            )}

            {/* R30 §12b · listing_inline, under the description. The
                page was empty from here down. Category-targeted: a
                housing listing draws housing advertisers only, and
                when nothing matches the slot renders nothing rather
                than falling back to a generic ad. */}
            <ListingInlineSponsor category={listing.category} />

            {/* Posted date */}
            <p className="text-xs text-slate-400 text-center">
              פורסם {daysAgo(listing.created_at)}
            </p>
          </div>

          {/* Sidebar — contact card */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-4 sticky top-20">
              {/* R15 §3a · corporation name rides the reveal endpoint —
                  until the visitor clicks "הצג פרטים" they see only
                  the identity-free trust badge. The Building2 icon is
                  the placeholder art. `revealed.corporation_name` (or
                  listing.corporation_name for the owner's own view)
                  replaces the generic 'תאגיד' label after reveal. */}
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

              {/* R15 §3c · reveal flow. Three states:
                  1. owner's own row (listing.contact_phone present) →
                     show inline like before.
                  2. viewer already revealed this session → show the
                     `revealed` payload.
                  3. visitor hasn't revealed → orange "הצג פרטים"
                     button that POSTs /marketplace/{id}/reveal. 401
                     redirects to /login with returnTo; 403 shows a
                     "חשבון לא מאושר" message. */}
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

              <Link href="/marketplace" className="block text-center text-xs text-slate-400 hover:text-brand-600 transition-colors pt-1">
                ← חזור לכל המודעות
              </Link>
            </div>

            {/* R30 §12b · listing_rail, under the contact card — the
                ~530px of dead space in the left column. Desktop ≥1440
                only (the component self-gates), category-targeted, and
                below the fold so it doesn't count against the §5
                above-fold ceiling. */}
            <ListingRailSponsor category={listing.category} />
          </div>
        </div>
      </main>
    </div>
    </SponsorProvider>
  );
}
