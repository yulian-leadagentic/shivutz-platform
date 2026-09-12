"""Pivot/v2 Phase 1 — subscription endpoints.

State machine: trialing → active → past_due → expired/cancelled.
Lazy-init: the first time an entity calls /me, we insert a trialing row
expiring 14 days from now. Avoids coupling registration in user-org with
this service.

Fake mode is now the single PAYMENT_FAKE_MODE flag imported from
services/cardcom.py — the L5 §3 unification removed the old
subscription-scoped fake flag (which defaulted ON in production,
silently short-circuiting billing). With PAYMENT_FAKE_MODE=1 the
/start endpoint activates the subscription immediately with a
30-day current_period_end and never contacts Cardcom.
"""
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.db import get_db
# L5 §3 — one fake-mode flag across payment; imported from the same
# module that gates the Cardcom network calls so /start and
# charge_token can never disagree about mode.
from app.services.cardcom import (
    PAYMENT_FAKE_MODE,
    charge_token,
    CardcomDeclinedError,
    CardcomNetworkError,
)
from app.services.payment_events import record_event
from app.crypto import decrypt_token

logger = logging.getLogger(__name__)
router = APIRouter()

# L5 §7 — days between rebill retries. Aligned with the existing
# GRACE_DAYS=7 (§7: "אל תבנה שני מסלולי חסד" — reuse the same
# window shape). Three retries → expired = 4 x 3 = 12 days worst-case.
REBILL_INTERVAL_DAYS = 3
REBILL_MAX_ATTEMPTS  = 3
# Guardrail from §6 — an unbounded batch that stalls mid-run is an
# unknown state. 100 subs per pass is plenty for launch scale.
RENEWAL_BATCH_LIMIT  = 100

TRIAL_DAYS = 14
FAKE_PERIOD_DAYS = 30

VALID_TIERS  = {"basic", "advanced", "pro"}
VALID_TYPES  = {"contractor", "corporation"}


def _serialize(row: dict) -> dict:
    out = dict(row)
    for k, v in list(out.items()):
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


def _resolve_entity(x_entity_id: Optional[str], x_entity_type: Optional[str]) -> tuple[str, str]:
    if not x_entity_id or not x_entity_type:
        raise HTTPException(status_code=400, detail="entity_id_and_type_required")
    if x_entity_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="invalid_entity_type")
    return x_entity_id, x_entity_type


def _fetch(cur, entity_id: str, entity_type: str) -> Optional[dict]:
    cur.execute(
        "SELECT * FROM subscriptions WHERE entity_id=%s AND entity_type=%s LIMIT 1",
        (entity_id, entity_type),
    )
    return cur.fetchone()


GRACE_DAYS = 7  # spec B3 — corp trial-end grace before hard-cap


def _insert_trial(cur, entity_id: str, entity_type: str) -> dict:
    sub_id = str(uuid.uuid4())
    trial_ends = datetime.utcnow() + timedelta(days=TRIAL_DAYS)
    grace_ends = trial_ends + timedelta(days=GRACE_DAYS)
    cur.execute(
        """INSERT INTO subscriptions
             (id, entity_id, entity_type, tier, status, trial_ends_at, grace_ends_at)
           VALUES (%s, %s, %s, 'basic', 'trialing', %s, %s)""",
        (sub_id, entity_id, entity_type, trial_ends, grace_ends),
    )
    return _fetch(cur, entity_id, entity_type)


def _in_grace(row: dict, now: datetime) -> bool:
    """True when trial ended but grace window has not — publish/edit
    blocked, existing ads still live, contact reveals still permitted
    from the corp side (they're the ad owner, not a paywalled viewer)."""
    if row.get("status") != "trialing":
        return False
    if row.get("trial_ends_at") is None:
        return False
    if row["trial_ends_at"] > now:
        return False  # trial still active
    ge = row.get("grace_ends_at")
    return ge is None or ge > now


# ─── GET /payments/subscriptions/me ──────────────────────────────────────────
# Returns the calling entity's subscription, lazy-initialising a trial
# row if none exists. Gateway forwards x-entity-id / x-entity-type from
# the JWT.

