-- 098 · R37 Part 1 (D2) · the "contractor verified" email makes no
-- promise of periodic re-checks
--
-- Yulian, 15.11: "Remove the revalidation promise entirely. No sentence
-- about periodic re-checks. The job itself stays as it is."
--
-- The sentence on /how-it-works is removed in the frontend. The same
-- promise also closes the email a contractor receives on verification
-- (template `contractor.verified`, seeded by 012):
--
--   "האימות תקף לחצי שנה. נבדוק את הרישום שלך בפנקס באופן תקופתי,
--    ונודיע לך מראש אם יידרש לחדש."
--   "Verification is valid for six months. We will re-check your
--    registry listing periodically and notify you in advance if renewal
--    is needed."
--
-- This removes that footer paragraph and the rule above it, in both
-- languages. Nothing else in the template changes. The revalidation job
-- and the emails it sends when a registration lapses are untouched.
--
-- Matched by pattern, not by the literal block, so the line endings the
-- body was stored with do not matter. Idempotent: once the paragraph is
-- gone the pattern matches nothing and the row is left as it is.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
USE notif_db;

UPDATE notification_templates
   SET body_he = REGEXP_REPLACE(
         body_he,
         '<hr[^>]*>[[:space:]]*<p[^>]*>[[:space:]]*האימות תקף לחצי שנה[^<]*</p>[[:space:]]*',
         ''),
       body_en = REGEXP_REPLACE(
         body_en,
         '<hr[^>]*>[[:space:]]*<p[^>]*>[[:space:]]*Verification is valid for six months[^<]*</p>[[:space:]]*',
         '')
 WHERE event_key = 'contractor.verified';
