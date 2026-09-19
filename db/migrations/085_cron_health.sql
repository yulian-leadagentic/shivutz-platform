-- 085 · R11 follow-up · cron heartbeat table.
--
-- The renewal cron was 404-ing daily for months because 'batch failed'
-- was a bare console.log — nothing tracked "how long has this been
-- failing?" and no admin surface said "your renewal batch hasn't
-- succeeded in N runs." Every prior verification bypassed the HTTP
-- boundary via in-process import, so the fault stayed invisible.
--
-- This table is the loud-failure surface. Each cron writes here after
-- every attempt (via POST /payments/subscriptions/internal/cron-heartbeat).
-- consecutive_failures resets on success; grows on failure. Admin
-- dashboard shows anything > 0 in amber, > 3 in red.
--
-- Small table, one row per cron_name — UPSERT semantics.
-- Idempotent — CREATE TABLE IF NOT EXISTS.

USE payment_db;

CREATE TABLE IF NOT EXISTS cron_health (
  cron_name             VARCHAR(64)  NOT NULL,
  last_run_at           DATETIME     NULL,
  last_ok_at            DATETIME     NULL,
  last_fail_at          DATETIME     NULL,
  last_error            VARCHAR(500) NULL,
  consecutive_failures  INT          NOT NULL DEFAULT 0,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cron_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
