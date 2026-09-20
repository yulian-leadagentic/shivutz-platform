-- 089: R10 §6 · one subscription_plans row for service_provider
--
-- 077 already extended `subscription_plans.entity_type` ENUM to
-- include 'service_provider' (077:215-224 · idempotent). What's
-- missing is any DATA — subscription_limits.py hits _FALLBACK for
-- provider because no row exists, and providers.py:15 documents
-- "No `marketplace_subscriptions` row is created here" (R10 §0/§6:
-- provider is currently invisible to R4's seat-gate mechanism).
--
-- One tier to start, per R10 §6 + decisions doc §2:
--
--   entity_type            = 'service_provider'
--   tier                   = 'basic'
--   monthly_price_nis      = 0
--       Base account is free forever for providers. What they pay
--       for is marketplace ad inventory via
--       marketplace_subscription_tiers (021), not their user seat.
--   included_users         = 5
--       The seat baseline Yulian confirmed. Real-estate agencies
--       are the >5-user segment we care about (§6 opening quote).
--   extra_user_price_nis   = 50
--       ₪50 · lower than contractor's ₪80. Providers skew smaller.
--       Decision-doc §2: value locked; do NOT hardcode in code —
--       admin can raise via /admin/subscription-plans without a
--       redeploy.
--   max_users              = NULL
--       No hard cap once seat billing is active. Consistent with
--       contractor 'pro' (071 UPDATE for pro).
--   max_reveals_per_month  = NULL
--       Providers don't consume worker contact reveals — they are
--       the sellers, not the recruiters.
--   max_active_ads         = NULL
--       Ad quota is per-category via marketplace_subscription_tiers.
--       Nulling this so R4-style "max_active_ads" isn't accidentally
--       enforced on providers.
--   max_ad_lifetime_days   = NULL
--       Same: lifetime lives on the marketplace_subscription_tier
--       the provider bought (021: `duration_days`).
--   can_boost              = FALSE
--       Sponsor-ad pricing is R6 territory (065/069) and Yulian's
--       Nov decision. Leave off until R6 wires that up.
--   trial_days_default     = 0
--       No trial. The whole plan is free forever.
--   cardcom_plan_code      = NULL
--       No Cardcom subscription plan — nothing recurring to charge.
--
-- 🔴 Yulian's decision-doc §2 rule: this plan's extra_user_price_nis
-- (50) is the ONLY source of truth. subscription_limits.py's
-- _FALLBACK gets a matching entry in the same commit so a fresh DB
-- (row missing) still sees ₪50, but the DB row wins on every read.

USE payment_db;

INSERT INTO subscription_plans
  (id, entity_type, tier,
   max_users, included_users, extra_user_price_nis,
   max_reveals_per_month, max_active_ads, max_ad_lifetime_days,
   monthly_price_nis, can_boost, trial_days_default, cardcom_plan_code)
VALUES
  (UUID(), 'service_provider', 'basic',
   NULL, 5, 50,
   NULL, NULL, NULL,
   0, FALSE, 0, NULL)
ON DUPLICATE KEY UPDATE
  included_users       = VALUES(included_users),
  extra_user_price_nis = VALUES(extra_user_price_nis),
  monthly_price_nis    = VALUES(monthly_price_nis);
