#!/usr/bin/env python3
"""R29 §3 · CI catalog-parity check for services/admin ↔ services/user-org.

The sponsor_sizes catalog (SIZES + _WIDE_STRIP_PLACEMENTS +
_ASPECT_TOLERANCE) lives in TWO files because Railway builds each
service from its own subtree and a cross-service Python import
returned ImportError at runtime (the R28 §4 bug this whole section
closes). Runtime drift guards in each file are defence-in-depth:
  * admin  → hard raise (write side, small blast radius)
  * user-org → logger.error + continue (read side, wide blast radius)

This CI script is the AUTHORITATIVE parity check. It imports both
files by their absolute paths (Python can't import two modules with
the same fully-qualified name simultaneously, so we use
importlib.util.spec_from_file_location) and diffs the catalog. Any
divergence in SIZES / _WIDE_STRIP_PLACEMENTS / _ASPECT_TOLERANCE
fails the CI job — a merge that touches one file without the other
never reaches Railway.

Run:
  python scripts/check-sponsor-sizes-parity.py
Exit:
  0  = catalogs match
  1  = drift (message printed to stderr identifies the mismatch)
"""
from __future__ import annotations

import importlib.util
import os
import sys


def _load_module(path: str, alias: str):
    """Load a Python file by path under a synthetic module name. Using
    a synthetic name (not the file's package-qualified one) lets us
    load two files that both call themselves `app.services.sponsor_sizes`
    in the same process — pytest / regular import machinery could not
    do this without shadowing."""
    spec = importlib.util.spec_from_file_location(alias, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"can't build spec for {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[alias] = mod
    spec.loader.exec_module(mod)
    return mod


def _normalise_sizes(sizes: dict) -> dict:
    """Tuples in one file, tuples in the other — but a future edit
    might use lists by accident. Coerce to lists for the diff so we
    catch REAL differences, not container-type noise."""
    return {
        slot: {bp: (list(spec) if spec is not None else None) for bp, spec in bps.items()}
        for slot, bps in sizes.items()
    }


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, ".."))
    admin_path = os.path.join(root, "services", "admin",    "app", "services", "sponsor_sizes.py")
    user_path  = os.path.join(root, "services", "user-org", "app", "services", "sponsor_sizes.py")

    for path in (admin_path, user_path):
        if not os.path.isfile(path):
            print(f"[parity] missing catalog file: {path}", file=sys.stderr)
            return 1

    admin = _load_module(admin_path, "_parity_admin_sponsor_sizes")
    user  = _load_module(user_path,  "_parity_user_sponsor_sizes")

    errors: list[str] = []

    admin_sizes = _normalise_sizes(admin.SIZES)
    user_sizes  = _normalise_sizes(user.SIZES)
    if admin_sizes != user_sizes:
        errors.append("SIZES catalogs differ.")
        admin_keys = set(admin_sizes)
        user_keys  = set(user_sizes)
        only_admin = admin_keys - user_keys
        only_user  = user_keys - admin_keys
        if only_admin:
            errors.append(f"  slots only in admin: {sorted(only_admin)}")
        if only_user:
            errors.append(f"  slots only in user-org: {sorted(only_user)}")
        for k in sorted(admin_keys & user_keys):
            if admin_sizes[k] != user_sizes[k]:
                errors.append(f"  slot {k!r} differs:")
                errors.append(f"    admin    → {admin_sizes[k]}")
                errors.append(f"    user-org → {user_sizes[k]}")

    admin_wide = sorted(admin._WIDE_STRIP_PLACEMENTS)
    user_wide  = sorted(user._WIDE_STRIP_PLACEMENTS)
    if admin_wide != user_wide:
        errors.append("_WIDE_STRIP_PLACEMENTS sets differ.")
        errors.append(f"  admin    → {admin_wide}")
        errors.append(f"  user-org → {user_wide}")

    if admin._ASPECT_TOLERANCE != user._ASPECT_TOLERANCE:
        errors.append(
            f"_ASPECT_TOLERANCE differs: admin={admin._ASPECT_TOLERANCE}, "
            f"user-org={user._ASPECT_TOLERANCE}"
        )

    # Belt-and-braces: also assert the sha256 hashes agree. This
    # catches a hash-constant drift even when the catalogs happen to
    # look identical to the human diff above (they shouldn't — same
    # inputs = same hash — but a subtle serialisation change in one
    # copy's _catalog_hash would surface here).
    admin_hash = admin._catalog_hash()
    user_hash  = user._catalog_hash()
    if admin_hash != user_hash:
        errors.append(
            f"computed catalog hash differs: admin={admin_hash}, "
            f"user-org={user_hash}"
        )
    if admin_hash != admin._CANONICAL_CATALOG_HASH:
        errors.append(
            f"admin catalog hash != admin _CANONICAL_CATALOG_HASH "
            f"({admin_hash} vs {admin._CANONICAL_CATALOG_HASH})"
        )
    if user_hash != user._CANONICAL_CATALOG_HASH:
        errors.append(
            f"user-org catalog hash != user-org _CANONICAL_CATALOG_HASH "
            f"({user_hash} vs {user._CANONICAL_CATALOG_HASH})"
        )

    if errors:
        print("[parity] sponsor_sizes catalog drift:", file=sys.stderr)
        for line in errors:
            print(line, file=sys.stderr)
        print(
            "\n[parity] fix: edit BOTH catalog files in lockstep, then run\n"
            "  python services/admin/app/services/sponsor_sizes.py\n"
            "to print the new hash and paste it into _CANONICAL_CATALOG_HASH "
            "in both copies.",
            file=sys.stderr,
        )
        return 1

    print(f"[parity] sponsor_sizes catalogs match (hash={admin_hash[:12]}…)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
