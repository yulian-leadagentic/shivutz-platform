-- 030: Foreign-tender flow corrections.
--
--   * Origin country moves to the PROFESSION LINE (a tender can ask
--     for Thai carpenters + Chinese tilers in one go).
--   * Bids quote an ARRIVAL-TO-ISRAEL date instead of "delivery days".
--   * Bids are priced PER LINE as an HOURLY rate (unit_price column
--     repurposed). No whole-bid total.
--   * The contractor selects individual LINES across bids (not whole
--     bids), so bid items carry a `selected` flag.
--   * New admin PUBLISH gate: a freshly-created tender sits in
--     'pending_admin' until the admin approves it for broadcast — it
--     is NOT sent to corps on creation any more.
--
-- Pre-launch: safe to ALTER in place. `region` on foreign_tenders is
-- left in the schema (harmless) but no longer collected in the UI.

USE deal_db;

-- Origin per requested profession.
ALTER TABLE foreign_tender_items
  ADD COLUMN origin_country VARCHAR(8) NULL AFTER profession_type;

-- Corp's promised arrival-to-Israel date (replaces the meaning of
-- delivery_estimate_days, which is left nullable for back-compat).
ALTER TABLE foreign_bids
  ADD COLUMN arrival_date DATE NULL AFTER delivery_estimate_days;

-- Line-level selection by the contractor. `unit_price` is now the
-- HOURLY rate the corp quotes for that profession line.
ALTER TABLE foreign_bid_items
  ADD COLUMN selected TINYINT(1) NOT NULL DEFAULT 0 AFTER unit_price;

-- Note on tender.status: a new 'pending_admin' value is introduced at
-- the application layer (created → pending_admin → open after admin
-- publish). The column is already VARCHAR(20) so no DDL needed; the
-- default stays 'open' in the schema but create_tender now inserts
-- 'pending_admin' explicitly.
