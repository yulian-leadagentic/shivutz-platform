"""Cardcom API Service — ALL external Cardcom calls go through here only."""
import os
import uuid
import httpx
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

CARDCOM_BASE_URL = os.getenv("CARDCOM_BASE_URL",       "https://secure.cardcom.solutions")
CARDCOM_TERMINAL = os.getenv("CARDCOM_TERMINAL_NUMBER", "1000")
CARDCOM_API_NAME = os.getenv("CARDCOM_API_NAME",        "test2025")
CARDCOM_API_PASS = os.getenv("CARDCOM_API_PASSWORD",    "test5000$")

# PAYMENT_FAKE_MODE=1  — short-circuit all Cardcom calls with synthetic
# responses. Enables local dev and UX simulation without touching Cardcom.
# NEVER enable in production.
PAYMENT_FAKE_MODE = os.getenv("PAYMENT_FAKE_MODE", "0") == "1"
FAKE_AUTH_HOLD_DAYS = 30  # fake hold length — mirrors real-world J5 ceiling

# FREE_LAUNCH_UNTIL=YYYY-MM-DD (or full ISO) — skip the *capture/charge* leg
# without touching the J5 authorization leg. While the date is in the future,
# capture_transaction + charge_token return a synthetic captured result tagged
# `FREE-` so downstream deal state still advances. Authorization still hits
# Cardcom (we want a real card on file so the cut-over to paid mode requires
# zero user re-onboarding). Safe to leave set in production; unset / past date
# = normal billing.
FREE_LAUNCH_UNTIL = os.getenv("FREE_LAUNCH_UNTIL", "").strip() or None


def _free_launch_active() -> bool:
    if not FREE_LAUNCH_UNTIL:
        return False
    try:
        cutoff = datetime.fromisoformat(FREE_LAUNCH_UNTIL)
    except ValueError:
        logger.error("[cardcom] FREE_LAUNCH_UNTIL=%r is not ISO format — ignoring", FREE_LAUNCH_UNTIL)
        return False
    return datetime.utcnow() < cutoff


if PAYMENT_FAKE_MODE:
    logger.warning("=" * 60)
    logger.warning("PAYMENT_FAKE_MODE=1  —  Cardcom calls are SIMULATED.")
    logger.warning("                       DO NOT USE THIS FLAG IN PRODUCTION.")
    logger.warning("=" * 60)

if FREE_LAUNCH_UNTIL:
    logger.warning("=" * 60)
    logger.warning("FREE_LAUNCH_UNTIL=%s — captures/charges short-circuit until that date.", FREE_LAUNCH_UNTIL)
    logger.warning("                       Authorizations still hit Cardcom for real.")
    logger.warning("=" * 60)


def _free_launch_result(deal_id: str, amount: float, kind: str) -> dict:
    """Synthetic captured response used during the free-launch window."""
    tx_id = "FREE-" + uuid.uuid4().hex[:12].upper()
    logger.info("[cardcom FREE] %s deal=%s amount=%.2f tx=%s (until %s)",
                kind, deal_id, amount, tx_id, FREE_LAUNCH_UNTIL)
    return {
        "provider_transaction_id": tx_id,
        "response_code":  "FREE_LAUNCH",
        "invoice_number": "",
        "invoice_url":    None,
        "raw":            {"free_launch": True, "until": FREE_LAUNCH_UNTIL, "amount": amount},
    }


class CardcomApiError(Exception):
    """General Cardcom API error. `description` is Cardcom's own text
    for the refusal, when it gave one."""
    def __init__(self, message: str, code: str = None, description: str = None):
        super().__init__(message)
        self.code = code
        self.description = description


class CardcomDeclinedError(CardcomApiError):
    """Card declined by Cardcom."""
    pass


class CardcomNetworkError(CardcomApiError):
    """Network/timeout error reaching Cardcom."""
    pass


class CardcomPendingError(CardcomApiError):
    """A card page has no final result yet."""
    pass


# GetLpResult answers with one of these while the card holder has not
# finished on the page: still typing, or the last attempt failed and
# the page is still open.
LP_PENDING_CODES = {5117, 5118, 5119}

