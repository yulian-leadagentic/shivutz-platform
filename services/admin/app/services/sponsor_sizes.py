"""R29 §2 · one source of truth for sponsor-slot dimensions.

The migration-092 admin flow was toothless: `_validate_creative`
checked that a triple (url, w, h) arrived together but ANY 1..8000
value passed. That's how a 1037×609 image landed in `home_leaderboard`
(spec: 1200×150) and rendered as a 340×200 tile floating in a 1120-
wide strip — the R28 §4 finding Yulian caught.

This module holds the approved table (Yulian 22.09.2026) and the
validator every write path calls. The dimensions themselves are
IAB-adjacent standards so an external ad agency can hand us assets
without a spec sheet.

Two truths this module defends:

  1. **Aspect matters** — `object-fit: contain` on a wide-strip slot
     with a square-ish creative paints a tile in the middle and
     leaves brand-coloured wings. Wrong ratio in, wrong presentation
     out. Tolerance is ±3% (small enough to reject 1037×609 as
     leaderboard, wide enough to accept a 1197×628 that a designer
     rounded).

  2. **Minimum width matters** — a creative narrower than the slot
     is stretched by the browser and blurred. Reject rather than
     render fuzzy.

`_FALLBACK` on sponsor_sizes IS intentional: an unknown placement
(a new value we haven't seen yet) is NOT auto-rejected — we accept
and log, so a future admin adding a placement to `placements` JSON
before this file catches up doesn't get bounced. Better a
lenient-then-fixed shape than an aggressive-then-broken one.

The `SIZES` dict is exported and used verbatim by the front-end
uploader (admin sponsor form) via a public endpoint the frontend
already has room for. Server always has the last word — the client
copy is nice-to-have UX only. R29 §2 rule: "המידות בקבוע אחד
משותף".
"""
from __future__ import annotations

from typing import Optional, Literal

Breakpoint = Literal["desktop", "mobile"]

# R29 §2 · APPROVED 22.09.2026. Do NOT edit these numbers without a
# new decision — an ad agency ordering assets is holding this table.
SIZES: dict[str, dict[str, Optional[tuple[int, int]]]] = {
    # slot                                  desktop           mobile
    "home_leaderboard":                    {"desktop": (1200, 150), "mobile": (720, 200)},
    "home_billboard":                      {"desktop": (1200, 250), "mobile": (720, 300)},
    "side_rail":                           {"desktop": (300, 600),  "mobile": None},
    # R30 §12b · listing-page slots. Same shapes as their page-level
    # cousins on purpose — an agency supplying a side_rail creative can
    # reuse it for listing_rail, and a billboard asset fits
    # listing_inline. Fewer distinct sizes to order = fewer rejected
    # uploads.
    "listing_rail":                        {"desktop": (300, 600),  "mobile": None},
    "listing_inline":                      {"desktop": (1200, 250), "mobile": (720, 300)},
    "home_carousel":                       {"desktop": (640, 360),  "mobile": (640, 360)},
    "marketplace_carousel":                {"desktop": (640, 360),  "mobile": (640, 360)},
    "marketplace_banner":                  {"desktop": (1200, 250), "mobile": (720, 300)},
    "search_inline":                       {"desktop": (240, 240),  "mobile": (240, 240)},
    "logo_wall":                           {"desktop": (240, 120),  "mobile": None},
    # R21/R22 legacy value from migration 092 — kept for the
    # sponsor_ads.creative_url fallback path only. New uploads should
    # target home_leaderboard/home_billboard/etc.
    "home_banner":                         {"desktop": (1200, 250), "mobile": (720, 300)},
}

# ±3% aspect tolerance. Tighter than that and a 1197×628 designer
# round-down starts bouncing; looser and 1037×609 slips into
# home_leaderboard.
_ASPECT_TOLERANCE = 0.03


