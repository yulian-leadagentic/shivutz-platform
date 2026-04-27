-- =====================================================================
-- 010_payment_preauth_nullable_pm.sql — allow NULL payment_method_id
-- =====================================================================
--
-- Pattern A (J5 pre-auth) doesn't use a persistent payment_method row —
-- each J5 carries its own card info at Cardcom. payment_method_id still
-- records which saved method was used when we're on the legacy Pattern B
-- path, so it stays on the table but becomes NULL-able.
--
-- Apply once:
--   docker-compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD \
--     payment_db < db/migrations/010_payment_preauth_nullable_pm.sql
-- =====================================================================

USE payment_db;

ALTER TABLE payment_transactions
  MODIFY COLUMN payment_method_id CHAR(36) NULL
  COMMENT 'NULL for Pattern-A (J5) transactions — auth is tied to auth_provider_deal_id instead';
