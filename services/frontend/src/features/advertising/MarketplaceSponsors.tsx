'use client';

/**
 * U7 §5 · marketplace sponsor placements + R5 §3 · home sponsor slots.
 *
 * Two surfaces per host page:
 *   - Banner    · full-width strip. One creative at a time; rotates
 *                 on refresh (backend orders by RAND()).
 *   - Carousel  · R20 §1 · CSS scroll-snap on mobile (horizontal
 *                 swipe, next card peeks at the edge). At `sm` and
 *                 above collapses back to a responsive grid. No
 *                 auto-scroll, no arrows, no third-party library —
 *                 scroll-snap alone. Previous docstring claimed
 *                 "scrolls on mobile" but the CSS was grid-cols-1;
 *                 fixed together with this comment.
 *
 * Both hit the SAME endpoint (/ads/public/sponsored) with a
 * ?placement= param — the backend gates every allowed value
 * separately so nothing leaks across surfaces. `SponsorBanner` and
 * `SponsorCarousel` are the parameterised components; the named
 * `MarketplaceSponsor*` / `HomeSponsor*` wrappers are what callers
 * actually import so grep-for-placement stays honest.
 *
 * F3 · "no sections without active ads" — if the endpoint returns
 * zero rows, the component renders NOTHING (not a placeholder, not
 * a skeleton, not a "coming soon"). Migration 078 seeds marketplace
 * rows; home_banner / home_carousel rows are seeded in the R5 §3
 * follow-up seeder (docs/cc-prompts/…).
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useAdImpression } from '@/hooks/useAdImpression';
import { postAdEvent, type AdPlacement } from '@/lib/adEvents';

// R6 §1a · translate placement strings the backend uses into the
// terser 'placement' enum on promo_events.metadata_json. The
// original strings are longer than we want to store per row, and
// the enum keeps admin-stats filtering readable.
function placementBucket(raw: string): AdPlacement {
  if (raw.startsWith('marketplace')) return 'marketplace';
  if (raw.includes('carousel'))      return 'carousel';
  if (raw.includes('banner'))        return 'featured';
  return 'inline';
}

interface SponsorAd {
  id:              string;
  advertiser_name: string;
  headline_he:     string;
  body_he:         string | null;
  chips_he:        string[] | null;
  cta_label_he:    string;
  cta_url:         string | null;
  logo_url:        string | null;
  // R20 §3 · finished-creative overrides. When creative_url is
  // present the client renders the image and IGNORES the
  // headline/body/chips model. w/h drive the aspect-ratio wrapper
  // that reserves layout space and prevents CLS on load.
  creative_url:    string | null;
  creative_w:      number | null;
  creative_h:      number | null;
  brand_bg:        string | null;
  brand_fg:        string | null;
}

async function fetchSponsored(placement: string, limit: number): Promise<SponsorAd[]> {
  try {
    const res = await apiFetch<{ results: SponsorAd[] }>(
      `/ads/public/sponsored?placement=${encodeURIComponent(placement)}&limit=${limit}`,
    );
    return res.results ?? [];
  } catch {
    return [];   // network / auth blip → hide the section, F3-safe
  }
}

// Parameterised banner. Named exports below (Marketplace/Home) pin
// the placement string so grep-for-placement stays honest.
function SponsorBanner({ placement, label }: { placement: string; label?: string }) {
  const [ad, setAd] = useState<SponsorAd | null>(null);
  useEffect(() => {
    fetchSponsored(placement, 1).then((rows) => setAd(rows[0] ?? null));
  }, [placement]);

  // R6 §1a · one impression per (ad, page load) when this banner is
  // ≥50% visible for ≥1s. The hook returns early when targetId is
  // undefined (fetch still pending) and re-registers when the ad
  // arrives.
  const observeRef = useAdImpression({ targetId: ad?.id, placement: placementBucket(placement) });

  if (!ad) return null;
  const bg = ad.brand_bg ?? '#1e293b';
  const fg = ad.brand_fg ?? '#ffffff';
  const handleClick = () => {
    if (!ad.cta_url) return;
    postAdEvent({
      event_type: 'ad_click', target_type: 'sponsor_ad',
      target_id: ad.id, placement: placementBucket(placement),
    });
  };

  // R20 §3 · when the ad ships a finished creative, render the
  // image and forget the headline/body/chips model. The whole card
  // is a single anchor so a click anywhere fires ad_click, per
  // §3c. `object-fit: contain` prevents cropping — a bizi-style
  // legal disclaimer at the bottom of the image survives even if
  // the aspect ratio is a shade off the 1.91:1 banner spec.
  if (ad.creative_url) {
    const aspectStyle = ad.creative_w && ad.creative_h
      ? { aspectRatio: `${ad.creative_w} / ${ad.creative_h}` }
      : {};
    const inner = (
      <img
        src={ad.creative_url}
        alt={ad.advertiser_name}
        className="w-full h-full object-contain block"
        loading="lazy"
      />
    );
    return (
      <div ref={observeRef} className="mb-6">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
          {label ?? 'מודעה ממומנת'}
        </div>
        <div className="rounded-2xl overflow-hidden shadow-sm bg-white"
             style={{ ...aspectStyle, backgroundColor: bg }}>
          {ad.cta_url ? (
            <a href={ad.cta_url} target="_blank" rel="noopener noreferrer sponsored"
               onClick={handleClick} className="block w-full h-full">
              {inner}
            </a>
          ) : inner}
        </div>
      </div>
    );
  }

  return (
    <div ref={observeRef} className="mb-6">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
        {label ?? 'מודעה ממומנת'}
      </div>
      {/* R20 §2 · mobile banner compact layout.
          Was `flex flex-col sm:flex-row` — mobile stacked logo,
          headline+body, and CTA in THREE separate rows (~180px).
          Now: logo + headline share row 1 (via a nested flex), CTA
          drops as row 2. body_he is hidden below sm because the
          headline + brand line is what carries the message on a
          380px screen; body_he still shows from sm+ where there's
          room. Total mobile height ~72-88px vs ~180px before. */}
      <div
        className="rounded-2xl px-4 sm:px-6 py-3 sm:py-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4"
        style={{ backgroundColor: bg, color: fg }}
      >
        <div className="flex items-center gap-3 min-w-0 w-full sm:flex-1">
          {ad.logo_url && (
            <img src={ad.logo_url} alt="" className="h-8 sm:h-12 w-auto shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-base sm:text-lg font-bold leading-tight truncate">{ad.headline_he}</h3>
            {ad.body_he && (
              <p className="hidden sm:block text-sm opacity-90 mt-1 leading-relaxed">{ad.body_he}</p>
            )}
          </div>
        </div>
        {ad.cta_url ? (
          <a
            href={ad.cta_url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={handleClick}
            className="shrink-0 inline-flex items-center bg-white/95 hover:bg-white text-slate-900 text-xs sm:text-sm font-semibold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-colors"
          >
            {ad.cta_label_he}
          </a>
        ) : (
          <span className="shrink-0 inline-flex items-center bg-white/20 text-xs sm:text-sm font-semibold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg opacity-80">
            {ad.cta_label_he}
          </span>
        )}
      </div>
    </div>
  );
}

function SponsorCarousel({ placement, label }: { placement: string; label?: string }) {
  const [ads, setAds] = useState<SponsorAd[]>([]);
  useEffect(() => {
    fetchSponsored(placement, 4).then(setAds);
  }, [placement]);

  if (ads.length === 0) return null;
  const bucket = placementBucket(placement);

  return (
    <div className="mb-6">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
        {label ?? 'שירותים ממומנים'}
      </div>
      {/* R20 §1 · TWO layouts by breakpoint, one container per layout.
          Mobile (<sm): horizontal scroll-snap strip. Each card is
          ~82vw with `snap-start` so the NEXT card peeks at the edge —
          the peek is the whole "there's more, swipe" signal, and the
          reason we deliberately don't hit 100vw. `snap-mandatory`
          keeps the scroll from stopping between cards.
          Desktop (sm+): the responsive grid stays exactly as before.
          `.sponsor-carousel-scroll` (globals.css) hides the WebKit +
          Firefox scrollbar — a peek plus scrollbar is visual noise;
          the peek alone is the affordance.
          NO auto-scroll, NO arrows, NO carousel library. Yulian §1
          rule + guardrail: those trigger ad-blocker installs. */}
      <div className="sm:hidden -mx-4 px-4">
        <div
          role="region"
          aria-label={label ?? 'שירותים ממומנים'}
          className="sponsor-carousel-scroll flex overflow-x-auto snap-x snap-mandatory gap-3 pb-1"
        >
          {ads.map((ad) => (
            <div
              key={ad.id}
              className="snap-start shrink-0"
              style={{ width: '82vw' }}
            >
              <CarouselCard ad={ad} placement={bucket} />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden sm:grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {ads.map((ad) => (
          <CarouselCard key={ad.id} ad={ad} placement={bucket} />
        ))}
      </div>
    </div>
  );
}

// ── Named wrappers. Import these, not the parameterised bases, so
//    the file's grep footprint mirrors what's actually rendered on
//    each page. Adding a new placement = add a new wrapper.
export function MarketplaceSponsorBanner()   { return <SponsorBanner   placement="marketplace_banner"   />; }
export function MarketplaceSponsorCarousel() { return <SponsorCarousel placement="marketplace_carousel" />; }
export function HomeSponsorBanner()          { return <SponsorBanner   placement="home_banner"          />; }
export function HomeSponsorCarousel()        { return <SponsorCarousel placement="home_carousel"        />; }

function CarouselCard({ ad, placement }: { ad: SponsorAd; placement: AdPlacement }) {
  const bg = ad.brand_bg ?? '#0f172a';
  const fg = ad.brand_fg ?? '#ffffff';
  // R6 §1a · per-card impression. Each carousel slide is its own
  // observed element — a card that never scrolls into view does
  // NOT count. §1a: "מודעה שנשלפה ולא נראתה — אין impression".
  // R20 §1b · with the mobile scroll-snap strip cards 2-N sit
  // OUTSIDE the visible viewport until the user swipes; the
  // IntersectionObserver only fires on scroll-in. That's the
  // intended behaviour — expect fewer mobile impressions on
  // late cards, that IS the fix. Do not adjust the observer.
  const observeRef = useAdImpression({ targetId: ad.id, placement });
  const handleClick = () => {
    if (!ad.cta_url) return;
    postAdEvent({
      event_type: 'ad_click', target_type: 'sponsor_ad',
      target_id: ad.id, placement,
    });
  };

  // R20 §3 · creative_url branch — same rendering rule as SponsorBanner.
  // Card = image + anchor wrapper. No headline/body/chips overlay.
  if (ad.creative_url) {
    const aspectStyle = ad.creative_w && ad.creative_h
      ? { aspectRatio: `${ad.creative_w} / ${ad.creative_h}` }
      : { aspectRatio: '1 / 1' };  // fall back to square (R20 §3a spec)
    const inner = (
      <img
        src={ad.creative_url}
        alt={ad.advertiser_name}
        className="w-full h-full object-contain block"
        loading="lazy"
      />
    );
    return (
      <div ref={observeRef}
           className="rounded-xl overflow-hidden shadow-sm h-full"
           style={{ ...aspectStyle, backgroundColor: bg }}>
        {ad.cta_url ? (
          <a href={ad.cta_url} target="_blank" rel="noopener noreferrer sponsored"
             onClick={handleClick} className="block w-full h-full">
            {inner}
          </a>
        ) : inner}
      </div>
    );
  }

  return (
    <div
      ref={observeRef}
      className="rounded-xl p-4 shadow-sm flex flex-col h-full"
      style={{ backgroundColor: bg, color: fg }}
    >
      <h3 className="text-sm font-bold leading-tight">{ad.headline_he}</h3>
      {ad.body_he && (
        <p className="text-xs opacity-90 mt-1 leading-relaxed flex-1">{ad.body_he}</p>
      )}
      {ad.chips_he && ad.chips_he.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {ad.chips_he.slice(0, 3).map((c) => (
            <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-white/15">
              {c}
            </span>
          ))}
        </div>
      )}
      {ad.cta_url ? (
        <a
          href={ad.cta_url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={handleClick}
          className="mt-3 inline-flex items-center justify-center bg-white/95 hover:bg-white text-slate-900 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
        >
          {ad.cta_label_he}
        </a>
      ) : (
        <span className="mt-3 inline-flex items-center justify-center bg-white/20 text-xs font-semibold px-3 py-1.5 rounded-md opacity-80">
          {ad.cta_label_he}
        </span>
      )}
    </div>
  );
}
