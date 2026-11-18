"""R37 4.1 · what we send Cardcom, and what we keep of its answers.

The four calls are checked against Cardcom's published v11 description
(secure.cardcom.solutions/swagger/v11/swagger.json): field names, and
the absence of the fields the old code sent that the API does not have.
No network: httpx is replaced by a recorder.

Run: python -m unittest app.services.test_cardcom_requests
"""
import asyncio
import unittest
from unittest import mock

from app.services import cardcom


class _Response:
    def __init__(self, body, status=200):
        self._body, self.status_code = body, status

    def raise_for_status(self):
        pass

    def json(self):
        return self._body


class _Client:
    """Stands in for httpx.AsyncClient and remembers the one call made."""
    sent = None

    def __init__(self, answer):
        self.answer = answer

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None):
        _Client.sent = {"url": url, "json": json}
        return _Response(self.answer)


def _real(coro_fn, answer, *args, **kwargs):
    """Run one cardcom call in real mode against a canned answer."""
    client = _Client(answer)
    with mock.patch.object(cardcom, "PAYMENT_FAKE_MODE", False), \
         mock.patch.object(cardcom, "FREE_LAUNCH_UNTIL", None), \
         mock.patch.object(cardcom, "CARDCOM_TERMINAL", "1000"), \
         mock.patch.object(cardcom.httpx, "AsyncClient", client):
        out = asyncio.run(coro_fn(*args, **kwargs))
    return out, _Client.sent


OLD_FIELDS = ("CoinID", "UniqueID", "InvoiceHead", "InvoiceLines", "Installments",
              "CreateToken", "TokenToCharge", "ErrorRedirectUrl", "InternalDealNumber")


class CardPageTest(unittest.TestCase):
    def test_the_page_saves_a_card_and_charges_nothing(self):
        out, sent = _real(
            cardcom.create_low_profile, {"ResponseCode": 0, "LowProfileId": "lp-1", "Url": "https://cardcom/page"},
            return_value="setup-1", success_url="https://site/ok", failed_url="https://site/no",
            webhook_url="https://api/webhooks/cardcom",
        )
        body = sent["json"]
        self.assertTrue(sent["url"].endswith("/api/v11/LowProfile/Create"))
        self.assertEqual(body["Operation"], "CreateTokenOnly")
        self.assertEqual(body["AdvancedDefinition"], {"JValidateType": 2})
        self.assertEqual(body["ReturnValue"], "setup-1")
        self.assertEqual((body["SuccessRedirectUrl"], body["FailedRedirectUrl"], body["WebHookUrl"]),
                         ("https://site/ok", "https://site/no", "https://api/webhooks/cardcom"))
        for required in ("TerminalNumber", "ApiName", "Amount"):
            self.assertIn(required, body)
        self.assertEqual(out, {"low_profile_id": "lp-1", "url": "https://cardcom/page"})

    def test_the_page_request_carries_no_password_and_no_old_field(self):
        _, sent = _real(
            cardcom.create_low_profile, {"ResponseCode": 0, "LowProfileId": "lp-1", "Url": "u"},
            return_value="s", success_url="a", failed_url="b", webhook_url="c",
        )
        self.assertNotIn("ApiPassword", sent["json"])
        for old in OLD_FIELDS:
            self.assertNotIn(old, sent["json"])

    def test_a_refused_page_raises_with_cardcoms_own_text(self):
        with self.assertRaises(cardcom.CardcomApiError) as ctx:
            _real(cardcom.create_low_profile, {"ResponseCode": 5035, "Description": "אין הרשאה"},
                  return_value="s", success_url="a", failed_url="b", webhook_url="c")
        self.assertEqual((ctx.exception.code, ctx.exception.description), ("5035", "אין הרשאה"))

    def test_fake_mode_opens_no_page_and_calls_nobody(self):
        _Client.sent = None
        with mock.patch.object(cardcom, "PAYMENT_FAKE_MODE", True), \
             mock.patch.object(cardcom.httpx, "AsyncClient", _Client({})):
            out = asyncio.run(cardcom.create_low_profile(
                return_value="s", success_url="/provider/billing?card_setup=s", failed_url="x", webhook_url=""))
        self.assertIsNone(_Client.sent)
        self.assertEqual(out["url"], "/provider/billing?card_setup=s")
        self.assertTrue(out["low_profile_id"].startswith("FAKE-"))