@router.get("/me")
def get_my_subscription(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_id, entity_type = _resolve_entity(x_entity_id, x_entity_type)
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        row = _fetch(cur, entity_id, entity_type)
        if row is None:
            row = _insert_trial(cur, entity_id, entity_type)
            conn.commit()
        out = _serialize(row)
        # B4 — surface the payment-service mode so /billing can render
        # a 'מצב בדיקה' chip while Cardcom recurring is not yet live.
        # Booleans stay stable across a mode flip so the frontend just
        # needs to hide the chip when payment_mode='live'.
        out["payment_mode"] = "fake" if PAYMENT_FAKE_MODE else "live"
        return out
    finally:
        conn.close()


# ─── POST /payments/subscriptions/start ──────────────────────────────────────
# Begin a paid subscription for a tier. In fake mode we flip the row to
# 'active' immediately. In real mode we'd open a Cardcom recurring flow
# (TODO Phase 1.5 — needs Cardcom plan IDs).

class StartBody(BaseModel):
    tier: str  # 'basic' | 'advanced' | 'pro'


@router.post("/start")
async def start_subscription(
    body: StartBody,
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_id, entity_type = _resolve_entity(x_entity_id, x_entity_type)
    if body.tier not in VALID_TIERS:
        raise HTTPException(status_code=400, detail="invalid_tier")

    plan_code = f"{entity_type.upper()}_{body.tier.upper()}"

    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        row = _fetch(cur, entity_id, entity_type)
        if row is None:
            _insert_trial(cur, entity_id, entity_type)
            row = _fetch(cur, entity_id, entity_type)

        if PAYMENT_FAKE_MODE:
            period_end = datetime.utcnow() + timedelta(days=FAKE_PERIOD_DAYS)
            cur.execute(
                """UPDATE subscriptions
                     SET tier=%s, status='active', cardcom_plan_code=%s,
                         current_period_end=%s, cancelled_at=NULL,
                         grace_sms_step=0
                   WHERE entity_id=%s AND entity_type=%s""",
                (body.tier, plan_code, period_end, entity_id, entity_type),
            )
            conn.commit()

            # B3 — renewal restores paused ads for corps that were in
            # hard-cap. Runs cross-schema; missing table (dev) or empty
            # result set is a no-op. Only touches ads that were paused
            # BY the grace cron (paused_by='grace_hard_cap') to avoid
            # un-pausing ones the corp paused manually.
            if entity_type == "corporation":
                try:
                    org_conn = get_db("org_db")
                    try:
                        org_cur = org_conn.cursor()
                        org_cur.execute(
                            """UPDATE ads SET active=TRUE, paused_by=NULL
                                WHERE owner_entity_id=%s
                                  AND active=FALSE
                                  AND paused_by='grace_hard_cap'
                                  AND deleted_at IS NULL""",
                            (entity_id,),
                        )
                        org_conn.commit()
                    finally:
                        org_conn.close()
                except Exception as exc:  # noqa: BLE001 — restore is best-effort
                    print(f"[subscriptions] grace-restore skipped: {exc}")

            return {"mode": "fake", "tier": body.tier, "status": "active",
                    "current_period_end": period_end.isoformat()}

        # ── L5 §4 · real Cardcom path ──────────────────────────────
        # Precondition: the entity has already tokenised a card via the
        # existing /cardcom webhook (`webhooks.py`). If not, we
        # short-circuit with a 402 that tells the frontend to redirect
        # to the tokenisation flow first — deliberately NOT calling
        # create_low_profile here so /start has a single job (charge)
        # and the two-phase flow stays explicit.
        pm = _default_payment_method(cur, entity_id, entity_type)
        if not pm:
            raise HTTPException(status_code=402, detail={
                "code":    "no_payment_method",
                "message": "יש להזין כרטיס אשראי לפני פתיחת מנוי בתשלום.",
            })

        # Price ALWAYS from subscription_plans — never from the request
        # body. Body carries only the tier; a client passing an amount
        # would be a classic billing hole.
        price = _plan_price(cur, entity_type, body.tier)
        if price is None:
            # A tier that was seeded without a price is a configuration
            # bug, not a client error. 500 (with a specific code the
            # billing UI can map) is right — this must not be silent.
            raise HTTPException(status_code=500, detail={
                "code": "tier_price_missing",
                "tier": body.tier,
            })

        # charge_token is idempotency-keyed by our own uuid. Cardcom
        # replays would return the same UniqueID and be dedup'd on
        # their side too; our payment_events UNIQUE is the belt.
        idem = str(uuid.uuid4())
        invoice_data = _invoice_data_for(cur, entity_id, entity_type,
                                         plan_tier=body.tier, amount=price)

        try:
            charge = await charge_token(
                provider_token  = decrypt_token(pm["provider_token"]),
                base_amount     = price,
                vat_amount      = 0,  # subscription_plans prices are VAT-included per Yulian
                deal_id         = f"sub:{entity_type}:{entity_id}:start",
                idempotency_key = idem,
                invoice_data    = invoice_data,
            )
        except CardcomDeclinedError as exc:
            # Card was rejected — record it, don't change subscription
            # status, hand the reason to the UI.
            record_event(
                entity_id=entity_id, entity_type=entity_type,
                kind="subscription_start", outcome="declined",
                amount_nis=price,
                provider_transaction_id=None,
                response_code=getattr(exc, "code", None),
                raw={"error": str(exc)},
            )
            raise HTTPException(status_code=402, detail={
                "code": "card_declined", "reason": str(exc),
            })
        except CardcomNetworkError as exc:
            record_event(
                entity_id=entity_id, entity_type=entity_type,
                kind="subscription_start", outcome="error",
                amount_nis=price,
                provider_transaction_id=None,
                raw={"error": str(exc)},
            )
            raise HTTPException(status_code=502, detail={
                "code": "payment_provider_unreachable",
            })

        # Success. Record BEFORE flipping the subscription — if the
        # DB write fails, we want the row in payment_events so
        # reconciliation can see the charge landed.
        inserted, event_id = record_event(
            entity_id=entity_id, entity_type=entity_type,
            kind="subscription_start", outcome="ok",
            amount_nis=price,
            provider_transaction_id=charge.get("provider_transaction_id"),
            response_code=charge.get("response_code"),
            invoice_number=charge.get("invoice_number") or None,
            invoice_url=charge.get("invoice_url"),
            raw=charge.get("raw"),
        )
        if not inserted:
            # We saw this transaction id already — Cardcom or a client
            # retry replayed. Do NOT extend the period again.
            logger.warning(
                "[subscriptions] duplicate subscription_start charge for "
                "%s/%s (dedup event=%s) — not extending period.",
                entity_type, entity_id, event_id,
            )
        else:
            period_end = datetime.utcnow() + timedelta(days=FAKE_PERIOD_DAYS)
            cur.execute(
                """UPDATE subscriptions
                     SET tier=%s, status='active', cardcom_plan_code=%s,
                         current_period_end=%s, cancelled_at=NULL,
                         grace_sms_step=0, rebill_attempts=0,
                         next_attempt_at=NULL
                   WHERE entity_id=%s AND entity_type=%s""",
                (body.tier, plan_code, period_end, entity_id, entity_type),
            )
            conn.commit()

            # Restore ads paused by grace hard-cap (same rule as fake path).
            if entity_type == "corporation":
                _restore_grace_hard_capped_ads(entity_id)

        # Return the fresh state to the frontend.
        row = _fetch(cur, entity_id, entity_type)
        out = _serialize(row) if row else {}
        out["mode"]          = "real"
        out["invoice_url"]   = charge.get("invoice_url")
        out["invoice_number"] = charge.get("invoice_number") or None
        return out
    finally:
        conn.close()


# ── L5 helpers — shared between /start and the renewal batch ────────

def _default_payment_method(cur, entity_id: str, entity_type: str) -> Optional[dict]:
    cur.execute(
        """SELECT * FROM payment_methods
            WHERE entity_type=%s AND entity_id=%s
              AND deleted_at IS NULL AND status='active'
            ORDER BY is_default DESC, created_at DESC
            LIMIT 1""",
        (entity_type, entity_id),
    )
    return cur.fetchone()


def _plan_price(cur, entity_type: str, tier: str) -> Optional[int]:
    cur.execute(
        """SELECT monthly_price_nis FROM subscription_plans
            WHERE entity_type=%s AND tier=%s LIMIT 1""",
        (entity_type, tier),
    )
    row = cur.fetchone()
    if not row or row["monthly_price_nis"] is None:
        return None
    return int(row["monthly_price_nis"])


def _invoice_data_for(cur, entity_id: str, entity_type: str, *,
                      plan_tier: str, amount: int) -> dict:
    """PAY-4 · fill Cardcom's InvoiceHead/InvoiceLines so it issues a
    real Israeli invoice. Fields degrade to empty strings — Cardcom
    tolerates missing metadata on the invoice side, and we'd rather
    charge with a thin invoice than skip the charge."""
    name = ""
    email = ""
    try:
        org_conn = get_db("org_db")
        try:
            org_cur = org_conn.cursor()
            table = "corporations" if entity_type == "corporation" else "contractors"
            org_cur.execute(
                f"""SELECT company_name_he, company_name, contact_email
                     FROM {table} WHERE id=%s LIMIT 1""",
                (entity_id,),
            )
            r = org_cur.fetchone() or {}
            name  = r.get("company_name_he") or r.get("company_name") or ""
            email = r.get("contact_email") or ""
        finally:
            org_conn.close()
    except Exception as exc:  # noqa: BLE001 — invoice metadata is best-effort
        logger.warning("[subscriptions] invoice metadata lookup failed: %s", exc)
    return {
        "customer_name":  name,
        "customer_email": email,
        "description":    f"מנוי {plan_tier} — פלטפורמת שיבוץ",
    }


def _restore_grace_hard_capped_ads(corp_id: str) -> None:
    """Post-charge: re-enable ads that the grace hard-cap cron paused.
    Same rule the fake path used — pull it out so both branches share."""
    try:
        org_conn = get_db("org_db")
        try:
            org_cur = org_conn.cursor()
            org_cur.execute(
                """UPDATE ads SET active=TRUE, paused_by=NULL
                    WHERE owner_entity_id=%s
                      AND active=FALSE
                      AND paused_by='grace_hard_cap'
                      AND deleted_at IS NULL""",
                (corp_id,),
            )
            org_conn.commit()
        finally:
            org_conn.close()
    except Exception as exc:  # noqa: BLE001 — restore is best-effort
        logger.warning("[subscriptions] grace-restore skipped: %s", exc)


# ─── POST /payments/internal/renewal-batch ───────────────────────────────────
# L5 §6 · monthly renewal + §7 · failure chain.
#
# Sweep pattern mirrors services/notification/src/cron/*: no gateway
# exposure (the notification service posts to it internally on the
# daily cron), one pass per invocation, LIMIT-capped so a stall never
# hangs the batch.
#
# Two things are LATCH-protected against concurrent runs:
#   1. last_renewal_attempt_at is stamped BEFORE we call Cardcom, so
#      a second batch pass in the same second skips rows already
#      touched.
#   2. payment_events UNIQUE(provider_transaction_id) — if Cardcom
#      somehow returns the same txn id twice (or we call it twice
#      for the same subscription in the same day), the second
#      record_event returns inserted=False and we DO NOT extend
#      the period a second time.
#
# WHERE clause picks up:
#   * active subs with current_period_end due (first monthly renewal)
#   * past_due subs whose next_attempt_at is due (retry #2, #3)

@router.post("/internal/renewal-batch")
async def renewal_batch(x_internal_secret: Optional[str] = Header(default=None)):
    # A shared-secret gate is enough for an internal endpoint. The
    # gateway does NOT expose /payments/internal/*; only the
    # notification service (RENEWAL_BATCH_SECRET set in Railway) can
    # call this. Missing/mismatched secret = 401.
    import os
    expected = os.getenv("INTERNAL_BATCH_SECRET", "")
    if not expected or x_internal_secret != expected:
        raise HTTPException(status_code=401, detail="unauthorized")

    now = datetime.utcnow()
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT id, entity_id, entity_type, tier, status,
                       current_period_end, rebill_attempts, next_attempt_at
                  FROM subscriptions
                 WHERE (
                        (status='active'   AND current_period_end <= %s)
                     OR (status='past_due' AND next_attempt_at    <= %s)
                       )
                   AND (last_renewal_attempt_at IS NULL
                        OR last_renewal_attempt_at < DATE_SUB(%s, INTERVAL 1 HOUR))
                 ORDER BY COALESCE(next_attempt_at, current_period_end) ASC
                 LIMIT {RENEWAL_BATCH_LIMIT}""",
            (now, now, now),
        )
        due = cur.fetchall()
    finally:
        conn.close()

    processed  = 0
    charged    = 0
    failed     = 0
    dedup_skip = 0

    for sub in due:
        # LATCH — mark attempted BEFORE the network call so a parallel
        # batch pass sees this row as too-recent to retry.
        _latch_attempt(sub["id"], now)
        processed += 1

        pm = _default_payment_method_by_id(sub["entity_id"], sub["entity_type"])
        if not pm:
            # No card on file — mark past_due, but with a specific reason
            # so the UI can prompt the user to re-add a card.
            _apply_failure(sub, reason="no_payment_method")
            failed += 1
            continue

        price = _lookup_plan_price(sub["entity_type"], sub["tier"])
        if price is None:
            logger.error(
                "[renewal-batch] sub=%s has no seeded price for tier=%s — skipping",
                sub["id"], sub["tier"],
            )
            continue

        idem = str(uuid.uuid4())
        try:
            charge = await charge_token(
                provider_token  = decrypt_token(pm["provider_token"]),
                base_amount     = price,
                vat_amount      = 0,
                deal_id         = f"sub:{sub['entity_type']}:{sub['entity_id']}:renewal",
                idempotency_key = idem,
                invoice_data    = _invoice_data_for_id(
                    sub["entity_id"], sub["entity_type"],
                    plan_tier=sub["tier"], amount=price,
                ),
            )
        except CardcomDeclinedError as exc:
            record_event(
                entity_id=sub["entity_id"], entity_type=sub["entity_type"],
                kind="renewal", outcome="declined", amount_nis=price,
                provider_transaction_id=None,
                response_code=getattr(exc, "code", None),
                raw={"error": str(exc)},
            )
            _apply_failure(sub, reason="declined")
            failed += 1
            continue
        except CardcomNetworkError as exc:
            record_event(
                entity_id=sub["entity_id"], entity_type=sub["entity_type"],
                kind="renewal", outcome="error", amount_nis=price,
                provider_transaction_id=None,
                raw={"error": str(exc)},
            )
            # Network errors don't advance the failure chain — they
            # just leave the row with an updated last_renewal_attempt_at
            # so the next pass tries again. Otherwise a Cardcom
            # blip pushes healthy subs into past_due.
            continue

        inserted, event_id = record_event(
            entity_id=sub["entity_id"], entity_type=sub["entity_type"],
            kind="renewal", outcome="ok", amount_nis=price,
            provider_transaction_id=charge.get("provider_transaction_id"),
            response_code=charge.get("response_code"),
            invoice_number=charge.get("invoice_number") or None,
            invoice_url=charge.get("invoice_url"),
            raw=charge.get("raw"),
        )
        if not inserted:
            # We already recorded a charge with this txn id — don't
            # extend the period a second time. This is the idempotency
            # guard §5 promises.
            dedup_skip += 1
            logger.warning(
                "[renewal-batch] dedup on sub=%s (existing event=%s) — "
                "period NOT extended.",
                sub["id"], event_id,
            )
            continue

        _apply_success(sub)
        charged += 1

    return {
        "processed":  processed,
        "charged":    charged,
        "failed":     failed,
        "dedup_skip": dedup_skip,
    }


def _latch_attempt(sub_id: str, when: datetime) -> None:
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE subscriptions SET last_renewal_attempt_at=%s WHERE id=%s",
            (when, sub_id),
        )
        conn.commit()
    finally:
        conn.close()


def _apply_success(sub: dict) -> None:
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE subscriptions
                 SET status='active',
                     current_period_end=DATE_ADD(NOW(), INTERVAL %s DAY),
                     rebill_attempts=0,
                     next_attempt_at=NULL,
                     grace_sms_step=0
               WHERE id=%s""",
            (FAKE_PERIOD_DAYS, sub["id"]),
        )
        conn.commit()
    finally:
        conn.close()
    # Re-enable grace-hard-capped ads for corps whose payment
    # just went through.
    if sub["entity_type"] == "corporation":
        _restore_grace_hard_capped_ads(sub["entity_id"])


def _apply_failure(sub: dict, *, reason: str) -> None:
    """§7 failure chain: past_due + retry in 3 days, until
    REBILL_MAX_ATTEMPTS. After exhaustion → expired."""
    attempts = int(sub.get("rebill_attempts") or 0) + 1
    if attempts >= REBILL_MAX_ATTEMPTS:
        _mark_expired(sub, reason=reason)
        return
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE subscriptions
                 SET status='past_due',
                     rebill_attempts=%s,
                     next_attempt_at=DATE_ADD(NOW(), INTERVAL %s DAY)
               WHERE id=%s""",
            (attempts, REBILL_INTERVAL_DAYS, sub["id"]),
        )
        conn.commit()
    finally:
        conn.close()


def _mark_expired(sub: dict, *, reason: str) -> None:
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE subscriptions
                 SET status='expired',
                     next_attempt_at=NULL
               WHERE id=%s""",
            (sub["id"],),
        )
        conn.commit()
    finally:
        conn.close()
    # Pause corp ads on expiry — same paused_by tag the grace-hard-cap
    # cron uses, so renewal restores them once the corp pays.
    if sub["entity_type"] == "corporation":
        try:
            org_conn = get_db("org_db")
            try:
                org_cur = org_conn.cursor()
                org_cur.execute(
                    """UPDATE ads SET active=FALSE, paused_by='grace_hard_cap'
                        WHERE owner_entity_id=%s
                          AND active=TRUE
                          AND deleted_at IS NULL""",
                    (sub["entity_id"],),
                )
                org_conn.commit()
            finally:
                org_conn.close()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[subscriptions] expiry ads-pause skipped: %s", exc)


