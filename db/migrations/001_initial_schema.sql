-- =============================================================
-- Shivutz Platform — Initial Schema
-- MySQL 8.0 | All schemas created here on first boot
-- =============================================================
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- 1. AUTH DB
-- ─────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS auth_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE auth_db;

CREATE TABLE IF NOT EXISTS users (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  email            VARCHAR(255) NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  role             ENUM('admin','contractor','corporation','staff') NOT NULL,
  org_id           CHAR(36)     NULL,
  org_type         ENUM('contractor','corporation') NULL,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  email_verified_at DATETIME    NULL,
  last_login_at    DATETIME     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at       DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email (email),
  INDEX idx_role (role),
  INDEX idx_org_id (org_id),
  INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id      CHAR(36)     NOT NULL,
  token_hash   VARCHAR(255) NOT NULL,
  expires_at   DATETIME     NOT NULL,
  revoked_at   DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_user_id (user_id),
  INDEX idx_token_hash (token_hash),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─────────────────────────────────────────────────────────────
-- 2. ORG DB
-- ─────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS org_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE org_db;

CREATE TABLE IF NOT EXISTS contractors (
  id                    CHAR(36)      NOT NULL DEFAULT (UUID()),
  user_owner_id         CHAR(36)      NOT NULL,
  company_name          VARCHAR(255)  NOT NULL,
  company_name_he       VARCHAR(255)  NOT NULL,
  business_number       VARCHAR(50)   NOT NULL,
  classification        ENUM('small','medium','large','enterprise') NOT NULL,
  operating_regions     JSON          NOT NULL DEFAULT ('[]'),
  industry_type_ids     JSON          NOT NULL DEFAULT ('[]'),
  contact_name          VARCHAR(255)  NOT NULL,
  contact_phone         VARCHAR(20)   NOT NULL,
  contact_email         VARCHAR(255)  NOT NULL,
  approval_status       ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
  approved_by_user_id   CHAR(36)      NULL,
  approved_at           DATETIME      NULL,
  rejection_reason      TEXT          NULL,
  approval_sla_deadline DATETIME      NULL,
  logo_url              VARCHAR(500)  NULL,
  notes                 TEXT          NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            DATETIME      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_business_number (business_number),
  INDEX idx_approval_status (approval_status),
  INDEX idx_sla_deadline (approval_sla_deadline),
  INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS corporations (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_owner_id           CHAR(36)     NOT NULL,
  company_name            VARCHAR(255) NOT NULL,
  company_name_he         VARCHAR(255) NULL,
  business_number         VARCHAR(100) NOT NULL,
  countries_of_origin     JSON         NOT NULL DEFAULT ('[]'),
  minimum_contract_months TINYINT UNSIGNED NOT NULL DEFAULT 3,
  contact_name            VARCHAR(255) NOT NULL,
  contact_phone           VARCHAR(20)  NOT NULL,
  contact_email           VARCHAR(255) NOT NULL,
  approval_status         ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
  approved_by_user_id     CHAR(36)     NULL,
  approved_at             DATETIME     NULL,
  rejection_reason        TEXT         NULL,
  approval_sla_deadline   DATETIME     NULL,
  logo_url                VARCHAR(500) NULL,
  notes                   TEXT         NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at              DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_business_number (business_number),
  INDEX idx_approval_status (approval_status),
  INDEX idx_sla_deadline (approval_sla_deadline),
  INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_users (
  id          CHAR(36)  NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)  NOT NULL,
  org_id      CHAR(36)  NOT NULL,
  org_type    ENUM('contractor','corporation') NOT NULL,
  role        ENUM('owner','manager','staff')  NOT NULL DEFAULT 'staff',
  invited_by  CHAR(36)  NULL,
  invited_at  DATETIME  NULL,
  joined_at   DATETIME  NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  DATETIME  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_id (user_id),
  INDEX idx_org_id (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
  id          CHAR(36)  NOT NULL DEFAULT (UUID()),
  org_id      CHAR(36)  NOT NULL,
  org_type    ENUM('contractor','corporation') NOT NULL,
  tier        ENUM('free','basic','pro','enterprise') NOT NULL DEFAULT 'free',
  status      ENUM('active','cancelled','expired') NOT NULL DEFAULT 'active',
  started_at  DATETIME  NOT NULL,
  expires_at  DATETIME  NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_org_id (org_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─────────────────────────────────────────────────────────────
-- 3. WORKER DB
-- ─────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS worker_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE worker_db;

CREATE TABLE IF NOT EXISTS profession_types (
  code        VARCHAR(50)  NOT NULL,
  name_he     VARCHAR(100) NOT NULL,
  name_en     VARCHAR(100) NOT NULL,
  category    VARCHAR(50)  NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS origin_countries (
  code        CHAR(2)      NOT NULL,
  name_he     VARCHAR(100) NOT NULL,
  name_en     VARCHAR(100) NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regions (
  code        VARCHAR(50)  NOT NULL,
  name_he     VARCHAR(100) NOT NULL,
  name_en     VARCHAR(100) NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workers (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  corporation_id    CHAR(36)     NOT NULL,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  profession_type   VARCHAR(50)  NOT NULL,
  experience_years  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  origin_country    CHAR(2)      NOT NULL,
  languages         JSON         NOT NULL DEFAULT ('[]'),
  visa_type         VARCHAR(50)  NULL,
  visa_number       VARCHAR(100) NULL,
  visa_valid_from   DATE         NULL,
  visa_valid_until  DATE         NULL,
  visa_alert_sent   BOOLEAN      NOT NULL DEFAULT FALSE,
  status            ENUM('available','assigned','on_leave','deactivated') NOT NULL DEFAULT 'available',
  current_deal_id   CHAR(36)     NULL,
  notes             TEXT         NULL,
  extra_fields      JSON         NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at        DATETIME     NULL,
  PRIMARY KEY (id),
  INDEX idx_corporation_id (corporation_id),
  INDEX idx_profession_type (profession_type),
  INDEX idx_status (status),
  INDEX idx_origin_country (origin_country),
  INDEX idx_visa_valid_until (visa_valid_until),
  INDEX idx_deleted_at (deleted_at),
  INDEX idx_match_lookup (corporation_id, profession_type, status, visa_valid_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS worker_availability (
  id               CHAR(36) NOT NULL DEFAULT (UUID()),
  worker_id        CHAR(36) NOT NULL,
  unavailable_from DATE     NOT NULL,
  unavailable_to   DATE     NOT NULL,
  reason           VARCHAR(100) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_worker_id (worker_id),
  INDEX idx_dates (unavailable_from, unavailable_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: professions
INSERT IGNORE INTO profession_types (code, name_he, name_en, category, sort_order) VALUES
  ('flooring',    'ריצוף',       'Flooring',       'construction', 1),
  ('plastering',  'טיח',         'Plastering',      'construction', 2),
  ('scaffolding', 'פיגומים',     'Scaffolding',     'construction', 3),
  ('formwork',    'תפסנות',      'Formwork',        'construction', 4),
  ('skeleton',    'שלד',         'Skeleton/Frame',  'construction', 5),
  ('painting',    'צבע',         'Painting',        'construction', 6),
  ('electricity', 'חשמל',        'Electricity',     'construction', 7),
  ('plumbing',    'אינסטלציה',   'Plumbing',        'construction', 8),
  ('general',     'כללי',        'General Labor',   'construction', 9);

-- Seed: regions
INSERT IGNORE INTO regions (code, name_he, name_en) VALUES
  ('north',      'צפון',     'North'),
  ('center',     'מרכז',     'Center'),
  ('south',      'דרום',     'South'),
  ('jerusalem',  'ירושלים',  'Jerusalem'),
  ('national',   'כל הארץ', 'Nationwide');

-- Seed: countries of origin
INSERT IGNORE INTO origin_countries (code, name_he, name_en) VALUES
  ('RO', 'רומניה',     'Romania'),
  ('UA', 'אוקראינה',   'Ukraine'),
  ('MD', 'מולדובה',    'Moldova'),
  ('LK', 'סרי לנקה',  'Sri Lanka'),
  ('IN', 'הודו',       'India'),
  ('PH', 'פיליפינים',  'Philippines'),
  ('TH', 'תאילנד',    'Thailand'),
  ('CN', 'סין',        'China');


-- ─────────────────────────────────────────────────────────────
-- 4. JOB DB
-- ─────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS job_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE job_db;

CREATE TABLE IF NOT EXISTS job_requests (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  contractor_id    CHAR(36)     NOT NULL,
  project_name     VARCHAR(255) NOT NULL,
  project_name_he  VARCHAR(255) NULL,
  region           VARCHAR(50)  NOT NULL,
  address          VARCHAR(500) NULL,
  project_start    DATE         NOT NULL,
  project_end      DATE         NULL,
  description      TEXT         NULL,
  status           ENUM('draft','open','matched','in_negotiation','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
  industry_type    VARCHAR(50)  NULL,
  created_by       CHAR(36)     NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at       DATETIME     NULL,
  PRIMARY KEY (id),
  INDEX idx_contractor_id (contractor_id),
  INDEX idx_status (status),
  INDEX idx_region (region),
  INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_request_line_items (
  id                   CHAR(36)        NOT NULL DEFAULT (UUID()),
  request_id           CHAR(36)        NOT NULL,
  profession_type      VARCHAR(50)     NOT NULL,
  quantity             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  start_date           DATE            NOT NULL,
  end_date             DATE            NOT NULL,
  min_experience       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  required_languages   JSON            NOT NULL DEFAULT ('[]'),
  origin_preference    JSON            NOT NULL DEFAULT ('[]'),
  special_requirements TEXT            NULL,
  status               ENUM('open','partially_matched','fully_matched','cancelled') NOT NULL DEFAULT 'open',
  created_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_request_id (request_id),
  INDEX idx_profession_type (profession_type),
  INDEX idx_dates (start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_cache (
  request_id    CHAR(36)  NOT NULL,
  result_json   JSON      NOT NULL,
  computed_at   DATETIME  NOT NULL,
  expires_at    DATETIME  NOT NULL,
  PRIMARY KEY (request_id),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─────────────────────────────────────────────────────────────
-- 5. DEAL DB
-- ─────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS deal_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE deal_db;

CREATE TABLE IF NOT EXISTS deals (
  id                           CHAR(36)       NOT NULL DEFAULT (UUID()),
  request_line_item_id         CHAR(36)       NOT NULL,
  contractor_id                CHAR(36)       NOT NULL,
  corporation_id               CHAR(36)       NOT NULL,
  proposed_by                  CHAR(36)       NOT NULL,
  workers_count                TINYINT UNSIGNED NOT NULL,
  agreed_price                 DECIMAL(12,2)  NULL,
  currency                     CHAR(3)        NOT NULL DEFAULT 'ILS',
  status                       ENUM('proposed','counter_proposed','accepted','active','reporting','completed','disputed','cancelled') NOT NULL DEFAULT 'proposed',
  contractor_report_submitted  BOOLEAN        NOT NULL DEFAULT FALSE,
  corporation_report_submitted BOOLEAN        NOT NULL DEFAULT FALSE,
  discrepancy_flag             BOOLEAN        NOT NULL DEFAULT FALSE,
  discrepancy_details          JSON           NULL,
  start_date                   DATE           NULL,
  end_date                     DATE           NULL,
  notes                        TEXT           NULL,
  created_at                   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at                   DATETIME       NULL,
  PRIMARY KEY (id),
  INDEX idx_contractor_id (contractor_id),
  INDEX idx_corporation_id (corporation_id),
  INDEX idx_status (status),
  INDEX idx_discrepancy_flag (discrepancy_flag),
  INDEX idx_request_line_item_id (request_line_item_id),
  INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deal_workers (
  id          CHAR(36)  NOT NULL DEFAULT (UUID()),
  deal_id     CHAR(36)  NOT NULL,
  worker_id   CHAR(36)  NOT NULL,
  assigned_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at  DATETIME  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_deal_worker (deal_id, worker_id),
  INDEX idx_deal_id (deal_id),
  INDEX idx_worker_id (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id              CHAR(36)  NOT NULL DEFAULT (UUID()),
  deal_id         CHAR(36)  NOT NULL,
  sender_user_id  CHAR(36)  NOT NULL,
  sender_role     ENUM('contractor','corporation','admin') NOT NULL,
  content         TEXT      NOT NULL,
  content_type    ENUM('text','system') NOT NULL DEFAULT 'text',
  read_by         JSON      NOT NULL DEFAULT ('[]'),
  created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      DATETIME  NULL,
  PRIMARY KEY (id),
  INDEX idx_deal_created (deal_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deal_reports (
  id               CHAR(36)        NOT NULL DEFAULT (UUID()),
  deal_id          CHAR(36)        NOT NULL,
  reported_by      ENUM('contractor','corporation') NOT NULL,
  reporter_user_id CHAR(36)        NOT NULL,
  actual_workers   TINYINT UNSIGNED NOT NULL,
  actual_start_date DATE           NOT NULL,
  actual_end_date   DATE           NOT NULL,
  actual_days      SMALLINT UNSIGNED NOT NULL,
  notes            TEXT            NULL,
  submitted_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_deal_reporter (deal_id, reported_by),
  INDEX idx_deal_id (deal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commissions (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  deal_id           CHAR(36)      NOT NULL,
  gross_amount      DECIMAL(12,2) NOT NULL,
  commission_rate   DECIMAL(5,4)  NOT NULL,
  commission_amount DECIMAL(12,2) NOT NULL,
  invoice_number    VARCHAR(100)  NULL,
  invoice_date      DATE          NULL,
  invoice_url       VARCHAR(500)  NULL,
  status            ENUM('pending','invoiced','paid','disputed') NOT NULL DEFAULT 'pending',
  notes             TEXT          NULL,
  created_by        CHAR(36)      NOT NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_deal_id (deal_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id            CHAR(36)    NOT NULL DEFAULT (UUID()),
  entity_type   VARCHAR(50) NOT NULL,
  entity_id     CHAR(36)    NOT NULL,
  action        VARCHAR(50) NOT NULL,
  performed_by  CHAR(36)    NOT NULL,
  old_value     JSON        NULL,
  new_value     JSON        NULL,
  ip_address    VARCHAR(45) NULL,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_performed_by (performed_by),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─────────────────────────────────────────────────────────────
-- 6. NOTIF DB
-- ─────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS notif_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE notif_db;

CREATE TABLE IF NOT EXISTS notification_templates (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  event_key        VARCHAR(100) NOT NULL,
  subject_he       VARCHAR(255) NOT NULL,
  subject_en       VARCHAR(255) NOT NULL,
  body_he          TEXT         NOT NULL,
  body_en          TEXT         NOT NULL,
  variables_schema JSON         NULL,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_key (event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_log (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  event_key     VARCHAR(100) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_user_id CHAR(36)  NULL,
  subject       VARCHAR(255) NOT NULL,
  status        ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  sendgrid_id   VARCHAR(255) NULL,
  error_message TEXT         NULL,
  sent_at       DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_event_key (event_key),
  INDEX idx_recipient_user_id (recipient_user_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: notification templates (Hebrew primary)
INSERT IGNORE INTO notification_templates (id, event_key, subject_he, subject_en, body_he, body_en, variables_schema) VALUES
  (UUID(), 'org.registered',         'בקשת הצטרפות חדשה ממתינה לאישור', 'New registration pending approval',   '<p>התקבלה בקשה חדשה מ-{{org_name}}. אנא בדוק ואשר.</p>', '<p>New registration from {{org_name}}. Please review and approve.</p>', '{"org_name":"string"}'),
  (UUID(), 'org.approved',           'חשבונך אושר — ברוך הבא לשיבוץ!',  'Your account has been approved',      '<p>שלום {{contact_name}}, חשבון {{org_name}} אושר בהצלחה.</p>', '<p>Hello {{contact_name}}, your account {{org_name}} has been approved.</p>', '{"contact_name":"string","org_name":"string"}'),
  (UUID(), 'org.rejected',           'בקשת ההצטרפות שלך נדחתה',          'Your registration was not approved',  '<p>שלום {{contact_name}}, בקשת ההצטרפות שלך נדחתה. סיבה: {{reason}}</p>', '<p>Hello {{contact_name}}, your registration was not approved. Reason: {{reason}}</p>', '{"contact_name":"string","reason":"string"}'),
  (UUID(), 'org.sla.warning',        'אזהרה: בקשת אישור ממתינה מעל 40 שעות', 'Approval SLA warning',           '<p>בקשת אישור עבור {{org_name}} ממתינה כבר {{hours}} שעות.</p>', '<p>Approval request for {{org_name}} has been pending for {{hours}} hours.</p>', '{"org_name":"string","hours":"number"}'),
  (UUID(), 'deal.proposed',          'הצעת עסקה חדשה מקבלן',              'New deal proposal from contractor',   '<p>קבלן {{contractor_name}} פתח הצעת עסקה עבור פרויקט {{project_name}}.</p>', '<p>Contractor {{contractor_name}} has proposed a deal for project {{project_name}}.</p>', '{"contractor_name":"string","project_name":"string","deal_id":"string"}'),
  (UUID(), 'deal.accepted',          'העסקה התקבלה!',                      'Deal accepted',                       '<p>התאגיד {{corporation_name}} קיבל את הצעתך לפרויקט {{project_name}}.</p>', '<p>Corporation {{corporation_name}} accepted your proposal for project {{project_name}}.</p>', '{"corporation_name":"string","project_name":"string","deal_id":"string"}'),
  (UUID(), 'deal.discrepancy.flagged','סתירה בדיווחי חוזה — נדרש טיפול',  'Contract report discrepancy detected','<p>זוהתה סתירה בין דיווחי הצדדים בעסקה {{deal_id}}. אנא בדוק.</p>', '<p>A discrepancy was detected between reports in deal {{deal_id}}. Please review.</p>', '{"deal_id":"string"}'),
  (UUID(), 'message.new',            'הודעה חדשה בעסקה',                  'New message in deal',                 '<p>התקבלה הודעה חדשה בעסקה {{deal_id}} מ-{{sender_name}}.</p>', '<p>New message in deal {{deal_id}} from {{sender_name}}.</p>', '{"deal_id":"string","sender_name":"string"}'),
  (UUID(), 'commission.invoiced',    'חשבונית עמלה הופקה',                'Commission invoice issued',            '<p>חשבונית מספר {{invoice_number}} הופקה עבור עסקה {{deal_id}}.</p>', '<p>Invoice #{{invoice_number}} has been issued for deal {{deal_id}}.</p>', '{"invoice_number":"string","deal_id":"string"}'),
  (UUID(), 'worker.visa.expiring_30d','אשרת עבודה פוקעת בעוד 30 יום',    'Work visa expiring in 30 days',       '<p>אשרת העובד {{worker_name}} פוקעת ב-{{visa_date}}.</p>', '<p>Work visa for {{worker_name}} expires on {{visa_date}}.</p>', '{"worker_name":"string","visa_date":"string"}'),
  (UUID(), 'worker.visa.expired',    'אשרת עובד פקעה',                    'Work visa expired',                   '<p>אשרת העובד {{worker_name}} פקעה. העובד הועבר לסטטוס לא פעיל.</p>', '<p>Work visa for {{worker_name}} has expired. Worker status set to deactivated.</p>', '{"worker_name":"string"}');
