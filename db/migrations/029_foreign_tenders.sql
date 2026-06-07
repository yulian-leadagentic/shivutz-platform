-- 029: Foreign-worker import tenders (מכרז ייבוא עובדים מחו״ל).
--
-- A separate flow from the in-country `deals` model. Key differences:
--   * No matcher runs — the workers aren't in the country yet, so
--     there's nothing to match against. The contractor publishes a
--     tender and corps submit competing bids.
--   * Multi-profession in one tender (15 carpenters + 5 plasterers +
--     10 tilers) via line items.
--   * Partial bids allowed — a corp offers how many of each profession
--     it can supply; the contractor can combine several corps.
--   * Admin-mediated. No credit-card / J5 hold. Payment is arranged
--     off-platform by the admin, who also REVEALS the parties to each
--     other. Until the admin reveals, the contractor sees corps as
--     "תאגיד 1/2/…" and corps see the contractor as "קבלן".
--
-- Lives in deal_db (the deal service owns it; closest conceptual home
-- to contractor↔corp transactions).

USE deal_db;

-- ── Tender header ──────────────────────────────────────────────────
-- One row per "I want to import N foreign workers" request.
CREATE TABLE IF NOT EXISTS foreign_tenders (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  contractor_id    CHAR(36)     NOT NULL,
  title            VARCHAR(200) NULL,             -- optional free label
  origin_country   VARCHAR(8)   NULL,             -- ISO code; whole-tender origin preference
  region           VARCHAR(64)  NULL,             -- where the work is
  target_start_date DATE        NULL,             -- when the contractor needs them on-site
  notes            TEXT         NULL,             -- special requirements, free text
  -- Lifecycle:
  --   open           accepting bids
  --   selecting      contractor is reviewing / has partially selected
  --   awaiting_admin contractor finished selecting, admin must approve+reveal
  --   in_progress    admin approved + revealed; import under way
  --   closed         fulfilled / finished
  --   cancelled      contractor pulled it
  status           VARCHAR(20)  NOT NULL DEFAULT 'open',
  -- Set when the admin approves + reveals identities. NULL = still
  -- double-blind. Drives the masking in the API layer.
  revealed_at      DATETIME     NULL,
  revealed_by_user_id CHAR(36)  NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  cancelled_at     DATETIME     NULL,
  closed_at        DATETIME     NULL,
  KEY idx_ft_contractor (contractor_id, created_at),
  KEY idx_ft_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Tender line items ──────────────────────────────────────────────
-- One row per profession requested within a tender.
CREATE TABLE IF NOT EXISTS foreign_tender_items (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  tender_id        CHAR(36)     NOT NULL,
  profession_type  VARCHAR(64)  NOT NULL,
  quantity         INT          NOT NULL,
  min_experience   INT          NOT NULL DEFAULT 0,   -- months
  notes            VARCHAR(255) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fti_tender (tender_id),
  CONSTRAINT fk_fti_tender FOREIGN KEY (tender_id)
    REFERENCES foreign_tenders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Bids ───────────────────────────────────────────────────────────
-- One row per corp offer against a tender. A corp submits at most one
-- active bid per tender (enforced in the API, not a unique key, so a
-- corp can withdraw + re-submit).
CREATE TABLE IF NOT EXISTS foreign_bids (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  tender_id        CHAR(36)     NOT NULL,
  corporation_id   CHAR(36)     NOT NULL,
  total_price      DECIMAL(12,2) NULL,             -- corp's quoted total (NIS)
  currency         VARCHAR(3)   NOT NULL DEFAULT 'ILS',
  delivery_estimate_days INT    NULL,              -- "workers on-site within N days"
  notes            TEXT         NULL,
  -- Lifecycle:
  --   submitted   corp's live offer, awaiting contractor review
  --   selected    contractor picked this bid (may be one of several)
  --   confirmed   admin approved + revealed; this bid is going ahead
  --   rejected    contractor declined / another bid won the line
  --   withdrawn   corp pulled the bid before selection
  status           VARCHAR(20)  NOT NULL DEFAULT 'submitted',
  submitted_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  selected_at      DATETIME     NULL,
  confirmed_at     DATETIME     NULL,
  created_by_user_id CHAR(36)   NULL,
  KEY idx_fb_tender (tender_id),
  KEY idx_fb_corp (corporation_id),
  KEY idx_fb_status (status),
  CONSTRAINT fk_fb_tender FOREIGN KEY (tender_id)
    REFERENCES foreign_tenders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Bid line items ─────────────────────────────────────────────────
-- How many of each requested profession this corp can supply.
-- Partial fulfilment = quantity_offered < the tender item's quantity.
CREATE TABLE IF NOT EXISTS foreign_bid_items (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  bid_id           CHAR(36)     NOT NULL,
  tender_item_id   CHAR(36)     NOT NULL,
  profession_type  VARCHAR(64)  NOT NULL,          -- denormalised for easy display
  quantity_offered INT          NOT NULL,
  unit_price       DECIMAL(12,2) NULL,             -- optional per-worker price
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fbi_bid (bid_id),
  KEY idx_fbi_item (tender_item_id),
  CONSTRAINT fk_fbi_bid FOREIGN KEY (bid_id)
    REFERENCES foreign_bids(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
