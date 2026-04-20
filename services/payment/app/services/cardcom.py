"""Cardcom API Service — ALL external Cardcom calls go through here only."""
import os
import httpx
import logging

logger = logging.getLogger(__name__)

CARDCOM_BASE_URL = os.getenv("CARDCOM_BASE_URL",       "https://secure.cardcom.solutions")
CARDCOM_TERMINAL = os.getenv("CARDCOM_TERMINAL_NUMBER", "1000")
CARDCOM_API_NAME = os.getenv("CARDCOM_API_NAME",        "test2025")
CARDCOM_API_PASS = os.getenv("CARDCOM_API_PASSWORD",    "test5000$")


class CardcomApiError(Exception):
    """General Cardcom API error."""
    def __init__(self, message: str, code: str = None):
        super().__init__(message)
        self.code = code


class CardcomDeclinedError(CardcomApiError):
    """Card declined by Cardcom."""
    pass


class CardcomNetworkError(CardcomApiError):
    """Network/timeout error reaching Cardcom."""
    pass


async def create_low_profile(
    entity_id: str,
    return_url: str,
    webhook_url: str,
    amount: float = 1.0,
) -> dict:
    """
    Create a LowProfile page for card tokenization.
    entity_id should be formatted as "corporation:{uuid}" or "contractor:{uuid}"
    so the webhook handler can parse the entity type.
    Returns: { "low_profile_id": str, "url": str }
    """
    payload = {
        "TerminalNumber": int(CARDCOM_TERMINAL),
        "ApiName":        CARDCOM_API_NAME,
        "ApiPassword":    CARDCOM_API_PASS,
        "ReturnValue":    entity_id,
        "Amount":         amount,
        "CoinID":         1,       # 1 = ILS
        "Language":       "he",
        "SuccessRedirectUrl": return_url,
        "ErrorRedirectUrl":   return_url + "?error=1",
        "WebHookUrl":         webhook_url,
        "CreateToken":        True,
        "TokenToCharge": {
            "TerminalNumber": int(CARDCOM_TERMINAL),
            "ApiName":        CARDCOM_API_NAME,
            "ApiPassword":    CARDCOM_API_PASS,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CARDCOM_BASE_URL}/api/v11/LowProfile/Create",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("[cardcom] LowProfile created entity=%s code=%s", entity_id, data.get("ResponseCode"))
            if data.get("ResponseCode") != 0:
                raise CardcomApiError(
                    f"Cardcom error: {data.get('Description', 'Unknown')}",
                    code=str(data.get("ResponseCode"))
                )
            return {
                "low_profile_id": data["LowProfileId"],
                "url":            data["Url"],
            }
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout creating LowProfile: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error: {e}")


async def get_low_profile_result(low_profile_id: str) -> dict:
    """
    Verify LowProfile result after webhook.
    MUST call this — never trust webhook body alone.
    Returns token + card details.
    """
    payload = {
        "TerminalNumber": int(CARDCOM_TERMINAL),
        "ApiName":        CARDCOM_API_NAME,
        "ApiPassword":    CARDCOM_API_PASS,
        "LowProfileId":   low_profile_id,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CARDCOM_BASE_URL}/api/v11/LowProfile/GetLpResult",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("[cardcom] LpResult id=%s code=%s", low_profile_id, data.get("ResponseCode"))
            if data.get("ResponseCode") != 0:
                raise CardcomApiError(
                    f"GetLpResult error: {data.get('Description', 'Unknown')}",
                    code=str(data.get("ResponseCode"))
                )
            token_info = data.get("TokenInfo", {})
            return {
                "token":            token_info.get("Token"),
                "last_4_digits":    token_info.get("Last4Digits") or data.get("Last4Digits"),
                "card_brand":       _map_brand(token_info.get("CardBrand")),
                "expiry_month":     token_info.get("ExpMonth"),
                "expiry_year":      token_info.get("ExpYear"),
                "card_holder_name": token_info.get("CardHolderName"),
                "entity_id":        data.get("ReturnValue"),
                "raw":              data,
            }
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout in GetLpResult: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error: {e}")


async def charge_token(
    provider_token: str,
    base_amount: float,
    vat_amount: float,
    deal_id: str,
    idempotency_key: str,
    invoice_data: dict = None,
) -> dict:
    """
    Charge a stored token via Cardcom.
    Never logs provider_token.
    Returns: provider_transaction_id, response_code, invoice_number, invoice_url, raw
    """
    total = round(base_amount + vat_amount, 2)
    payload = {
        "TerminalNumber": int(CARDCOM_TERMINAL),
        "ApiName":        CARDCOM_API_NAME,
        "ApiPassword":    CARDCOM_API_PASS,
        "Amount":         total,
        "CoinID":         1,
        "Token":          provider_token,
        "UniqueID":       idempotency_key,
        "Installments":   {"NumberOfPayments": 1, "FirstPayment": total},
    }
    if invoice_data:
        payload["InvoiceHead"] = {
            "CustName":     invoice_data.get("customer_name", ""),
            "SendByEmail":  True,
            "EmailAddress": invoice_data.get("customer_email", ""),
            "Language":     "he",
            "CoinID":       1,
            "VATIncluded":  True,
        }
        payload["InvoiceLines"] = [{
            "Description": invoice_data.get("description", "עמלת שיבוץ עובדים זרים"),
            "Price":       base_amount,
            "Quantity":    1,
            "IsTaxFree":   False,
        }]

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{CARDCOM_BASE_URL}/api/v11/Transactions/Transaction",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            # Never log the token
            logger.info("[cardcom] charge deal=%s total=%.2f code=%s", deal_id, total, data.get("ResponseCode"))
            if str(data.get("ResponseCode")) not in ("0", "000"):
                desc = data.get("Description") or data.get("ReturnMessage", "Declined")
                raise CardcomDeclinedError(
                    f"Charge declined: {desc}",
                    code=str(data.get("ResponseCode"))
                )
            inv = data.get("InvoiceResponse", {}) or {}
            return {
                "provider_transaction_id": str(
                    data.get("InternalDealNumber") or data.get("TranzactionId", "")
                ),
                "response_code":  str(data.get("ResponseCode")),
                "invoice_number": str(inv.get("InvoiceNumber", "") or ""),
                "invoice_url":    inv.get("InvoiceUrl"),
                "raw":            data,
            }
    except CardcomDeclinedError:
        raise
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout charging: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error charging: {e}")


async def refund_transaction(provider_transaction_id: str, amount: float = None) -> dict:
    """Refund a previously charged transaction."""
    payload = {
        "TerminalNumber":    int(CARDCOM_TERMINAL),
        "ApiName":           CARDCOM_API_NAME,
        "ApiPassword":       CARDCOM_API_PASS,
        "InternalDealNumber": provider_transaction_id,
    }
    if amount is not None:
        payload["Amount"] = amount

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CARDCOM_BASE_URL}/api/v11/Transactions/RefundByTransactionId",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("[cardcom] refund tx=%s code=%s", provider_transaction_id, data.get("ResponseCode"))
            if data.get("ResponseCode") != 0:
                raise CardcomApiError(
                    f"Refund error: {data.get('Description')}",
                    code=str(data.get("ResponseCode"))
                )
            return {"refunded": True, "raw": data}
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout on refund: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error on refund: {e}")


def _map_brand(brand_code) -> str:
    mapping = {"1": "visa", "2": "mastercard", "3": "amex", "6": "isracard"}
    return mapping.get(str(brand_code or ""), str(brand_code or ""))
