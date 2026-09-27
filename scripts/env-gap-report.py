#!/usr/bin/env python3
"""R31 §3 · staging vs production environment gap — KEY NAMES ONLY.

Reads `railway variables --kv` for every service in two environments and
reports, per service:

  MISSING   set on staging, absent on production  → will 500 or silently
            fall back the first time production reaches that code path
  EXTRA     set on production, absent on staging  → untested config
  DIFFERS   present on both with different values → expected for URLs and
            credentials, DANGEROUS for feature flags
  SAME      identical value in both               → the interesting case,
            because several of these MUST differ

It never prints a value. For DIFFERS it prints a short sha256 prefix of
each side so two runs can be compared without either secret leaving the
terminal. For SAME it prints the key alone — and SAME is the column to
read, since a shared Cloudinary account or a shared MASTER_OTP shows up
exactly there.

Usage:
  python scripts/env-gap-report.py                     # all services
  python scripts/env-gap-report.py auth notification   # a subset
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys

SERVICES = ["gateway", "auth", "user-org", "admin", "notification",
            "payment", "deal", "worker", "job-match", "frontend"]

STAGING = "Staging"
PRODUCTION = "production"

# Keys whose value SHOULD differ between the two environments. Listing
# them means the report can say "same, and that is the finding" instead
# of leaving the reader to remember which ones matter.
MUST_DIFFER = {
    "CLOUDINARY_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET", "CLOUDINARY_UPLOAD_PRESET",
    "JWT_SECRET", "REFRESH_TOKEN_SECRET", "SESSION_SECRET",
    "FRONTEND_URL", "CORS_ALLOWED_ORIGINS",
    "VONAGE_API_KEY", "VONAGE_API_SECRET",
    "CARDCOM_TERMINAL_NUMBER", "CARDCOM_API_NAME", "CARDCOM_API_PASSWORD",
}

# NOT in MUST_DIFFER, and the first run flagged it wrongly:
# NEXT_PUBLIC_API_URL is `/api` in both, which is correct — it is a
# relative path, so it resolves against whichever origin served the
# page. Identical is the right answer there, and a check that cannot
# tell "same because relative" from "same because copied" is a check
# that trains people to skim past red.

# Keys that must NOT exist in production at all.
FORBIDDEN_IN_PROD = {"MASTER_OTP", "HIDE_SEED_ROWS", "PAYMENT_FAKE_MODE",
                     "SEED_ADMIN_PHONE", "SEED_ADMIN_NAME"}

# Keys production must HAVE. Absence here is not clutter, it is a
# feature that does not work: no ANTHROPIC_API_KEY means the Hebrew
# query parser — the product — cannot run, and no ENVIRONMENT means
# seed_visibility.hide_seed_rows() never engages, which is the one
# item the launch list says must be verified automatically.
REQUIRED_IN_PROD = {
    "user-org":     {"ANTHROPIC_API_KEY", "ENVIRONMENT", "CLOUDINARY_CLOUD_NAME",
                     "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"},
    "notification": {"VONAGE_FROM", "INTERNAL_BATCH_SECRET"},
    "payment":      {"INTERNAL_BATCH_SECRET"},
}


def read(service: str, env: str) -> dict[str, str] | None:
    try:
        p = subprocess.run(
            ["railway", "variables", "--service", service,
             "--environment", env, "--kv"],
            capture_output=True, text=True, timeout=120, shell=True,
        )
    except subprocess.TimeoutExpired:
        return None
    if p.returncode != 0:
        return None
    out = {}
    for line in p.stdout.splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v
    return out


def h(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()[:8]


def main() -> int:
    services = sys.argv[1:] or SERVICES
    report = {}
    for svc in services:
        s = read(svc, STAGING)
        p = read(svc, PRODUCTION)
        if s is None or p is None:
            print(f"\n### {svc}\n  could not read "
                  f"({'staging' if s is None else ''}"
                  f"{' production' if p is None else ''})")
            continue
        sk, pk = set(s), set(p)
        missing = sorted(sk - pk)
        extra = sorted(pk - sk)
        differs = sorted(k for k in sk & pk if s[k] != p[k])
        same = sorted(k for k in sk & pk if s[k] == p[k])

        same_but_must_differ = [k for k in same if k in MUST_DIFFER]
        forbidden = [k for k in pk if k in FORBIDDEN_IN_PROD]
        absent = sorted(REQUIRED_IN_PROD.get(svc, set()) - pk)

        report[svc] = dict(missing=missing, extra=extra, differs=differs,
                           same=same, shared=same_but_must_differ,
                           forbidden=forbidden, absent_required=absent)

        print(f"\n### {svc}  (staging {len(sk)} keys · production {len(pk)})")
        if forbidden:
            print(f"  🔴 PRESENT IN PRODUCTION AND MUST NOT BE: {', '.join(forbidden)}")
        if absent:
            print(f"  🔴 REQUIRED IN PRODUCTION AND ABSENT: {', '.join(absent)}")
        if same_but_must_differ:
            print(f"  🔴 SAME VALUE IN BOTH, MUST DIFFER: {', '.join(same_but_must_differ)}")
        if missing:
            print(f"  MISSING in production ({len(missing)}): {', '.join(missing)}")
        if extra:
            print(f"  EXTRA in production ({len(extra)}): {', '.join(extra)}")
        if differs:
            print(f"  differs ({len(differs)}): "
                  + ", ".join(f"{k}[{h(s[k])}≠{h(p[k])}]" for k in differs))
        print(f"  same ({len(same)})")

    with open("env-gap.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print("\nkey names written to env-gap.json (no values)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
