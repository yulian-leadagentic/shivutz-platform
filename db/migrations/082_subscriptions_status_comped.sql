-- 082 · R9 §5 · subscriptions.status add `comped`
--
-- Yulian 18.09: launching without Cardcom means we hand out subscriptions
-- for free at admin discretion. A comped subscription must:
--   - not be swept by the monthly renewal batch (its query already only
--     looks at 'active' and 'past_due', so we're safe once the value
--     exists — see subscriptions.py:678).
--   - be treated by every entitlement gate exactly like 'active'.
--
-- The change is additive: `comped` appended to the ENUM after 'expired'
-- so existing rows and existing gates keep their current mapping. Never
-- reorder or remove values — some places in the payment service store
-- the status as a plain string and would silently mis-map.
--
-- Idempotent — reads the current column type and skips if 'comped' is
-- already in the SET.

USE payment_db;

SET @has_comped := (
  SELECT LOCATE('''comped''', COLUMN_TYPE)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='payment_db'
     AND TABLE_NAME='subscriptions'
     AND COLUMN_NAME='status'
);

SET @ddl := IF(
  @has_comped = 0,
  'ALTER TABLE subscriptions
     MODIFY COLUMN status ENUM(''trialing'',''active'',''past_due'',''cancelled'',''expired'',''comped'')
       NOT NULL DEFAULT ''trialing''
       COMMENT ''trialing/active/past_due/cancelled/expired = paid lifecycle. comped = R9 admin-granted, never billed, never expires.''',
  'SELECT ''subscriptions.status already has comped''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