# CreateTokenOnly still needs an Amount. With a J2 check Cardcom
# validates the card for it and moves no money.
CARD_CHECK_AMOUNT = 1

# What of a Cardcom answer is kept in payment_events.raw. A list of what
# may stay, not of what must go: the answers also carry the token, the
# first digits of the card and the holder's id number and phone, and
# none of that belongs in our database.
_RAW_KEEP = (
    "ResponseCode", "Description", "TranzactionId", "NewTranzactionId",
    "LowProfileId", "ReturnValue", "Operation", "Amount",
    "DocumentNumber", "DocumentType", "DocumentUrl",
    "ApprovalNumber", "Brand", "Last4CardDigitsString", "IsRefund",
)


def _safe_raw(data: dict) -> dict:
    out = {k: data[k] for k in _RAW_KEEP if data.get(k) is not None}
    for nested in ("TranzactionInfo", "DocumentInfo"):
        if isinstance(data.get(nested), dict):
            out[nested] = {k: data[nested][k] for k in _RAW_KEEP if data[nested].get(k) is not None}
    return out


def _fake_deal_id() -> str:
    """Obviously-fake identifier so a leaked FAKE_ id is never mistaken for real."""
    return "FAKE-" + uuid.uuid4().hex[:12].upper()


async def create_low_profile(
    return_value: str,
    success_url: str,
    failed_url: str,
    webhook_url: str,
) -> dict:
    """Open a Cardcom page that saves a card and charges nothing.

    R37 4.1.1. Operation CreateTokenOnly with a J2 check: Cardcom
    validates the card and hands back a token, and no money moves. The
    card number is typed on Cardcom's page and never reaches us.

    `return_value` comes back from GetLpResult as ReturnValue. Pass the
    id of our own pending row, so the result can be matched to it.

    Returns {"low_profile_id", "url"}. In PAYMENT_FAKE_MODE there is no
    Cardcom page: `url` is `success_url` itself and the browser lands
    straight on our return page.
    """
    if PAYMENT_FAKE_MODE:
        fake_id = _fake_deal_id()
        logger.warning("[cardcom] FAKE card page %s (PAYMENT_FAKE_MODE=1, no network call)", fake_id)
        return {"low_profile_id": fake_id, "url": success_url}

    payload = {
        "TerminalNumber":     int(CARDCOM_TERMINAL),
        "ApiName":            CARDCOM_API_NAME,
        "Operation":          "CreateTokenOnly",
        "ReturnValue":        return_value,
        "Amount":             CARD_CHECK_AMOUNT,
        "ISOCoinId":          1,       # 1 = ILS
        "Language":           "he",
        "SuccessRedirectUrl": success_url,
        "FailedRedirectUrl":  failed_url,
        "WebHookUrl":         webhook_url,
        "AdvancedDefinition": {"JValidateType": 2},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CARDCOM_BASE_URL}/api/v11/LowProfile/Create",
                json=payload,
            )
            # When Cardcom rejects the terminal or the API name it
            # answers a flat 401 with an HTML page, not a JSON body.
            # Named here so a wrong credential does not read as a
            # network fault (QA-R4 #D5).
            if resp.status_code == 401:
                logger.error(
                    "[cardcom] AUTH FAILED: check CARDCOM_TERMINAL_NUMBER / "
                    "CARDCOM_API_NAME / CARDCOM_API_PASSWORD"
                )
                raise CardcomApiError(
                    "Cardcom rejected our terminal credentials (HTTP 401). "
                    "Verify CARDCOM_TERMINAL_NUMBER, CARDCOM_API_NAME and "
                    "CARDCOM_API_PASSWORD in the payment service environment.",
                    code="401",
                )
            resp.raise_for_status()
            data = resp.json()
            logger.info("[cardcom] card page created ref=%s code=%s", return_value, data.get("ResponseCode"))
            if data.get("ResponseCode") != 0:
                raise CardcomApiError(
                    f"Cardcom error: {data.get('Description', 'Unknown')}",
                    code=str(data.get("ResponseCode")),
                    description=data.get("Description"),
                )
            return {
                "low_profile_id": data["LowProfileId"],
                "url":            data["Url"],
            }
    except CardcomApiError:
        raise
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout creating LowProfile: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error: {e}")


