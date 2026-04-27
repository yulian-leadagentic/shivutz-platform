-- =====================================================================
-- 015_deal_lifecycle_notifications.sql
-- =====================================================================
--
-- Notification templates for the deal lifecycle events introduced in
-- migration 014. One template per (event, recipient role); upserted so
-- this migration can be re-run safely as we tune copy.
--
-- Apply once:
--   docker-compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD \
--     notif_db < db/migrations/015_deal_lifecycle_notifications.sql
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
USE notif_db;

INSERT INTO notification_templates
  (id, event_key, subject_he, subject_en, body_he, body_en, variables_schema)
VALUES

-- ── corp committed worker list → contractor must act ───────────────────
  (UUID(),
   'deal.corp_committed.contractor',
   'תאגיד הציג רשימת עובדים — נדרש אישור תוך 7 ימים',
   'Corporation submitted worker list — your approval needed within 7 days',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#0f4c81;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">שיבוץ</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">רשימת עובדים ממתינה לאישורך</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          תאגיד הגיש רשימה של <strong>{{worker_count}} עובדי {{profession_he}}</strong>
          ({{region_he}}) למענה על הבקשה שלך.
        </p>
        <div style="background:#fef3c7;border-right:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0;font-size:14px">
          <strong>מה לעשות:</strong> היכנס למערכת, סקור את פרטי העובדים והחלט אם להמשיך עם התאגיד.
          לאחר אישורך, פרטי שני הצדדים ייחשפו וחיוב הפלטפורמה ירוץ בתוך 48 שעות.
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">
          יש לך <strong>7 ימים</strong> להגיב — לאחר מכן ההצעה תפוג והעובדים יוחזרו לזמינות.
        </p>
        <p style="text-align:center;margin:20px 0">
          <a href="{{deal_url}}" style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600">סקור רשימת עובדים</a>
        </p>
      </div>
    </div>',
   '<div dir="ltr" lang="en"><h2>Hello {{contact_name}},</h2><p>A corporation submitted a list of <strong>{{worker_count}} {{profession_he}} workers</strong> ({{region_he}}) in response to your request.</p><p>You have <strong>7 days</strong> to review and approve. After approval, mutual identity disclosure happens and platform billing runs within 48 hours.</p><p><a href="{{deal_url}}">Review worker list</a></p></div>',
   '{"contact_name":"string","worker_count":"number","profession_he":"string","region_he":"string","deal_url":"string"}'),

-- ── contractor approved → contractor confirmation ──────────────────────
  (UUID(),
   'deal.approved.contractor',
   'אישרת רשימת עובדים — חיוב תוך 48 שעות',
   'You approved the worker list — billing in 48 hours',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#047857;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">✓ אישרת את הרשימה</div>
        <div style="font-size:13px;opacity:.9;margin-top:2px">העסקה ממתינה לחיוב</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          אישרת את הרשימה של <strong>{{worker_count}} עובדי {{profession_he}}</strong>
          מ-<strong>{{corp_name}}</strong>. פרטי הקשר של שני הצדדים נחשפו במערכת.
        </p>
        <div style="background:#ecfdf5;border-right:4px solid #047857;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0;font-size:14px">
          <p style="margin:0 0 6px"><strong>עמלת פלטפורמה: ₪{{commission_amount}}</strong></p>
          <p style="margin:0">חיוב יבוצע ב-{{capture_at}} (אלא אם התאגיד יבטל בחלון הזמן).</p>
        </div>
        <p style="margin:0;font-size:13px;color:#64748b">המשך התיאום מתבצע ישירות מול התאגיד.</p>
      </div>
    </div>',
   '<div dir="ltr" lang="en"><h2>Hello {{contact_name}},</h2><p>You approved <strong>{{worker_count}} {{profession_he}}</strong> from <strong>{{corp_name}}</strong>. Both parties'' details are now visible.</p><p><strong>Platform commission: ₪{{commission_amount}}</strong> — charged on {{capture_at}} unless the corporation cancels within the window.</p></div>',
   '{"contact_name":"string","worker_count":"number","profession_he":"string","corp_name":"string","commission_amount":"number","capture_at":"string"}'),

