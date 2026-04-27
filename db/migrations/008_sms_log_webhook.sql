-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008: SMS log table + inbound SMS log
--
-- Creates:
--   notif_db.sms_log          — outbound SMS audit trail + DLR delivery status
--   notif_db.inbound_sms_log  — inbound SMS from Vonage webhook
-- ─────────────────────────────────────────────────────────────────────────────

USE notif_db;

-- Outbound SMS log — one row per send attempt
-- Note: table may exist from a previous migration; ALTER adds DLR columns if absent.
CREATE TABLE IF NOT EXISTS sms_log (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  phone            VARCHAR(20)   NOT NULL,
  message          TEXT          NOT NULL,
  provider         VARCHAR(30)   NOT NULL DEFAULT 'stub',
  message_id       VARCHAR(100)  NULL,          -- provider-assigned message ID
  status           ENUM('sent','failed')
                                 NOT NULL DEFAULT 'sent',
  error            TEXT          NULL,          -- populated on failure
  -- Delivery receipt (DLR) fields — populated via Vonage webhook
  delivery_status  VARCHAR(30)   NULL,          -- delivered | expired | failed | rejected | accepted | buffered
  delivery_err     VARCHAR(10)   NULL,          -- Vonage err-code
  delivered_at     DATETIME      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_phone      (phone),
  INDEX idx_message_id (message_id),
  INDEX idx_status     (status),
  INDEX idx_created    (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idempotent: add DLR columns only if the table was created by an earlier migration
-- without them (MySQL does not support ADD COLUMN IF NOT EXISTS before 8.0.31).
DROP PROCEDURE IF EXISTS _add_dlr_columns;
DELIMITER $$
CREATE PROCEDURE _add_dlr_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_log' AND COLUMN_NAME = 'delivery_status'
  ) THEN
    ALTER TABLE sms_log
      ADD COLUMN delivery_status VARCHAR(30) NULL AFTER error,
      ADD COLUMN delivery_err    VARCHAR(10) NULL AFTER delivery_status,
      ADD COLUMN delivered_at    DATETIME    NULL AFTER delivery_err;
  END IF;
END$$
DELIMITER ;
CALL _add_dlr_columns();
DROP PROCEDURE IF EXISTS _add_dlr_columns;

-- Inbound SMS log — messages received from Vonage inbound webhook
CREATE TABLE IF NOT EXISTS inbound_sms_log (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  from_phone       VARCHAR(20)   NOT NULL,       -- msisdn (sender)
  to_number        VARCHAR(30)   NOT NULL,       -- virtual number that received it
  message_id       VARCHAR(100)  NOT NULL,
  message_text     TEXT          NULL,
  message_type     VARCHAR(20)   NOT NULL DEFAULT 'text',
  received_at      DATETIME      NULL,           -- message-timestamp from Vonage
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_from_phone (from_phone),
  INDEX idx_message_id (message_id),
  INDEX idx_received   (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
