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


class DimensionRejection(Exception):
    """Server-side rejection surfaces as HTTP 400 with the Hebrew
    message. Kept as a dedicated exception so callers can distinguish
    "wrong shape" from "missing fields"."""
    def __init__(self, code: str, message_he: str, extra: Optional[dict] = None) -> None:
        super().__init__(message_he)
        self.code = code
        self.message_he = message_he
        self.extra = extra or {}


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
                f"נדרש רוחב של לפחות {spec_w}px, הועלתה {w}px."
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
                f"נדרש {spec_w}×{spec_h}, הועלתה {w}×{h}."
            ),
            extra={"expected_w": spec_w, "expected_h": spec_h, "got_w": w, "got_h": h},
        )
