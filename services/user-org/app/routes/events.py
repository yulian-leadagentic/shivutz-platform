"""R6 §1b + §4 · promo_events endpoints.

Three routes:
    POST /events                 · public — record ONE ad impression/click/inquiry
    POST /events/batch           · public — record up to 20 in one request (R30 §26)
    GET  /admin/sponsor-stats    · admin  — per-ad daily counters + CTR

R30 §26 · why the batch route exists. The home page mounts four
sponsor surfaces (leaderboard, billboard, carousel, side_rail) and
each fired its own POST /events on impression. Combined with the
gateway's 30-requests-per-minute anon budget
(services/gateway/src/rateLimit.js), one page load spent four of a
visitor's thirty requests on telemetry alone — and since the rail's
fetch is issued last, it was the request that got 429'd when the
budget ran out. The paid ad slot was the thing being dropped.
The impressions are NOT removed (they are the CTR data the pricing
decision depends on); they are coalesced client-side and arrive as
one request.

The table `promo_events` was created in migration 065 and never wired
up — R6 argues that impression tracking is a PREREQUISITE for
sponsor-ad pricing (flat-per-category vs CPM), so wiring the events
before Yulian's November pricing decision produces the CTR data those
decisions need.

Design constraints (all from R6 §1b):
  1. Public POST is a write. Three input gates are non-negotiable:
     event_type allow-list · target_type allow-list · target_id must
     exist as an active sponsor_ad row.
  2. IP rate limit — 60 events per (IP, minute) window. High enough
     for a session of casual browsing (a sidebar carousel that
     rotates through 6 ads while a user scrolls a 15-slot marketplace
     can plausibly send 30-40 impression rows in a minute); low
     enough that a scripted flood can't blow up the table.
  3. session_id is client-generated, sessionStorage — the endpoint
     accepts whatever the caller sends without trying to correlate.
  4. metadata_json is limited to a small allow-list of keys (placement
     + category) so a rogue caller can't cram arbitrary blobs.
  5. Body size cap (16 KiB) so a scripted request can't POST 5,000
     event rows in one call.
"""
import ipaddress
import json
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, Field

from app.db import get_db

router = APIRouter()


# ── R6 §1b allow-lists ──────────────────────────────────────────────
_ALLOWED_EVENT_TYPES  = frozenset({"impression", "ad_click", "inquiry"})
_ALLOWED_TARGET_TYPES = frozenset({"sponsor_ad"})
# metadata_json is a two-key surface for now: where in the layout the
# ad was placed + which content category it appeared under. Every
# other key is dropped BEFORE the INSERT so an untrusted caller can't
# smuggle a fetch URL / referrer / user-agent into the table.
_ALLOWED_METADATA_KEYS = frozenset({"placement", "category"})


class EventPayload(BaseModel):
    event_type:    str = Field(min_length=1, max_length=32)
    target_type:   str = Field(min_length=1, max_length=24)
    target_id:     str = Field(min_length=1, max_length=36)
    session_id:    Optional[str] = Field(default=None, max_length=64)
    metadata:      Optional[dict] = None


# R30 §26 · batch envelope. Cap of 20 keeps the docstring's 16 KiB
# body ceiling comfortable and bounds the IN-clause below; the home
# page only ever coalesces four.
_BATCH_MAX = 20


class EventBatch(BaseModel):
    events: list[EventPayload] = Field(min_length=1, max_length=_BATCH_MAX)


def _clean_metadata(metadata: Optional[dict]) -> Optional[dict]:
    """§1b · metadata allow-list. Keep the two keys the client cares
    about, drop everything else. String values only, <= 64 chars each
    — no nested objects. Shared by the single + batch paths so the
    two can't drift on what a caller is allowed to smuggle in."""
    if not metadata:
        return None
    picked = {}
    for k, v in metadata.items():
        if k in _ALLOWED_METADATA_KEYS and isinstance(v, str):
            picked[k] = v[:64]
    return picked or None


