-- 043: רשימת קבלני כוח אדם בעלי היתר להעסיק עובדים זרים בענף הבניין
--
-- The "official manpower-corps list" published by רשות האוכלוסין וההגירה
-- (population & immigration authority). Admin uploads the official PDF
-- once a year; corps whose business_number appears in the list are
-- auto-promoted to tier_2 on registration with method='gov_list_match'.
-- Corps NOT in the list still need admin manual approval.
--
-- Schema is "snapshot per year" — re-uploading the same year wipes &
-- replaces all rows for that year. The 2027 file lands alongside the
-- 2026 file so we can show a "התאגיד לא מופיע ברשימה העדכנית" warning
-- on profiles whose source_year < the latest year on file.
--
-- Migration also adds the corp-side columns we need to:
--   * remember which year's list matched a given corp
--   * carry extra phones (the gov PDF often has 2 numbers per cell —
--     mobile + landline, or two mobile lines for a busy office)

USE org_db;

CREATE TABLE IF NOT EXISTS gov_corporations_registry (
  id               CHAR(36)     NOT NULL,
  source_year      SMALLINT     NOT NULL
    COMMENT 'Year on the file. Currently 2026; refreshed yearly.',
  serial_no        SMALLINT     NULL
    COMMENT 'מס"ד column from the PDF, for cross-reference with the source row.',
  business_number  CHAR(9)      NULL
    COMMENT 'Match key. NULL for rows that came without a parseable ח.פ — kept for audit but never auto-matches.',
  company_name_he  VARCHAR(200) NULL,
  address          VARCHAR(300) NULL,
  phone_mobile_1   VARCHAR(20)  NULL,
  phone_mobile_2   VARCHAR(20)  NULL,
  phone_landline_1 VARCHAR(20)  NULL,
  phone_landline_2 VARCHAR(20)  NULL,
  raw_row          JSON         NULL
    COMMENT 'Original parsed row for audit / debugging when a match looks wrong.',
  imported_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_by      CHAR(36)     NULL
    COMMENT 'Admin user_id who uploaded the file.',
  PRIMARY KEY (id),
  INDEX idx_year_bn (source_year, business_number),
  INDEX idx_bn      (business_number),
  INDEX idx_year    (source_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- corporations.gov_registry_source_year — which year's list this corp
-- was last matched against. NULL = never matched (manual approval lane).
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='org_db' AND TABLE_NAME='corporations'
    AND COLUMN_NAME='gov_registry_source_year'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE corporations
     ADD COLUMN gov_registry_source_year SMALLINT NULL
       COMMENT ''Year of the רשות האוכלוסין list this corp was matched against. NULL = never matched.''
       AFTER verification_method,
     ADD COLUMN gov_registry_matched_at DATETIME NULL
       COMMENT ''When the match happened (registration or later upload re-match).''
       AFTER gov_registry_source_year',
  'SELECT ''gov_registry_source_year already exists'' AS noop');
PREPARE s1 FROM @ddl; EXECUTE s1; DEALLOCATE PREPARE s1;

-- Extra phone columns — the gov PDF often packs 2 phones per cell
-- (one mobile + one landline, or two mobile lines). Surface them on
-- the corp row so the profile can show "טלפון משרד" alongside
-- contact_phone (which holds the primary mobile).
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA='org_db' AND TABLE_NAME='corporations'
    AND COLUMN_NAME='phone_landline'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE corporations
     ADD COLUMN phone_landline           VARCHAR(20) NULL COMMENT ''Office landline. Editable by corp.''           AFTER contact_phone,
     ADD COLUMN phone_landline_secondary VARCHAR(20) NULL COMMENT ''Second landline if the gov row had one.''      AFTER phone_landline,
     ADD COLUMN phone_mobile_secondary   VARCHAR(20) NULL COMMENT ''Second mobile if the gov row had one.''        AFTER phone_landline_secondary',
  'SELECT ''phone_landline already exists'' AS noop');
PREPARE s2 FROM @ddl; EXECUTE s2; DEALLOCATE PREPARE s2;

-- Extend verification_method ENUM so 'gov_list_match' is a first-class
-- value (same pattern as 042 did for 'kablan_match'). Idempotent —
-- MODIFY against the same ENUM is a no-op.
ALTER TABLE corporations
  MODIFY COLUMN verification_method
    ENUM('email','sms','manual','none','kablan_match','gov_list_match') NULL
    COMMENT 'How tier_2 was reached. gov_list_match = corp''s ח.פ found in רשות האוכלוסין list.';
