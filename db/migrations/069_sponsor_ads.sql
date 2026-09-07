-- H10 §1 — sponsor ads for inline injection into contractor
-- search results. This is a STANDALONE table (not tied to
-- corporations, marketplace_categories, or subscription tiers).
--
-- Rationale — why not marketplace_categories:
--   marketplace_categories describes CORPORATIONS purchasing slots
--   within the marketplace product. External advertisers (a tool
--   retailer, an insurer, etc.) are not corporations, own no
--   entity in the platform, and don't buy a subscription tier.
--   Repurposing that schema would tangle two different domains
--   under one name — H5's decision. Separate table = clean.
--
-- Scope caveat — this round is DISPLAY LAYER ONLY:
--   * NO price column. Yulian hasn't decided flat-per-category vs
--     CPM, and the choice determines the schema. Adding one now
--     would invalidate the wrong guess later.
--   * NO impression/click event tracking. That's a P0 for
--     charging anyone, but the P0 for a click is billing, and
--     billing is out of scope.
--   * Both are listed as follow-up items on the H10 acceptance.

CREATE TABLE sponsor_ads (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  advertiser_name VARCHAR(120) NOT NULL,

  -- Creative
  headline_he     VARCHAR(120) NOT NULL,
  body_he         VARCHAR(200)     NULL,
  chips_he        JSON             NULL,   -- e.g. ["חיתוך קרמיקה","פלס לייזר"]
  cta_label_he    VARCHAR(40)  NOT NULL,
  -- NULL cta_url = render CTA as a non-interactive <span>, NOT
  -- an <a href="#"> and NOT a dead link. The frontend enforces.
  cta_url         VARCHAR(500)     NULL,
  logo_url        VARCHAR(500)     NULL,
  brand_bg        CHAR(7)          NULL,   -- #RRGGBB
  brand_fg        CHAR(7)          NULL,

  -- Targeting — NULL means "no targeting on this axis", i.e.
  -- everyone. NOT "nobody". The backend applies the same
  -- (col IS NULL OR value IN col) pattern used by the ad-search
  -- soft filter.
  target_professions JSON          NULL,
  target_ad_types    JSON          NULL,
  target_regions     JSON          NULL,

  -- Lifecycle
  active     BOOLEAN   NOT NULL DEFAULT FALSE,   -- new rows never live-fire by accident
  starts_at  DATETIME      NULL,
  ends_at    DATETIME      NULL,
  sort_order INT       NOT NULL DEFAULT 0,
  -- H7 marker — every row the seed writes flips this so a future
  -- prod cleanup can DELETE WHERE is_seed=TRUE safely, without a
  -- manual sweep that risks catching a real advertiser.
  is_seed    BOOLEAN   NOT NULL DEFAULT FALSE,
  created_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_sponsor_active (active, starts_at, ends_at)
);
