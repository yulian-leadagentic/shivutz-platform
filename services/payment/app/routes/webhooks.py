"""Cardcom webhook receiver.
Cardcom sends application/x-www-form-urlencoded.
Always return 200 OK — never fail silently without returning 200.
MUST verify via GetLpResult — never trust webhook body alone.
"""
from fastapi import APIRouter, Request
from app.services.cardcom import get_low_profile_result, CardcomApiError, CardcomNetworkError
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/cardcom")
async def cardcom_webhook(request: Request):
    try:
        form = await request.form()
        low_profile_id = (
            form.get("lowprofilecode")
            or form.get("LowProfileId")
            or form.get("LowProfileCode")
        )
        response_code = form.get("ResponseCode") or form.get("responsecode")

        logger.info(
            "[webhook/cardcom] received LowProfileId=%s ResponseCode=%s",
            low_profile_id, response_code
        )

        if not low_profile_id:
            return {"received": True}  # test ping or empty call

        # Verify with Cardcom — REQUIRED, never skip
        try:
            result = await get_low_profile_result(low_profile_id)
        except (CardcomApiError, CardcomNetworkError) as e:
            logger.error("[webhook/cardcom] GetLpResult failed: %s", e)
            return {"received": True, "verified": False}

        if not result.get("token"):
            logger.warning("[webhook/cardcom] no token in result for id=%s", low_profile_id)
            return {"received": True, "token_saved": False}

        entity_id = result.get("entity_id")
        if not entity_id:
            logger.error("[webhook/cardcom] no entity_id (ReturnValue) in result")
            return {"received": True, "token_saved": False}

        # Convention: entity_id passed as "corporation:{uuid}" or "contractor:{uuid}"
        entity_type      = "corporation"
        actual_entity_id = entity_id
        if ":" in entity_id:
            parts = entity_id.split(":", 1)
            entity_type      = parts[0]
            actual_entity_id = parts[1]

        # Import here to avoid circular imports
        from app.routes.payment_methods import SaveTokenInput, save_payment_method

        body = SaveTokenInput(
            entity_type      = entity_type,
            entity_id        = actual_entity_id,
            provider_token   = result["token"],
            last_4_digits    = result.get("last_4_digits") or "0000",
            card_brand       = result.get("card_brand"),
            card_holder_name = result.get("card_holder_name"),
            expiry_month     = int(result.get("expiry_month") or 12),
            expiry_year      = int(result.get("expiry_year") or 2030),
        )

        try:
            save_payment_method(body)
            logger.info("[webhook/cardcom] token saved for %s/%s", entity_type, actual_entity_id)
        except Exception as e:
            logger.error("[webhook/cardcom] failed to save token: %s", e)

    except Exception as e:
        logger.error("[webhook/cardcom] unhandled error: %s", e)

    # ALWAYS return 200 to Cardcom
    return {"received": True}
