-- 060: extend subscription_plans with per-ad lifetime cap + monthly price
--
-- Corp tiers were previously (basic 2u / 3 ads · advanced 5u / 15 ads
-- · pro 20u / ∞). User feedback: corp tiers should be 3/6/12 users +
-- 3/6/12 concurrent ads + 30/90/∞ day ad lifetime + ₪80/140/170.
--
-- Contractor tiers keep their 1/3/10 users + 10/40/120 reveals shape;
-- contractor prices left NULL (admin can set later).
--
-- Prices are stored as integer NIS/month for simplicity — Cardcom
-- recurring flow will read this when auto-renewing.

USE payment_db;

ALTER TABLE subscription_plans
  ADD COLUMN max_ad_lifetime_days INT NULL AFTER max_active_ads,
  ADD COLUMN monthly_price_nis    INT NULL AFTER trial_days_default;

UPDATE subscription_plans SET
  max_users             = 3,
  max_active_ads        = 3,
  max_ad_lifetime_days  = 30,
  monthly_price_nis     = 80,
  can_boost             = FALSE
WHERE entity_type = 'corporation' AND tier = 'basic';

UPDATE subscription_plans SET
  max_users             = 6,
  max_active_ads        = 6,
  max_ad_lifetime_days  = 90,
  monthly_price_nis     = 140,
  can_boost             = TRUE
WHERE entity_type = 'corporation' AND tier = 'advanced';

UPDATE subscription_plans SET
  max_users             = 12,
  max_active_ads        = 12,
  max_ad_lifetime_days  = NULL,   -- unlimited
  monthly_price_nis     = 170,
  can_boost             = TRUE
WHERE entity_type = 'corporation' AND tier = 'pro';