-- ── contractor approved → corp confirmation + cancel-window warning ────
  (UUID(),
   'deal.approved.corp',
   'הקבלן אישר — לחיוב נותרו 48 שעות',
   'Contractor approved — 48-hour billing window',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#0f4c81;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">הקבלן אישר את הרשימה</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">חלון ביטול: 48 שעות</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          הקבלן <strong>{{contractor_name}}</strong> אישר את רשימת
          {{worker_count}} עובדי {{profession_he}} שהגשת.
          פרטי שני הצדדים נחשפו במערכת.
        </p>
        <div style="background:#fef3c7;border-right:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0;font-size:14px">
          <strong>חיוב יבוצע ב-{{capture_at}}.</strong><br>
          אם בלתי אפשרי לספק את העובדים — בטל את העסקה במערכת לפני המועד הזה כדי למנוע חיוב.
        </div>
        <p style="margin:0;font-size:13px;color:#64748b">לאחר חלון הביטול, חיוב יבוצע אוטומטית והפרטים יסגרו לעסקה הזו.</p>
      </div>
    </div>',
   '<div dir="ltr" lang="en"><h2>Hello {{contact_name}},</h2><p>Contractor <strong>{{contractor_name}}</strong> approved your list of {{worker_count}} {{profession_he}}. Both parties'' details are now visible.</p><p><strong>Billing fires on {{capture_at}}.</strong> If you cannot deliver the workers, cancel the deal in the system before then to avoid charges.</p></div>',
   '{"contact_name":"string","contractor_name":"string","worker_count":"number","profession_he":"string","capture_at":"string"}'),

-- ── contractor rejected → corp ─────────────────────────────────────────
  (UUID(),
   'deal.rejected.corp',
   'הקבלן לא בחר ברשימה שהגשת',
   'Contractor declined your list',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          הקבלן בחר שלא להמשיך עם הרשימה של {{worker_count}} עובדי {{profession_he}} שהגשת.
          לא בוצע חיוב והעובדים שוחררו לזמינות מיידית.
        </p>
        <p style="margin:0;font-size:13px;color:#64748b">הרשימה לא נחשפה לקבלן ופרטי הקשר לא הוחלפו.</p>
      </div>
    </div>',
   '<div dir="ltr" lang="en"><p>Hello {{contact_name}}, the contractor chose not to proceed with your list of {{worker_count}} {{profession_he}}. No charge was made and the workers are immediately available again.</p></div>',
   '{"contact_name":"string","worker_count":"number","profession_he":"string"}'),

-- ── contractor rejected → admin alert ──────────────────────────────────
  (UUID(),
   'deal.rejected.admin',
   'עסקה נדחתה: {{worker_count}} עובדי {{profession_he}}',
   'Deal rejected: {{worker_count}} {{profession_he}}',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
        <p style="margin:0 0 8px"><strong>הקבלן {{contractor_name}}</strong> דחה רשימת עובדים מ-<strong>{{corp_name}}</strong>.</p>
        <ul style="margin:8px 0;padding-right:20px;font-size:14px;color:#475569">
          <li>{{worker_count}} עובדי {{profession_he}} ({{region_he}})</li>
          <li>עמלת פלטפורמה שלא חויבה: ₪{{commission_amount}}</li>
          <li>זמן דחייה: {{rejected_at}}</li>
        </ul>
      </div>
    </div>',
   '<div dir="ltr"><p>Contractor <strong>{{contractor_name}}</strong> declined a list from <strong>{{corp_name}}</strong>: {{worker_count}} {{profession_he}} ({{region_he}}). Forgone commission: ₪{{commission_amount}}. At {{rejected_at}}.</p></div>',
   '{"contractor_name":"string","corp_name":"string","worker_count":"number","profession_he":"string","region_he":"string","commission_amount":"number","rejected_at":"string"}'),

-- ── deal expired (contractor didn''t act in 7d) → contractor ───────────
  (UUID(),
   'deal.expired.contractor',
   'ההצעה פגה — לא אישרת בזמן',
   'Offer expired — no approval received',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          רשימת ה-{{worker_count}} עובדי {{profession_he}} שהוצעה לך פגה היום.
          הבקשה שלך נשארת פתוחה ונמשיך לחפש מענה.
        </p>
      </div>
    </div>',
   '<div dir="ltr"><p>Hello {{contact_name}}, the list of {{worker_count}} {{profession_he}} expired. Your request stays open and we''ll keep searching.</p></div>',
   '{"contact_name":"string","worker_count":"number","profession_he":"string"}'),

