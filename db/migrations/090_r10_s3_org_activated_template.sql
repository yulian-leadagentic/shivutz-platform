-- 090: R10 §3 · notification_templates row for org.activated
--
-- Pairs with the handler branch in
-- services/notification/src/consumers/handlers.js (case 'org.activated')
-- which fires when a service_provider self-registers. Providers
-- land at status='active' immediately (no approval queue), so the
-- admin email is INFORMATIONAL — no "Open approvals queue" CTA, no
-- approve/reject buttons. Deep-link goes to the entity card
-- (/admin/orgs/<id>) instead of /admin/approvals.
--
-- Same UPSERT pattern as 046 (org.registered), same inline HTML
-- style (no MJML dependency for one-off admin pings).

USE notif_db;

SET @subject_he := 'ספק שירותים חדש נרשם: {{org_name}}';
SET @subject_en := 'New service provider registered: {{org_name}}';
SET @body_he := CONCAT(
    '<div style="font-family: -apple-system, Heebo, Arial, sans-serif; direction: rtl; max-width: 560px; margin: 0 auto; padding: 24px;">',
      '<h2 style="color: #0f172a; font-size: 20px; margin: 0 0 12px;">ספק שירותים חדש נרשם והופעל</h2>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 4px;">',
        'שם העסק: <strong>{{org_name}}</strong>',
      '</p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">',
        'קטגוריית שירות: <strong>{{category_name}}</strong>',
      '</p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">',
        'החשבון פעיל מיד — אין תור אישור לספק. הקישור למטה פותח את כרטיס הישות במסכי הניהול.',
      '</p>',
      '<p style="margin: 0 0 24px;">',
        '<a href="{{entity_link}}" ',
           'style="display: inline-block; background: #F78203; color: #fff; text-decoration: none; ',
                  'padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 15px;">',
          'פתח את כרטיס הספק',
        '</a>',
      '</p>',
      '<p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 24px 0 0;">',
        'הודעה אוטומטית ממערכת BuildUp · {{entity_link}}',
      '</p>',
    '</div>'
  );
SET @body_en := CONCAT(
    '<div style="font-family: -apple-system, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">',
      '<h2 style="color: #0f172a; font-size: 20px; margin: 0 0 12px;">New service provider registered</h2>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 4px;">Business: <strong>{{org_name}}</strong></p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">Category: <strong>{{category_name}}</strong></p>',
      '<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">The account is active immediately — no approval queue for providers.</p>',
      '<p style="margin: 0 0 24px;"><a href="{{entity_link}}" style="display: inline-block; background: #F78203; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700;">Open provider card</a></p>',
    '</div>'
  );

INSERT INTO notification_templates
  (id, event_key, subject_he, subject_en, body_he, body_en, is_active, created_at)
VALUES (
  UUID(),
  'org.activated',
  @subject_he, @subject_en, @body_he, @body_en,
  TRUE, NOW()
)
ON DUPLICATE KEY UPDATE
  subject_he = VALUES(subject_he),
  subject_en = VALUES(subject_en),
  body_he    = VALUES(body_he),
  body_en    = VALUES(body_en),
  is_active  = TRUE;
