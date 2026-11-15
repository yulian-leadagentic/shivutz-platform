"""R37 4.1.1 · the two routes a card setup goes through.

  * the entity comes from the gateway's headers, never from a body
  * the return page may ask only about the caller's own setup
  * no route stores a token that a request carries

Run: python -m unittest app.routes.test_card_setup_routes
"""
import asyncio
import json
import unittest
from unittest import mock

from fastapi import HTTPException

from app.routes import payment_methods
from app.services.cardcom import CardcomApiError, CardcomNetworkError

ME, OTHER = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
SETUP = {"id": "setup-1", "entity_type": "service_provider", "entity_id": ME,
         "low_profile_id": "lp-1", "status": "pending", "is_fake": False}


def _confirm(setup_id="setup-1", entity_id=ME, entity_type="service_provider"):
    return asyncio.run(payment_methods.confirm_card_setup(
        setup_id, x_entity_id=entity_id, x_org_id=None, x_entity_type=entity_type))


class ConfirmRouteTest(unittest.TestCase):
    def setUp(self):
        self.complete = mock.AsyncMock(return_value={"status": "pending", "payment_method_id": None, "reason": None})
        for name, value in (("load", mock.Mock(return_value=dict(SETUP))), ("complete", self.complete)):
            p = mock.patch.object(payment_methods.card_setup, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_the_owner_gets_the_state_of_its_setup(self):
        self.assertEqual(_confirm()["status"], "pending")
        self.complete.assert_awaited_once()

    def test_another_providers_setup_reads_as_not_found_and_asks_cardcom_nothing(self):
        with self.assertRaises(HTTPException) as ctx:
            _confirm(entity_id=OTHER)
        self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (404, "card_setup_not_found"))
        self.complete.assert_not_awaited()

    def test_the_same_id_under_another_entity_type_is_not_the_owner(self):
        with self.assertRaises(HTTPException) as ctx:
            _confirm(entity_type="contractor")
        self.assertEqual(ctx.exception.status_code, 404)
        self.complete.assert_not_awaited()

    def test_a_setup_that_does_not_exist_is_404(self):
        with mock.patch.object(payment_methods.card_setup, "load", mock.Mock(return_value=None)):
            with self.assertRaises(HTTPException) as ctx:
                _confirm("nope")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_a_caller_with_no_entity_is_refused(self):
        for entity_id, entity_type in ((None, "service_provider"), (ME, None), (ME, "admin")):
            with self.assertRaises(HTTPException) as ctx:
                _confirm(entity_id=entity_id, entity_type=entity_type)
            self.assertEqual(ctx.exception.status_code, 403)

    def test_cardcom_unreachable_is_502_with_a_hebrew_message(self):
        self.complete.side_effect = CardcomNetworkError("timeout")
        with self.assertRaises(HTTPException) as ctx:
            _confirm()
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertEqual(ctx.exception.detail["code"], "payment_provider_unreachable")


class StartRouteTest(unittest.TestCase):
    def _start(self, side_effect=None, **headers):
        start = mock.AsyncMock(return_value={"setup_id": "s", "url": "u", "mode": "real"}, side_effect=side_effect)
        with mock.patch.object(payment_methods.card_setup, "start", start):
            args = dict(x_entity_id=ME, x_org_id=None, x_entity_type="service_provider", x_user_id="user-1")
            args.update(headers)
            return asyncio.run(payment_methods.start_card_setup(**args)), start

    def test_the_entity_comes_from_the_gateway_headers(self):
        out, start = self._start()
        start.assert_awaited_once_with("service_provider", ME, "user-1")
        self.assertEqual(out["url"], "u")

    def test_an_environment_that_cannot_open_a_page_says_so(self):
        with self.assertRaises(HTTPException) as ctx:
            self._start(side_effect=payment_methods.card_setup.CardSetupUnavailable("no addresses"))
        self.assertEqual((ctx.exception.status_code, ctx.exception.detail["code"]), (503, "card_setup_unavailable"))

    def test_a_cardcom_refusal_is_502_and_does_not_leak_its_text(self):
        with self.assertRaises(HTTPException) as ctx:
            self._start(side_effect=CardcomApiError("terminal 12345 rejected", code="401"))
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertNotIn("12345", json.dumps(ctx.exception.detail, ensure_ascii=False))

    def test_there_is_no_route_that_stores_a_token_from_a_request_body(self):
        posts = [r.path for r in payment_methods.router.routes if "POST" in getattr(r, "methods", ())]
        self.assertEqual(sorted(posts), ["/setup", "/setup/{setup_id}/confirm"])


if __name__ == "__main__":
    unittest.main()
