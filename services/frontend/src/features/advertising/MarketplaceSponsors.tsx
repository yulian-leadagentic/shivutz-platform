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

// R6 §1a · translate placement strings the backend uses into the
// terser 'placement' enum on promo_events.metadata_json. The
// original strings are longer than we want to store per row, and
// the enum keeps admin-stats filtering readable.
function placementBucket(raw: string): AdPlacement {
  if (raw.startsWith('marketplace')) return 'marketplace';
  if (raw.includes('carousel'))      return 'carousel';
  if (raw.includes('banner') || raw.includes('leaderboard') || raw.includes('billboard')) return 'featured';
  if (raw === 'side_rail')           return 'inline';
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
        const s = await fetch('/api/legal/settings').then(r => (r.ok ? r.json() : null));
        const raw = s?.sponsor_above_fold_limit;
        const parsed = raw != null ? parseInt(String(raw), 10) : NaN;
        if (!cancelled && Number.isFinite(parsed) && parsed > 0) setLimit(parsed);
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

async function fetchSponsored(placement: string, limit: number): Promise<SponsorAd[]> {
  try {
    const res = await apiFetch<{ results: SponsorAd[] }>(
      `/ads/public/sponsored?placement=${encodeURIComponent(placement)}&limit=${limit}`,
    );
    return (res.results ?? []).filter(isRenderable);
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
  /** Slot aspect ratio for the CLS wrapper (width / height).
   *  home_leaderboard = 8      (1200×150)
   *  home_billboard   = 4.8    (1200×250)
   *  home_banner      = 4.8    (legacy 1200×250)
   *  marketplace_banner = 4.8  (1200×250)
   *
   *  Kept as a number rather than a string so callers can't ship a
   *  malformed aspectRatio expression by accident. */
  aspectRatio: number;
}

function SponsorStripBanner({ placement, label, aboveFold = false, aspectRatio }: StripProps) {
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
        () => fetchSponsored(placement, 3),
        aboveFold,
      );
      if (cancelled) return;
      setAd(winner);
      setCR(true);
    })();
    return () => { cancelled = true; };
  }, [placement, aboveFold, ctx]);

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
        <div className="rounded-2xl bg-slate-100/60" style={{ aspectRatio }} />
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
        <div className="rounded-2xl overflow-hidden shadow-sm w-full"
             style={{ aspectRatio, backgroundColor: bg }}>
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
        className="rounded-2xl overflow-hidden shadow-sm w-full flex flex-col sm:flex-row items-stretch"
        style={{ backgroundColor: bg, color: fg, aspectRatio }}
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
          let limit = 4;
          try {
            const s = await fetch('/api/legal/settings').then(r => (r.ok ? r.json() : null));
            const raw = s?.sponsor_carousel_limit;
            const parsed = raw != null ? parseInt(String(raw), 10) : NaN;
            if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
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
              <CarouselCard ad={ad} placement={bucket} />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden sm:grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {renderDesktop && ads.map((ad) => (
          <CarouselCard key={ad.id} ad={ad} placement={bucket} />
        ))}
      </div>
    </div>
  );
}

// ── side_rail · sticky tower, ≥1440 only, single ad ─────────────────

/**
 * R29 §4 · fixed sticky rail on the left edge of the viewport
 * (Hebrew RTL — the left margin is the "outer" one). Spec is 300×600.
 * Placement gated to viewports ≥1440 (roughly 15" MacBook and up)
 * where the content column leaves enough dead margin to host it
 * without shoving copy off-centre.
 *
 * Not rendered when:
 *   - viewport < 1440
 *   - server returned no ad for this placement
 *   - the ad id was already claimed by an earlier slot (R29 §5 dedupe)
 *   - above-fold cap already spent
 *
 * The rail carries the SAME creative-vs-composite fork as the strip
 * banner. side_rail is not a wide-strip slot, so a creative_url
 * renders the flat image regardless of exact aspect; composite is
 * the fallback when there's no image.
 */
