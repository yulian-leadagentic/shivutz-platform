"""A refusal with structured detail answers with its own code, never the
bare word "error" (corp ad publish on staging, 20.11).

Run: python -m unittest app.test_errors
"""
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.errors import register_error_handlers


def _client(detail, status=402):
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/x")
    def _x():
        raise HTTPException(status_code=status, detail=detail)

    return TestClient(app)


class ErrorShapeTest(unittest.TestCase):
    def test_a_coded_refusal_carries_its_code_and_details(self):
        r = _client({"code": "tier_active_ad_limit", "tier": "basic", "limit": 3, "used": 3}).get("/x")
        self.assertEqual(r.status_code, 402)
        self.assertEqual(r.json(), {"error": {
            "code": "tier_active_ad_limit", "message": "tier_active_ad_limit",
            "details": {"code": "tier_active_ad_limit", "tier": "basic", "limit": 3, "used": 3},
        }})

    def test_a_hebrew_message_is_kept(self):
        r = _client({"code": "tier_boost_not_allowed", "message": "שדרג כדי לקדם"}).get("/x")
        self.assertEqual((r.json()["error"]["code"], r.json()["error"]["message"]),
                         ("tier_boost_not_allowed", "שדרג כדי לקדם"))

    def test_without_a_code_the_status_names_it(self):
        r = _client({"tier": "basic"}).get("/x")
        self.assertEqual((r.json()["error"]["code"], r.json()["error"]["message"]), ("http_402", "http_402"))

    def test_a_string_detail_is_unchanged(self):
        r = _client("corp_only", status=403).get("/x")
        self.assertEqual(r.json(), {"error": {"code": "http_403", "message": "corp_only"}})


if __name__ == "__main__":
    unittest.main()
