-- 073: L9 §2 — payment_events.is_fake column + real-charge index
--
-- Today the only signal that a payment_events row was written under
-- PAYMENT_FAKE_MODE=1 lives inside the `raw` TEXT blob as
-- {"fake": true, "reason": "PAYMENT_FAKE_MODE=1"} (see cardcom.py's
-- charge_token fake path). That's not a filterable column — reports,
-- exports and Cardcom reconciliation would need LIKE '%fake%' on a
-- blob, which is brittle and slow.
--
-- Rules for future callers (record_event in payment_events.py):
--   * is_fake MUST be written from PAYMENT_FAKE_MODE at call time —
--     not derived from a FAKE- prefix on provider_transaction_id, and
--     not derived from raw["fake"]. The service state is the source
--     of truth for what happened, not the message shape.
--   * NULL provider_transaction_id (network-error rows) is NOT fake —
--     those are real attempts that failed. Leave is_fake=FALSE.
--
-- The composite index (is_fake, created_at) is the query shape the
-- billing reports use: "real charges in the last N days".

USE payment_db;

ALTER TABLE payment_events
  ADD COLUMN is_fake BOOLEAN NOT NULL DEFAULT FALSE AFTER kind;

CREATE INDEX idx_payment_events_real
  ON payment_events (is_fake, created_at);
