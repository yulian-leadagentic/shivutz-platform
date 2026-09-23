#!/usr/bin/env python3
"""R30 §15 · CI parity check for the mirrored phone normalizer.

services/user-org/app/services/phone_normalize.py is the source of
truth; services/admin/app/services/phone_normalize.py is a verbatim
mirror. The copy exists because Railway builds each service from its
own subtree and a cross-service Python import ImportErrors at runtime
— the R29 §3 failure, which shipped silently and mis-rendered every
ad for a day.

Runtime guards in each file are defence-in-depth, and deliberately
asymmetric (same reasoning as sponsor_sizes):
  * admin     → hard raise at import (narrow blast radius)
  * user-org  → logger.error + continue (a failed boot is a full outage)

THIS script is the authoritative check. It loads both files by
absolute path under synthetic module names — two modules that both
call themselves `app.services.phone_normalize` cannot be imported
normally in one process — and compares their BEHAVIOUR rather than
their text, so a reworded comment passes and a genuine logic change
fails.

Run:
  python scripts/check-phone-normalize-parity.py
Exit:
  0  = the two copies behave identically and match their pinned hash
  1  = drift (the offending probe is named on stderr)
"""
from __future__ import annotations

import importlib.util
import os
import sys


def _load(path: str, alias: str):
    spec = importlib.util.spec_from_file_location(alias, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"can't build spec for {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[alias] = mod
    spec.loader.exec_module(mod)
    return mod


def _outcomes(mod) -> dict:
    """Probe → normalized value, or '!code' when rejected."""
    out = {}
    for probe in mod._mirror_guard_probes() if hasattr(mod, "_mirror_guard_probes") else mod._PROBES:
        try:
            out[repr(probe)] = mod.normalize_israeli_phone(probe)
        except mod.InvalidPhone as exc:
            out[repr(probe)] = f"!{exc.code}"
    return out


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, ".."))
    user_path  = os.path.join(root, "services", "user-org", "app", "services", "phone_normalize.py")
    admin_path = os.path.join(root, "services", "admin",    "app", "services", "phone_normalize.py")

    for p in (user_path, admin_path):
        if not os.path.isfile(p):
            print(f"[phone-parity] missing: {p}", file=sys.stderr)
            return 1

    # The admin copy raises at import when its own hash drifts, so an
    # ImportError here IS a drift report — surface it as one rather
    # than a traceback.
    try:
        user  = _load(user_path,  "_parity_user_phone")
        admin = _load(admin_path, "_parity_admin_phone")
    except RuntimeError as exc:
        print(f"[phone-parity] a copy refused to load:\n{exc}", file=sys.stderr)
        return 1

    errors: list[str] = []

    u_out, a_out = _outcomes(user), _outcomes(admin)
    for probe in sorted(set(u_out) | set(a_out)):
        u, a = u_out.get(probe, "<absent>"), a_out.get(probe, "<absent>")
        if u != a:
            errors.append(f"  {probe}: user-org → {u!r}, admin → {a!r}")
    if errors:
        errors.insert(0, "normalizer behaviour differs between the two copies:")

    if user._behavior_fingerprint() != admin._behavior_fingerprint():
        errors.append("behaviour fingerprints differ (see the probe list above)")
    if user._CANONICAL_BEHAVIOR_HASH != admin._CANONICAL_BEHAVIOR_HASH:
        errors.append(
            f"pinned hashes differ: user-org={user._CANONICAL_BEHAVIOR_HASH}, "
            f"admin={admin._CANONICAL_BEHAVIOR_HASH}"
        )
    actual = user._behavior_fingerprint()
    if actual != user._CANONICAL_BEHAVIOR_HASH:
        errors.append(
            f"behaviour changed but the pinned hash was not updated: "
            f"computed {actual}, pinned {user._CANONICAL_BEHAVIOR_HASH}"
        )

    # The HTTP wrapper must exist on both — a route importing it from
    # the admin copy would otherwise fail only at request time.
    for name, mod in (("user-org", user), ("admin", admin)):
        for fn in ("normalize_or_400", "message_he"):
            if not hasattr(mod, fn):
                errors.append(f"{name} copy is missing {fn}()")

    if errors:
        print("[phone-parity] drift:", file=sys.stderr)
        for line in errors:
            print(line, file=sys.stderr)
        print(
            "\n[phone-parity] fix: edit services/user-org/.../phone_normalize.py, "
            "mirror it verbatim into services/admin/.../phone_normalize.py, then run\n"
            "  python services/user-org/app/services/phone_normalize.py\n"
            "and paste the printed hash into _CANONICAL_BEHAVIOR_HASH in BOTH files.",
            file=sys.stderr,
        )
        return 1

    print(f"[phone-parity] copies agree (hash={actual[:12]}…)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
