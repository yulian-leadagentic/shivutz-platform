// R30 §25 · front-end mirror of the sponsor-slot catalog.
//
// Source of truth is services/admin/app/services/sponsor_sizes.py
// (SIZES). That table is duplicated into
// services/user-org/app/services/sponsor_sizes.py because Railway
// builds each service from its own subtree, and now a third time
// here because the browser can't import Python. Drift is caught by
// scripts/check-sponsor-sizes-parity.py, which diffs all three.
//
// Why this file exists at all: before R30 §25 the strip renderer
// took ONE aspect number and applied it at every width. The catalog
// has always carried a separate mobile shape (home_leaderboard is
// 1200×150 on desktop but 720×200 on mobile) and the renderer
// ignored it — so a phone got the 8:1 desktop lock, the composite
// stacked to a column inside a 43px box, and `overflow-hidden`
// clipped the CTA clean off. Reading BOTH breakpoints from the
// catalog is the fix; `aspect-ratio: auto` would have papered over
// it and thrown away the approved mobile shape.
//
// Numbers approved 22.09.2026 — do not edit here. Edit the Python
// catalog, then mirror, then re-run the parity script.

export type Breakpoint = 'desktop' | 'mobile';

/** `mobile: null` = the slot does not exist on phones (side_rail,
 *  logo_wall). Callers fall back to the desktop ratio, but the slot
 *  itself is gated out well before that matters. */
export interface SlotSpec {
  desktop: readonly [number, number];
  mobile:  readonly [number, number] | null;
}

export const SPONSOR_SIZES: Record<string, SlotSpec> = {
  home_leaderboard:     { desktop: [1200, 150], mobile: [720, 200] },
  home_billboard:       { desktop: [1200, 250], mobile: [720, 300] },
  side_rail:            { desktop: [300, 600],  mobile: null },
  // R30 §12b · listing-page slots. Same shapes as their page-level
  // cousins so one creative can serve both.
  listing_rail:         { desktop: [300, 600],  mobile: null },
  listing_inline:       { desktop: [1200, 250], mobile: [720, 300] },
  home_carousel:        { desktop: [640, 360],  mobile: [640, 360] },
  marketplace_carousel: { desktop: [640, 360],  mobile: [640, 360] },
  marketplace_banner:   { desktop: [1200, 250], mobile: [720, 300] },
  search_inline:        { desktop: [240, 240],  mobile: [240, 240] },
  logo_wall:            { desktop: [240, 120],  mobile: null },
  home_banner:          { desktop: [1200, 250], mobile: [720, 300] },
};

/** Width ÷ height per breakpoint, ready for `aspect-ratio`. */
export interface AspectPair {
  desktop: number;
  mobile:  number;
}

/** Aspect ratios for a placement, or `null` for a placement absent
 *  from the catalog — the caller then renders without an aspect lock
 *  rather than inventing one. */
export function aspectFor(placement: string): AspectPair | null {
  const spec = SPONSOR_SIZES[placement];
  if (!spec) return null;
  const desktop = spec.desktop[0] / spec.desktop[1];
  // A slot with no mobile shape keeps the desktop ratio; it is gated
  // off phones anyway, so this only ever feeds a skeleton box.
  const mobile = spec.mobile ? spec.mobile[0] / spec.mobile[1] : desktop;
  return { desktop, mobile };
}

/** Approved (w, h) for the admin uploader's "required size" hint. */
export function sizeFor(
  placement: string,
  breakpoint: Breakpoint = 'desktop',
): readonly [number, number] | null {
  return SPONSOR_SIZES[placement]?.[breakpoint] ?? null;
}

// R30 §30b · which placements actually have a renderer.
//
// The rule: a placement that can be BOOKED must have somewhere to
// appear. `logo_wall` is in SPONSOR_SIZES above but is absent here —
// it was deferred in R29 §6 (needs ~8 advertisers before a wall of
// logos reads as anything but abandoned), so the admin write-side
// allow-list rejects it and an admin cannot sell a slot that renders
// nowhere.
//
// Each entry names the component that draws it, so the next person
// adding a slot can see what "has a renderer" means concretely.
// scripts/check-placement-renderers.py diffs this against
// services/admin/app/routes/sponsors.py:_ALLOWED_PLACEMENTS and fails
// CI when they drift — which is exactly how listing_rail and
// listing_inline ended up servable but not bookable.
export const RENDERED_PLACEMENTS: Record<string, string> = {
  search_inline:        'app/page.tsx · SponsorSlot (injected between search results)',
  marketplace_banner:   'MarketplaceSponsors · SponsorStripBanner',
  marketplace_carousel: 'MarketplaceSponsors · SponsorCarousel',
  home_banner:          'MarketplaceSponsors · SponsorStripBanner',
  home_carousel:        'MarketplaceSponsors · SponsorCarousel',
  home_leaderboard:     'MarketplaceSponsors · SponsorStripBanner',
  home_billboard:       'MarketplaceSponsors · SponsorStripBanner',
  side_rail:            'MarketplaceSponsors · SponsorRailLayout → RailCell',
  listing_rail:         'MarketplaceSponsors · ListingRailSponsor → RailCell',
  listing_inline:       'MarketplaceSponsors · ListingInlineSponsor',
};