-- ── deal expired → corp ────────────────────────────────────────────────
  (UUID(),
   'deal.expired.corp',
   'ההצעה שהגשת פגה — העובדים שוחררו',
   'Offer expired — workers released',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
        <p style="margin:0 0 12px">הקבלן לא אישר את הרשימה תוך 7 ימים, ולכן ההצעה פגה. {{worker_count}} העובדים שהקצית שוחררו וזמינים להצעות אחרות.</p>
      </div>
    </div>',
   '<div dir="ltr"><p>The contractor did not approve within 7 days. Your {{worker_count}} workers are released back to availability.</p></div>',
   '{"worker_count":"number"}'),

-- ── deal expired → admin ───────────────────────────────────────────────
  (UUID(),
   'deal.expired.admin',
   'עסקה פגה: {{worker_count}} עובדי {{profession_he}}',
   'Deal expired: {{worker_count}} {{profession_he}}',
   '<div dir="rtl" lang="he"><p>הקבלן <strong>{{contractor_name}}</strong> לא אישר רשימה מ-<strong>{{corp_name}}</strong> במהלך 7 ימים. עמלה שלא חויבה: ₪{{commission_amount}}.</p></div>',
   '<div dir="ltr"><p>Contractor {{contractor_name}} did not act on a list from {{corp_name}} within 7 days. Forgone commission: ₪{{commission_amount}}.</p></div>',
   '{"contractor_name":"string","corp_name":"string","worker_count":"number","profession_he":"string","commission_amount":"number"}'),

