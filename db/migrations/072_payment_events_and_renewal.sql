-- 072: L5 — payment events (idempotency) + renewal state on subscriptions
--
-- Two things enable §5 (webhook idempotency) + §6 (renewal batch):
--
-- (A) payment_events — one row per Cardcom transaction attempt
--     (charge / refund). UNIQUE on provider_transaction_id gives us
--     the idempotency guarantee for both the recurring webhook (which
--     Cardcom RE-DELIVERS on retries by design) and the renewal batch
--     (which can be re-run without double-charging). Cardcom's
--     TranzactionId / InternalDealNumber is unique per real charge;
--     fake-mode charges use a synthetic FAKE-<uuid> to keep the same
--     dedup path working end-to-end in staging.
--
-- (B) subscriptions gains three columns for the failure chain in §7:
--     last_renewal_attempt_at — latched BEFORE the Cardcom call so
--       two parallel batches can't both fire (LATCH pattern).
--     rebill_attempts         — 0/1/2/3 counter driving the retry
--       schedule (§7 rules: fail → +3d → +3d → +3d → expired).
--     next_attempt_at         — when the next batch pass should try
--       again. NULL after success or terminal expiry; the batch's
--       WHERE clause uses this to pick up only rows that are due.
--
-- No auto_renew column — a cancelled sub has status='cancelled', and
-- the batch's WHERE clause already excludes non-'active' rows.

USE payment_db;

CREATE TABLE IF NOT EXISTS payment_events (
  id                       CHAR(36)      NOT NULL PRIMARY KEY,
  entity_id                CHAR(36)      NOT NULL,
  entity_type              VARCHAR(16)   NOT NULL,
  -- Kind is what the event RECORDS, not what triggered it:
  --   'subscription_start'  — first paid activation of a tier
  --   'renewal'             — monthly billing (batch or webhook)
  --   'refund'              — future
  kind                     VARCHAR(32)   NOT NULL,
  -- 'ok' = Cardcom returned ResponseCode 0/000; 'declined' = a
  -- CardcomDeclinedError (card / balance); 'error' = network / 5xx.
  outcome                  VARCHAR(16)   NOT NULL,
  amount_nis               INT           NULL,
  -- The dedup key. Cardcom's TranzactionId is int-shaped but comes
  -- across as a string on the wire, so we keep it typed as such.
  -- UNIQUE means a webhook retry / batch re-run for the SAME real
  -- charge silently no-ops instead of double-recording.
  provider_transaction_id  VARCHAR(64)   NULL,
  response_code            VARCHAR(16)   NULL,
  invoice_number           VARCHAR(64)   NULL,
  invoice_url              VARCHAR(512)  NULL,
  -- Full Cardcom response JSON (or short error text) for post-hoc
  -- support. Never contains the card token — see cardcom.py which
  -- redacts before this row is written.
  raw                      TEXT          NULL,
  created_at               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_payment_events_txn (provider_transaction_id),
  INDEX idx_payment_events_entity (entity_id, entity_type, created_at),
  INDEX idx_payment_events_kind   (kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE subscriptions
  ADD COLUMN last_renewal_attempt_at TIMESTAMP NULL AFTER current_period_end,
  ADD COLUMN rebill_attempts         TINYINT   NOT NULL DEFAULT 0 AFTER last_renewal_attempt_at,
  ADD COLUMN next_attempt_at         TIMESTAMP NULL AFTER rebill_attempts,
  ADD INDEX idx_subs_renewal_due (status, next_attempt_at);
