"""R37 4.1.4 · renewing a paid marketplace plan.

The mechanism is the one the contractor and corporation subscriptions
already have: the notification service fires the daily batch
(cron/subscriptionRenewal.js), the batch in routes/subscriptions.py
charges what is due, and it calls renew_due_plans() in the same pass.
The failure rule is that table's rule, with that file's own numbers
passed in, not copied:

  charged            the plan runs another period from now
  declined           past_due, and another attempt in `interval_days`
  `max_attempts`     failed attempts in a row: the plan ends (expired)
  Cardcom unreachable  nothing changes; the next pass tries again

Which plans: only a plan a charge paid for (payment_transaction_id is
set) whose owner left renewal on. A promo plan is never charged here:
it was promised that nothing is charged without notice, and what
happens to it when the promo ends is not decided.

Where a plan differs from a subscription, and what was done:

  * The price and the length of the new period are the tier row's, as
    it stands on the day, the way a subscription renews at its plan's
    current price. The plan keeps its size.
  * A subscription with no card on file is moved forward a period for
    free (R9 §3: it was never asked for a card). A paid plan was. With
    no card it cannot be charged, so the renewal has failed and the
    plan goes down the same chain as a declined card. It is not
    renewed for free: no plan runs without a successful charge.
  * A subscription that expires has its corporation's ads paused. A
    plan that ends has its published listings paused, the same thing
    cancelling the plan does (an advertiser publishes in a category
    only while it holds a running plan there). They are kept, and can
    be published again under a plan with room.
  * If the owner turned renewal off while the plan was past_due, or
    bought another plan in the category, the plan ends without another
    charge.
"""
import logging
import uuid
from datetime import datetime
from typing import Optional

from app.crypto import decrypt_token
from app.db import get_db
from app.services import cardcom, marketplace_charges as mc
from app.services.cardcom import (
    CardcomDeclinedError,
    CardcomNetworkError,
    charge_token,
    expiry_mmyy,
)
from app.services.payment_events import record_event

logger = logging.getLogger(__name__)


