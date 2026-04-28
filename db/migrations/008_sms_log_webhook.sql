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

-- DLR columns (delivery_status, delivery_err, delivered_at) are included
-- in the CREATE TABLE IF NOT EXISTS above, so a fresh install already has
-- them. Legacy bridge for older envs is intentionally omitted — this
-- migration runs via PyMySQL which does not support DELIMITER / stored
-- procedure blocks.

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
