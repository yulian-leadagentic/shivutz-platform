"""Fixes list ג, item 4 · what each kind of charge's document says.

  * every charge kind has its line, with the Hebrew plan name, not the code
  * the month is the charge's month, Israel time
  * no line names placement, a commission or workers, and neither does
    any string anywhere in the payment service

Run: python -m unittest app.services.test_invoice_lines
"""
import pathlib
import unittest
from datetime import datetime, timezone

from app.services import invoice_lines as il

AT = datetime(2026, 11, 18, 9, 0, tzinfo=timezone.utc)
# Built from code points, so this file does not hold the words it bans.
BANNED = tuple("".join(map(chr, word)) for word in (
    (0x5e9, 0x5d9, 0x5d1, 0x5d5, 0x5e5),   # placement
    (0x5e2, 0x5de, 0x5dc, 0x5d4),          # commission
    (0x5e2, 0x5de, 0x5dc, 0x5ea),          # commission, construct state
))
APP = pathlib.Path(__file__).resolve().parents[1]


class LinesTest(unittest.TestCase):
    def test_a_contractor_or_corporation_plan(self):
        self.assertEqual(il.subscription("basic", AT), "מנוי לפלטפורמת TagidAI, מסלול בסיסי, 11/2026")
        self.assertEqual(il.subscription("advanced", AT), "מנוי לפלטפורמת TagidAI, מסלול מתקדם, 11/2026")
        self.assertEqual(il.subscription("pro", AT), "מנוי לפלטפורמת TagidAI, מסלול פרו, 11/2026")

    def test_extra_users_on_a_plan(self):
        self.assertEqual(il.extra_seats("basic", 1, AT), "משתמש נוסף במנוי לפלטפורמת TagidAI, מסלול בסיסי, 11/2026")
        self.assertEqual(il.extra_seats("pro", 3, AT), "3 משתמשים נוספים במנוי לפלטפורמת TagidAI, מסלול פרו, 11/2026")

    def test_a_providers_advertising_plan(self):
        self.assertEqual(il.marketplace_plan("הסעות", AT), "פרסום בפלטפורמת TagidAI, קטגוריית הסעות, 11/2026")

    def test_a_provider_plan_whose_category_could_not_be_read_still_says_what_was_sold(self):
        for missing in ("", None, "  "):
            self.assertEqual(il.marketplace_plan(missing, AT), "פרסום בפלטפורמת TagidAI, 11/2026")

    def test_a_contact_reveal(self):
        self.assertEqual(il.contact_reveal(), "חשיפת פרטי קשר בפלטפורמת TagidAI")

    def test_the_month_is_israel_time(self):
        # 23:30 UTC on 31.10 is already 1.11 in Israel.
        self.assertEqual(il.billing_month(datetime(2026, 10, 31, 23, 30, tzinfo=timezone.utc)), "11/2026")

    def test_an_unknown_tier_has_no_line(self):
        with self.assertRaises(ValueError):
            il.subscription("gold", AT)

    def test_no_line_names_placement_a_commission_or_workers(self):
        lines = [il.subscription(t, AT) for t in il.TIER_NAMES_HE] + [
            il.extra_seats("basic", 2, AT), il.marketplace_plan("הסעות", AT),
            il.marketplace_plan(None, AT), il.contact_reveal()]
        for line in lines:
            self.assertTrue(line.strip())
            self.assertIn("TagidAI", line)
            for word in BANNED + ("עובדים",):
                self.assertNotIn(word, line)


class NoStringInThePaymentServiceTest(unittest.TestCase):
    def test_no_source_file_names_placement_or_a_commission(self):
        found = []
        for path in APP.rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            for word in BANNED:
                if word in text:
                    found.append(f"{path.relative_to(APP)}: {word}")
        self.assertEqual(found, [])


if __name__ == "__main__":
    unittest.main()
