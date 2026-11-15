-- 104 · R37 4.1.2 · a row for every charge of a marketplace plan
--
-- A marketplace plan (org_db.marketplace_subscriptions) was never paid
-- for: during the launch promo it is free, and afterwards the purchase
-- answered 503. This table is what a paid plan hangs on.
--
-- One row is one attempt to take money for one plan period:
--
--   kind      purchase   a provider buys a plan in a category
--             renewal    the daily batch renews a paid plan
--
--   status    pending        written by user-org once the purchase passed
--                            its checks. Nothing has been charged.
--             charging       the payment service has taken the row and is
--                            talking to Cardcom. A row that STAYS here is
--                            one whose outcome is not known; look it up
--                            at Cardcom before doing anything about it.
--             charged        Cardcom took the money. subscription_id is
--                            the plan that was activated or extended.
--             declined       Cardcom refused. Nothing was activated.
--             error          Cardcom was not reached. Nothing was
--                            activated; whether money moved is not known.
--             not_attempted  no card on file, or this environment cannot
--                            charge. Cardcom was not called.
--             refunded       an admin returned the charge (4.1.5).
--
-- The row's id is also the id sent to Cardcom with the charge
-- (ExternalUniqTranId), so the same row can never be charged twice.
--
-- The amount is the tier row's price at the moment of the charge, VAT
-- inside it, the way the contractor plans are charged. The tier's size
-- and length are copied here so that what was paid for can be read
-- without the tier row, which an admin may edit later.
--
-- This is also where a refund is recorded, and what links a plan to its
-- payment_events rows (payment_event_id, refund_event_id).
--
-- No card data: payment_method_id points at the card row that was used.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.

USE payment_db;

CREATE TABLE IF NOT EXISTS marketplace_charges (
  id                       CHAR(36)      NOT NULL,
  kind                     VARCHAR(16)   NOT NULL,
  entity_type              VARCHAR(20)   NOT NULL,
  entity_id                CHAR(36)      NOT NULL,
  subscription_id          CHAR(36)      NULL,
  tier_id                  CHAR(36)      NOT NULL,
  category_code            VARCHAR(50)   NOT NULL,
  slot_count               SMALLINT      NOT NULL,
  duration_days            SMALLINT      NOT NULL,
  amount_nis               DECIMAL(10,2) NOT NULL,
  auto_renew               TINYINT(1)    NOT NULL DEFAULT 1,
  status                   VARCHAR(16)   NOT NULL DEFAULT 'pending',
  is_fake                  TINYINT(1)    NOT NULL DEFAULT 0,
  payment_method_id        CHAR(36)      NULL,
  payment_event_id         CHAR(36)      NULL,
  provider_transaction_id  VARCHAR(64)   NULL,
  invoice_number           VARCHAR(64)   NULL,
  invoice_url              VARCHAR(512)  NULL,
  failure_reason           VARCHAR(255)  NULL,
  refunded_at              DATETIME      NULL,
  refunded_by_user_id      CHAR(36)      NULL,
  refund_event_id          CHAR(36)      NULL,
  refund_transaction_id    VARCHAR(64)   NULL,
  created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mc_entity (entity_type, entity_id, created_at),
  KEY idx_mc_subscription (subscription_id),
  KEY idx_mc_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
