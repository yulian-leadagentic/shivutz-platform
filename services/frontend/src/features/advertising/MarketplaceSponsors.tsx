'use client';

/**
 * U7 §5 · marketplace sponsor placements
 * R5 §3 · home sponsor slots
 * R29 §3 · composite-first wide-strip renderer (home_leaderboard,
 *          home_billboard, marketplace_banner)
 * R29 §4 · side_rail sticky tower on ≥1440 viewports
 * R29 §5 · dedupe by ad id + above-fold density ceiling
 *
 * Two families of surfaces per host page:
 *
 *   - Wide-strip banners (home_leaderboard, home_billboard,
 *     marketplace_banner, legacy home_banner) · full-page-width
 *     brand_bg strip carrying headline + body + CTA. The composite
 *     render is the DEFAULT for these; a flat creative renders ONLY
 *     when server-side `render_mode === 'creative'` (i.e. the
 *     sponsor_ads row has a creative_url whose aspect fits the slot
 *     within ±3%). This closes the R28 §4 finding: a 1037×609 image
 *     no longer paints as a 340×200 letterbox floating in a 1120-wide
 *     white strip — it now paints the brand strip and the text lives.
 *
 *   - Cards (marketplace_carousel, home_carousel, search_inline,
 *     side_rail) · discrete tiles rendered inside their host's grid
 *     or rail. Creative-first when a creative_url is present; falls
 *     back to the composite card when it isn't.
 *
 * SponsorProvider (below) wraps a page's sponsor surfaces and
 * enforces two R29 §5 rules:
 *
 *   1. **Dedupe by ad id** — an ad promoted into two placements
 *      (e.g. an advertiser who bought both `home_leaderboard` and
 *      `side_rail`) renders in whichever slot claims it first; every
 *      other slot skips that id. Same rule R23 §1 wrote in prose for
 *      the marketplace region-heading double-render — surfaced here
 *      as shared React state so the two families stay honest.
 *
 *   2. **Above-fold cap** — `site_settings.sponsor_above_fold_limit`
 *      (default 2) hard-caps how many sponsor rows can sit above the
 *      fold on any page. Components whose `aboveFold` prop is true
 *      count against the ceiling; over-count → render nothing rather
 *      than push real content below the fold. R28 §3's ancillary
 *      chip row + R29 §3-4's leaderboard/side_rail made this real.
 *
 * `SponsorProvider` is OPTIONAL — surfaces render fine without one,
 * they just skip the dedupe + cap logic. Home + search results wrap
 * in one; older callers keep working.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useAdImpression } from '@/hooks/useAdImpression';
import { postAdEvent, type AdPlacement } from '@/lib/adEvents';
import { aspectFor, type AspectPair } from '@/lib/sponsorSizes';

// R6 §1a · translate placement strings the backend uses into the
// terser 'placement' enum on promo_events.metadata_json. The
// original strings are longer than we want to store per row, and
// the enum keeps admin-stats filtering readable.
function placementBucket(raw: string): AdPlacement {
  // R30 §12b · the listing slots are matched BEFORE the generic rules
  // so they keep their own identity in promo_events.metadata_json.
  // Measured on staging before this fix: both listing slots — and
  // side_rail — recorded {"placement":"inline"}, so admin CTR could
  // not separate a 300×600 rail from a 1200×250 strip from the home
  // page's own rail. Three different products, one label.
  if (raw === 'listing_rail')        return 'listing_rail';
  if (raw === 'listing_inline')      return 'listing_inline';
  if (raw.startsWith('marketplace')) return 'marketplace';
  if (raw.includes('carousel'))      return 'carousel';
  if (raw.includes('banner') || raw.includes('leaderboard') || raw.includes('billboard')) return 'featured';
  // 'sidebar' was declared in AdPlacement and never used — side_rail
  // was falling through to the catch-all. Rows written before this
  // change carry 'inline' for side_rail; anything comparing across
  // that boundary needs to account for the rename.
  if (raw === 'side_rail')           return 'sidebar';
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
  creative_url:    string | null;
  creative_w:      number | null;
  creative_h:      number | null;
  brand_bg:        string | null;
  brand_fg:        string | null;
  // R29 §3 · server-computed. 'composite' forces the brand_bg strip;
  // 'creative' allows the flat image. Wide-strip slots (leaderboard,
  // billboard) return 'composite' whenever the creative doesn't fit
  // the slot spec within ±3%, regardless of whether creative_url is
  // set. Cards keep the legacy behaviour (creative when creative_url
  // is set).
  render_mode?:    'creative' | 'composite';
}

// ── R29 §5 · dedupe + above-fold ceiling context ────────────────────

// R29 §5 · claim result. `first` = one ad picked for a banner slot,
// `batch` = many ads picked for a carousel. `null` in either means
// "nothing survived dedupe / cap", render nothing.
interface SponsorCtxValue {
  aboveFoldLimit: number;
  /** Enqueue a banner-slot fetch. The queue serialises claims in JSX
   *  mount order so the topmost surface (leaderboard) always wins the
   *  first pick when two surfaces target the same ad. Fetches still
   *  run in parallel — the queue only orders the claim step. */
  enqueueOne:   (fetchFn: () => Promise<SponsorAd[]>, aboveFold: boolean) => Promise<SponsorAd | null>;
  /** Same as `enqueueOne` but for a carousel that wants N unclaimed
   *  ads. Returns the sublist that survived dedupe + cap. */
  enqueueBatch: (fetchFn: () => Promise<SponsorAd[]>, aboveFold: boolean) => Promise<SponsorAd[]>;
}