def _default_payment_method_by_id(entity_id: str, entity_type: str) -> Optional[dict]:
    """Same as _default_payment_method but opens its own connection —
    used by the renewal batch loop which processes one sub at a time
    and doesn't share a cursor with the batch query."""
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        return _default_payment_method(cur, entity_id, entity_type)
    finally:
        conn.close()


def _lookup_plan_price(entity_type: str, tier: str) -> Optional[int]:
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        return _plan_price(cur, entity_type, tier)
    finally:
        conn.close()


def _invoice_data_for_id(entity_id: str, entity_type: str, *,
                         plan_tier: str, amount: int) -> dict:
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        return _invoice_data_for(cur, entity_id, entity_type,
                                 plan_tier=plan_tier, amount=amount)
    finally:
        conn.close()


# ─── POST /payments/subscriptions/cancel ─────────────────────────────────────
# Mark the subscription as cancelled. Access continues until current_period_end.

@router.post("/cancel")
def cancel_subscription(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_id, entity_type = _resolve_entity(x_entity_id, x_entity_type)
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        row = _fetch(cur, entity_id, entity_type)
        if row is None:
            raise HTTPException(status_code=404, detail="no_subscription")
        cur.execute(
            """UPDATE subscriptions
                 SET status='cancelled', cancelled_at=NOW()
               WHERE entity_id=%s AND entity_type=%s""",
            (entity_id, entity_type),
        )
        conn.commit()
        return {"status": "cancelled"}
    finally:
        conn.close()


# ─── GET /payments/subscriptions/check ───────────────────────────────────────
# Internal endpoint the gateway hits to decide whether to allow a
# paywalled request. Returns 200 + status if entitled, 402 otherwise.
# Trial expiry is computed on read so we don't need a cron flipping
# expired trials to 'expired' before the gate works.

@router.get("/check")
def check_entitlement(
    x_entity_id:   Optional[str] = Header(default=None),
    x_entity_type: Optional[str] = Header(default=None),
):
    entity_id, entity_type = _resolve_entity(x_entity_id, x_entity_type)
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        row = _fetch(cur, entity_id, entity_type)
        if row is None:
            row = _insert_trial(cur, entity_id, entity_type)
            conn.commit()

        now      = datetime.utcnow()
        status   = row["status"]
        entitled = False
        in_grace = False

        if status == "trialing":
            trial_live = row["trial_ends_at"] is None or row["trial_ends_at"] > now
            if trial_live:
                entitled = True
            else:
                # B3 grace — trial ended but hard-cap hasn't fired yet.
                # NOT entitled for paywalled actions (publish/edit),
                # but the frontend uses the code to render the grace
                # banner instead of a plain "subscription required"
                # wall.
                in_grace = _in_grace(row, now)
        elif status in ("active", "cancelled"):
            entitled = row["current_period_end"] is None or row["current_period_end"] > now
        elif status == "past_due":
            entitled = True  # short grace, payment service flips to expired on retry exhaustion

        if not entitled:
            raise HTTPException(
                status_code=402,
                detail={"code": "grace_period" if in_grace else "subscription_required",
                        "status": status,
                        "tier": row["tier"],
                        "grace_ends_at": row["grace_ends_at"].isoformat() if in_grace and row.get("grace_ends_at") else None},
            )
        return {"entitled": True, "status": status, "tier": row["tier"]}
    finally:
        conn.close()
