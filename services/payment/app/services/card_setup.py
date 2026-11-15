"""R37 4.1.1 and 4.1.6 · saving a card.

A card is typed on Cardcom's page, never on ours. What we keep is the
token Cardcom hands back (encrypted, payment_methods.provider_token)
and what a person needs to recognise the card: its last four digits,
brand, expiry and holder name. No card number and no CVV reach this
service.

  start()     the logged-in entity asks to add or replace its card. We
              write a pending row (payment_card_setups) that says whose
              setup this is, and hand back the address of Cardcom's page.
  complete()  asks Cardcom what happened on that page (GetLpResult) and,
              if a card was saved, stores its token for the entity named
              on OUR row.

complete() is reached two ways: the return page calls it for the
caller's own setup, and Cardcom's webhook calls it with the page id.
Neither is believed for anything but "go and ask Cardcom now". The
entity comes from our row and the outcome from GetLpResult. Whichever
arrives first does the work; the other finds the row finished and
changes nothing.

A new card replaces the old one: an entity has one card on file.
"""
import logging
import os
import uuid
from typing import Optional

from app.crypto import encrypt_token
from app.db import get_db
from app.services.cardcom import (
    PAYMENT_FAKE_MODE,
    CardcomApiError,
    CardcomNetworkError,
    CardcomPendingError,
    create_low_profile,
    get_low_profile_result,
)

logger = logging.getLogger(__name__)

ENTITY_TYPES = ("contractor", "corporation", "service_provider")

# Where the browser comes back to. Only the provider area has a card
# block (R37 Part 3.4); the others land on /billing.
RETURN_PATHS = {"service_provider": "/provider/billing"}
DEFAULT_RETURN_PATH = "/billing"


class CardSetupUnavailable(Exception):
    """This environment cannot open a Cardcom page: a setting is missing."""


def _return_path(entity_type: str, setup_id: str) -> str:
    return f"{RETURN_PATHS.get(entity_type, DEFAULT_RETURN_PATH)}?card_setup={setup_id}"


def _page_addresses(entity_type: str, setup_id: str) -> tuple[str, str, str]:
    """(success, failed, webhook) for the page about to be opened."""
    path = _return_path(entity_type, setup_id)
    if PAYMENT_FAKE_MODE:
        # No Cardcom page in fake mode: the browser goes straight to our
        # own return page, so a path on the same site is enough.
        return path, path, ""
    frontend = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
    api = os.getenv("PUBLIC_API_URL", "").strip().rstrip("/")
    if not frontend or not api:
        # Cardcom needs full addresses to send the browser and its
        # webhook to. Guessing them would send a card holder somewhere
        # we did not choose.
        raise CardSetupUnavailable(
            "FRONTEND_URL and PUBLIC_API_URL must be set on the payment service"
        )
    return (
        f"{frontend}{path}",
        f"{frontend}{path}&card_result=failed",
        f"{api}/webhooks/cardcom",
    )


async def start(entity_type: str, entity_id: str, user_id: Optional[str] = None) -> dict:
    """Open a card page for this entity. Returns {setup_id, url, mode}."""
    setup_id = str(uuid.uuid4())
    success_url, failed_url, webhook_url = _page_addresses(entity_type, setup_id)
    page = await create_low_profile(
        return_value=setup_id,
        success_url=success_url,
        failed_url=failed_url,
        webhook_url=webhook_url,
    )
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO payment_card_setups
                   (id, entity_type, entity_id, low_profile_id, status, is_fake, started_by_user_id)
               VALUES (%s, %s, %s, %s, 'pending', %s, %s)""",
            (setup_id, entity_type, entity_id, page["low_profile_id"], PAYMENT_FAKE_MODE, user_id),
        )
        conn.commit()
    finally:
        conn.close()
    logger.info("[card-setup] opened setup=%s for %s/%s", setup_id, entity_type, entity_id)
    return {
        "setup_id": setup_id,
        "url": page["url"],
        "mode": "fake" if PAYMENT_FAKE_MODE else "real",
    }


def load(setup_id: Optional[str] = None, low_profile_id: Optional[str] = None) -> Optional[dict]:
    """A setup row by its own id or by Cardcom's page id."""
    if not setup_id and not low_profile_id:
        return None
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        if setup_id:
            cur.execute("SELECT * FROM payment_card_setups WHERE id=%s", (setup_id,))
        else:
            cur.execute("SELECT * FROM payment_card_setups WHERE low_profile_id=%s", (low_profile_id,))
        return cur.fetchone()
    finally:
        conn.close()


