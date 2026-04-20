-- =====================================================================
-- 005_payment_schema.sql — Payment Module Foundation
-- =====================================================================

CREATE DATABASE IF NOT EXISTS payment_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE payment_db;

-- payment_methods: stores Cardcom tokens (never raw card numbers)
CREATE TABLE IF NOT EXISTS payment_methods (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  entity_type       VARCHAR(20)  NOT NULL,  -- 'contractor' | 'corporation'
  entity_id         CHAR(36)     NOT NULL,
  provider          VARCHAR(20)  NOT NULL DEFAULT 'cardcom',
  provider_token    TEXT         NOT NULL,  -- AES-256-GCM encrypted
  last_4_digits     VARCHAR(4)   NOT NULL,
  card_brand        VARCHAR(20)  NULL,      -- visa | mastercard | amex | isracard
  card_holder_name  VARCHAR(200) NULL,
  expiry_month      TINYINT      NOT NULL,
  expiry_year       SMALLINT     NOT NULL,
  is_default        BOOLEAN      NOT NULL DEFAULT TRUE,
  status            VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at      DATETIME     NULL,
  deleted_at        DATETIME     NULL,
  PRIMARY KEY (id),
  INDEX idx_pm_entity  (entity_type, entity_id),
  INDEX idx_pm_status  (status),
  INDEX idx_pm_expiry  (expiry_year, expiry_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- payment_transactions: full audit log — NEVER delete rows
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                          CHAR(36)      NOT NULL DEFAULT (UUID()),
  deal_id                     CHAR(36)      NOT NULL,
  charged_entity_type         VARCHAR(20)   NOT NULL DEFAULT 'corporation',
  charged_entity_id           CHAR(36)      NOT NULL,
  payment_method_id           CHAR(36)      NOT NULL,
  base_amount                 DECIMAL(10,2) NOT NULL,
  vat_rate                    DECIMAL(5,4)  NOT NULL,
  vat_amount                  DECIMAL(10,2) NOT NULL,
  total_amount                DECIMAL(10,2) NOT NULL,
  currency                    VARCHAR(3)    NOT NULL DEFAULT 'ILS',
  status                      VARCHAR(30)   NOT NULL DEFAULT 'pending_charge',
  grace_period_expires_at     DATETIME      NOT NULL,
  approved_at                 DATETIME      NULL,
  approved_by_user_id         CHAR(36)      NULL,
  cancelled_at                DATETIME      NULL,
  cancelled_by_user_id        CHAR(36)      NULL,
  cancellation_reason         TEXT          NULL,
  charged_at                  DATETIME      NULL,
  provider_transaction_id     TEXT          NULL,
  provider_response_code      VARCHAR(10)   NULL,
  provider_response_raw       JSON          NULL,
  invoice_number              VARCHAR(100)  NULL,
  invoice_url                 TEXT          NULL,
  invoice_issued_at           DATETIME      NULL,
  retry_count                 TINYINT       NOT NULL DEFAULT 0,
  last_retry_at               DATETIME      NULL,
  failure_reason              TEXT          NULL,
  admin_handled_at            DATETIME      NULL,
  admin_handled_by_user_id    CHAR(36)      NULL,
  admin_resolution_notes      TEXT          NULL,
  idempotency_key             VARCHAR(100)  NOT NULL,
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_idempotency (idempotency_key),
  INDEX idx_pt_deal    (deal_id),
  INDEX idx_pt_status  (status),
  INDEX idx_pt_grace   (grace_period_expires_at),
  INDEX idx_pt_entity  (charged_entity_type, charged_entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- system_settings: admin-managed key-value config
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key           VARCHAR(100) NOT NULL,
  setting_value         TEXT         NOT NULL,
  value_type            VARCHAR(20)  NOT NULL DEFAULT 'string',
  description           TEXT         NULL,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_user_id    CHAR(36)     NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default settings
INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description) VALUES
  ('vat_rate',           '0.18',       'number',  'אחוז מע״מ כשבר עשרוני (0.18 = 18%)'),
  ('grace_period_days',  '7',          'number',  'מספר ימי grace period בין התחייבות לחיוב אוטומטי'),
  ('max_charge_retries', '3',          'number',  'מקסימום retries לפני charge_failed_final'),
  ('retry_delays_hours', '[24,48,72]', 'json',    'מרווחי שעות בין retries'),
  ('cardcom_terminal',   '1000',       'string',  'מספר מסוף קארדקום');

-- ── ALTER existing tables (idempotent via IGNORE on duplicate column errors) ──

USE org_db;

-- corporations: add payment commission columns (ignore if already exist)
ALTER TABLE corporations ADD COLUMN commission_per_worker_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE corporations ADD COLUMN commission_currency          VARCHAR(3)    NOT NULL DEFAULT 'ILS';
ALTER TABLE corporations ADD COLUMN commission_set_by_user_id    CHAR(36)      NULL;
ALTER TABLE corporations ADD COLUMN commission_set_at            DATETIME      NULL;

-- contractors: add payment commission columns
ALTER TABLE contractors ADD COLUMN commission_per_worker_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE contractors ADD COLUMN commission_currency          VARCHAR(3)    NOT NULL DEFAULT 'ILS';
ALTER TABLE contractors ADD COLUMN commission_set_by_user_id    CHAR(36)      NULL;
ALTER TABLE contractors ADD COLUMN commission_set_at            DATETIME      NULL;
ALTER TABLE contractors ADD COLUMN billing_enabled              BOOLEAN       NOT NULL DEFAULT FALSE;

USE deal_db;

-- deals: add payment tracking columns
ALTER TABLE deals ADD COLUMN corp_committed_at              DATETIME      NULL;
ALTER TABLE deals ADD COLUMN corp_committed_by_user_id      CHAR(36)      NULL;
ALTER TABLE deals ADD COLUMN payment_status                 VARCHAR(30)   NULL;
ALTER TABLE deals ADD COLUMN active_payment_transaction_id  CHAR(36)      NULL;
ALTER TABLE deals ADD COLUMN payment_amount_estimated       DECIMAL(10,2) NULL;
ALTER TABLE deals ADD COLUMN payment_hold_by_admin          BOOLEAN       NOT NULL DEFAULT FALSE;
ALTER TABLE deals ADD COLUMN payment_hold_reason            TEXT          NULL;
ALTER TABLE deals ADD COLUMN payment_hold_set_by_user_id    CHAR(36)      NULL;
ALTER TABLE deals ADD COLUMN payment_hold_set_at            DATETIME      NULL;
