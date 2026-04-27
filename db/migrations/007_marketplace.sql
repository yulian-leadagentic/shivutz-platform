-- ============================================================
-- Migration 007 — Marketplace Listings + Leads
-- Database: org_db
-- ============================================================
USE org_db;

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()),
  corporation_id  CHAR(36)       NOT NULL,
  category        VARCHAR(50)    NOT NULL,
  subcategory     VARCHAR(50)    NULL,
  title           VARCHAR(300)   NOT NULL,
  description     TEXT           NULL,
  city            VARCHAR(100)   NULL,
  region          VARCHAR(50)    NULL,
  price           DECIMAL(10,2)  NULL,
  price_unit      VARCHAR(30)    NULL,
  capacity        INT            NULL,
  is_furnished    BOOLEAN        NULL,
  available_from  DATE           NULL,
  status          VARCHAR(20)    NOT NULL DEFAULT 'active',
  contact_phone   VARCHAR(30)    NULL,
  contact_name    VARCHAR(200)   NULL,
  images_json     JSON           NULL,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME       NULL,
  PRIMARY KEY (id),
  INDEX idx_ml_corp     (corporation_id),
  INDEX idx_ml_status   (status),
  INDEX idx_ml_category (category, status),
  INDEX idx_ml_region   (region, status),
  INDEX idx_ml_deleted  (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  full_name   VARCHAR(255) NOT NULL,
  phone       VARCHAR(30)  NOT NULL,
  org_type    ENUM('contractor','corporation') NOT NULL,
  source      VARCHAR(100) NULL DEFAULT 'landing_page',
  notes       TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_leads_phone   (phone),
  INDEX idx_leads_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
