"""R38 item 2 · the lock for the Python services: no em dash in a message a
user can read. The scan is scripts/em_dash_scan.py.

Run: python -m unittest scripts/test_em_dash_scan.py   (from the repo root)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import em_dash_scan as scan  # noqa: E402

D = scan.EM_DASH


class NoEmDashTest(unittest.TestCase):
    def test_no_em_dash_in_any_message_the_services_return(self):
        hits = scan.scan_roots()
        self.assertEqual(hits, [], "\n".join(f"{h['file']}:{h['line']}  {h['text']}" for h in hits))

    def test_a_dash_in_an_error_detail_is_caught(self):
        src = f'raise HTTPException(status_code=409, detail={{"code": "x", "message": "שגיאה {D} נסו שוב"}})\n'
        self.assertEqual(len(scan.scan_source("a.py", src)), 1)

    def test_a_dash_in_an_english_detail_is_caught(self):
        src = f'raise HTTPException(status_code=409, detail="Not allowed {D} ask an admin")\n'
        self.assertEqual(len(scan.scan_source("a.py", src)), 1)

    def test_a_dash_in_a_hebrew_f_string_is_caught(self):
        src = f'body = f"שלום {{name}} {D} החשבון שלך פעיל"\n'
        self.assertEqual(len(scan.scan_source("a.py", src)), 1)

    def test_comments_docstrings_and_english_logs_are_not_messages(self):
        src = (f'"""Module docstring {D} fine."""\n'
               f'# a comment {D} fine\n'
               f'def f():\n    """Docstring {D} fine."""\n'
               f'    logger.info("[x] skipped {D} fine")\n')
        self.assertEqual(scan.scan_source("a.py", src), [])


if __name__ == "__main__":
    unittest.main()