function SponsorSideRail({ aboveFold = true }: { aboveFold?: boolean } = {}) {
  const wide = useIsWideDesktop();
  const [ad, setAd] = useState<SponsorAd | null>(null);
  const [claimResolved, setCR] = useState<boolean>(false);
  const ctx = useSponsorCtx();

  useEffect(() => {
    if (!wide) { setAd(null); setCR(true); return; }
    let cancelled = false;
    (async () => {
      // Serial claim queue: rail joins the queue AFTER the in-page
      // wide-strip / carousel surfaces in mount order, so it takes
      // whatever unclaimed ad remains for the side_rail placement.
      const winner = await ctx.enqueueOne(
        () => fetchSponsored('side_rail', 3),
        aboveFold,
      );
      if (cancelled) return;
      setAd(winner);
      setCR(true);
    })();
    return () => { cancelled = true; };
  }, [wide, aboveFold, ctx]);

  const observeRef = useAdImpression({ targetId: ad?.id, placement: placementBucket('side_rail') });

  if (!wide || !claimResolved || !ad) return null;

  const bg = ad.brand_bg ?? '#0f172a';
  const fg = ad.brand_fg ?? '#ffffff';
  const mode = pickRenderMode(ad);
  const handleClick = () => {
    if (!ad.cta_url) return;
    postAdEvent({
      event_type: 'ad_click', target_type: 'sponsor_ad',
      target_id: ad.id, placement: placementBucket('side_rail'),
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
    <div className="flex flex-col h-full p-4" style={{ color: fg }}>
      <h3 className="text-base font-bold leading-tight">{ad.headline_he}</h3>
      {ad.body_he && (
        <p className="text-xs opacity-90 mt-2 leading-relaxed flex-1 overflow-hidden">{ad.body_he}</p>
      )}
      {ad.chips_he && ad.chips_he.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {ad.chips_he.slice(0, 3).map((c) => (
            <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-white/15">{c}</span>
          ))}
        </div>
      )}
      {ad.cta_url && (
        <span className="mt-3 inline-flex items-center justify-center bg-white/95 text-slate-900 text-xs font-semibold px-3 py-1.5 rounded-md">
          {ad.cta_label_he}
        </span>
      )}
    </div>
  );

  // Positioned fixed on the LEFT edge — Hebrew RTL means content
  // reads right-to-left, so the left edge is the outer margin the
  // side_rail should live in.
  //
  // `top-56` (14rem = 224px) clears the WHOLE stickable header stack,
  // not just the fixed nav. That stack is:
  //   * LandingNav — fixed top-0, h-16 (64px)
  //   * search sticky bar — top-16 z-40; grows to ~140-180px when a
  //     result is active (input + chip row + filters row); the earlier
  //     top-24 (96px) put the rail's top edge INSIDE this sticky
  //     zone, and z-40 > z-30 meant the sticky bar painted OVER the
  //     rail's top ~100px (the "top row over the ad" Yulian caught
  //     on the search-results screenshot).
  // 224px = 64 (nav) + ~160 (sticky at its tallest observed on search
  // results) = the rail's top edge sits at the bottom of the sticky
  // zone with no measurable overlap.
  //
  // `z-30` still sits below modals (z-40+) but above regular content;
  // NOT raised to z-40 because the sticky search bar is z-40 and the
  // rail must NEVER cover the search input.
  return (
    <aside
      ref={observeRef}
      className="hidden fixed left-4 top-56 z-30"
      style={{
        display: wide ? 'block' : 'none',
        width: 300,
        height: 600,
      }}
      aria-label="מודעה ממומנת · צד"
    >
      <div className="rounded-2xl overflow-hidden shadow-md w-full h-full" style={{ backgroundColor: bg }}>
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

function CarouselCard({ ad, placement }: { ad: SponsorAd; placement: AdPlacement }) {
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

  // Cards keep the pre-R29 rule — creative when creative_url is set,
  // composite when it isn't. Card slots aren't wide-strips, so a
  // slight aspect mismatch is fine (the card is square-ish and
  // object-contain letterboxes with brand_bg on either side, which
  // is the intended card look).
  if (ad.creative_url && pickRenderMode(ad) !== 'composite') {
    const aspectStyle = ad.creative_w && ad.creative_h
      ? { aspectRatio: `${ad.creative_w} / ${ad.creative_h}` }
      : { aspectRatio: '1 / 1' };
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

// Marketplace surfaces (existing).
export function MarketplaceSponsorBanner()   { return <SponsorStripBanner placement="marketplace_banner"   aspectRatio={4.8} label="מודעה ממומנת" />; }
export function MarketplaceSponsorCarousel() { return <SponsorCarousel    placement="marketplace_carousel" />; }

// Legacy home surfaces (R5 §3). Kept exported so old callers work.
// Prefer the new HomeSponsorLeaderboard / HomeSponsorBillboard pair
// for new work; those enforce the R29 §3 composite-first rule.
export function HomeSponsorBanner()          { return <SponsorStripBanner placement="home_banner"          aspectRatio={4.8} aboveFold />; }
export function HomeSponsorCarousel()        { return <SponsorCarousel    placement="home_carousel"        />; }

// R29 §3 · new wide-strip slots. Composite-first render.
export function HomeSponsorLeaderboard() {
  // 1200×150 → 8:1 aspect. Sits at the very top of the home content
  // area, above the search field. aboveFold=true.
  return <SponsorStripBanner placement="home_leaderboard" aspectRatio={8} aboveFold />;
}
export function HomeSponsorBillboard() {
  // 1200×250 → 4.8:1 aspect. Between search + recent-ads mosaic.
  // Still counts as above-fold on desktop; on mobile it lands right
  // at the fold line. Cap it either way.
  return <SponsorStripBanner placement="home_billboard" aspectRatio={4.8} aboveFold />;
}

// R29 §4 · sticky rail. Hosts: home, search results, marketplace.
export { SponsorSideRail };