def _full_year(year) -> int:
    """Cardcom gives the expiry year as 27 in one place and 2027 in another."""
    year = int(year or 0)
    return year + 2000 if 0 < year < 100 else year


async def get_low_profile_result(low_profile_id: str) -> dict:
    """What happened on a card page, asked of Cardcom directly.

    This is the only source for a card page's outcome (R37 4.1.6):
    nothing a callback or a redirect says is believed.

    Returns token, last_4_digits, card_brand, expiry_month, expiry_year,
    card_holder_name, return_value, raw. `raw` is safe to store, the
    token is not in it. Raises CardcomPendingError while the page has no
    final result, CardcomApiError on any other refusal.
    """
    if PAYMENT_FAKE_MODE:
        # A card that cannot be mistaken for a real one.
        logger.warning("[cardcom] FAKE card page result %s (PAYMENT_FAKE_MODE=1, no network call)", low_profile_id)
        return {
            "token":            "FAKE_TOKEN_" + uuid.uuid4().hex,
            "last_4_digits":    "0000",
            "card_brand":       "fake",
            "expiry_month":     12,
            "expiry_year":      2099,
            "card_holder_name": None,
            "return_value":     None,
            "raw":              {"fake": True, "reason": "PAYMENT_FAKE_MODE=1"},
        }

    payload = {
        "TerminalNumber": int(CARDCOM_TERMINAL),
        "ApiName":        CARDCOM_API_NAME,
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
            code = data.get("ResponseCode")
            logger.info("[cardcom] LpResult id=%s code=%s", low_profile_id, code)
            if code in LP_PENDING_CODES:
                raise CardcomPendingError("Card page not finished", code=str(code))
            if code != 0:
                raise CardcomApiError(
                    f"GetLpResult error: {data.get('Description', 'Unknown')}",
                    code=str(code),
                    description=data.get("Description"),
                )
            token_info = data.get("TokenInfo") or {}
            tran       = data.get("TranzactionInfo") or {}
            ui         = data.get("UIValues") or {}
            last4 = tran.get("Last4CardDigitsString")
            if not last4 and tran.get("Last4CardDigits"):
                last4 = f"{int(tran['Last4CardDigits']):04d}"
            return {
                # Never logged, and not part of `raw`.
                "token":            token_info.get("Token"),
                "last_4_digits":    last4 or "",
                "card_brand":       _map_brand(tran.get("Brand")),
                "expiry_month":     int(token_info.get("CardMonth") or ui.get("CardMonth") or tran.get("CardMonth") or 0),
                "expiry_year":      _full_year(token_info.get("CardYear") or ui.get("CardYear") or tran.get("CardYear")),
                "card_holder_name": ui.get("CardOwnerName") or tran.get("CardOwnerName"),
                "return_value":     data.get("ReturnValue"),
                "raw":              _safe_raw(data),
            }
    except CardcomApiError:
        raise
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout in GetLpResult: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error: {e}")


def expiry_mmyy(pm: dict) -> str | None:
    """A stored card's expiry as MMYY, the way Cardcom's token charge
    takes it. None when the row has no usable expiry."""
    month, year = int(pm.get("expiry_month") or 0), int(pm.get("expiry_year") or 0)
    if not 1 <= month <= 12 or year <= 0:
        return None
    return f"{month:02d}{year % 100:02d}"


async def charge_token(
    provider_token: str,
    base_amount: float,
    vat_amount: float,
    deal_id: str,
    idempotency_key: str,
    invoice_data: dict = None,
    card_expiry: str = None,
) -> dict:
    """
    Charge a stored token via Cardcom.
    Never logs provider_token.
    `card_expiry` is the card's expiry as MMYY; Cardcom's token charge
    takes it alongside the token.
    `invoice_data` (customer_name, customer_email, description, tax_id)
    makes Cardcom issue the document for the charge.
    Returns: provider_transaction_id, response_code, invoice_number, invoice_url, raw
    """
    total = round(base_amount + vat_amount, 2)

    # L5 §3 — the critical fix. charge_token was the ONE Cardcom
    # entry point that ignored PAYMENT_FAKE_MODE (authorize / capture /
    # void all honoured it — check them again below). That meant even
    # with all fake flags on, a subscription/reveal charge would hit
    # Cardcom for real. Now it returns a synthetic result shaped like
    # the real one so upstream callers can't tell the difference.
    if PAYMENT_FAKE_MODE:
        # R11 · fake-mode test hook. A token whose plaintext starts with
        # 'TEST_DECLINE_' short-circuits to CardcomDeclinedError so the
        # R9 "declined enters failure chain" regression can be exercised
        # end-to-end without real Cardcom. Real Cardcom uses specific
        # test card numbers for the same purpose (e.g. 4000-…-0002 →
        # declined). This is the seam Yulian's R11 §0 pointed at: the
        # network-boundary function owns the mode split, callers stay
        # single-path.
        if provider_token and provider_token.startswith("TEST_DECLINE_"):
            logger.warning(
                "[cardcom] FAKE decline deal=%s total=%.2f "
                "(TEST_DECLINE_ token prefix — R9 declined-regression hook)",
                deal_id, total,
            )
            raise CardcomDeclinedError(
                "Test decline (PAYMENT_FAKE_MODE=1, TEST_DECLINE_ token)",
                code="TEST_DECLINE",
            )
        fake_txn = f"FAKE-{uuid.uuid4().hex[:16]}"
        logger.warning(
            "[cardcom] FAKE charge deal=%s total=%.2f "
            "(PAYMENT_FAKE_MODE=1, no network call)",
            deal_id, total,
        )
        return {
            "provider_transaction_id": fake_txn,
            "response_code":           "0",
            "invoice_number":          "",
            "invoice_url":              None,
            "raw":                     {"fake": True, "reason": "PAYMENT_FAKE_MODE=1"},
        }

    if _free_launch_active():
        return _free_launch_result(deal_id, total, "charge_token")

    # Cardcom's v11 Transaction request (R37 4.1). The fields sent here
    # before (ApiPassword, CoinID, UniqueID, Installments, InvoiceHead,
    # InvoiceLines) are not in it: a charge went out with no expiry and
    # no document block, so no invoice would have been issued.
    payload = {
        "TerminalNumber":     int(CARDCOM_TERMINAL),
        "ApiName":            CARDCOM_API_NAME,
        "Amount":             total,
        "Token":              provider_token,
        # The same id sent twice is refused by Cardcom (code 608), so a
        # repeated request cannot charge twice.
        "ExternalUniqTranId": idempotency_key,
        "NumOfPayments":      1,
        "ISOCoinId":          1,       # 1 = ILS
    }
    if card_expiry:
        payload["CardExpirationMMYY"] = card_expiry
    if invoice_data:
        email = invoice_data.get("customer_email") or ""
        document = {
            "Name":          invoice_data.get("customer_name") or "",
            "IsSendByEmail": bool(email),
            "Languge":       "he",     # the field's spelling in Cardcom's API
            # The amount charged is the whole price, VAT inside it, so
            # the one line carries the whole amount.
            "Products": [{
                "Description": invoice_data.get("description", "עמלת שיבוץ עובדים זרים"),
                "UnitCost":    total,
                "Quantity":    1,
            }],
        }
        if email:
            document["Email"] = email
        if invoice_data.get("tax_id"):
            document["TaxId"] = invoice_data["tax_id"]
        payload["Document"] = document

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
                desc = data.get("Description") or "Declined"
                raise CardcomDeclinedError(
                    f"Charge declined: {desc}",
                    code=str(data.get("ResponseCode")),
                    description=data.get("Description"),
                )
            doc_number = data.get("DocumentNumber")
            return {
                "provider_transaction_id": str(data.get("TranzactionId") or ""),
                "response_code":  str(data.get("ResponseCode")),
                "invoice_number": str(doc_number) if doc_number else "",
                "invoice_url":    data.get("DocumentUrl"),
                "raw":            _safe_raw(data),
            }
    except CardcomDeclinedError:
        raise
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout charging: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error charging: {e}")


async def refund_transaction(provider_transaction_id: str, amount: float = None) -> dict:
    """Return a charge to the card it was made on (RefundByTransactionId).

    The whole charge, unless `amount` is given. The terminal needs the
    "זיכוי כרטיס או אסימון" permission for this call.

    Returns {"refunded": True, "refund_transaction_id", "raw"}.
    """
    if PAYMENT_FAKE_MODE:
        fake_id = "FAKE-REFUND-" + uuid.uuid4().hex[:12].upper()
        logger.warning("[cardcom] FAKE refund of tx=%s (PAYMENT_FAKE_MODE=1, no network call)",
                       provider_transaction_id)
        return {
            "refunded": True,
            "refund_transaction_id": fake_id,
            "raw": {"fake": True, "refund_of": provider_transaction_id},
        }

    try:
        cardcom_id = int(provider_transaction_id)
    except (TypeError, ValueError):
        # A FAKE- or FREE- id: there is no Cardcom transaction behind it.
        raise CardcomApiError("Not a Cardcom transaction id", code="bad_transaction_id")

    payload = {
        "ApiName":       CARDCOM_API_NAME,
        "ApiPassword":   CARDCOM_API_PASS,
        "TransactionId": cardcom_id,
    }
    if amount is not None:
        payload["PartialSum"] = amount

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
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
                    code=str(data.get("ResponseCode")),
                    description=data.get("Description"),
                )
            return {
                "refunded": True,
                "refund_transaction_id": str(data.get("NewTranzactionId") or ""),
                "raw": _safe_raw(data),
            }
    except CardcomApiError:
        raise
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout on refund: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error on refund: {e}")


