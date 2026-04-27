"""Tiny in-process sliding-window rate limiter.

Sufficient for the current single-instance user-org deployment. When the
service is sharded, swap to Redis without changing the call sites.
"""
from collections import defaultdict
from time import monotonic

_buckets: dict[str, list[float]] = defaultdict(list)


def check(key: str, max_per_window: int, window_seconds: int) -> bool:
    """True if the call is allowed, False if it would exceed the limit."""
    now = monotonic()
    cutoff = now - window_seconds
    bucket = [t for t in _buckets[key] if t > cutoff]
    if len(bucket) >= max_per_window:
        _buckets[key] = bucket
        return False
    bucket.append(now)
    _buckets[key] = bucket
    return True
