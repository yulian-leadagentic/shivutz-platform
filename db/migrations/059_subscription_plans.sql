-- 059: subscription_plans — admin-editable tier limits
--
-- Six rows (contractor + corp × basic/adv/pro). Admin can PATCH any
-- limit or the trial default. subscription_limits helpers in the
-- payment service read from here at request time so changes go live
-- immediately without a redeploy.
--
-- Nullable limit = "unlimited" (used for pro + for irrelevant columns
-- per side — contractors don't publish ads, so max_active_ads stays
-- NULL for them; corps don't have per-search reveal quotas today, so
-- max_reveals_per_month stays NULL for them).

USE payment_db;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                     CHAR(36)     PRIMARY KEY,
  entity_type            ENUM('contractor','corporation') NOT NULL,
  tier                   ENUM('basic','advanced','pro')   NOT NULL,
  max_users              INT          NULL,   -- team-member seats. NULL = unlimited.
  max_reveals_per_month  INT          NULL,   -- contractor-side; NULL = unlimited.
  max_active_ads         INT          NULL,   -- corp-side; NULL = unlimited.
  can_boost              BOOLEAN      NOT NULL DEFAULT FALSE,
  trial_days_default     INT          NOT NULL DEFAULT 14,
  cardcom_plan_code      VARCHAR(64)  NULL,
  updated_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_entity_tier (entity_type, tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO subscription_plans
  (id, entity_type, tier, max_users, max_reveals_per_month, max_active_ads, can_boost, trial_days_default)
VALUES
  (UUID(), 'contractor',  'basic',    1,    10, NULL, FALSE, 14),
  (UUID(), 'contractor',  'advanced', 3,    40, NULL, FALSE, 14),
  (UUID(), 'contractor',  'pro',      10,  120, NULL, TRUE,  14),
  (UUID(), 'corporation', 'basic',    2,  NULL,    3, FALSE, 14),
  (UUID(), 'corporation', 'advanced', 5,  NULL,   15, TRUE,  14),
  (UUID(), 'corporation', 'pro',      20, NULL, NULL, TRUE,  14)
ON DUPLICATE KEY UPDATE max_users = VALUES(max_users);
