-- 052: WhatsApp foundation
--
-- Adds the schema needed for WhatsApp via Vonage Messages API:
--
--   1. notif_db.whatsapp_message_log
--      Per-message log of OUTBOUND WhatsApp sends. Mirrors sms_log
--      shape so the operational tooling (admin SMS log page,
--      grafana queries) can be adapted with minimal churn. Holds
--      the Vonage message_uuid (the Messages API's analogue of
--      sms_log.message_id) and status transitions submitted →
--      delivered → read driven by the /webhooks/vonage/messages/status
--      handler.
--
--   2. notif_db.support_messages
--      Two-way customer service inbox. Stores INBOUND user-sent
--      WhatsApp messages plus admin replies in a single conversation
--      thread keyed by (channel, peer_phone). admin_replies has a
--      back-reference to the inbound row when the reply is in-thread
--      vs. an admin-initiated outreach.
--
--   3. notif_db.notification_templates.whatsapp_template_name
--      Per-template Meta-approved WhatsApp template name (the name
--      registered with Vonage/Meta, e.g. tagidai_otp_v1). NULL means
--      no WhatsApp template approved yet — sendMessage() falls back
--      to SMS for that event.
--
--   4. auth_db.users.whatsapp_opt_in
--      Per-user preference for receiving OTP via WhatsApp. NULL/FALSE
--      → SMS (current behaviour). TRUE → WhatsApp first, SMS fallback
--      on failure.

USE notif_db;

-- ── 1. Outbound WhatsApp message log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_message_log (
  id              VARCHAR(36)  NOT NULL,
  phone           VARCHAR(20)  NOT NULL COMMENT 'recipient in E.164',
  message_text    TEXT         NULL    COMMENT 'rendered body (template params substituted)',
  template_name   VARCHAR(120) NULL    COMMENT 'Meta-approved template name; NULL for free-text in 24h window',
  message_uuid    VARCHAR(64)  NULL    COMMENT 'Vonage Messages API returned id',
  status          ENUM('queued','submitted','delivered','read','rejected','failed','undeliverable') NOT NULL DEFAULT 'queued',
  delivery_err    VARCHAR(255) NULL,
  submitted_at    DATETIME     NULL,
  delivered_at    DATETIME     NULL,
  read_at         DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_whatsapp_log_phone     (phone),
  KEY ix_whatsapp_log_uuid      (message_uuid),
  KEY ix_whatsapp_log_created   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Two-way support inbox ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_messages (
  id               VARCHAR(36)  NOT NULL,
  channel          ENUM('whatsapp','sms') NOT NULL DEFAULT 'whatsapp',
  direction        ENUM('inbound','outbound') NOT NULL,
  peer_phone       VARCHAR(20)  NOT NULL COMMENT 'the customer side phone in E.164',
  message_text     TEXT         NOT NULL,
  message_uuid     VARCHAR(64)  NULL COMMENT 'Vonage id (inbound = provider id; outbound = our send id)',
  template_name    VARCHAR(120) NULL COMMENT 'set on outbound when sent as a template',
  in_reply_to      VARCHAR(36)  NULL COMMENT 'on outbound: the inbound row this reply is threaded under',
  admin_user_id    VARCHAR(36)  NULL COMMENT 'on outbound: which admin clicked send',
  received_at      DATETIME     NULL COMMENT 'inbound only: vonage event time',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_support_peer_created (peer_phone, created_at),
  KEY ix_support_channel      (channel),
  KEY ix_support_uuid         (message_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. WhatsApp template name on notification_templates ─────────────────────
-- Use INFORMATION_SCHEMA guard for idempotency — re-running the migration
-- on a DB that already has the column shouldn't fail.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'notification_templates'
     AND COLUMN_NAME  = 'whatsapp_template_name'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE notification_templates
     ADD COLUMN whatsapp_template_name VARCHAR(120) NULL
       COMMENT ''Meta-approved WhatsApp template name registered with Vonage; NULL = WhatsApp not enabled for this event, fall back to SMS''
     AFTER event_key',
  'SELECT ''notification_templates.whatsapp_template_name already exists''');
PREPARE _stmt FROM @sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ── 4. Per-user OTP channel preference ──────────────────────────────────────
USE auth_db;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'users'
     AND COLUMN_NAME  = 'whatsapp_opt_in'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users
     ADD COLUMN whatsapp_opt_in TINYINT(1) NOT NULL DEFAULT 0
       COMMENT ''1 = prefer OTP via WhatsApp (with SMS fallback on failure); 0 = SMS only. Set during registration.''',
  'SELECT ''users.whatsapp_opt_in already exists''');
PREPARE _stmt FROM @sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;