RESULT = {
    "ResponseCode": 0, "LowProfileId": "lp-1", "ReturnValue": "setup-1", "Operation": "CreateTokenOnly",
    "TokenInfo": {"Token": "tok-secret", "CardYear": 2028, "CardMonth": 7, "CardOwnerIdentityNumber": "123456782"},
    "UIValues": {"CardOwnerName": "דנה לוי", "CardOwnerPhone": "0501234567", "CardYear": 28, "CardMonth": 7},
    "TranzactionInfo": {"ResponseCode": 700, "TranzactionId": 77, "Last4CardDigits": 42, "Last4CardDigitsString": "0042",
                        "FirstCardDigits": 458000, "Brand": "Visa", "Token": "tok-secret",
                        "CardOwnerIdentityNumber": "123456782"},
}


class CardPageResultTest(unittest.TestCase):
    def test_the_result_is_asked_by_page_id_without_a_password(self):
        _, sent = _real(cardcom.get_low_profile_result, RESULT, "lp-1")
        self.assertTrue(sent["url"].endswith("/api/v11/LowProfile/GetLpResult"))
        self.assertEqual(set(sent["json"]), {"TerminalNumber", "ApiName", "LowProfileId"})

    def test_the_card_is_read_from_the_documented_places(self):
        out, _ = _real(cardcom.get_low_profile_result, RESULT, "lp-1")
        self.assertEqual(out["token"], "tok-secret")
        self.assertEqual((out["last_4_digits"], out["card_brand"]), ("0042", "visa"))
        self.assertEqual((out["expiry_month"], out["expiry_year"]), (7, 2028))
        self.assertEqual(out["card_holder_name"], "דנה לוי")
        self.assertEqual(out["return_value"], "setup-1")

    def test_what_is_kept_of_the_answer_has_no_token_and_no_personal_numbers(self):
        out, _ = _real(cardcom.get_low_profile_result, RESULT, "lp-1")
        kept = repr(out["raw"])
        for secret in ("tok-secret", "123456782", "0501234567", "458000"):
            self.assertNotIn(secret, kept)
        self.assertEqual(out["raw"]["TranzactionInfo"]["TranzactionId"], 77)

    def test_a_two_digit_year_is_read_as_this_century(self):
        answer = {**RESULT, "TokenInfo": {"Token": "t", "CardYear": 29, "CardMonth": 1}}
        out, _ = _real(cardcom.get_low_profile_result, answer, "lp-1")
        self.assertEqual(out["expiry_year"], 2029)

    def test_a_page_the_holder_has_not_finished_is_pending_not_failed(self):
        for code in (5117, 5118, 5119):
            with self.assertRaises(cardcom.CardcomPendingError):
                _real(cardcom.get_low_profile_result, {"ResponseCode": code}, "lp-1")

    def test_any_other_refusal_is_an_error(self):
        with self.assertRaises(cardcom.CardcomApiError) as ctx:
            _real(cardcom.get_low_profile_result, {"ResponseCode": 5001, "Description": "לא נמצא"}, "lp-1")
        self.assertNotIsInstance(ctx.exception, cardcom.CardcomPendingError)

    def test_fake_mode_gives_a_card_that_cannot_pass_for_real(self):
        with mock.patch.object(cardcom, "PAYMENT_FAKE_MODE", True):
            out = asyncio.run(cardcom.get_low_profile_result("FAKE-1"))
        self.assertTrue(out["token"].startswith("FAKE_TOKEN_"))
        self.assertEqual((out["last_4_digits"], out["card_brand"], out["expiry_year"]), ("0000", "fake", 2099))


CHARGED = {"ResponseCode": 0, "TranzactionId": 9911, "Amount": 200, "DocumentNumber": 3105,
           "DocumentUrl": "https://cardcom/doc/3105", "Token": "tok-secret", "FirstCardDigits": 458000,
           "CardOwnerIdentityNumber": "123456782", "Last4CardDigitsString": "0042", "Brand": "Visa"}