const SponsorCtx = createContext<SponsorCtxValue | null>(null);

// R30 §26 · ONE /legal/settings fetch per page load, shared.
//
// SponsorProvider wanted `sponsor_above_fold_limit` and every
// SponsorCarousel wanted `sponsor_carousel_limit` — from the same
// response, via two independent `fetch` calls. On a page with a
// provider and a carousel that's two requests out of an anonymous
// visitor's thirty-per-minute gateway budget for one JSON blob.
//
// Memoising the PROMISE (not the value) means concurrent callers
// during the initial render all await the same in-flight request,
// and a StrictMode remount reuses it rather than refetching. Module
// scope is the right lifetime here: site settings don't change
// within a page view, and a full navigation reloads the module.
let _settingsPromise: Promise<Record<string, unknown> | null> | null = null;

function siteSettingsOnce(): Promise<Record<string, unknown> | null> {
  if (!_settingsPromise) {
    _settingsPromise = fetch('/api/legal/settings')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return _settingsPromise;
}

/** Positive integer for `key`, else `fallback`. Settings arrive as
 *  strings from the settings table, so parse rather than trust. */
function settingNumber(
  s: Record<string, unknown> | null,
  key: string,
  fallback: number,
): number {
  const raw = s?.[key];
  const parsed = raw != null ? parseInt(String(raw), 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function SponsorProvider({ children }: { children: ReactNode }) {
  // R29 §5 · admin-editable ceiling. Reads sponsor_above_fold_limit
  // from /api/legal/settings (same endpoint carousel_limit already
  // reads). Missing / malformed value → 2, matching the seed in
  // migration 093.
  const [limit, setLimit] = useState<number>(2);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await siteSettingsOnce();
        const parsed = settingNumber(s, 'sponsor_above_fold_limit', 2);
        if (!cancelled) setLimit(parsed);
      } catch { /* keep default */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const seenAds        = useRef<Set<string>>(new Set());
  const aboveFoldCount = useRef<number>(0);
  const limitRef       = useRef<number>(limit);
  useEffect(() => { limitRef.current = limit; }, [limit]);

  // Serial claim queue. Each surface's useEffect calls enqueueOne /
  // enqueueBatch on mount; the tasks are chained on `queueRef` so
  // claim decisions resolve in queue-join order. Since useEffect
  // fires in DOM/JSX mount order, the queue-join order IS the reading
  // order of the page — leaderboard → billboard → carousel → side_rail.
  // The fetch inside each task still runs concurrently (the task
  // awaits its own fetch); only the CLAIM decision serialises. That
  // keeps page load fast while making the winner deterministic.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  const enqueueOne = useCallback(
    (fetchFn: () => Promise<SponsorAd[]>, aboveFold: boolean): Promise<SponsorAd | null> => {
      const task = queueRef.current.then(async () => {
        const rows = await fetchFn();
        if (!rows || rows.length === 0) return null;
        // Take the FIRST unclaimed ad from the fetched list.
        for (const ad of rows) {
          if (seenAds.current.has(ad.id)) continue;
          if (aboveFold && aboveFoldCount.current >= limitRef.current) return null;
          seenAds.current.add(ad.id);
          if (aboveFold) aboveFoldCount.current += 1;
          return ad;
        }
        return null;
      });
      // Chain so a rejection never poisons the queue for the next task.
      queueRef.current = task.catch(() => null);
      return task;
    },
    [],
  );

  const enqueueBatch = useCallback(
    (fetchFn: () => Promise<SponsorAd[]>, aboveFold: boolean): Promise<SponsorAd[]> => {
      const task = queueRef.current.then(async () => {
        const rows = await fetchFn();
        if (!rows || rows.length === 0) return [];
        const keep: SponsorAd[] = [];
        for (const ad of rows) {
          if (seenAds.current.has(ad.id)) continue;
          seenAds.current.add(ad.id);
          keep.push(ad);
        }
        // Carousel counts as ONE above-fold slot regardless of how many
        // cards it holds — otherwise a 4-card carousel would blow the
        // cap on its own.
        if (keep.length > 0 && aboveFold) {
          if (aboveFoldCount.current >= limitRef.current) return [];
          aboveFoldCount.current += 1;
        }
        return keep;
      });
      queueRef.current = task.catch(() => []);
      return task;
    },
    [],
  );

  const value = useMemo<SponsorCtxValue>(
    () => ({ aboveFoldLimit: limit, enqueueOne, enqueueBatch }),
    [limit, enqueueOne, enqueueBatch],
  );

  return <SponsorCtx.Provider value={value}>{children}</SponsorCtx.Provider>;
}

// Every sponsor component reads context. When there's no provider
// the fallback lets everything through, no dedupe, no cap — a lone
// MarketplaceSponsorBanner still renders exactly as it did before R29.
function useSponsorCtx(): SponsorCtxValue {
  return useContext(SponsorCtx) ?? {
    aboveFoldLimit: Infinity,
    enqueueOne:   async (fn) => (await fn())[0] ?? null,
    enqueueBatch: async (fn) => fn(),
  };
}

// ── fetch + guards ──────────────────────────────────────────────────

// R30 §27 · a cta_url with no scheme is a RELATIVE path to the
// browser. The seed row shipped `Www.tagidai.com`, which resolves to
// https://<our-host>/Www.tagidai.com and 404s on our own domain —
// the advertiser paid for a click-through that goes nowhere.
//
// R23 §2 added a validator to the admin form requiring http(s)://,
// but a form guard only covers rows edited AFTER it shipped; the
// offending row is still in the table. Normalising here, at the one
// place ads enter the component, means no render site can inherit a
// broken href regardless of what the DB holds.
//
// Also a security boundary: an href is an execution surface, and
// `javascript:` / `data:` in cta_url would run on click. The admin
// form does not reject those today, so anything with a scheme we
// don't explicitly trust is dropped to null (the CTA then renders
// in its R23 §3 inert style rather than as a live link).
const _SAFE_SCHEME = /^(?:https?:|mailto:|tel:)/i;
const _ANY_SCHEME   = /^[a-z][a-z0-9+.-]*:/i;

function normalizeCtaUrl(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  if (_SAFE_SCHEME.test(v)) return v;
  if (_ANY_SCHEME.test(v))  return null;   // javascript:, data:, vbscript:…
  if (v.startsWith('//'))   return `https:${v}`;  // protocol-relative
  if (v.startsWith('/'))    return v;             // deliberate in-app link
  return `https://${v}`;                          // bare host, scheme omitted
}

async function fetchSponsored(
  placement: string,
  limit: number,
  // R30 §12b/§12c · when supplied, the server filters to slots whose
  // category_code matches OR is NULL ("all categories"). Omitted for
  // the page-level slots, which aren't category-scoped.
  category?: string,
): Promise<SponsorAd[]> {
  try {
    const qs = new URLSearchParams({ placement, limit: String(limit) });
    if (category) qs.set('category', category);
    const res = await apiFetch<{ results: SponsorAd[] }>(
      `/ads/public/sponsored?${qs.toString()}`,
    );
    return (res.results ?? [])
      .map((ad) => ({ ...ad, cta_url: normalizeCtaUrl(ad.cta_url) }))
      .filter(isRenderable);
  } catch {
    return [];   // network / auth blip → hide the section, F3-safe
  }
}

// R23 §6 · a sponsor row is renderable when it has either a finished
// creative (image path — creative_url alone is enough because the
// image IS the ad) OR a headline (text path — headline_he is
// NOT NULL in the DB per migration 069, but a caller could still
// send empty string). Skipping rows that have neither turns the
// "giant empty blue rectangle" R23 §6 flagged into a rendered
// section only when it has something to say.
function isRenderable(ad: SponsorAd): boolean {
  if (ad.creative_url) return true;
  if (ad.headline_he && ad.headline_he.trim() !== '') return true;
  return false;
}

// R29 §3 · shorthand — should this ad render as flat image or as
// the composite brand strip? Server tells us via render_mode; legacy
// rows (server didn't ship the field) fall back to "creative if
// creative_url is set" so old admin surfaces keep working.
function pickRenderMode(ad: SponsorAd): 'creative' | 'composite' {
  if (ad.render_mode) return ad.render_mode;
  return ad.creative_url ? 'creative' : 'composite';
}

// ── viewport hooks ──────────────────────────────────────────────────

function useIsMobile(breakpointPx = 640): boolean | undefined {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [breakpointPx]);
  return isMobile;
}

// R29 §4 · side_rail is desktop-only, and only wide enough on
// ≥1440 viewports where the content column leaves ~380px of dead
// margin on either side. Below that we don't have the room without
// crowding the main content. Returns undefined during SSR so the
// server-rendered HTML has no rail (avoids a hydration mismatch on
// the first paint at any width).
function useIsWideDesktop(minPx = 1440): boolean | undefined {
  const [wide, setWide] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minPx}px)`);
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [minPx]);
  return wide;
}

// ── wide-strip banner (composite default; creative when it fits) ────

interface StripProps {
  placement: string;
  label?:    string;
  /** R29 §5 — this slot sits above the fold on its host page.
   *  Counts against `sponsor_above_fold_limit`; over-count → the
   *  slot renders nothing (rather than shoving real content down). */
  aboveFold?: boolean;
  /** R30 §25 · slot aspect ratios for the CLS wrapper, one per
   *  breakpoint, read from the shared catalog via `aspectFor()`.
   *
   *    home_leaderboard   8    desktop (1200×150) · 3.6 mobile (720×200)
   *    home_billboard     4.8  desktop (1200×250) · 2.4 mobile (720×300)
   *    home_banner        4.8  desktop (legacy)   · 2.4 mobile
   *    marketplace_banner 4.8  desktop (1200×250) · 2.4 mobile
   *
   *  This used to be a single number, and the desktop ratio was
   *  applied at every width: on a phone the composite stacked to a
   *  column inside an 8:1 box (43px at 375px wide) and
   *  `overflow-hidden` clipped the CTA away entirely. The catalog
   *  always had the mobile shape; the renderer just never read it. */
  aspectRatio: AspectPair;
  /** R30 §12b · category-scoped slots (listing_inline) pass the viewed
   *  listing's category so the server can match category_code. Page-level
   *  strips omit it. */
  category?: string;
}

/** R30 §25 · both ratios ride to CSS as custom properties — an inline
 *  style can't hold a media query, so `.sponsor-strip` in globals.css
 *  picks --ar-m below sm and --ar-d at sm+. */
function aspectVars(a: AspectPair): React.CSSProperties {
  return { '--ar-d': a.desktop, '--ar-m': a.mobile } as React.CSSProperties;
}

function SponsorStripBanner({ placement, label, aboveFold = false, aspectRatio, category }: StripProps) {
  const [ad, setAd]           = useState<SponsorAd | null>(null);
  const [claimResolved, setCR] = useState<boolean>(false);
  const ctx = useSponsorCtx();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // R29 §5 · enqueue via the Provider's serial claim queue so
      // whichever surface joined the queue first wins the ad when
      // two surfaces target the same one (leaderboard beats billboard
      // beats carousel beats side_rail in reading order). Fetches
      // still run concurrently — only the claim decision serialises.
      // Fetch up to 3 candidates so if the top pick is already
      // claimed by an earlier surface, this slot can fall back to
      // the next-best row instead of rendering nothing.
      const winner = await ctx.enqueueOne(
        () => fetchSponsored(placement, 3, category),
        aboveFold,
      );
      if (cancelled) return;
      setAd(winner);
      setCR(true);
    })();
    return () => { cancelled = true; };
  }, [placement, aboveFold, ctx, category]);

  const observeRef = useAdImpression({ targetId: ad?.id, placement: placementBucket(placement) });

  if (!claimResolved) {
    // Reserve the vertical space during the initial fetch so the
    // page doesn't jump when the ad arrives. Uses the slot aspect
    // ratio so both branches (creative or composite) fit the same
    // box. `max-w-6xl` matches the containing <section>'s width.
    return (
      <div className="mb-6 w-full">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
          {label ?? 'מודעה ממומנת'}
        </div>
        <div className="sponsor-strip rounded-2xl bg-slate-100/60" style={aspectVars(aspectRatio)} />
      </div>
    );
  }
  if (!ad) return null;

  const bg = ad.brand_bg ?? '#0f172a';
  const fg = ad.brand_fg ?? '#ffffff';
  const mode = pickRenderMode(ad);
  const handleClick = () => {
    if (!ad.cta_url) return;
    postAdEvent({
      event_type: 'ad_click', target_type: 'sponsor_ad',
      target_id: ad.id, placement: placementBucket(placement),
    });
  };

  // R29 §3 · CREATIVE branch — the server has cleared the ad
  // (render_mode === 'creative' means the flat image fits this slot
  // within ±3%). Full-bleed image, brand_bg only visible as the
  // (near-zero) letterbox from `object-contain`. Never centred on
  // white. `object-fit: cover` is banned — R20 §3a says the legal
  // disclaimer band on a bizi-style creative must not crop.
  if (mode === 'creative' && ad.creative_url) {
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
        <div className="sponsor-strip rounded-2xl overflow-hidden shadow-sm w-full"
             style={{ ...aspectVars(aspectRatio), backgroundColor: bg }}>
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

  // R29 §3 · COMPOSITE branch — the DEFAULT for wide-strip slots.
  // brand_bg fills the whole strip; brand_fg carries headline + body
  // + CTA. Logo sits at the start of the strip when present. Layout
  // is horizontal at sm+, stacks on mobile. No white centering, no
  // letterbox — the strip IS the ad.
  return (
    <div ref={observeRef} className="mb-6">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
        {label ?? 'מודעה ממומנת'}
      </div>
      <div
        className="sponsor-strip rounded-2xl overflow-hidden shadow-sm w-full flex flex-col sm:flex-row items-stretch"
        style={{ ...aspectVars(aspectRatio), backgroundColor: bg, color: fg }}
      >
        {ad.logo_url && (
          <div className="shrink-0 flex items-center justify-center px-4 sm:px-6 py-2 sm:py-0 bg-black/10">
            {/* Logo max height 60% of strip so it doesn't crowd copy. */}
            <img src={ad.logo_url} alt="" className="max-h-[60%] max-w-[140px] w-auto object-contain" />
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col justify-center px-4 sm:px-6 py-2 sm:py-3">
          <h3 className="text-base sm:text-xl font-bold leading-tight line-clamp-1">{ad.headline_he}</h3>
          {ad.body_he && (
            <p className="hidden sm:block text-sm opacity-90 mt-1 leading-snug line-clamp-2">{ad.body_he}</p>
          )}
        </div>
        {ad.cta_url ? (
          <a
            href={ad.cta_url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={handleClick}
            className="shrink-0 self-center mx-4 sm:mx-6 my-2 inline-flex items-center bg-white/95 hover:bg-white text-slate-900 text-xs sm:text-sm font-semibold px-3 sm:px-5 py-1.5 sm:py-2 rounded-lg transition-colors"
          >
            {ad.cta_label_he}
          </a>
        ) : (
          <span className="shrink-0 self-center mx-4 sm:mx-6 hidden sm:inline text-xs opacity-70">
            {ad.cta_label_he}
          </span>
        )}
      </div>
    </div>
  );
}

// ── card carousel (unchanged shape; dedupe added) ───────────────────

function SponsorCarousel({ placement, label, aboveFold = false }: { placement: string; label?: string; aboveFold?: boolean }) {
  const [ads, setAds] = useState<SponsorAd[]>([]);
  const isMobile = useIsMobile();
  const ctx = useSponsorCtx();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // R29 §5 · enqueue via the serial claim queue so the carousel
      // resolves AFTER any wide-strip surface above it. Ads already
      // claimed by an earlier surface are filtered out; the carousel
      // renders whatever survives.
      const claimed = await ctx.enqueueBatch(
        async () => {
          // R30 §26 · shares the provider's in-flight settings request.
          let limit = 4;
          try {
            limit = settingNumber(await siteSettingsOnce(), 'sponsor_carousel_limit', 4);
          } catch { /* fall back to 4 */ }
          return fetchSponsored(placement, limit);
        },
        aboveFold,
      );
      if (cancelled) return;
      setAds(claimed);
    })();
    return () => { cancelled = true; };
  }, [placement, aboveFold, ctx]);

  if (ads.length === 0) return null;
  const bucket = placementBucket(placement);
  const renderMobile  = isMobile === undefined || isMobile === true;
  const renderDesktop = isMobile === undefined || isMobile === false;

  return (
    <div className="mb-6">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
        {label ?? 'שירותים ממומנים'}
      </div>
      <div className="sm:hidden -mx-4 px-4">
        <div
          role="region"
          aria-label={label ?? 'שירותים ממומנים'}
          className="sponsor-carousel-scroll flex overflow-x-auto snap-x snap-mandatory gap-3 pb-1"
        >
          {renderMobile && ads.map((ad) => (
            <div
              key={ad.id}
              className="snap-start shrink-0"
              style={{ width: '82vw' }}
            >
              <CarouselCard ad={ad} placement={bucket} rawPlacement={placement} />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden sm:grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {renderDesktop && ads.map((ad) => (
          <CarouselCard key={ad.id} ad={ad} placement={bucket} rawPlacement={placement} />
        ))}
      </div>
    </div>
  );
}

// ── R30 §24 · side_rail rebuilt as a GRID COLUMN ────────────────────
//
// The previous fixed-position implementation (R29 §4) chased the
// content around the viewport for a whole session because the sticky
// search bar had `backdrop-filter: blur(sm)`, which created a new
// containing block for `position: fixed` descendants (see R30 §22
// which also removes the blur). Even after removing the blur, a
// fixed-position rail can't reserve horizontal space — the content
// column doesn't know the rail is there, so any `mx-auto max-w-*`
// centres the content across the FULL width, and the rail overlaps.
//
// R30 §24 direction: the rail is NOT a floating overlay. It's a
// column in a page grid. Content column fills its cell, rail cell
// takes 300px, gap 24px, ≥1440 only. When there's no side_rail ad,
// the grid collapses to a single column (display:none on the cell
// isn't enough — the cell still holds width, so we conditionally
// render a single-column vs two-column grid).
//
// One layout component (`SponsorRailLayout`) is shared between home,
// search results, and /marketplace — the "רכיב פריסה אחד, לא שלושה
// עותקים" rule.

// Content column max-width when NO rail. Matches the previous
// `max-w-6xl` most callers used (72rem = 1152px).
const RAIL_CONTENT_MAX_PX = 1152;
// Content max + gap + rail. When rail is visible the grid centres
// the whole 1152 + 24 + 300 = 1476px inside the viewport.
const RAIL_LAYOUT_MAX_PX  = RAIL_CONTENT_MAX_PX + 24 + 300;
// Sticky top for the rail cell. 96px = h-16 nav (64) + 32px buffer.
// The sticky search bar (z-40) still paints over the rail if they
// visually overlap — z-10 here stays LOWER than the search bar per
// §24: "z-index נמוך מהניווט. הרייל אף פעם לא מעל סרגל עליון".
// Since the rail is inside the content grid and the content grid
// starts BELOW the sticky search bar in the DOM, the rail's cell
// sits at y ≥ (search bar bottom) at scroll=0. As scroll advances
// the rail moves up with the content until top: 96, then sticks.
const RAIL_STICKY_TOP_PX = 96;


/**
 * R30 §24 · one-component layout wrapper. Renders a two-column CSS
 * grid at ≥1440 when a side_rail ad is available, and a single-
 * column layout otherwise. Content column is the child; the rail
 * cell is managed internally.
 *
 * Usage:
 *   <SponsorRailLayout>
 *     <div>... page content ...</div>
 *   </SponsorRailLayout>
 *
 * Content should NOT wrap itself in `mx-auto max-w-6xl` — the
 * layout handles centring + width. Adding a second `mx-auto max-w-*`
 * inside is the exact bug §24 warned against.
 */
export function SponsorRailLayout({
  children,
  aboveFold = true,
}: {
  children: ReactNode;
  aboveFold?: boolean;
}) {
  const wide = useIsWideDesktop();
  const [ad, setAd] = useState<SponsorAd | null>(null);
  const [checked, setChk] = useState(false);
  const ctx = useSponsorCtx();

  useEffect(() => {
    if (!wide) { setAd(null); setChk(true); return; }
    let cancelled = false;
    (async () => {
      const winner = await ctx.enqueueOne(
        () => fetchSponsored('side_rail', 3),
        aboveFold,
      );
      if (cancelled) return;
      setAd(winner);
      setChk(true);
    })();
    return () => { cancelled = true; };
  }, [wide, aboveFold, ctx]);

  const showRail = wide && checked && !!ad;

  // Single-column path — same width/centring the callers had before.
  if (!showRail) {
    return (
      <div className="mx-auto px-4" style={{ maxWidth: RAIL_CONTENT_MAX_PX }}>
        {children}
      </div>
    );
  }

  // Two-column path — grid centres the whole span (1152 + 24 + 300).
  // `min-w-0` on the content column so long words / URLs don't force
  // an overflow that would blow the grid layout up.
  return (
    <div
      className="mx-auto px-4"
      style={{
        maxWidth: RAIL_LAYOUT_MAX_PX,
        display: 'grid',
        gridTemplateColumns: `minmax(0, 1fr) 300px`,
        gap: 24,
      }}
    >
      <div className="min-w-0">{children}</div>
      <RailCell ad={ad} />
    </div>
  );
}


/**
 * R30 §24 · the sticky rail cell inside SponsorRailLayout. Kept
 * separate so the layout can render `null` (single column) or
 * this component (two columns) without conditional JSX inside the
 * grid definition. `position: sticky` + `align-self: start` — the
 * §24 note "sticky בתוך גריד לא עובד בלי align-self: start" because
 * the default `stretch` gives the cell full row height and there's
 * nothing to stick TO.
 */
function RailCell({ ad, placement = 'side_rail' }: { ad: SponsorAd; placement?: string }) {
  // R30 §12b · the placement was hardcoded to 'side_rail'. ListingRailSponsor
  // reuses this cell, so every listing_rail impression was being attributed
  // to the home-page rail — visible in promo_events as listing_rail rows
  // carrying side_rail's bucket. The caller now says which slot it is.
  const observeRef = useAdImpression({ targetId: ad.id, placement: placementBucket(placement) });

  const bg = ad.brand_bg ?? '#0f172a';
  const fg = ad.brand_fg ?? '#ffffff';
  const mode = pickRenderMode(ad);
  const handleClick = () => {
    if (!ad.cta_url) return;
    postAdEvent({
      event_type: 'ad_click', target_type: 'sponsor_ad',
      target_id: ad.id, placement: placementBucket(placement),
    });
  };

  const inner = mode === 'creative' && ad.creative_url ? (
    <img
      src={ad.creative_url}
      alt={ad.advertiser_name}
      className="w-full h-full object-contain block"
      loading="lazy"
    />
  ) : (
    // R30 §29 · once the card has a real 300×600 frame the old layout
    // bunched every element at the top and left ~450px of empty brand
    // colour below. `justify-between` with the copy grouped at the top
    // and the CTA pinned to the bottom spreads it over the height
    // WITHOUT stretching the text — the body keeps its natural leading
    // rather than being flex-grown into a sparse column.
    <div className="flex flex-col h-full justify-between p-4" style={{ color: fg }}>
      <div>
        <h3 className="text-base font-bold leading-tight">{ad.headline_he}</h3>
        {ad.body_he && (
          <p className="text-xs opacity-90 mt-2 leading-relaxed">{ad.body_he}</p>
        )}
        {ad.chips_he && ad.chips_he.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {ad.chips_he.slice(0, 3).map((c) => (
              <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-white/15">{c}</span>
            ))}
          </div>
        )}
      </div>
      {ad.cta_url && (
        <span className="inline-flex items-center justify-center bg-white/95 text-slate-900 text-xs font-semibold px-3 py-2 rounded-md">
          {ad.cta_label_he}
        </span>
      )}
    </div>
  );

  // R30 §24 · sticky grid child. NO fixed, NO absolute, NO negative
  // margins. `align-self: start` because a grid cell defaults to
  // `stretch` (fills the row height), leaving sticky nothing to
  // stick to.
  //
  // R30 §29 · the slot had NO aspect-ratio anywhere in the chain, so
  // the card collapsed to its content height: 300×139 instead of
  // 300×600. The old `height: 600` here only applied to the creative
  // branch, and it sat on the <aside> — the wrong element twice over.
  //
  // The ratio now comes from the catalog (side_rail / listing_rail are
  // both 300×600 → 0.5) and sits on the CARD container, never on the
  // <aside>: giving the sticky element a fixed height is what broke
  // the pin in R29 §4. The aside keeps only its viewport cap; the
  // card inside it owns the shape, and the existing `h-full` chain
  // below finally has a height to fill.
  //
  // maxHeight on the card degrades gracefully: on a screen too short
  // for 600px the card shrinks instead of being clipped by the
  // aside's overflow:hidden — the bottom-cut-off bug from R29 §4.
  const railAspect = aspectFor(placement);
  return (
    <aside
      ref={observeRef}
      className="sticky z-10"
      style={{
        top:        RAIL_STICKY_TOP_PX,
        alignSelf:  'start',
        width:      300,
        maxHeight:  `calc(100vh - ${RAIL_STICKY_TOP_PX + 16}px)`,
        overflow:   'hidden',
      }}
      aria-label="מודעה ממומנת · צד"
    >
      <div
        className="rounded-2xl overflow-hidden shadow-md w-full"
        style={{
          backgroundColor: bg,
          ...(railAspect ? { aspectRatio: railAspect.desktop } : {}),
          maxHeight: '100%',
        }}
      >
        {ad.cta_url ? (
          <a href={ad.cta_url} target="_blank" rel="noopener noreferrer sponsored"
             onClick={handleClick} className="block w-full h-full">
            {inner}
          </a>
        ) : inner}
      </div>
    </aside>
  );
}

// ── carousel card (unchanged) ───────────────────────────────────────

function CarouselCard({ ad, placement, rawPlacement }: { ad: SponsorAd; placement: AdPlacement; rawPlacement: string }) {
  const bg = ad.brand_bg ?? '#0f172a';
  const fg = ad.brand_fg ?? '#ffffff';
  const observeRef = useAdImpression({ targetId: ad.id, placement });
  const handleClick = () => {
    if (!ad.cta_url) return;
    postAdEvent({
      event_type: 'ad_click', target_type: 'sponsor_ad',
      target_id: ad.id, placement,
    });
  };

  // R30 §30d · one lookup, used by both branches below.
  const carouselAspect = aspectFor(rawPlacement);

  // Cards keep the pre-R29 rule — creative when creative_url is set,
  // composite when it isn't. Card slots aren't wide-strips, so a
  // slight aspect mismatch is fine (the card is square-ish and
  // object-contain letterboxes with brand_bg on either side, which
  // is the intended card look).
  if (ad.creative_url && pickRenderMode(ad) !== 'composite') {
    // R30 §30d · the fallback was a bare '1 / 1', unrelated to the
    // catalog's 640×360 for both carousel slots. Cards never collapsed
    // (the grid row is align-items: stretch) so this was consistency,
    // not a break — but a card without stored dimensions rendered
    // square inside a 16:9 slot. Catalog now, like every other slot.
    const slotAspect = carouselAspect;
    const aspectStyle = ad.creative_w && ad.creative_h
      ? { aspectRatio: `${ad.creative_w} / ${ad.creative_h}` }
      : { aspectRatio: slotAspect ? slotAspect.desktop : 1 };
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
      // R30 §30d · the catalog ratio applies to the COMPOSITE card too,
      // not just the creative one. Every sponsor ad on staging has
      // creative_url NULL, so every carousel card takes this branch —
      // meaning the §30d fix was wired to a path nothing exercises, and
      // "the carousel is 640×360" could not be demonstrated at all.
      //
      // Cards never collapsed (the grid row is align-items: stretch) so
      // this is consistency rather than a bug fix: without it a row's
      // height is set by whichever card happens to have the most copy.
      className="rounded-xl p-4 shadow-sm flex flex-col h-full"
      style={{
        backgroundColor: bg,
        color: fg,
        ...(carouselAspect ? { aspectRatio: carouselAspect.desktop } : {}),
      }}
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
        <span className="mt-3 inline-flex text-[11px] opacity-70">
          {ad.cta_label_he}
        </span>
      )}
    </div>
  );
}

// ── named exports ───────────────────────────────────────────────────
//
// Import these, not the parameterised bases, so the file's grep
// footprint mirrors what's actually rendered on each page. Adding a
// new placement = add a new wrapper.

// R30 §25 · every wrapper now derives its aspect pair from the
// catalog instead of restating the desktop number inline. The old
// literals (8, 4.8) matched the catalog's desktop column by hand —
// which is exactly how the mobile column went unnoticed for a whole
// release. `STRIP_ASPECT` resolves once at module load; an unknown
// placement can't reach it because these wrappers are the only
// callers and each name is a catalog key.
const STRIP_ASPECT = (placement: string): AspectPair =>
  aspectFor(placement) ?? { desktop: 4.8, mobile: 2.4 };

// Marketplace surfaces (existing).
export function MarketplaceSponsorBanner()   { return <SponsorStripBanner placement="marketplace_banner"   aspectRatio={STRIP_ASPECT('marketplace_banner')} label="מודעה ממומנת" />; }
export function MarketplaceSponsorCarousel() { return <SponsorCarousel    placement="marketplace_carousel" />; }

// Legacy home surfaces (R5 §3). Kept exported so old callers work.
// Prefer the new HomeSponsorLeaderboard / HomeSponsorBillboard pair
// for new work; those enforce the R29 §3 composite-first rule.
export function HomeSponsorBanner()          { return <SponsorStripBanner placement="home_banner"          aspectRatio={STRIP_ASPECT('home_banner')} aboveFold />; }
export function HomeSponsorCarousel()        { return <SponsorCarousel    placement="home_carousel"        />; }

// R29 §3 · new wide-strip slots. Composite-first render.
export function HomeSponsorLeaderboard() {
  // 1200×150 desktop (8:1) · 720×200 mobile (3.6:1). Sits at the very
  // top of the home content area, above the search field.
  return <SponsorStripBanner placement="home_leaderboard" aspectRatio={STRIP_ASPECT('home_leaderboard')} aboveFold />;
}
export function HomeSponsorBillboard() {
  // 1200×250 desktop (4.8:1) · 720×300 mobile (2.4:1). Between search
  // + recent-ads mosaic. Still counts as above-fold on desktop; on
  // mobile it lands right at the fold line. Cap it either way.
  return <SponsorStripBanner placement="home_billboard" aspectRatio={STRIP_ASPECT('home_billboard')} aboveFold />;
}

// ── R30 §12b · listing-page slots ───────────────────────────────────
//
// Two slots on /marketplace/[id], both CATEGORY-TARGETED (§12c):
//
//   listing_rail    300×600, under the contact card, desktop ≥1440
//   listing_inline  1200×250 · 720×300 mobile, under the description
//
// The targeting needed no new mechanism — sponsor_ads_slots already
// carries category_code, where NULL means "every category" (the same
// convention 069 set for target_professions / target_ad_types). The
// page passes the viewed listing's own category, so a housing listing
// draws housing advertisers and an equipment listing does not.
//
// Yulian's rule, verbatim: an insurance advertiser appearing on a
// housing listing is exactly what these slots exist to prevent. So
// when nothing matches the category, the slot renders NOTHING — there
// is deliberately no generic fallback. That also satisfies F3 ("no
// sections without active ads").
//
// Impressions ride the existing useAdImpression / postAdEvent path;
// no second counter.

/** Under the description. Wide strip, so composite-first like the
 *  other 1200×250 slots. */
export function ListingInlineSponsor({ category }: { category: string }) {
  return (
    <SponsorStripBanner
      placement="listing_inline"
      category={category}
      aspectRatio={STRIP_ASPECT('listing_inline')}
      label="מודעה ממומנת"
    />
  );
}

/** Under the contact card. Reuses the rail cell so the sticky
 *  behaviour and the ≥1440 gate match side_rail exactly. */
export function ListingRailSponsor({ category }: { category: string }) {
  const wide = useIsWideDesktop();
  const [ad, setAd] = useState<SponsorAd | null>(null);
  const ctx = useSponsorCtx();

  useEffect(() => {
    if (!wide) { setAd(null); return; }
    let cancelled = false;
    (async () => {
      const winner = await ctx.enqueueOne(
        () => fetchSponsored('listing_rail', 3, category),
        false,   // below the fold — does not count against the §5 ceiling
      );
      if (!cancelled) setAd(winner);
    })();
    return () => { cancelled = true; };
  }, [wide, category, ctx]);

  if (!wide || !ad) return null;
  return <RailCell ad={ad} placement="listing_rail" />;
}

// R30 §24 · SponsorRailLayout replaces the R29 §4 <SponsorSideRail />
// standalone component. Callers now wrap their main content in
// <SponsorRailLayout>...</SponsorRailLayout>; the layout owns both
// the grid AND the rail cell, so a "no side_rail ad" state collapses
// the grid to a single column without leaving an empty cell. See the
// component doc above for the usage rule (content must not have its
// own mx-auto max-w-*).
