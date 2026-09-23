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
