"""R37 4.1.6 · Cardcom's card-page webhook is believed for nothing.

  * one value is read from the call, the id of the page, and only to
    find OUR pending row for it
  * whose card it is comes from that row; nothing else in the body is
    passed on
  * a page id we never issued does nothing
  * the answer is the same 200 whatever happened

That a repeated call changes nothing is pinned where the work is done:
app/services/test_card_setup.py.

Run: python -m unittest app.routes.test_cardcom_webhook
"""
import asyncio
import json
import unittest
from unittest import mock

from app.routes import webhooks
from app.services.cardcom import CardcomNetworkError

ME, OTHER = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
SETUP = {"id": "setup-1", "entity_type": "service_provider", "entity_id": ME,
         "low_profile_id": "lp-1", "status": "pending", "is_fake": False}


class _Request:
    def __init__(self, body=b"", query=None):
        self._body, self.query_params = body, query or {}

    async def body(self):
        return self._body


class WebhookTest(unittest.TestCase):
    def setUp(self):
        self.load = mock.Mock(return_value=dict(SETUP))
        self.complete = mock.AsyncMock(return_value={"status": "completed", "payment_method_id": "pm", "reason": None})
        for name, value in (("load", self.load), ("complete", self.complete)):
            p = mock.patch.object(webhooks.card_setup, name, value)
            p.start()
            self.addCleanup(p.stop)

    def call(self, body=b"", query=None):
        return asyncio.run(webhooks.cardcom_webhook(_Request(body, query)))

    def test_the_page_id_is_found_in_json_form_and_query(self):
        for body, query in (
            (json.dumps({"LowProfileId": "lp-1", "ResponseCode": 0}).encode(), None),
            (b"lowprofilecode=lp-1&ResponseCode=0", None),
            (b"", {"LowProfileId": "lp-1"}),
        ):
            self.load.reset_mock()
            self.call(body, query)
            self.load.assert_called_once_with(low_profile_id="lp-1")

    def test_the_setup_completed_is_our_row_for_that_page_and_nothing_from_the_body(self):
        body = json.dumps({
            "LowProfileId": "lp-1", "ReturnValue": "service_provider:" + OTHER,
            "TokenInfo": {"Token": "attacker-token"}, "ResponseCode": 0,
        }).encode()
        self.call(body)
        (passed,), _ = self.complete.await_args
        self.assertEqual(passed["entity_id"], ME)
        self.assertNotIn("attacker-token", repr(self.complete.await_args))
        self.assertNotIn(OTHER, repr(self.complete.await_args))

    def test_a_page_id_we_never_issued_does_nothing(self):
        self.load.return_value = None
        self.assertEqual(self.call(b"LowProfileId=made-up"), {"received": True})
        self.complete.assert_not_awaited()

    def test_an_empty_call_does_nothing(self):
        self.assertEqual(self.call(), {"received": True})
        self.load.assert_not_called()

    def test_the_answer_is_the_same_whatever_happened(self):
        answers = [self.call(b"LowProfileId=lp-1")]
        self.complete.return_value = {"status": "failed", "payment_method_id": None, "reason": "x"}
        answers.append(self.call(b"LowProfileId=lp-1"))
        self.complete.side_effect = CardcomNetworkError("timeout")
        answers.append(self.call(b"LowProfileId=lp-1"))
        self.load.return_value = None
        answers.append(self.call(b"LowProfileId=unknown"))
        self.assertEqual(answers, [{"received": True}] * 4)

    def test_a_body_that_is_not_json_or_a_form_does_nothing(self):
        self.assertEqual(self.call(b"{not json"), {"received": True})
        self.load.assert_not_called()


if __name__ == "__main__":
    unittest.main()
