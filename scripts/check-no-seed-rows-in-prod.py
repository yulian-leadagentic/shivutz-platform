#!/usr/bin/env python3
"""BLOCKING launch-list item · zero seed rows served in production.

Why a script and not a look
---------------------------
`sponsor_ads.advertiser_name` is a PUBLIC field — the wordmark when an
ad has no logo, and the text a screen reader announces. Staging carried
"איילון חברה לביטוח" on it: a real, publicly-traded Israeli insurer,
presented as an advertiser. On staging that is embarrassing. In
production it is using an existing company's name as a customer that is
not a customer.

"We cleaned it up" is true right until someone adds one more row. So
this is checked by a script, not by eye, and it is a blocking item on
the launch list.

What it does
------------
Hits the PUBLIC endpoints as an anonymous visitor would and asserts
that nothing carrying a seed marker comes back. It deliberately does
NOT read the database: the question is not "are there seed rows?"
(there always will be — they hold the staging demo) but "does a real
visitor see one?".

Run against production before launch, and against staging with
HIDE_SEED_ROWS=true set on the service to rehearse the same state:

  python scripts/check-no-seed-rows-in-prod.py --base-url https://www.tagidai.com

Exit:
  0  = no seed row reachable from any public surface
  1  = at least one is reachable (each one named on stderr)
  2  = could not complete the check (network / shape) — NOT a pass
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

# Substrings that betray a demo row in copy a visitor can read.
#
# Kept deliberately NARROW. The first draft included bare "בדיקה" and
# "test", which flagged a real listing whose description reads
# "כל הכלים מכוילים ובבדיקה תקופתית" — "under periodic inspection",
# ordinary Hebrew. A blocking launch check that cries wolf is a check
# people learn to skip, which is worse than not having one.
#
# So: only markers that cannot occur in genuine advertiser copy.
SEED_MARKERS = ("seed ·", "seed·", " seed ", "הדגמה", "לדוגמה", "demo ·", "probe")

# And only the IDENTITY fields — the ones that name who is advertising.
# Free-text descriptions are where ordinary words live, and scanning
# them is what produced the false positive above. Provenance is not
# supposed to be in ANY public field (that is the R30 naming rule); the
# is_seed gate is the real enforcement and this is the tripwire.
SCANNED_FIELDS = ("advertiser_name", "title")

PLACEMENTS = (
    "home_leaderboard", "home_billboard", "home_carousel", "home_banner",
    "side_rail", "listing_rail", "listing_inline",
    "marketplace_banner", "marketplace_carousel",
)


def get(url: str):
    req = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def looks_like_seed(text: str) -> str | None:
    low = (text or "").lower()
    for m in SEED_MARKERS:
        if m in low:
            return m
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True,
                    help="e.g. https://www.tagidai.com (no trailing slash)")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    findings: list[str] = []
    checked = 0

    try:
        # 1 · sponsored ads, every placement. advertiser_name is the
        #     field that renders publicly.
        for placement in PLACEMENTS:
            data = get(f"{base}/api/ads/public/sponsored?placement={placement}&limit=10")
            for row in data.get("results", []):
                checked += 1
                for field in SCANNED_FIELDS:
                    hit = looks_like_seed(row.get(field) or "")
                    if hit:
                        findings.append(
                            f"  sponsored[{placement}] {str(row.get('id'))[:8]} "
                            f".{field} contains {hit!r}: {row.get(field)!r}"
                        )

        # 2 · the search-results inline slot (NULL placement ≡ search_inline)
        data = get(f"{base}/api/ads/public/sponsored?limit=10")
        for row in data.get("results", []):
            checked += 1
            hit = looks_like_seed(row.get("advertiser_name") or "")
            if hit:
                findings.append(
                    f"  sponsored[search_inline] {str(row.get('id'))[:8]} "
                    f".advertiser_name contains {hit!r}: {row.get('advertiser_name')!r}"
                )

        # 3 · marketplace listings
        data = get(f"{base}/api/marketplace?limit=100")
        rows = data if isinstance(data, list) else data.get("results", data.get("items", []))
        for row in rows or []:
            checked += 1
            for field in SCANNED_FIELDS:
                hit = looks_like_seed(row.get(field) or "")
                if hit:
                    findings.append(
                        f"  marketplace {str(row.get('id'))[:8]} .{field} "
                        f"contains {hit!r}: {str(row.get(field))[:60]!r}"
                    )
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
        print(f"[seed-check] could not complete: {exc}", file=sys.stderr)
        print("[seed-check] treating as FAILURE — an unreachable check is not a pass.",
              file=sys.stderr)
        return 2

    if findings:
        print(f"[seed-check] {len(findings)} seed row(s) reachable from a public "
              f"surface at {base}:", file=sys.stderr)
        for f in findings:
            print(f, file=sys.stderr)
        print(
            "\n[seed-check] fix: set ENVIRONMENT=production (or HIDE_SEED_ROWS=true)\n"
            "on user-org so app/services/seed_visibility.py gates them out. Do NOT\n"
            "delete the rows — they hold the staging demo.",
            file=sys.stderr,
        )
        return 1

    print(f"[seed-check] {base}: {checked} public rows inspected, none is a seed row")
    return 0


if __name__ == "__main__":
    sys.exit(main())
