-- =====================================================================
-- 020_match_found_template.sql
-- =====================================================================
-- Email template for the match-found notification.
--
-- Triggered by the notification service when a contractor's open job
-- request reaches is_complete=true (every line item filled). Variables:
--   contact_name  — recipient first/full name (free text)
--   project_name  — project name (Hebrew preferred, English fallback)
--   worker_count  — total workers in the matched bundle
--   region        — region of the request, may be empty
--   match_url     — deep link to /contractor/requests/{id}/match
--
-- Templates table is upsert-by-event_key (UNIQUE). Re-runs are no-ops.
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
USE notif_db;

INSERT INTO notification_templates
  (id, event_key, subject_he, subject_en, body_he, body_en, variables_schema)
VALUES
  (UUID(),
   'match.found',
   'נמצאה התאמה מלאה לבקשתך — {{project_name}}',
   'A complete match was found for your request — {{project_name}}',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#0f4c81;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">שיבוץ</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">פלטפורמת השיבוץ לקבלנים ותאגידים</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 16px;line-height:1.6">
          נמצאה התאמה מלאה ל<strong>{{project_name}}</strong> — כל המשרות בבקשה מולאו.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px">
          <tr><td style="padding:8px 12px;color:#64748b;width:40%">סך עובדים</td><td style="padding:8px 12px"><strong>{{worker_count}}</strong></td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b">איזור</td><td style="padding:8px 12px">{{region}}</td></tr>
        </table>
        <p style="text-align:center;margin:24px 0">
          <a href="{{match_url}}"
             style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;
                    padding:12px 28px;border-radius:6px;font-weight:600">
            צפה בהצעה ואשר
          </a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">
          אם הכפתור לא נפתח, העתק את הקישור הבא לדפדפן:<br>
          <span style="word-break:break-all" dir="ltr">{{match_url}}</span>
        </p>
      </div>
    </div>',
   '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#0f4c81;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">Shivutz</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">Workforce placement platform</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">Hello {{contact_name}},</h2>
        <p style="margin:0 0 16px;line-height:1.6">
          A complete match was found for <strong>{{project_name}}</strong> — every position in your request has been filled.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px">
          <tr><td style="padding:8px 12px;color:#64748b;width:40%">Workers matched</td><td style="padding:8px 12px"><strong>{{worker_count}}</strong></td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b">Region</td><td style="padding:8px 12px">{{region}}</td></tr>
        </table>
        <p style="text-align:center;margin:24px 0">
          <a href="{{match_url}}"
             style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;
                    padding:12px 28px;border-radius:6px;font-weight:600">
            View &amp; approve
          </a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">
          If the button does not open, copy this URL into your browser:<br>
          <span style="word-break:break-all">{{match_url}}</span>
        </p>
      </div>
    </div>',
   '{"contact_name":"string","project_name":"string","worker_count":"number","region":"string","match_url":"string"}')
ON DUPLICATE KEY UPDATE
  subject_he       = VALUES(subject_he),
  subject_en       = VALUES(subject_en),
  body_he          = VALUES(body_he),
  body_en          = VALUES(body_en),
  variables_schema = VALUES(variables_schema);
