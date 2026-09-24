#!/usr/bin/env python3
"""R30 §30b · every bookable placement must have a renderer.

An admin books a slot in /admin/sponsors and prices it. If nothing on
the site draws that placement, the advertiser paid for something that
never appears — we sold air. That is a revenue-integrity bug, not a
display gap, and it is invisible in code review because the two halves
live in different languages and different services.

It has already happened twice:
  * logo_wall   — in SPONSOR_SIZES, offered nowhere, no renderer
  * listing_rail / listing_inline (R30 §12b) — renderer written, READ
    side opened, WRITE side never updated, so the slots could be
    served but not booked

This script diffs the two registries and fails on drift in EITHER
direction:

  bookable   services/admin/app/routes/sponsors.py  _ALLOWED_PLACEMENTS
  rendered   services/frontend/src/lib/sponsorSizes.ts  RENDERED_PLACEMENTS

Run:
  python scripts/check-placement-renderers.py
Exit:
  0  = every bookable placement renders, and vice versa
  1  = drift (each offending placement named on stderr)
"""
from __future__ import annotations

import os
import re
import sys


def bookable_placements(path: str) -> set[str] | None:
    """Parse _ALLOWED_PLACEMENTS out of the admin router.

    Read as text rather than imported: the module pulls in fastapi, the
    DB layer and the sponsor_sizes drift guard, none of which belong in
    a CI lint.
    """
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"_ALLOWED_PLACEMENTS\s*=\s*\{(.*?)\}", src, re.S)
    if not m:
        return None
    return set(re.findall(r'"([a-z_]+)"', m.group(1)))


def rendered_placements(path: str) -> set[str] | None:
    """Parse RENDERED_PLACEMENTS out of the TS registry."""
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(
        r"export\s+const\s+RENDERED_PLACEMENTS\s*:[^=]*=\s*\{(.*?)\n\};", src, re.S
    )
    if not m:
        return None
    # keys are bare identifiers: `search_inline: '…'`
    return set(re.findall(r"^\s*([a-z_]+)\s*:", m.group(1), re.M))


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, ".."))
    admin_path = os.path.join(root, "services", "admin", "app", "routes", "sponsors.py")
    ts_path    = os.path.join(root, "services", "frontend", "src", "lib", "sponsorSizes.ts")

    for p in (admin_path, ts_path):
        if not os.path.isfile(p):
            print(f"[placements] missing: {p}", file=sys.stderr)
            return 1

    bookable = bookable_placements(admin_path)
    rendered = rendered_placements(ts_path)
    if bookable is None:
        print(f"[placements] could not parse _ALLOWED_PLACEMENTS from {admin_path}", file=sys.stderr)
        return 1
    if rendered is None:
        print(f"[placements] could not parse RENDERED_PLACEMENTS from {ts_path}", file=sys.stderr)
        return 1

    errors: list[str] = []

    sold_but_dark = sorted(bookable - rendered)
    if sold_but_dark:
        errors.append("BOOKABLE BUT NOT RENDERED — an admin can sell a slot that never appears:")
        errors.extend(f"    {p}" for p in sold_but_dark)

    built_but_unsellable = sorted(rendered - bookable)
    if built_but_unsellable:
        errors.append("RENDERED BUT NOT BOOKABLE — the surface exists and no one can buy it:")
        errors.extend(f"    {p}" for p in built_but_unsellable)

    if errors:
        print("[placements] registries disagree:", file=sys.stderr)
        for line in errors:
            print(line, file=sys.stderr)
        print(
            "\n[placements] fix: add the placement to BOTH\n"
            "  services/admin/app/routes/sponsors.py  _ALLOWED_PLACEMENTS\n"
            "  services/frontend/src/lib/sponsorSizes.ts  RENDERED_PLACEMENTS\n"
            "or, if it genuinely has no renderer yet (logo_wall), leave it out of\n"
            "both so the booking endpoint keeps returning 400.",
            file=sys.stderr,
        )
        return 1

    print(f"[placements] {len(bookable)} placements — all bookable ones render")
    return 0


if __name__ == "__main__":
    sys.exit(main())