def size_for(placement: str, breakpoint: Breakpoint) -> Optional[tuple[int, int]]:
    """Return (w, h) for a placement/breakpoint, or None if the slot
    doesn't exist on that breakpoint (e.g. side_rail on mobile).
    Unknown placements return None too — the caller treats that as
    "no spec, accept as-is" (see module docstring for why)."""
    return (SIZES.get(placement) or {}).get(breakpoint)


# ── R30 §28 · bidi isolation for dimension pairs in Hebrew copy ──────
#
# "נדרש 1200×150" renders as "נדרש 150×1200" in an RTL paragraph: the
# `×` is a NEUTRAL character between two LTR runs, so it takes the
# paragraph's base direction and the pair lays out right-to-left. The
# admin then reads the REVERSED size out of our own rejection message
# and re-uploads at the wrong shape.
#
# The frontend fixes its own strings with <bdi>, but a server message
# is plain text with nowhere to hang markup. U+2066 LEFT-TO-RIGHT
# ISOLATE … U+2069 POP DIRECTIONAL ISOLATE does the same job in the
# character stream, and any conforming renderer honours it — browser,
# curl in a terminal, Postman, a log line.
_LRI = "⁦"   # LEFT-TO-RIGHT ISOLATE
_PDI = "⁩"   # POP DIRECTIONAL ISOLATE


def _ltr(text: str) -> str:
    """Wrap a run that must read left-to-right inside Hebrew copy."""
    return f"{_LRI}{text}{_PDI}"


class DimensionRejection(Exception):
    """Server-side rejection surfaces as HTTP 400 with the Hebrew
    message. Kept as a dedicated exception so callers can distinguish
    "wrong shape" from "missing fields"."""
    def __init__(self, code: str, message_he: str, extra: Optional[dict] = None) -> None:
        super().__init__(message_he)
        self.code = code
        self.message_he = message_he
        self.extra = extra or {}


# R29 §3 · wide-strip slots default to the composite render (brand_bg
# strip + headline + body + CTA). A flat creative is served ONLY when
# a sponsor_creatives row exactly matches the slot aspect (±3%). A
# non-matching creative falls to composite — never a centred image on
# white. Listed here so the render-mode picker in the public read
# endpoint stays honest about which slots this rule covers.
_WIDE_STRIP_PLACEMENTS = frozenset({
    "home_leaderboard",
    "home_billboard",
    "home_banner",          # R21/R22 legacy, same 1200×250 spec as billboard
    "marketplace_banner",   # same rule — a strip on a page, not a card
    "listing_inline",       # R30 §12b · 1200×250 strip under the description
})


def is_wide_strip(placement: Optional[str]) -> bool:
    """True when the placement is a full-width strip where the composite
    (headline + body + CTA on brand_bg) is the default render."""
    return placement in _WIDE_STRIP_PLACEMENTS


def creative_matches_slot(
    placement: str,
    breakpoint: Breakpoint,
    w: Optional[int],
    h: Optional[int],
) -> bool:
    """True when a raw creative (w, h) sits within ±3% of the slot's
    approved aspect AND meets the minimum-width bar. Used at read
    time to decide whether a legacy sponsor_ads.creative_url may
    render for this slot or must be replaced by the composite.

    Unknown placement OR missing (w, h) → False (fall to composite).
    This is stricter than `check_creative_dimensions`, which returns
    silently on unknown placements — the read path prefers composite
    when unsure, because a bad wide-strip render is worse than a text
    strip.
    """
    if not w or not h:
        return False
    spec = size_for(placement, breakpoint)
    if spec is None:
        return False
    spec_w, spec_h = spec
    if w < spec_w:
        return False
    spec_ratio = spec_w / spec_h
    got_ratio  = w / h
    return abs(got_ratio - spec_ratio) / spec_ratio <= _ASPECT_TOLERANCE