def _map_brand(brand) -> str:
    """Cardcom names the brand ('Visa', 'MasterCard', 'AmericanExpress',
    'Isracard', 'Diners'...). Kept in lower case; anything that is not a
    name is left out, a number is not guessed at."""
    brand = str(brand or "").strip()
    return brand.lower() if brand.isalpha() else ""


# ─────────────────────────────────────────────────────────────────────────────
# J5 pre-authorization flow (Pattern A)
# ─────────────────────────────────────────────────────────────────────────────

async def authorize_low_profile(
    entity_id: str,
    deal_id: str,
    amount: float,
    return_url: str,
    webhook_url: str,
    invoice_data: dict = None,
) -> dict:
    """
    Create a J5 pre-authorization LowProfile page.

    User is redirected to Cardcom's hosted form showing `amount`, enters
    their card, and Cardcom places a hold (no actual charge) for that
    amount. Capture must happen within ~7–30 days or the hold auto-voids.

    `entity_id` is formatted "corporation:{uuid}" so the webhook can parse.
    `deal_id` becomes the UniqueID — allows idempotent retries.

    Returns: { "low_profile_id": str, "url": str }
    """
    if PAYMENT_FAKE_MODE:
        fake_id = _fake_deal_id()
        logger.info("[cardcom FAKE] authorize_low_profile deal=%s amount=%.2f → %s",
                    deal_id, amount, fake_id)
        # Route the user straight back to the return URL with a hint so the
        # frontend can call the fake-auth-complete endpoint.
        return {
            "low_profile_id": fake_id,
            "url": f"{return_url}?fake_auth=1&low_profile_id={fake_id}",
        }

    payload = {
        "TerminalNumber": int(CARDCOM_TERMINAL),
        "ApiName":        CARDCOM_API_NAME,
        "ApiPassword":    CARDCOM_API_PASS,
        "ReturnValue":    entity_id,
        "Amount":         round(amount, 2),
        "CoinID":         1,          # 1 = ILS
        "Language":       "he",
        "Operation":      "ChargeOnly",  # J5 signalled via DealType below
        "ChargeBy":       "J5",       # Cardcom alias for DealType=3 (pre-auth)
        "DealType":       3,
        "UniqueID":       deal_id,
        "SuccessRedirectUrl": return_url,
        "ErrorRedirectUrl":   return_url + "?error=1",
        "WebHookUrl":         webhook_url,
        "CreateToken":        False,  # J5 does not need long-term token
    }
    if invoice_data:
        payload["InvoiceHead"] = {
            "CustName":     invoice_data.get("customer_name", ""),
            "SendByEmail":  False,   # invoice only after capture
            "EmailAddress": invoice_data.get("customer_email", ""),
            "Language":     "he",
            "CoinID":       1,
            "VATIncluded":  True,
        }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CARDCOM_BASE_URL}/api/v11/LowProfile/Create",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("[cardcom] J5 LowProfile created deal=%s amount=%.2f code=%s",
                        deal_id, amount, data.get("ResponseCode"))
            if data.get("ResponseCode") != 0:
                raise CardcomApiError(
                    f"Cardcom J5 error: {data.get('Description', 'Unknown')}",
                    code=str(data.get("ResponseCode"))
                )
            return {
                "low_profile_id": data["LowProfileId"],
                "url":            data["Url"],
            }
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout creating J5 LowProfile: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error: {e}")