def _charge(answer=CHARGED, **over):
    args = dict(provider_token="tok-secret", base_amount=200, vat_amount=0, deal_id="mp:1",
                idempotency_key="charge-1", card_expiry="0728",
                invoice_data={"customer_name": "ספק בדיקה", "customer_email": "a@b.co",
                              "description": "מסלול פרסום", "tax_id": "514000000"})
    args.update(over)
    return _real(cardcom.charge_token, answer, **args)


class TokenChargeTest(unittest.TestCase):
    def test_the_charge_is_a_v11_transaction_with_the_token_and_its_expiry(self):
        _, sent = _charge()
        body = sent["json"]
        self.assertTrue(sent["url"].endswith("/api/v11/Transactions/Transaction"))
        self.assertEqual((body["Token"], body["CardExpirationMMYY"], body["Amount"]), ("tok-secret", "0728", 200))
        self.assertEqual(body["ExternalUniqTranId"], "charge-1")
        self.assertEqual(body["ISOCoinId"], 1)
        self.assertNotIn("ApiPassword", body)
        for old in OLD_FIELDS:
            self.assertNotIn(old, body)

    def test_the_document_block_is_what_makes_cardcom_issue_the_invoice(self):
        _, sent = _charge()
        doc = sent["json"]["Document"]
        self.assertEqual((doc["Name"], doc["Email"], doc["IsSendByEmail"], doc["TaxId"]),
                         ("ספק בדיקה", "a@b.co", True, "514000000"))
        self.assertEqual(doc["Products"], [{"Description": "מסלול פרסום", "UnitCost": 200, "Quantity": 1}])

    def test_the_one_invoice_line_is_the_whole_amount_charged(self):
        _, sent = _charge(base_amount=170.94, vat_amount=29.06)
        self.assertEqual(sent["json"]["Amount"], 200.0)
        self.assertEqual(sent["json"]["Document"]["Products"][0]["UnitCost"], 200.0)

    def test_no_email_means_the_document_is_not_mailed(self):
        _, sent = _charge(invoice_data={"customer_name": "ספק", "description": "מסלול"})
        doc = sent["json"]["Document"]
        self.assertEqual(doc["IsSendByEmail"], False)
        self.assertNotIn("Email", doc)

    def test_without_invoice_data_no_document_is_asked_for(self):
        _, sent = _charge(invoice_data=None)
        self.assertNotIn("Document", sent["json"])

    def test_the_document_asked_for_is_a_tax_invoice_and_receipt(self):
        _, sent = _charge()
        self.assertEqual(sent["json"]["Document"]["DocumentTypeToCreate"], "TaxInvoiceAndReceipt")

    def test_a_document_without_a_line_is_not_sent_and_nothing_is_charged(self):
        for invoice_data in ({"customer_name": "ספק"}, {"customer_name": "ספק", "description": "  "}):
            _Client.sent = None
            with self.assertRaises(ValueError) as ctx:
                _charge(invoice_data=invoice_data)
            self.assertEqual(str(ctx.exception), "invoice_description_missing")
            self.assertIsNone(_Client.sent)

    def test_a_missing_line_fails_in_fake_mode_too(self):
        with mock.patch.object(cardcom, "PAYMENT_FAKE_MODE", True):
            with self.assertRaises(ValueError):
                asyncio.run(cardcom.charge_token(
                    provider_token="tok", base_amount=1, vat_amount=0, deal_id="d",
                    idempotency_key="k", invoice_data={"customer_name": "ספק"}))

    def test_the_answer_gives_the_transaction_and_the_invoice(self):
        out, _ = _charge()
        self.assertEqual(out["provider_transaction_id"], "9911")
        self.assertEqual((out["invoice_number"], out["invoice_url"]), ("3105", "https://cardcom/doc/3105"))
        kept = repr(out["raw"])
        for secret in ("tok-secret", "123456782", "458000"):
            self.assertNotIn(secret, kept)

    def test_a_refusal_is_a_decline_with_cardcoms_own_text(self):
        with self.assertRaises(cardcom.CardcomDeclinedError) as ctx:
            _charge(answer={"ResponseCode": 6001, "Description": "העסקה נדחתה"})
        self.assertEqual((ctx.exception.code, ctx.exception.description), ("6001", "העסקה נדחתה"))

    def test_fake_mode_still_charges_nobody_and_still_honours_the_decline_hook(self):
        _Client.sent = None
        with mock.patch.object(cardcom, "PAYMENT_FAKE_MODE", True), \
             mock.patch.object(cardcom.httpx, "AsyncClient", _Client({})):
            out = asyncio.run(cardcom.charge_token("FAKE_TOKEN_x", 200, 0, "mp:1", "k", card_expiry="1299"))
            with self.assertRaises(cardcom.CardcomDeclinedError):
                asyncio.run(cardcom.charge_token("TEST_DECLINE_x", 200, 0, "mp:1", "k"))
        self.assertIsNone(_Client.sent)
        self.assertTrue(out["provider_transaction_id"].startswith("FAKE-"))