def _live_target_ids(cur, target_ids: list[str]) -> set:
    """Subset of `target_ids` that are active sponsor_ads right now.
    One query for the whole batch rather than one per event."""
    if not target_ids:
        return set()
    placeholders = ",".join(["%s"] * len(target_ids))
    cur.execute(
        f"""SELECT id FROM sponsor_ads
             WHERE id IN ({placeholders}) AND active = TRUE
               AND (starts_at IS NULL OR starts_at <= NOW())
               AND (ends_at   IS NULL OR ends_at   >= NOW())""",
        tuple(target_ids),
    )
    return {row[0] if not isinstance(row, dict) else row["id"] for row in cur.fetchall()}


# ── Rate limiter (per-process, in-memory) ───────────────────────────
# Sufficient for now — the notification service runs one uvicorn per
# Railway pod, and we have one user-org pod. If we ever scale beyond
# 1 pod, move this to Redis with the same 60/min semantics.
_RATE_LIMIT_MAX      = 60      # requests per WINDOW per IP
_RATE_LIMIT_WINDOW_S = 60
_rate_ip_hits: "defaultdict[str, deque[float]]" = defaultdict(deque)


def _rate_limited(ip: str) -> bool:
    """True when this IP has exceeded 60 requests in the last 60s."""
    now  = time.monotonic()
    hits = _rate_ip_hits[ip]
    # Drop expired entries from the front — cheap because deque is
    # append/pop O(1) at both ends.
    while hits and hits[0] < now - _RATE_LIMIT_WINDOW_S:
        hits.popleft()
    if len(hits) >= _RATE_LIMIT_MAX:
        return True
    hits.append(now)
    return False


def _client_ip(request: Request) -> str:
    """Best-effort caller IP. Railway routes through an edge proxy so
    x-forwarded-for wins; falls back to the socket peer for local
    dev. Only the FIRST IP in the XFF list is trusted — the rest are
    hop-appended and forgeable."""
    xff = request.headers.get("x-forwarded-for") or ""
    if xff:
        first = xff.split(",")[0].strip()
        try:
            ipaddress.ip_address(first)  # validate
            return first
        except ValueError:
            pass
    peer = request.client
    return peer.host if peer else "unknown"


# ── POST /events ────────────────────────────────────────────────────
@router.post("/events", status_code=204)
async def record_event(
    body:            EventPayload,
    request:         Request,
    x_entity_id:     Optional[str] = Header(default=None),
    x_entity_type:   Optional[str] = Header(default=None),
):
    """Record one ad event. Public — anon must be able to send
    impressions — so every input is validated and the caller's IP is
    rate-limited. Returns 204 on success (no body — the client
    fire-and-forgets)."""

    ip = _client_ip(request)
    if _rate_limited(ip):
        # 429 with no body — R6 §1b guardrail: don't tell a flooder
        # WHY they're being throttled (window size, remaining count),
        # they'll just tune the attack.
        raise HTTPException(status_code=429, detail="rate_limited")

    # §1b · event_type allow-list.
    if body.event_type not in _ALLOWED_EVENT_TYPES:
        raise HTTPException(status_code=400, detail={"code": "event_type_not_allowed"})

    # §1b · target_type allow-list.
    if body.target_type not in _ALLOWED_TARGET_TYPES:
        raise HTTPException(status_code=400, detail={"code": "target_type_not_allowed"})

    # §1b · target_id must exist AND be active. Anything else lets a
    # caller cram arbitrary UUIDs into the table.
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id FROM sponsor_ads
                WHERE id = %s AND active = TRUE
                  AND (starts_at IS NULL OR starts_at <= NOW())
                  AND (ends_at   IS NULL OR ends_at   >= NOW())
                LIMIT 1""",
            (body.target_id,),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=400, detail={"code": "target_not_found"})

        clean_meta = _clean_metadata(body.metadata)

        import uuid as _uuid
        cur.execute(
            """INSERT INTO promo_events
                   (id, event_type, target_type, target_id,
                    actor_entity_id, actor_entity_type, session_id,
                    metadata_json)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                str(_uuid.uuid4()),
                body.event_type, body.target_type, body.target_id,
                x_entity_id or None, x_entity_type or None,
                body.session_id, json.dumps(clean_meta) if clean_meta else None,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return  # 204