async def capture_transaction(
    auth_provider_deal_id: str,
    amount: float,
    idempotency_key: str,
    invoice_data: dict = None,
) -> dict:
    """
    Capture (settle) a prior J5 authorization.

    Converts the hold into a real charge using Cardcom's
    TransactionByDealNumber — no card details are re-submitted.

    Returns: provider_transaction_id, response_code, invoice_*, raw.
    """
    if PAYMENT_FAKE_MODE:
        logger.info("[cardcom FAKE] capture auth=%s amount=%.2f", auth_provider_deal_id, amount)
        return {
            "provider_transaction_id": _fake_deal_id(),
            "response_code":  "0",
            "invoice_number": "",
            "invoice_url":    None,
            "raw":            {"fake": True, "captured_from": auth_provider_deal_id},
        }

    if _free_launch_active():
        return _free_launch_result(auth_provider_deal_id, amount, "capture")

    payload = {
        "TerminalNumber":     int(CARDCOM_TERMINAL),
        "ApiName":            CARDCOM_API_NAME,
        "ApiPassword":        CARDCOM_API_PASS,
        "InternalDealNumber": auth_provider_deal_id,
        "Amount":             round(amount, 2),
        "UniqueID":           idempotency_key,
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
            "Price":       invoice_data.get("base_amount", amount),
            "Quantity":    1,
            "IsTaxFree":   False,
        }]

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{CARDCOM_BASE_URL}/api/v11/Transactions/TransactionByDealNumber",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("[cardcom] capture auth=%s amount=%.2f code=%s",
                        auth_provider_deal_id, amount, data.get("ResponseCode"))
            if str(data.get("ResponseCode")) not in ("0", "000"):
                desc = data.get("Description") or data.get("ReturnMessage", "Capture declined")
                raise CardcomDeclinedError(
                    f"Capture declined: {desc}",
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
        raise CardcomNetworkError(f"Timeout capturing: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error capturing: {e}")


async def void_transaction(auth_provider_deal_id: str) -> dict:
    """
    Void (release) a J5 hold before it's captured.

    No money moved — Cardcom releases the auth hold on the card. Safe to
    call inside the grace window; fails if already captured or expired.
    """
    if PAYMENT_FAKE_MODE:
        logger.info("[cardcom FAKE] void auth=%s", auth_provider_deal_id)
        return {"voided": True, "raw": {"fake": True, "voided": auth_provider_deal_id}}

    payload = {
        "TerminalNumber":     int(CARDCOM_TERMINAL),
        "ApiName":            CARDCOM_API_NAME,
        "ApiPassword":        CARDCOM_API_PASS,
        "InternalDealNumber": auth_provider_deal_id,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CARDCOM_BASE_URL}/api/v11/Transactions/CancelTransaction",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("[cardcom] void auth=%s code=%s",
                        auth_provider_deal_id, data.get("ResponseCode"))
            if data.get("ResponseCode") != 0:
                raise CardcomApiError(
                    f"Void error: {data.get('Description')}",
                    code=str(data.get("ResponseCode"))
                )
            return {"voided": True, "raw": data}
    except httpx.TimeoutException as e:
        raise CardcomNetworkError(f"Timeout on void: {e}")
    except httpx.HTTPError as e:
        raise CardcomNetworkError(f"HTTP error on void: {e}")


def fake_auth_expiry() -> datetime:
    """
    Utility for the backend flow: in fake mode we still populate
    `auth_expires_at` with a realistic-looking timestamp so TTL sweeps
    behave the same way as in production.
    """
    return datetime.utcnow() + timedelta(days=FAKE_AUTH_HOLD_DAYS)