def _answer(row: dict) -> dict:
    return {
        "status": row["status"],
        "payment_method_id": row.get("payment_method_id"),
        "reason": row.get("failure_reason"),
    }


async def complete(setup: dict) -> dict:
    """Finish `setup` if Cardcom has a result for it.

    Returns {status, payment_method_id, reason} with status one of
    completed, pending, failed. Safe to call any number of times.
    Raises CardcomNetworkError when Cardcom cannot be reached; the row
    stays pending and the next call asks again.
    """
    if setup["status"] != "pending":
        return _answer(setup)

    # A row opened in one mode is never finished in the other: a real
    # page must not be answered by the fake result, nor the reverse.
    if bool(setup["is_fake"]) != PAYMENT_FAKE_MODE:
        return _answer(_fail(setup["id"], "payment_mode_changed"))

    try:
        result = await get_low_profile_result(setup["low_profile_id"])
    except CardcomPendingError:
        return {"status": "pending", "payment_method_id": None, "reason": None}
    except CardcomNetworkError:
        # Cardcom was not reached, so there is no answer to record.
        raise
    except CardcomApiError as exc:
        # Cardcom answered, and the answer is no.
        reason = (getattr(exc, "description", None) or str(exc))[:255]
        return _answer(_fail(setup["id"], reason))

    if not PAYMENT_FAKE_MODE and result.get("return_value") != setup["id"]:
        logger.error("[card-setup] setup=%s: Cardcom's ReturnValue is not this setup", setup["id"])
        return _answer(_fail(setup["id"], "return_value_mismatch"))
    if not result.get("token"):
        return _answer(_fail(setup["id"], "no_token_in_result"))

    return _answer(_store(setup["id"], result))


def _fail(setup_id: str, reason: str) -> dict:
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE payment_card_setups
                  SET status='failed', failure_reason=%s, completed_at=NOW()
                WHERE id=%s AND status='pending'""",
            (reason, setup_id),
        )
        conn.commit()
        cur.execute("SELECT * FROM payment_card_setups WHERE id=%s", (setup_id,))
        return cur.fetchone()
    finally:
        conn.close()


def _store(setup_id: str, result: dict) -> dict:
    """One transaction: the new card in, the old one out, the setup
    marked done. The row lock is what makes a webhook and a return page
    arriving together store one card and not two. Nothing here waits on
    the network."""
    conn = get_db("payment_db")
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM payment_card_setups WHERE id=%s FOR UPDATE", (setup_id,))
        row = cur.fetchone()
        if row["status"] != "pending":
            conn.rollback()
            return row

        if not result.get("expiry_month") or not result.get("expiry_year"):
            logger.warning("[card-setup] setup=%s: no expiry in Cardcom's answer", setup_id)

        pm_id = str(uuid.uuid4())
        cur.execute(
            """UPDATE payment_methods
                  SET is_default=FALSE, status='removed', deleted_at=NOW()
                WHERE entity_type=%s AND entity_id=%s AND deleted_at IS NULL""",
            (row["entity_type"], row["entity_id"]),
        )
        cur.execute(
            """INSERT INTO payment_methods
                   (id, entity_type, entity_id, provider, provider_token,
                    last_4_digits, card_brand, card_holder_name,
                    expiry_month, expiry_year, is_default, status)
               VALUES (%s, %s, %s, 'cardcom', %s, %s, %s, %s, %s, %s, TRUE, 'active')""",
            (
                pm_id, row["entity_type"], row["entity_id"],
                encrypt_token(result["token"]),
                (result.get("last_4_digits") or "")[:4],
                result.get("card_brand") or None,
                (result.get("card_holder_name") or None),
                int(result.get("expiry_month") or 0),
                int(result.get("expiry_year") or 0),
            ),
        )
        cur.execute(
            """UPDATE payment_card_setups
                  SET status='completed', payment_method_id=%s, completed_at=NOW()
                WHERE id=%s""",
            (pm_id, setup_id),
        )
        conn.commit()
        logger.info("[card-setup] setup=%s stored card for %s/%s",
                    setup_id, row["entity_type"], row["entity_id"])
        cur.execute("SELECT * FROM payment_card_setups WHERE id=%s", (setup_id,))
        return cur.fetchone()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