class RefundTest(unittest.TestCase):
    def test_the_refund_names_the_transaction_and_carries_the_password(self):
        out, sent = _real(cardcom.refund_transaction, {"ResponseCode": 0, "NewTranzactionId": 9912}, "9911")
        self.assertTrue(sent["url"].endswith("/api/v11/Transactions/RefundByTransactionId"))
        self.assertEqual(set(sent["json"]), {"ApiName", "ApiPassword", "TransactionId"})
        self.assertEqual(sent["json"]["TransactionId"], 9911)
        self.assertEqual((out["refunded"], out["refund_transaction_id"]), (True, "9912"))

    def test_a_partial_refund_sends_the_sum(self):
        _, sent = _real(cardcom.refund_transaction, {"ResponseCode": 0, "NewTranzactionId": 1}, "9911", 50)
        self.assertEqual(sent["json"]["PartialSum"], 50)

    def test_an_id_that_is_not_cardcoms_is_refused_before_any_call(self):
        _Client.sent = None
        for not_real in ("FAKE-abc", "FREE-ABC", "", None):
            with self.assertRaises(cardcom.CardcomApiError) as ctx:
                _real(cardcom.refund_transaction, {"ResponseCode": 0}, not_real)
            self.assertEqual(ctx.exception.code, "bad_transaction_id")
        self.assertIsNone(_Client.sent)

    def test_a_refused_refund_raises(self):
        with self.assertRaises(cardcom.CardcomApiError) as ctx:
            _real(cardcom.refund_transaction, {"ResponseCode": 5210, "Description": "אין הרשאת זיכוי"}, "9911")
        self.assertEqual(ctx.exception.description, "אין הרשאת זיכוי")

    def test_fake_mode_refunds_nothing_at_cardcom(self):
        _Client.sent = None
        with mock.patch.object(cardcom, "PAYMENT_FAKE_MODE", True), \
             mock.patch.object(cardcom.httpx, "AsyncClient", _Client({})):
            out = asyncio.run(cardcom.refund_transaction("FAKE-abc"))
        self.assertIsNone(_Client.sent)
        self.assertTrue(out["refund_transaction_id"].startswith("FAKE-REFUND-"))


class BrandTest(unittest.TestCase):
    def test_a_named_brand_is_kept_and_a_number_is_not_guessed(self):
        self.assertEqual(cardcom._map_brand("MasterCard"), "mastercard")
        self.assertEqual(cardcom._map_brand(2), "")
        self.assertEqual(cardcom._map_brand(None), "")


class ExpiryTest(unittest.TestCase):
    def test_month_and_year_become_mmyy(self):
        self.assertEqual(cardcom.expiry_mmyy({"expiry_month": 7, "expiry_year": 2028}), "0728")
        self.assertEqual(cardcom.expiry_mmyy({"expiry_month": 12, "expiry_year": 2099}), "1299")

    def test_a_row_without_a_usable_expiry_gives_none(self):
        for row in ({"expiry_month": 0, "expiry_year": 0}, {"expiry_month": 13, "expiry_year": 2028}, {}):
            self.assertIsNone(cardcom.expiry_mmyy(row))


if __name__ == "__main__":
    unittest.main()