-- ── corp cancelled during 48h window → contractor ──────────────────────
  (UUID(),
   'deal.cancelled_by_corp.contractor',
   'התאגיד ביטל את העסקה — לא חויבת',
   'Corporation cancelled the deal — no charge',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#b91c1c;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700">⚠ עסקה בוטלה</div>
        <div style="font-size:13px;opacity:.9;margin-top:2px">התאגיד הודיע שלא יוכל לספק את העובדים</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          התאגיד <strong>{{corp_name}}</strong> ביטל את העסקה לפני שהחיוב התבצע.
          לא חויבת בעמלה והבקשה שלך נשארת פתוחה.
        </p>
        {{#if cancellation_reason}}<p style="margin:0 0 12px;font-size:14px;color:#64748b"><strong>סיבה:</strong> {{cancellation_reason}}</p>{{/if}}
        <p style="margin:0;font-size:13px;color:#64748b">מנהל המערכת קיבל התראה ויעמוד בקשר במידת הצורך.</p>
      </div>
    </div>',
   '<div dir="ltr"><p>Corporation <strong>{{corp_name}}</strong> cancelled before billing. No charge made; your request stays open.</p></div>',
   '{"contact_name":"string","corp_name":"string","cancellation_reason":"string"}'),

-- ── corp cancelled → admin urgent ──────────────────────────────────────
  (UUID(),
   'deal.cancelled_by_corp.admin',
   '⚠ דחוף: תאגיד ביטל לאחר אישור הקבלן',
   '⚠ Urgent: corporation cancelled after contractor approval',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#b91c1c;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700">⚠ ביטול בחלון הקריטי</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <p style="margin:0 0 12px">התאגיד <strong>{{corp_name}}</strong> ביטל אחרי שהקבלן <strong>{{contractor_name}}</strong> כבר אישר את הרשימה.</p>
        <ul style="margin:8px 0;padding-right:20px;font-size:14px;color:#475569">
          <li>{{worker_count}} עובדי {{profession_he}} ({{region_he}})</li>
          <li>עמלה שלא חויבה: ₪{{commission_amount}}</li>
          <li>סיבת ביטול: {{cancellation_reason}}</li>
          <li>זמן ביטול: {{cancelled_at}}</li>
        </ul>
        <p style="margin:8px 0 0;font-size:13px;color:#b91c1c"><strong>פעולה מומלצת:</strong> צור קשר עם התאגיד לבירור ועם הקבלן להציע חלופה.</p>
      </div>
    </div>',
   '<div dir="ltr"><p>Corporation <strong>{{corp_name}}</strong> cancelled after contractor <strong>{{contractor_name}}</strong> approved. {{worker_count}} {{profession_he}} ({{region_he}}). Lost commission: ₪{{commission_amount}}. Reason: {{cancellation_reason}}. At {{cancelled_at}}.</p></div>',
   '{"contractor_name":"string","corp_name":"string","worker_count":"number","profession_he":"string","region_he":"string","commission_amount":"number","cancellation_reason":"string","cancelled_at":"string"}'),

-- ── deal closed (capture succeeded) → contractor invoice ───────────────
  (UUID(),
   'deal.closed.contractor',
   'חשבונית עמלה — עסקה {{deal_id_short}}',
   'Commission invoice — deal {{deal_id_short}}',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#047857;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">✓ העסקה נסגרה</div>
        <div style="font-size:13px;opacity:.9;margin-top:2px">חשבונית עמלה הופקה</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          העסקה עם <strong>{{corp_name}}</strong> ל-{{worker_count}} עובדי {{profession_he}} נסגרה.
          חשבונית עמלת הפלטפורמה הופקה.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b">מספר חשבונית</td><td style="padding:8px 12px;font-weight:600" dir="ltr">{{invoice_number}}</td></tr>
          <tr><td style="padding:8px 12px;color:#64748b">סכום</td><td style="padding:8px 12px;font-weight:600">₪{{commission_amount}}</td></tr>
        </table>
        {{#if invoice_url}}<p style="text-align:center;margin:20px 0"><a href="{{invoice_url}}" style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600">הורד חשבונית</a></p>{{/if}}
      </div>
    </div>',
   '<div dir="ltr"><p>Deal with {{corp_name}} for {{worker_count}} {{profession_he}} closed. Commission invoice {{invoice_number}}: ₪{{commission_amount}}.</p></div>',
   '{"contact_name":"string","corp_name":"string","worker_count":"number","profession_he":"string","invoice_number":"string","commission_amount":"number","invoice_url":"string","deal_id_short":"string"}'),

-- ── deal closed → corp ─────────────────────────────────────────────────
  (UUID(),
   'deal.closed.corp',
   'העסקה נסגרה — {{worker_count}} עובדי {{profession_he}}',
   'Deal closed — {{worker_count}} {{profession_he}}',
   '<div dir="rtl" lang="he"><p>שלום {{contact_name}}, העסקה עם הקבלן <strong>{{contractor_name}}</strong> ל-{{worker_count}} עובדי {{profession_he}} נסגרה. המשך תיאום מתבצע ישירות מולו.</p></div>',
   '<div dir="ltr"><p>Hello {{contact_name}}, deal with contractor {{contractor_name}} for {{worker_count}} {{profession_he}} closed. Coordination proceeds directly.</p></div>',
   '{"contact_name":"string","contractor_name":"string","worker_count":"number","profession_he":"string"}'),

-- ── admin nudge: deal pending contractor approval > 24h ────────────────
  (UUID(),
   'deal.pending_admin_nudge',
   'נדרשת התערבות: עסקה ממתינה לאישור קבלן יותר מ-24 שעות',
   'Action: deal pending contractor approval > 24h',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
        <p style="margin:0 0 12px">העסקה ממתינה לאישור הקבלן <strong>{{contractor_name}}</strong> כבר {{hours_pending}} שעות.</p>
        <ul style="margin:8px 0;padding-right:20px;font-size:14px;color:#475569">
          <li>תאגיד מציע: <strong>{{corp_name}}</strong></li>
          <li>{{worker_count}} עובדי {{profession_he}} ({{region_he}})</li>
          <li>עמלה צפויה: ₪{{commission_amount}}</li>
          <li>פגיעה ב-{{expires_at}} אם לא יאושר</li>
        </ul>
        <p style="margin:8px 0 0;font-size:13px;color:#64748b"><strong>פעולה מומלצת:</strong> ליצור קשר עם הקבלן לעידוד אישור.</p>
      </div>
    </div>',
   '<div dir="ltr"><p>Deal pending contractor <strong>{{contractor_name}}</strong> approval for {{hours_pending}} hours. Corp: {{corp_name}}, {{worker_count}} {{profession_he}} ({{region_he}}). Expected commission: ₪{{commission_amount}}. Expires {{expires_at}}.</p></div>',
   '{"contractor_name":"string","corp_name":"string","worker_count":"number","profession_he":"string","region_he":"string","commission_amount":"number","expires_at":"string","hours_pending":"number"}')

ON DUPLICATE KEY UPDATE
  subject_he       = VALUES(subject_he),
  subject_en       = VALUES(subject_en),
  body_he          = VALUES(body_he),
  body_en          = VALUES(body_en),
  variables_schema = VALUES(variables_schema),
  is_active        = TRUE,
  updated_at       = NOW();
