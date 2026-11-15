-- 103 · R37 4.1.1 · one row for every card page we open at Cardcom
--
-- Until now nothing in the product could save a card: the function that
-- opens Cardcom's page (create_low_profile) had no caller, and the
-- webhook that was meant to store the token took the owner of the card
-- from a value Cardcom echoes back.
--
-- This table is what makes the flow ours. When a logged-in entity asks
-- to add or replace its card, a row is written here BEFORE the browser
-- leaves for Cardcom: whose setup it is, and the id Cardcom gave the
-- page. When the result comes back (the return page, or Cardcom's
-- webhook) we look the page id up here, ask Cardcom what happened
-- (GetLpResult) and store the token for the entity named on this row.
-- Nothing in a callback or a redirect decides whose card it is.
--
--   status   pending     the page was opened, no final result yet
--            completed   a card was saved; payment_method_id says which
--            failed      Cardcom reported a failure; failure_reason says why
--
-- No card number is stored here or anywhere else. The token lives in
-- payment_methods.provider_token, encrypted.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.

USE payment_db;

CREATE TABLE IF NOT EXISTS payment_card_setups (
  id                  CHAR(36)     NOT NULL,
  entity_type         VARCHAR(20)  NOT NULL,
  entity_id           CHAR(36)     NOT NULL,
  low_profile_id      VARCHAR(64)  NOT NULL,
  status              VARCHAR(16)  NOT NULL DEFAULT 'pending',
  payment_method_id   CHAR(36)     NULL,
  failure_reason      VARCHAR(255) NULL,
  is_fake             TINYINT(1)   NOT NULL DEFAULT 0,
  started_by_user_id  CHAR(36)     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at        DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pcs_low_profile (low_profile_id),
  KEY idx_pcs_entity (entity_type, entity_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
