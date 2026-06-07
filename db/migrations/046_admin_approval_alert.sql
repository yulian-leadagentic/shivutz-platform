-- 046: enrich org.registered email template with org_type + admin link.
--
-- The handler now passes `org_type_label` (קבלן / תאגיד) and
-- `admin_link` (deep link to /admin/approvals) alongside the existing
-- `org_name` variable. The template body needs the matching Handlebars
-- placeholders for those to actually appear in the rendered email.
--
-- We UPSERT the row so the migration is idempotent against deploys
-- where the template already exists (most common) and creates it from
-- scratch on a clean DB. notification_templates is keyed by event_key.
--
-- The HTML body is intentionally simple — admins read these on mobile
-- and the CTA button is the only thing they need to act. Tailwind-like
-- inline styles instead of a full email framework because the volume
-- here is tiny and we don't want a dependency on MJML / handlebars
-- partials.

USE notif_db;

SET @subject_he := 'ארגון חדש ממתין לאישור: {{org_name}}';
SET @subject_en := 'New organisation pending approval: {{org_name}}';
SET @body_he := CONCAT(
    '<div style="font-family: -apple-system, Heebo, Arial, sans-serif; direction: rtl; max-width: 560px; margin: 0 auto; padding: 24px;">',
      '<h2 style="color: #0f172a; font-size: 20px; margin: 0 0 12px;">{{org_type_label}} חדש ממתין לאישור</h2>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 4px;">',
        'שם הארגון: <strong>{{org_name}}</strong>',
      '</p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">',
        'הוא ממתין לאישור במסך הניהול. כל עוד הוא לא אושר ידנית או אומת אוטומטית, הוא לא יוכל לבצע פעולות בפלטפורמה.',
      '</p>',
      '<p style="margin: 0 0 24px;">',
        '<a href="{{admin_link}}" ',
           'style="display: inline-block; background: #F78203; color: #fff; text-decoration: none; ',
                  'padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 15px;">',
          'פתח את מסך האישורים',
        '</a>',
      '</p>',
      '<p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 24px 0 0;">',
        'הודעה אוטומטית ממערכת BuildUp · {{admin_link}}',
      '</p>',
    '</div>'
  );
SET @body_en := CONCAT(
    '<div style="font-family: -apple-system, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">',
      '<h2 style="color: #0f172a; font-size: 20px; margin: 0 0 12px;">New {{org_type_label}} pending approval</h2>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 4px;">Organisation: <strong>{{org_name}}</strong></p>',
      '<p style="margin: 0 0 24px;"><a href="{{admin_link}}" style="display: inline-block; background: #F78203; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700;">Open approvals queue</a></p>',
    '</div>'
  );

INSERT INTO notification_templates
  (id, event_key, subject_he, subject_en, body_he, body_en, is_active, created_at)
VALUES (
  UUID(),
  'org.registered',
  @subject_he, @subject_en, @body_he, @body_en,
  TRUE, NOW()
)
ON DUPLICATE KEY UPDATE
  subject_he = VALUES(subject_he),
  subject_en = VALUES(subject_en),
  body_he    = VALUES(body_he),
  body_en    = VALUES(body_en),
  is_active  = TRUE;