# ── WCAG 4.5:1 contrast check (R29 §3 tail rule) ──────────────────────────
#
# The composite render paints headline + body + CTA in brand_fg on
# brand_bg. When contrast falls below WCAG AA large-text 4.5:1 the
# strip is unreadable and the ad is worse than useless — a viewer
# who can't read it never clicks. So we reject on save rather than
# ship the bad ad. Reference:
# https://www.w3.org/TR/WCAG21/#contrast-minimum
#
# Both colours arrive as "#RRGGBB" (Pydantic already validates the
# shape at Field(min=7, max=7)). Anything else → False and we skip
# the check (a defensive-only path — the validator upstream should
# have thrown 400).

def _hex_to_srgb(hex_col: str) -> Optional[tuple[float, float, float]]:
    if not hex_col or not hex_col.startswith("#") or len(hex_col) != 7:
        return None
    try:
        r = int(hex_col[1:3], 16) / 255.0
        g = int(hex_col[3:5], 16) / 255.0
        b = int(hex_col[5:7], 16) / 255.0
    except ValueError:
        return None
    return r, g, b


def _relative_luminance(rgb: tuple[float, float, float]) -> float:
    def _channel(c: float) -> float:
        # WCAG 2.1 formula; linearise sRGB → luminance.
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast_ratio(fg_hex: str, bg_hex: str) -> Optional[float]:
    """Return the WCAG contrast ratio (>= 1.0). None on malformed input
    (caller should skip enforcement rather than 500)."""
    fg = _hex_to_srgb(fg_hex)
    bg = _hex_to_srgb(bg_hex)
    if fg is None or bg is None:
        return None
    lum_a = _relative_luminance(fg)
    lum_b = _relative_luminance(bg)
    lighter, darker = (lum_a, lum_b) if lum_a > lum_b else (lum_b, lum_a)
    return (lighter + 0.05) / (darker + 0.05)


_MIN_CONTRAST_RATIO = 4.5


def check_brand_contrast(brand_fg: Optional[str], brand_bg: Optional[str]) -> None:
    """Raise DimensionRejection when brand_fg on brand_bg falls below
    WCAG AA 4.5:1. Silent when either value is missing (the composite
    render already has fallback #0f172a bg / #ffffff fg with 15+ contrast,
    so a NULL pair is legal).

    Same exception type as the dimension check so the admin route
    handler has one catch to bridge back to HTTP 400.
    """
    if not brand_fg or not brand_bg:
        return
    ratio = contrast_ratio(brand_fg, brand_bg)
    if ratio is None:
        return
    if ratio < _MIN_CONTRAST_RATIO:
        raise DimensionRejection(
            code="brand_contrast_too_low",
            message_he=(
                f"ניגודיות הצבעים נמוכה מדי לקריאה. "
                f"נדרש יחס ניגודיות של לפחות {_MIN_CONTRAST_RATIO:.1f}:1 "
                f"(WCAG AA), התקבל {ratio:.2f}:1."
            ),
            extra={
                "min_ratio":    _MIN_CONTRAST_RATIO,
                "actual_ratio": round(ratio, 2),
                "brand_fg":     brand_fg,
                "brand_bg":     brand_bg,
            },
        )


def check_creative_dimensions(
    placement: str,
    breakpoint: Breakpoint,
    w: int,
    h: int,
) -> None:
    """Raises DimensionRejection when the (w, h) don't fit the spec
    for the given placement + breakpoint. Silent success otherwise.

    Rejection reasons:
      - too small: width smaller than spec width
      - wrong aspect: (w/h) differs from spec (w/h) by > _ASPECT_TOLERANCE
    """
    spec = size_for(placement, breakpoint)
    if spec is None:
        # Unknown placement / no spec on this breakpoint — see module
        # docstring. Not a rejection; the render pipeline handles
        # missing creatives via the fallback chain in migration 093.
        return

    spec_w, spec_h = spec

    if w < spec_w:
        raise DimensionRejection(
            code="creative_too_small",
            message_he=(
                f"התמונה שהועלתה קטנה מדי לסלוט הזה. "
                f"נדרש רוחב של לפחות {_ltr(f'{spec_w}px')}, הועלתה {_ltr(f'{w}px')}."
            ),
            extra={"expected_w": spec_w, "expected_h": spec_h, "got_w": w, "got_h": h},
        )

    spec_ratio = spec_w / spec_h
    got_ratio = w / h
    if abs(got_ratio - spec_ratio) / spec_ratio > _ASPECT_TOLERANCE:
        raise DimensionRejection(
            code="creative_wrong_aspect",
            message_he=(
                f"יחס הצדדים של התמונה אינו מתאים לסלוט. "
                f"נדרש {_ltr(f'{spec_w}×{spec_h}')}, הועלתה {_ltr(f'{w}×{h}')}."
            ),
            extra={"expected_w": spec_w, "expected_h": spec_h, "got_w": w, "got_h": h},
        )


