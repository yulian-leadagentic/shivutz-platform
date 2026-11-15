-- 099 · R35 · WhatsApp message ids: unique, and wide enough for Meta
--
-- WhatsApp runs on Meta's Cloud API, not on Vonage. Migration 052
-- created these tables when the plan was the Vonage Messages API, and
-- its header and column comments still say so. An applied migration is
-- not edited (the runner hashes each file and warns forever when one
-- changes), so the correction is recorded here: wherever 052 says
-- "Vonage", read "Meta". The tables themselves are provider-neutral and
-- stay as they are, apart from the two changes below. SMS is still
-- Vonage and is not touched.
--
-- 1. message_uuid goes from VARCHAR(64) to VARCHAR(128), on both
--    tables. 64 fitted a Vonage UUID. The value stored now is Meta's
--    message id, the wamid: "wamid." followed by base64 that wraps the
--    sender's number and the device's own message id. For an Israeli
--    number that is about 62 characters from an iPhone and about 78
--    from Android, so most Android inbound ids would not fit. In strict
--    mode the INSERT fails and the message is never answered; outside
--    strict mode the id is cut, and a status callback, which carries
--    the full id, never matches its row.
--
-- 2. message_uuid becomes UNIQUE on both tables. Meta redelivers
--    webhooks. The inbound handler dedups by inserting the wamid and
--    stopping on a duplicate-key error, and that needs a constraint,
--    not the plain index 052 created. NULLs stay legal and repeatable
--    (a failed send is logged with no id).
--
-- Before this runs anywhere, check for duplicates. Both queries must
-- return no rows:
--
--   SELECT message_uuid, COUNT(*) AS copies
--     FROM notif_db.support_messages
--    WHERE message_uuid IS NOT NULL
--    GROUP BY message_uuid HAVING COUNT(*) > 1;
--
--   SELECT message_uuid, COUNT(*) AS copies
--     FROM notif_db.whatsapp_message_log
--    WHERE message_uuid IS NOT NULL
--    GROUP BY message_uuid HAVING COUNT(*) > 1;
--
-- If either returns rows, ADD UNIQUE fails with error 1062, the runner
-- exits non-zero and the deploy stops. That is deliberate: this file
-- does not pick which copy of a message to keep. Clear the duplicates
-- by hand and redeploy. Every step is guarded, so a second run does
-- only what the first did not finish.

USE notif_db;

-- ── support_messages ────────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='notif_db' AND TABLE_NAME='support_messages'
       AND COLUMN_NAME='message_uuid') < 128,
  'ALTER TABLE support_messages
     MODIFY COLUMN message_uuid VARCHAR(128) NULL
     COMMENT ''provider message id: the Meta wamid for WhatsApp, on inbound and outbound rows alike''',
  'SELECT ''support_messages.message_uuid is already 128 wide''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA='notif_db' AND TABLE_NAME='support_messages'
       AND INDEX_NAME='uq_support_uuid') = 0,
  'ALTER TABLE support_messages ADD UNIQUE KEY uq_support_uuid (message_uuid)',
  'SELECT ''uq_support_uuid already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The plain index goes only once the unique one is in place, so the
-- column is never left without an index.
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA='notif_db' AND TABLE_NAME='support_messages'
       AND INDEX_NAME='ix_support_uuid') > 0,
  'ALTER TABLE support_messages DROP INDEX ix_support_uuid',
  'SELECT ''ix_support_uuid already dropped''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── whatsapp_message_log ────────────────────────────────────────────────────
SET @ddl := IF(
  (SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='notif_db' AND TABLE_NAME='whatsapp_message_log'
       AND COLUMN_NAME='message_uuid') < 128,
  'ALTER TABLE whatsapp_message_log
     MODIFY COLUMN message_uuid VARCHAR(128) NULL
     COMMENT ''the wamid Meta returned for this send''',
  'SELECT ''whatsapp_message_log.message_uuid is already 128 wide''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA='notif_db' AND TABLE_NAME='whatsapp_message_log'
       AND INDEX_NAME='uq_whatsapp_log_uuid') = 0,
  'ALTER TABLE whatsapp_message_log ADD UNIQUE KEY uq_whatsapp_log_uuid (message_uuid)',
  'SELECT ''uq_whatsapp_log_uuid already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA='notif_db' AND TABLE_NAME='whatsapp_message_log'
       AND INDEX_NAME='ix_whatsapp_log_uuid') > 0,
  'ALTER TABLE whatsapp_message_log DROP INDEX ix_whatsapp_log_uuid',
  'SELECT ''ix_whatsapp_log_uuid already dropped''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
