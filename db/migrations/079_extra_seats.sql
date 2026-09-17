-- 079 · R4 · per-entity extra seats (paid vs granted) + payment_events kind
--
-- Yulian 17.09: "חמישה משתמשים כלולים, ניתן לשינוי ע״י מנהל מערכת.
-- ניתן לרכוש מושבים נוספים, מחיר במסכי הניהול. מנהל מערכת יכול לשנות
-- בכל רגע נתון את כמות המושבים של הקבלן — בין אם הוא שילם או לא."
--
-- Two separate columns so the monthly renewal only bills what the
-- customer actually bought. Merging paid + granted would silently
-- charge admins' goodwill (R4 §0 warning).
--
--   included_users        (in subscription_plans, admin edits at
--                          /admin/subscription-plans — untouched here)
--   extra_seats_paid      (customer bought via /subscriptions/seats/…
--                          — billed in the renewal batch)
--   extra_seats_granted   (admin granted at /admin/subscriptions/…
--                          — NEVER billed. Ever. Tests assert this)
--   seats_note            (human context for the grant. Half a year
--                          from now nobody remembers why they gave 3)
--
-- Also extends payment_events.kind to include 'seat_purchase' so the
-- reporting query "how much revenue from seats vs subscriptions"
-- has a real answer. 072 seeded 'charge','refund','webhook','renewal'
-- — a paid-seat purchase belongs on its own row with its own kind
-- because it can happen mid-cycle and off the renewal cadence.
--
-- Idempotent guards (INFORMATION_SCHEMA) so a redeploy is a no-op.

USE payment_db;

-- extra_seats_paid ─────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='payment_db'
       AND TABLE_NAME='subscriptions'
       AND COLUMN_NAME='extra_seats_paid') = 0,
  'ALTER TABLE subscriptions
     ADD COLUMN extra_seats_paid INT NOT NULL DEFAULT 0
       COMMENT ''Seats the customer paid for — billed in the renewal batch''
     AFTER cancelled_at',
  'SELECT ''subscriptions.extra_seats_paid already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- extra_seats_granted ─────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='payment_db'
       AND TABLE_NAME='subscriptions'
       AND COLUMN_NAME='extra_seats_granted') = 0,
  'ALTER TABLE subscriptions
     ADD COLUMN extra_seats_granted INT NOT NULL DEFAULT 0
       COMMENT ''Seats an admin gave — never billed''
     AFTER extra_seats_paid',
  'SELECT ''subscriptions.extra_seats_granted already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- seats_note ──────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='payment_db'
       AND TABLE_NAME='subscriptions'
       AND COLUMN_NAME='seats_note') = 0,
  'ALTER TABLE subscriptions
     ADD COLUMN seats_note VARCHAR(255) NULL
       COMMENT ''Why the admin granted seats. Filled every grant.''
     AFTER extra_seats_granted',
  'SELECT ''subscriptions.seats_note already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- payment_events.kind — declared VARCHAR(32) in 072:36, so no ENUM
-- extension needed. The new value 'seat_purchase' just goes into
-- new rows written by the seat-purchase endpoint. Documenting the
-- values used in code here so grep finds them from the schema file:
--   'charge'         — one-off charge (initial subscription buy)
--   'refund'         — reversal
--   'webhook'        — Cardcom async status update
--   'renewal'        — monthly renewal batch
--   'seat_purchase'  — R4, new: paid seat added mid-cycle