# ── R29 §3 · drift guard for the mirrored catalog ──────────────────
#
# The read-side subset of this table (SIZES + _WIDE_STRIP_PLACEMENTS
# + _ASPECT_TOLERANCE) is DUPLICATED in
# services/user-org/app/services/sponsor_sizes.py because Railway
# builds each service from its own subtree — a cross-service import
# from user-org into admin returned ImportError at runtime and every
# ad silently fell to render_mode="creative" (a bug that shipped
# once, staging, 22.09).
#
# Duplication is intentional; drift is not. Every module import
# recomputes _catalog_hash() and asserts it against
# `_CANONICAL_CATALOG_HASH` below. Editing SIZES / _WIDE_STRIP_PLACEMENTS
# / _ASPECT_TOLERANCE in one copy without updating the constant here
# (and in the sibling file) crashes that service at IMPORT time:
#   * FastAPI startup fails → Railway health check flips red
#   * CI (which imports the module during unit tests) fails to green
# Neither service can silently disagree — mismatch = loud.
#
# Procedure to change the catalog:
#   1. Edit SIZES / _WIDE_STRIP_PLACEMENTS / _ASPECT_TOLERANCE HERE.
#   2. Run `python services/admin/app/services/sponsor_sizes.py` to
#      print the new hash (main block below).
#   3. Paste the new hash into _CANONICAL_CATALOG_HASH in BOTH copies.
#   4. Copy the exact same SIZES / _WIDE_STRIP_PLACEMENTS values to
#      the user-org copy.
# Skipping step 3 or 4 = one service dies on startup. That is the
# feature.
_CANONICAL_CATALOG_HASH = "aecc1dac9f3721390f21937ff7ae5aa6956e3881c039487db087506a9395904a"


def _catalog_hash() -> str:
    """Canonical hash of the read-side catalog. Both service copies
    must produce the same string, and it must match
    _CANONICAL_CATALOG_HASH. Serialisation is sorted-key JSON so
    Python dict ordering never affects the digest."""
    import hashlib
    import json
    payload = {
        "sizes": {
            slot: {bp: (list(spec) if spec else None) for bp, spec in bps.items()}
            for slot, bps in SIZES.items()
        },
        "wide_strip": sorted(_WIDE_STRIP_PLACEMENTS),
        "tolerance":  _ASPECT_TOLERANCE,
    }
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()


_actual_hash = _catalog_hash()
if _actual_hash != _CANONICAL_CATALOG_HASH:
    raise RuntimeError(
        "sponsor_sizes catalog drift detected in services/admin.\n"
        f"  computed: {_actual_hash}\n"
        f"  expected: {_CANONICAL_CATALOG_HASH}\n"
        "Either revert your SIZES edit OR update _CANONICAL_CATALOG_HASH "
        "in BOTH services/admin/app/services/sponsor_sizes.py AND "
        "services/user-org/app/services/sponsor_sizes.py (with matching "
        "SIZES bodies)."
    )


if __name__ == "__main__":  # pragma: no cover — dev helper
    # Run this file directly to print the current catalog hash, so you
    # can paste it into _CANONICAL_CATALOG_HASH after a legitimate edit.
    print(_catalog_hash())
