"""R29 §2/§3 · read-side subset of the sponsor sizes catalog.

MIRROR of services/admin/app/services/sponsor_sizes.py. The write
side (admin) owns the full module with WCAG + dimension checks;
this file only carries what the public read endpoint needs to
decide render_mode. Kept as a duplicate rather than a shared package
because Railway isolates each service's file tree — a cross-service
import from user-org into admin returns ImportError at runtime, so
the earlier attempt (with a stub fallback) silently degraded to
render_mode="creative" for every wide-strip slot.

**If you edit SIZES here, edit the admin copy too.** They must
agree — otherwise an admin can save a creative the read side then
rejects, or the read side accepts a creative the admin never saw.
There is no runtime check that enforces parity — the duplication
lives on the honor system, guarded by this comment and a grep for
`SIZES = {`. A future refactor should promote this into a shared
Python package if a third service ever needs it.
"""
from __future__ import annotations

from typing import Optional, Literal

Breakpoint = Literal["desktop", "mobile"]

# R29 §2 · APPROVED 22.09.2026 by Yulian. Keep in sync with
# services/admin/app/services/sponsor_sizes.py — same table, same
# tolerance, same wide-strip set.
SIZES: dict[str, dict[str, Optional[tuple[int, int]]]] = {
    "home_leaderboard":                    {"desktop": (1200, 150), "mobile": (720, 200)},
    "home_billboard":                      {"desktop": (1200, 250), "mobile": (720, 300)},
    "side_rail":                           {"desktop": (300, 600),  "mobile": None},
    "home_carousel":                       {"desktop": (640, 360),  "mobile": (640, 360)},
    "marketplace_carousel":                {"desktop": (640, 360),  "mobile": (640, 360)},
    "marketplace_banner":                  {"desktop": (1200, 250), "mobile": (720, 300)},
    "search_inline":                       {"desktop": (240, 240),  "mobile": (240, 240)},
    "logo_wall":                           {"desktop": (240, 120),  "mobile": None},
    # R21/R22 legacy — same 1200×250 spec as billboard. Kept named
    # for the pre-R29 sponsor_ads rows that still target it.
    "home_banner":                         {"desktop": (1200, 250), "mobile": (720, 300)},
}

_ASPECT_TOLERANCE = 0.03

# R29 §3 · slots where the composite (brand_bg + headline + body +
# CTA) is the DEFAULT render. A flat creative on one of these paints
# ONLY when its aspect matches the slot within ±3%.
_WIDE_STRIP_PLACEMENTS = frozenset({
    "home_leaderboard",
    "home_billboard",
    "home_banner",          # legacy alias, same 1200×250 spec
    "marketplace_banner",
})


def size_for(placement: str, breakpoint: Breakpoint) -> Optional[tuple[int, int]]:
    """Return (w, h) for a placement/breakpoint; None when the slot
    doesn't exist on that breakpoint (e.g. side_rail on mobile) or
    the placement is unknown."""
    return (SIZES.get(placement) or {}).get(breakpoint)


def is_wide_strip(placement: Optional[str]) -> bool:
    return placement in _WIDE_STRIP_PLACEMENTS


def creative_matches_slot(
    placement: str,
    breakpoint: Breakpoint,
    w: Optional[int],
    h: Optional[int],
) -> bool:
    """True when a raw creative (w, h) sits within ±3% of the slot's
    approved aspect AND meets the minimum-width bar. Unknown
    placement OR missing (w, h) → False (fall to composite)."""
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


# R29 §3 · drift guard for the mirrored catalog.
#
# BLAST-RADIUS RULE — this is user-org (the read side). Editing SIZES
# / _WIDE_STRIP_PLACEMENTS here without updating the admin copy is a
# real defect, but it is a COSMETIC defect: a sponsor banner renders
# at the wrong shape. user-org also serves search, marketplace,
# registration, and contact reveals. A HARD crash here would take the
# whole product down for an ad-sizing typo. So this file DEGRADES to
# a loud logger.error() and keeps going — the service starts, the ads
# render whatever the local catalog says, and ops sees the ERROR in
# the log stream.
#
# The write side (services/admin/app/services/sponsor_sizes.py) still
# crashes hard on drift — same catch-early rule at the ENFORCEMENT
# boundary — and a dedicated CI test at scripts/check-sponsor-sizes-parity.py
# imports both files and blocks the merge if the two catalogs disagree,
# so drift never reaches Railway at all under normal operation.
# Together: CI = fail-fast; admin = fail-fast at runtime; user-org =
# survive and log. That is the belt-and-braces Yulian asked for.
_CANONICAL_CATALOG_HASH = "945707de90c1f4fdb9e3192b0c58e9913cec9aebb391b8ad2027ebaa3c565098"


def _catalog_hash() -> str:
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
    # NOT `raise` — see BLAST-RADIUS RULE above. Log loudly and continue.
    import logging
    logging.getLogger(__name__).error(
        "sponsor_sizes catalog drift detected in services/user-org "
        "(cosmetic; render mode picks may disagree with the admin "
        "write-side check until parity is restored). "
        "computed=%s expected=%s. "
        "Fix by editing services/admin/app/services/sponsor_sizes.py + "
        "services/user-org/app/services/sponsor_sizes.py in lockstep "
        "and updating _CANONICAL_CATALOG_HASH in both.",
        _actual_hash, _CANONICAL_CATALOG_HASH,
    )


if __name__ == "__main__":  # pragma: no cover — dev helper
    print(_catalog_hash())