def _due(now: datetime, limit: int) -> list[dict]:
    conn = get_db(mc.PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT * FROM {mc.ORG_DB}.marketplace_subscriptions
                 WHERE payment_transaction_id IS NOT NULL
                   AND (
                         (status='active'   AND auto_renew=TRUE AND expires_at <= %s)
                      OR (status='past_due' AND next_attempt_at <= %s)
                       )
                   AND (last_renewal_attempt_at IS NULL
                        OR last_renewal_attempt_at < DATE_SUB(%s, INTERVAL 1 HOUR))
                 ORDER BY COALESCE(next_attempt_at, expires_at) ASC
                 LIMIT {int(limit)}""",
            (now, now, now),
        )
        return cur.fetchall()
    finally:
        conn.close()


def _run(sql: str, params: tuple) -> int:
    conn = get_db(mc.PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def _one(sql: str, params: tuple) -> Optional[dict]:
    conn = get_db(mc.PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        return cur.fetchone()
    finally:
        conn.close()


def _latch(plan_id: str, when: datetime) -> None:
    """Stamped before Cardcom is called, so a second pass in the same
    hour leaves the plan alone."""
    _run(f"UPDATE {mc.ORG_DB}.marketplace_subscriptions SET last_renewal_attempt_at=%s WHERE id=%s",
         (when, plan_id))


def _note(plan_id: str, error: Optional[str]) -> None:
    _run(f"UPDATE {mc.ORG_DB}.marketplace_subscriptions SET last_renewal_error=%s WHERE id=%s",
         ((error or None) and error[:500], plan_id))


def _other_running_plan(plan: dict) -> bool:
    row = _one(
        f"""SELECT id FROM {mc.ORG_DB}.marketplace_subscriptions
             WHERE advertiser_entity_type=%s AND advertiser_entity_id=%s AND category_code=%s
               AND id <> %s AND status='active' AND expires_at > NOW()
             LIMIT 1""",
        (plan["advertiser_entity_type"], plan["advertiser_entity_id"], plan["category_code"], plan["id"]),
    )
    return row is not None


def _live_tier(tier_id: str) -> Optional[dict]:
    """The tier as it is sold today, or None when it is not sold."""
    row = _one(
        f"""SELECT t.id, t.category_code, t.price_nis, t.duration_days,
                   t.is_active AS tier_active, c.is_active AS category_active
              FROM {mc.ORG_DB}.marketplace_subscription_tiers t
              JOIN {mc.ORG_DB}.marketplace_categories c ON c.code = t.category_code
             WHERE t.id=%s""",
        (tier_id,),
    )
    if not row or not row["tier_active"] or not row["category_active"]:
        return None
    if row["price_nis"] is None or float(row["price_nis"]) <= 0:
        return None
    return row


def _end(plan: dict, reason: str) -> int:
    """The plan is over: marked expired, and the listings published on
    it paused. One transaction. Returns how many listings were paused."""
    conn = get_db(mc.PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(
            f"""UPDATE {mc.ORG_DB}.marketplace_listings
                   SET status='paused'
                 WHERE subscription_id=%s AND deleted_at IS NULL AND status='active'""",
            (plan["id"],),
        )
        paused = cur.rowcount
        cur.execute(
            f"""UPDATE {mc.ORG_DB}.marketplace_subscriptions
                   SET status='expired', next_attempt_at=NULL, last_renewal_error=%s
                 WHERE id=%s""",
            (reason[:500], plan["id"]),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    logger.info("[plan-renewal] plan %s ended (%s), %s listings paused", plan["id"], reason, paused)
    return paused


def _fail(plan: dict, reason: str, interval_days: int, max_attempts: int) -> str:
    """One more failed attempt. Returns 'past_due' or 'expired'."""
    attempts = int(plan.get("rebill_attempts") or 0) + 1
    if attempts >= max_attempts:
        _end(plan, reason)
        return "expired"
    _run(
        f"""UPDATE {mc.ORG_DB}.marketplace_subscriptions
               SET status='past_due', rebill_attempts=%s,
                   next_attempt_at=DATE_ADD(NOW(), INTERVAL %s DAY),
                   last_renewal_error=%s
             WHERE id=%s""",
        (attempts, int(interval_days), reason[:500], plan["id"]),
    )
    return "past_due"


def _open_charge(plan: dict, tier: dict) -> dict:
    """The row for this renewal attempt, taken for charging as it is
    written: nobody else pays a renewal."""
    charge = {
        "id": str(uuid.uuid4()), "kind": "renewal",
        "entity_type": plan["advertiser_entity_type"], "entity_id": plan["advertiser_entity_id"],
        "subscription_id": plan["id"], "tier_id": plan["tier_id"], "category_code": plan["category_code"],
        "slot_count": plan["slot_count"], "duration_days": int(tier["duration_days"]),
        "amount_nis": tier["price_nis"], "auto_renew": 1,
    }
    _run(
        f"""INSERT INTO {mc.PAY_DB}.marketplace_charges
                (id, kind, entity_type, entity_id, subscription_id, tier_id, category_code,
                 slot_count, duration_days, amount_nis, auto_renew, status, is_fake)
            VALUES (%s, 'renewal', %s, %s, %s, %s, %s, %s, %s, %s, TRUE, 'charging', %s)""",
        (charge["id"], charge["entity_type"], charge["entity_id"], charge["subscription_id"],
         charge["tier_id"], charge["category_code"], charge["slot_count"], charge["duration_days"],
         charge["amount_nis"], cardcom.PAYMENT_FAKE_MODE),
    )
    return charge


def _renewed(plan: dict, charge: dict, card_id: str, event_id: str, result: dict) -> None:
    """One transaction: the plan runs another period from now at the
    price just charged, and the charge is marked charged."""
    conn = get_db(mc.PAY_DB)
    try:
        cur = conn.cursor()
        cur.execute(
            f"""UPDATE {mc.ORG_DB}.marketplace_subscriptions
                   SET status='active',
                       expires_at=DATE_ADD(NOW(), INTERVAL %s DAY),
                       duration_days=%s, price_nis=%s,
                       rebill_attempts=0, next_attempt_at=NULL, last_renewal_error=NULL,
                       cardcom_token_ref=%s, payment_transaction_id=%s
                 WHERE id=%s""",
            (charge["duration_days"], charge["duration_days"], charge["amount_nis"],
             card_id, event_id, plan["id"]),
        )
        cur.execute(
            f"""UPDATE {mc.PAY_DB}.marketplace_charges
                   SET status='charged', payment_method_id=%s, payment_event_id=%s,
                       provider_transaction_id=%s, invoice_number=%s, invoice_url=%s
                 WHERE id=%s AND status='charging'""",
            (card_id, event_id, result.get("provider_transaction_id") or None,
             result.get("invoice_number") or None, result.get("invoice_url"), charge["id"]),
        )
        cur.execute(f"UPDATE {mc.PAY_DB}.payment_methods SET last_used_at=NOW() WHERE id=%s", (card_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        logger.error("[plan-renewal] plan %s was CHARGED (charge %s, event %s) and NOT extended",
                     plan["id"], charge["id"], event_id)
        raise
    finally:
        conn.close()


async def renew_due_plans(now: datetime, *, interval_days: int, max_attempts: int, limit: int) -> dict:
    """One pass over the paid plans that are due. Safe to run twice."""
    counts = {"processed": 0, "charged": 0, "failed": 0, "ended": 0, "skipped": 0}
    for plan in _due(now, limit):
        _latch(plan["id"], now)
        counts["processed"] += 1
        entity_type, entity_id = plan["advertiser_entity_type"], plan["advertiser_entity_id"]

        # Nothing more to charge for: the owner turned renewal off
        # during the chain, or holds another plan in the category.
        if not plan["auto_renew"]:
            _end(plan, "renewal_turned_off")
            counts["ended"] += 1
            continue
        if _other_running_plan(plan):
            _end(plan, "replaced_by_another_plan")
            counts["ended"] += 1
            continue

        tier = _live_tier(plan["tier_id"])
        if tier is None:
            # Like a subscription whose tier has no price: logged and
            # left for a person, not guessed at.
            logger.error("[plan-renewal] plan %s: its tier is not on sale, cannot renew", plan["id"])
            _note(plan["id"], "tier_unavailable")
            counts["skipped"] += 1
            continue

        amount = float(tier["price_nis"])
        audit = dict(entity_id=entity_id, entity_type=entity_type,
                     kind="marketplace_renewal", amount_nis=int(round(amount)))

        if cardcom._free_launch_active():
            # The switch that makes charge_token answer "charged" with
            # nothing charged. A paid plan is not renewed on that.
            logger.error("[plan-renewal] FREE_LAUNCH_UNTIL is set on the payment service: plan %s not renewed", plan["id"])
            _note(plan["id"], "free_launch_env_active")
            counts["skipped"] += 1
            continue

        card = mc.default_card(entity_type, entity_id)
        if not card:
            record_event(**audit, outcome="no_payment_method", provider_transaction_id=None,
                         raw={"reason": "no_payment_method", "subscription_id": plan["id"]})
            outcome = _fail(plan, "no_payment_method", interval_days, max_attempts)
            counts["ended" if outcome == "expired" else "failed"] += 1
            continue

        charge = _open_charge(plan, tier)
        try:
            result = await charge_token(
                provider_token  = decrypt_token(card["provider_token"]),
                base_amount     = amount,
                vat_amount      = 0,
                deal_id         = f"mp:{charge['id']}",
                idempotency_key = charge["id"],
                invoice_data    = mc.invoice_data(charge),
                card_expiry     = expiry_mmyy(card),
            )
        except CardcomDeclinedError as exc:
            said = (exc.description or "").strip() or str(exc)
            _, event_id = record_event(**audit, outcome="declined", provider_transaction_id=None,
                                       response_code=exc.code,
                                       raw={"error": str(exc), "charge_id": charge["id"], "subscription_id": plan["id"]})
            mc._settle(charge["id"], "declined", said, event_id)
            outcome = _fail(plan, said, interval_days, max_attempts)
            counts["ended" if outcome == "expired" else "failed"] += 1
            continue
        except CardcomNetworkError as exc:
            # Not a failed charge: the chain does not move, and the
            # next pass tries again.
            _, event_id = record_event(**audit, outcome="error", provider_transaction_id=None,
                                       raw={"error": str(exc), "charge_id": charge["id"], "subscription_id": plan["id"]})
            mc._settle(charge["id"], "error", str(exc), event_id)
            counts["skipped"] += 1
            continue

        _, event_id = record_event(
            **audit, outcome="ok",
            provider_transaction_id=result.get("provider_transaction_id"),
            response_code=result.get("response_code"),
            invoice_number=result.get("invoice_number") or None,
            invoice_url=result.get("invoice_url"),
            raw={**(result.get("raw") or {}), "charge_id": charge["id"], "subscription_id": plan["id"]},
        )
        _renewed(plan, charge, card["id"], event_id, result)
        counts["charged"] += 1
    return counts