# ── POST /events/batch ──────────────────────────────────────────────
@router.post("/events/batch", status_code=204)
async def record_events_batch(
    body:            EventBatch,
    request:         Request,
    x_entity_id:     Optional[str] = Header(default=None),
    x_entity_type:   Optional[str] = Header(default=None),
):
    """R30 §26 · record up to 20 ad events in ONE request.

    Counts as a single hit against both this endpoint's per-IP limiter
    and the gateway's anon budget — that is the entire point. Four
    sponsor impressions on a home page used to spend four of a
    visitor's thirty gateway requests.

    Differs from the single-event route in one deliberate way: an
    entry that fails validation (unknown event_type, stale target_id)
    is DROPPED, not 400. This is fire-and-forget telemetry and the
    batch is heterogeneous — one expired ad in the set must not cost
    us the other three impressions. A caller sending entirely invalid
    input gets a 204 and writes nothing, which is the same outcome
    they'd get from four individually-rejected posts.
    """
    ip = _client_ip(request)
    if _rate_limited(ip):
        raise HTTPException(status_code=429, detail="rate_limited")

    # Allow-list filter first — cheap, and shrinks the ID set we query.
    candidates = [
        e for e in body.events
        if e.event_type in _ALLOWED_EVENT_TYPES
        and e.target_type in _ALLOWED_TARGET_TYPES
    ]
    if not candidates:
        return  # 204 — nothing survived validation, nothing to write

    conn = get_db()
    try:
        cur = conn.cursor()
        live = _live_target_ids(cur, list({e.target_id for e in candidates}))
        if not live:
            return  # 204

        import uuid as _uuid
        rows = [
            (
                str(_uuid.uuid4()),
                e.event_type, e.target_type, e.target_id,
                x_entity_id or None, x_entity_type or None,
                e.session_id,
                json.dumps(_clean_metadata(e.metadata)) if _clean_metadata(e.metadata) else None,
            )
            for e in candidates if e.target_id in live
        ]
        if rows:
            cur.executemany(
                """INSERT INTO promo_events
                       (id, event_type, target_type, target_id,
                        actor_entity_id, actor_entity_type, session_id,
                        metadata_json)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                rows,
            )
            conn.commit()
    finally:
        conn.close()

    return  # 204


# ── GET /admin/sponsor-stats ────────────────────────────────────────
# R6 §4 · impressions + clicks + inquiries per sponsor_ad, per day.
# Admin-only. Uses idx_target_type_time (065:19) to keep the plan
# fast — see EXPLAIN acceptance item.

@router.get("/admin/sponsor-stats")
def sponsor_stats(
    days:          int = 30,
    x_user_role:   Optional[str] = Header(default=None),
):
    """Per-day counters for every sponsor_ad in the last `days` days.
    Only admin — non-admin (or anon) gets 403.

    Response shape:
        [
          {"target_id": "...", "day": "2026-09-19",
           "impressions": 128, "clicks": 6, "inquiries": 1, "ctr": 0.047},
          ...
        ]
    Rows for days with zero events are omitted (no synthetic zeros).
    """
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="admin_only")

    # Clamp so a mistaken `?days=99999` doesn't try to scan the whole
    # table. 90 covers a full quarter which is the widest window
    # anyone should need for a launch-period decision.
    days = max(1, min(int(days or 30), 90))

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT target_id,
                      DATE(at)                        AS day,
                      SUM(event_type='impression')   AS impressions,
                      SUM(event_type='ad_click')     AS clicks,
                      SUM(event_type='inquiry')      AS inquiries
                 FROM promo_events
                WHERE target_type = 'sponsor_ad'
                  AND at >= NOW() - INTERVAL %s DAY
                GROUP BY target_id, day
                ORDER BY day DESC, target_id""",
            (days,),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    out = []
    for r in rows:
        impressions = int(r["impressions"] or 0)
        clicks      = int(r["clicks"]      or 0)
        inquiries   = int(r["inquiries"]   or 0)
        ctr = (clicks / impressions) if impressions > 0 else 0.0
        out.append({
            "target_id":   r["target_id"],
            "day":         r["day"].isoformat() if r["day"] else None,
            "impressions": impressions,
            "clicks":      clicks,
            "inquiries":   inquiries,
            "ctr":         round(ctr, 4),
        })
    return out
