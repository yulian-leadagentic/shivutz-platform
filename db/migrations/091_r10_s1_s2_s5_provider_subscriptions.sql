-- 091: R10 §1 + §2 + §5 · provider marketplace_subscriptions + welcome email
--
-- Three schema edits, all idempotent.
--
--   1. marketplace_subscriptions.advertiser_entity_type — extend the
--      ENUM to allow 'service_provider'. 021 (the original table)
--      hard-coded ('contractor','corporation') because providers
--      didn't exist yet. Without this the INSERT in providers.py
--      §1 would fail with "Data truncated for column".
--      Idempotency: guarded by INFORMATION_SCHEMA check, matches the
--      pattern from 077.
--
--   2. marketplace_subscriptions.promo_note — new VARCHAR column,
--      NULL by default. Written on register-time creations that
--      applied the launch promo (§2). Value 'launch_free_promo' is
--      the only string in use today; future promos add their own
--      values (never enum'd, since they come and go).
--      🔴 Yulian's decision doc §1: "מי שיסתכל על זה בעוד חצי שנה
--      חייב לדעת למה לא שולם" — this column is that record.
--
--   3. notification_templates row `provider.welcome` — the email that
--      lands in the provider's inbox after successful register (§5).
--      Fresh event key; handlers.js §5 case dispatches to it.
--      Content follows decisions-doc §6 verbatim: subject + Hebrew
--      RTL body with {contact_name} · {business_name} · {plan_name} ·
--      {category_name} · {promo_block} · {cta_url}.
--      {promo_block} is expanded in handlers.js by looking up
--      site_settings.launch_promo_end at send time — the template
--      body carries a `{{promo_block}}` placeholder that handlers.js
--      pre-computes (empty string when the date has passed).

-- ── (1) advertiser_entity_type ENUM extension ──────────────────────
USE org_db;

SET @ddl := IF(
  (SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='marketplace_subscriptions'
       AND COLUMN_NAME='advertiser_entity_type') NOT LIKE '%service_provider%',
  'ALTER TABLE marketplace_subscriptions
     MODIFY COLUMN advertiser_entity_type
     ENUM(''contractor'',''corporation'',''service_provider'') NOT NULL',
  'SELECT ''marketplace_subscriptions.advertiser_entity_type already has service_provider''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── (2) promo_note column ──────────────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA='org_db'
       AND TABLE_NAME='marketplace_subscriptions'
       AND COLUMN_NAME='promo_note') = 0,
  'ALTER TABLE marketplace_subscriptions
     ADD COLUMN promo_note VARCHAR(64) NULL AFTER price_nis',
  'SELECT ''marketplace_subscriptions.promo_note already exists''');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── (3) provider.welcome notification template ─────────────────────
USE notif_db;

SET @subject_he := 'ברוכים הבאים ל-TagidAI — החשבון שלך פעיל';
SET @subject_en := 'Welcome to TagidAI — your account is active';

-- Hebrew body. `{{promo_block}}` is expanded in handlers.js at send
-- time (empty string when the promo has ended, else the "המסלול שלך
-- ללא עלות עד …" paragraph). Body follows decisions-doc §6 word for
-- word so the visual matches what Yulian approved on paper.
SET @body_he := CONCAT(
    '<div style="font-family: -apple-system, Heebo, Arial, sans-serif; direction: rtl; max-width: 560px; margin: 0 auto; padding: 24px;">',
      '<p style="color: #0f172a; font-size: 15px; margin: 0 0 12px;">',
        'שלום {{contact_name}},',
      '</p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.7; margin: 0 0 16px;">',
        'החשבון של <strong>{{business_name}}</strong> ב-TagidAI פעיל.',
      '</p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.7; margin: 0 0 12px;">',
        'המסלול שלך: <strong>{{plan_name}}</strong> · <strong>{{category_name}}</strong>',
      '</p>',
      '{{promo_block}}',
      '<h3 style="color: #0f172a; font-size: 16px; margin: 24px 0 12px;">מה עכשיו:</h3>',
      '<ol style="color: #334155; font-size: 14px; line-height: 1.9; margin: 0 0 20px; padding-inline-start: 24px;">',
        '<li>פרסם את המודעה הראשונה שלך</li>',
        '<li>המודעה שלך תופיע בחיפוש של קבלנים ותאגידים שמחפשים {{category_name}} — בעברית חופשית, בלי טפסים.</li>',
        '<li>פנייה מלקוח תגיע אליך במייל ובמסך הניהול שלך.</li>',
      '</ol>',
      '<p style="margin: 0 0 24px;">',
        '<a href="{{cta_url}}" ',
           'style="display: inline-block; background: #F78203; color: #fff; text-decoration: none; ',
                  'padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 15px;">',
          'פרסם את המודעה הראשונה שלך',
        '</a>',
      '</p>',
      '<p style="color: #64748b; font-size: 13px; line-height: 1.6; margin: 20px 0 4px;">',
        'צריך עזרה? השב למייל הזה.',
      '</p>',
      '<p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 24px 0 0;">',
        'TagidAI',
      '</p>',
    '</div>'
  );

-- English body. Slimmer — Hebrew is the primary path; en exists as a
-- fallback for the notification test panel + any admin whose locale
-- is set to English.
SET @body_en := CONCAT(
    '<div style="font-family: -apple-system, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">',
      '<p style="color: #0f172a; font-size: 15px; margin: 0 0 12px;">Hi {{contact_name}},</p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.7; margin: 0 0 16px;">',
        'Your <strong>{{business_name}}</strong> account on TagidAI is active.',
      '</p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.7; margin: 0 0 12px;">',
        'Plan: <strong>{{plan_name}}</strong> · <strong>{{category_name}}</strong>',
      '</p>',
      '{{promo_block}}',
      '<p style="margin: 24px 0;">',
        '<a href="{{cta_url}}" style="display: inline-block; background: #F78203; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700;">Post your first listing</a>',
      '</p>',
      '<p style="color: #64748b; font-size: 13px; margin: 20px 0 0;">Need help? Reply to this email.</p>',
    '</div>'
  );

INSERT INTO notification_templates
  (id, event_key, subject_he, subject_en, body_he, body_en, is_active, created_at)
VALUES (
  UUID(),
  'provider.welcome',
  @subject_he, @subject_en, @body_he, @body_en,
  TRUE, NOW()
)
ON DUPLICATE KEY UPDATE
  subject_he = VALUES(subject_he),
  subject_en = VALUES(subject_en),
  body_he    = VALUES(body_he),
  body_en    = VALUES(body_en),
  is_active  = TRUE;
