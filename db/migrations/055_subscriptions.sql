-- 052: subscriptions table (pivot/v2 Phase 1)
--
-- Single row per entity (contractor or corporation). New entities get
-- a `trialing` row inserted on first /subscriptions/me — see the lazy-
-- init in services/payment/app/routes/subscriptions.py.
--
-- `cardcom_plan_code` stores OUR internal plan code (CONTRACTOR_BASIC
-- etc.); the actual Cardcom plan ID is held in env vars so the same
-- plan can map to staging vs prod IDs without DB churn.
--
-- Pivot model:
--   trialing       — first 14 days, full access
--   active         — paid, recurring charge succeeding
--   past_due       — last charge failed, grace until next retry
--   cancelled      — user clicked cancel, lives until current_period_end
--   expired        — past current_period_end with no successful charge

USE payment_db;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       CHAR(36)     PRIMARY KEY,
  entity_id                CHAR(36)     NOT NULL,
  entity_type              ENUM('contractor','corporation') NOT NULL,
  tier                     ENUM('basic','advanced','pro')   NOT NULL DEFAULT 'basic',
  cardcom_plan_code        VARCHAR(64)  NULL,
  cardcom_subscription_id  VARCHAR(128) NULL,
  status                   ENUM('trialing','active','past_due','cancelled','expired')
                                        NOT NULL DEFAULT 'trialing',
  trial_ends_at            DATETIME     NULL,
  current_period_end       DATETIME     NULL,
  cancelled_at             DATETIME     NULL,
  created_at               TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_entity (entity_id, entity_type),
  KEY idx_status_period (status, current_period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
