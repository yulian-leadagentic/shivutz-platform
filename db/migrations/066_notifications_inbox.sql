-- 066: G5 — in-app notification center
--
-- Every outbound notification (SMS, WhatsApp, email) that carries a
-- user-actionable payload gets an inbox row so the recipient can
-- catch up in-app even if the SMS was missed. Also lets users read
-- past history from the bell menu.
--
-- Design notes:
--   * recipient_user_id is REQUIRED (unlike sms_log which can log an
--     anonymous phone). Anonymous SMS (OTP delivery) does NOT go here.
--   * read_at timestamp instead of a boolean so we can compute
--     "unread since last visit" without a second table.
--   * event_key mirrors the template's key so the UI can pick an icon
--     per event class (deal.proposed → briefcase, membership.request
--     → user-plus, etc.).
--   * body_he is the exact user-facing text that was sent — no need
--     to re-render templates in the bell UI, no drift between "the
--     SMS I got" and "what the app shows me". target_href optional
--     deep link (e.g. /contractor/deals/xxx).

USE notif_db;

CREATE TABLE notifications_inbox (
  id                  CHAR(36)     NOT NULL PRIMARY KEY,
  recipient_user_id   CHAR(36)     NOT NULL,
  event_key           VARCHAR(100) NOT NULL,        -- 'deal.proposed', 'membership.request', ...
  title_he            VARCHAR(255) NOT NULL,        -- 1-line summary (used as SMS subject)
  body_he             TEXT         NOT NULL,        -- full rendered body
  target_href         VARCHAR(512) NULL,            -- optional deep link ('/contractor/deals/abc')
  channels_sent       VARCHAR(64)  NULL,            -- CSV: 'sms,whatsapp' — for provenance UI
  read_at             DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_recipient_read (recipient_user_id, read_at, created_at),
  INDEX idx_event_time     (event_key, created_at),
  INDEX idx_recipient_time (recipient_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
