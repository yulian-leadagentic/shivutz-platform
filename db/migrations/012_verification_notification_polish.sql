-- =====================================================================
-- 012_verification_notification_polish.sql
-- =====================================================================
--
-- Polishes the verification-related notification templates added in 011
-- and adds the new `contractor.verified` success notification. Templates
-- are upserted (event_key is UNIQUE) so this migration is safe to re-run.
--
-- Apply once:
--   docker-compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD \
--     notif_db < db/migrations/012_verification_notification_polish.sql
-- =====================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
USE notif_db;

INSERT INTO notification_templates
  (id, event_key, subject_he, subject_en, body_he, body_en, variables_schema)
VALUES
  -- ── Email magic-link verification ──────────────────────────────────────
  (UUID(),
   'contractor.verify.email_link',
   'שלב אחרון — אימות בעלות על העסק בשיבוץ',
   'Final step — verify business ownership on Shivutz',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#0f4c81;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">שיבוץ</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">פלטפורמת השיבוץ לקבלנים ותאגידים</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          זה הכתובת הרשומה בפנקס הקבלנים עבור העסק שלך. כדי לאשר שאתה אכן בעל העסק
          ולפתוח גישה מלאה (כולל הגשת בקשות לתאגידים), אנא לחץ על הכפתור:
        </p>
        <p style="text-align:center;margin:24px 0">
          <a href="{{magic_link}}"
             style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;
                    padding:12px 28px;border-radius:6px;font-weight:600">
            אמת חשבון
          </a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">
          הקישור תקף ל-<strong>{{expires_in_minutes}} דקות</strong> וניתן לשימוש פעם אחת בלבד.
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">
          אם הכפתור לא נפתח, העתק את הקישור הבא לדפדפן:<br>
          <span style="word-break:break-all" dir="ltr">{{magic_link}}</span>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <p style="margin:0;font-size:12px;color:#94a3b8">
          לא ביקשת אימות? תוכל להתעלם מההודעה — לא יבוצע אימות ללא לחיצה על הקישור.
        </p>
      </div>
    </div>',
   '<div dir="ltr" lang="en" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#0f4c81;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">Shivutz</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">Workforce placement platform for contractors &amp; corporations</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">Hello {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          This is the address listed for your business in the Israeli Contractors Registry.
          To confirm you own the business and unlock full platform access (including submitting
          applications to corporations), please click the button below:
        </p>
        <p style="text-align:center;margin:24px 0">
          <a href="{{magic_link}}"
             style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;
                    padding:12px 28px;border-radius:6px;font-weight:600">
            Verify account
          </a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">
          The link is valid for <strong>{{expires_in_minutes}} minutes</strong> and can be used once.
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">
          If the button does not open, copy this link into your browser:<br>
          <span style="word-break:break-all">{{magic_link}}</span>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <p style="margin:0;font-size:12px;color:#94a3b8">
          Did not request this? You can ignore the email — no verification will be performed without clicking the link.
        </p>
      </div>
    </div>',
   '{"contact_name":"string","magic_link":"string","expires_in_minutes":"number"}'),

  -- ── Admin alert: blocked / deleted-company registration attempt ────────
  (UUID(),
   'contractor.blocked.deleted_company',
   '⚠ נחסם רישום: חברה במצב {{company_status}}',
   'Blocked registration: company status {{company_status}}',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#b91c1c;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700">⚠ ניסיון רישום נחסם</div>
        <div style="font-size:13px;opacity:.9;margin-top:2px">חברה לא פעילה ברשם החברות</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <p style="margin:0 0 14px;line-height:1.6">
          משתמש ניסה להירשם כקבלן עם מספר חברה הרשום ברשם החברות במצב
          <strong>"{{company_status}}"</strong>. הרישום נחסם אוטומטית.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b;width:130px">ח.פ</td><td style="padding:8px 12px;font-weight:600" dir="ltr">{{business_number}}</td></tr>
          <tr><td style="padding:8px 12px;color:#64748b">שם פונה</td><td style="padding:8px 12px">{{contact_name}}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b">טלפון</td><td style="padding:8px 12px" dir="ltr">{{contact_phone}}</td></tr>
          <tr><td style="padding:8px 12px;color:#64748b">סטטוס משפטי</td><td style="padding:8px 12px;color:#b91c1c;font-weight:600">{{company_status}}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b">זמן ניסיון</td><td style="padding:8px 12px" dir="ltr">{{attempted_at}}</td></tr>
        </table>
        <p style="margin:14px 0 0;font-size:13px;color:#64748b;line-height:1.5">
          אם זוהי טעות (למשל הרשם עוד לא עודכן לאחר שינוי סטטוס), ניתן לאשר את הקבלן ידנית
          דרך מסך האישורים — בחירה במנהל תעלה אותו ל-tier_2 בלי תלות בפנקס.
        </p>
      </div>
    </div>',
   '<div dir="ltr" lang="en" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#b91c1c;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700">⚠ Registration blocked</div>
        <div style="font-size:13px;opacity:.9;margin-top:2px">Inactive company in the Companies Registry</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <p style="margin:0 0 14px;line-height:1.6">
          A user attempted to register as a contractor using a company number recorded in the
          Companies Registry as <strong>"{{company_status}}"</strong>. The registration was blocked automatically.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b;width:130px">Business #</td><td style="padding:8px 12px;font-weight:600">{{business_number}}</td></tr>
          <tr><td style="padding:8px 12px;color:#64748b">Contact</td><td style="padding:8px 12px">{{contact_name}}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b">Phone</td><td style="padding:8px 12px">{{contact_phone}}</td></tr>
          <tr><td style="padding:8px 12px;color:#64748b">Legal status</td><td style="padding:8px 12px;color:#b91c1c;font-weight:600">{{company_status}}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;color:#64748b">Attempted at</td><td style="padding:8px 12px">{{attempted_at}}</td></tr>
        </table>
        <p style="margin:14px 0 0;font-size:13px;color:#64748b;line-height:1.5">
          If this is a registry data lag, you can approve the contractor manually through the
          approvals screen — admin approval bumps them to tier_2 regardless of registry presence.
        </p>
      </div>
    </div>',
   '{"business_number":"string","company_status":"string","contact_name":"string","contact_phone":"string","attempted_at":"string"}'),

  -- ── Periodic revalidation found contractor no longer in פנקס ───────────
  (UUID(),
   'contractor.verification.expired',
   'נדרש אימות מחדש בשיבוץ — הרישום בפנקס הקבלנים השתנה',
   'Re-verification required — your Contractors Registry listing has changed',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#0f4c81;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">שיבוץ</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">עדכון חשוב לחשבון שלך</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          במהלך הבדיקה התקופתית שלנו מול פנקס הקבלנים גילינו שהעסק
          <strong>{{company_name}}</strong> כבר לא מופיע ברשימת הקבלנים הרשומים.
        </p>
        <div style="background:#fef3c7;border-right:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0">
          <strong>מה ההשלכה?</strong><br>
          <span style="font-size:14px">
            לא תוכל להגיש בקשות לתאגידים עד שנעדכן את האימות. שאר היכולות (חיפוש
            במאגר, ניהול הפרויקטים שלך, עדכון פרטים) ממשיכות לעבוד כרגיל.
          </span>
        </div>
        <p style="margin:12px 0;line-height:1.6">
          הסיבות הנפוצות: שינוי סטטוס בפנקס (מוקפא, מבוטל), עדכון בפרטי הרישום,
          או ירידת שם זמנית של הפנקס.
        </p>
        <p style="margin:16px 0 8px;line-height:1.6">
          <strong>מה לעשות:</strong> היכנס למערכת ובחר באפשרות "אמת מחדש" בעמוד הגדרות.
          המערכת תבדוק שוב את הרישום ותפתח את האימות.
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#64748b">
          אם אתה חושב שזו טעות, תוכל לפנות אלינו ונבדוק ידנית.
        </p>
      </div>
    </div>',
   '<div dir="ltr" lang="en" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#0f4c81;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">Shivutz</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">Important account update</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">Hello {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          During our periodic check against the Israeli Contractors Registry we noticed that
          <strong>{{company_name}}</strong> no longer appears in the active list.
        </p>
        <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:6px 0 0 6px">
          <strong>What this means:</strong><br>
          <span style="font-size:14px">
            You will not be able to submit applications to corporations until verification is renewed.
            All other capabilities (browsing, managing your own projects, updating your profile) continue
            to work normally.
          </span>
        </div>
        <p style="margin:12px 0;line-height:1.6">
          Common causes: registry status change (suspended, revoked), updated registration details,
          or a temporary registry data outage.
        </p>
        <p style="margin:16px 0 8px;line-height:1.6">
          <strong>Next step:</strong> sign in and choose "Re-verify" on the settings page. The system will
          run the check again and reopen verification.
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#64748b">
          If you believe this is in error, please contact us and we will review manually.
        </p>
      </div>
    </div>',
   '{"contact_name":"string","company_name":"string"}'),

  -- ── NEW: success confirmation after tier_2 reached ────────────────────
  (UUID(),
   'contractor.verified',
   '✓ החשבון שלך אומת — גישה מלאה נפתחה',
   '✓ Account verified — full access unlocked',
   '<div dir="rtl" lang="he" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#047857;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">✓ אומת בהצלחה</div>
        <div style="font-size:13px;opacity:.9;margin-top:2px">החשבון שלך בשיבוץ פעיל באופן מלא</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">שלום {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          האימות של <strong>{{company_name}}</strong> הושלם דרך
          {{verification_method_he}}. החשבון שלך פעיל באופן מלא.
        </p>
        <div style="background:#ecfdf5;border-right:4px solid #047857;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0">
          <strong>מה אתה יכול לעשות עכשיו:</strong>
          <ul style="margin:8px 0 0 0;padding-right:20px;line-height:1.7;font-size:14px">
            <li>להגיש בקשות לתאגידים ולהשתתף בעסקאות</li>
            <li>לפרסם פרויקטים ולנהל ביצועים</li>
            <li>לקבל תשלומים דרך הפלטפורמה</li>
          </ul>
        </div>
        <p style="text-align:center;margin:24px 0">
          <a href="{{dashboard_url}}"
             style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;
                    padding:12px 28px;border-radius:6px;font-weight:600">
            פתח דשבורד
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5">
          האימות תקף לחצי שנה. נבדוק את הרישום שלך בפנקס באופן תקופתי, ונודיע לך
          מראש אם יידרש לחדש.
        </p>
      </div>
    </div>',
   '<div dir="ltr" lang="en" style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
      <div style="background:#047857;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:22px;font-weight:700">✓ Verified</div>
        <div style="font-size:13px;opacity:.9;margin-top:2px">Your Shivutz account is fully active</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;font-size:18px">Hello {{contact_name}},</h2>
        <p style="margin:0 0 12px;line-height:1.6">
          Verification of <strong>{{company_name}}</strong> completed via
          {{verification_method_he}}. Your account is fully active.
        </p>
        <div style="background:#ecfdf5;border-left:4px solid #047857;padding:12px 16px;margin:16px 0;border-radius:6px 0 0 6px">
          <strong>What you can do now:</strong>
          <ul style="margin:8px 0 0 0;padding-left:20px;line-height:1.7;font-size:14px">
            <li>Submit applications to corporations and participate in deals</li>
            <li>Publish projects and manage execution</li>
            <li>Receive payments through the platform</li>
          </ul>
        </div>
        <p style="text-align:center;margin:24px 0">
          <a href="{{dashboard_url}}"
             style="display:inline-block;background:#0f4c81;color:#fff;text-decoration:none;
                    padding:12px 28px;border-radius:6px;font-weight:600">
            Open dashboard
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5">
          Verification is valid for six months. We will re-check your registry listing
          periodically and notify you in advance if renewal is needed.
        </p>
      </div>
    </div>',
   '{"contact_name":"string","company_name":"string","verification_method_he":"string","dashboard_url":"string"}')

ON DUPLICATE KEY UPDATE
  subject_he = VALUES(subject_he),
  subject_en = VALUES(subject_en),
  body_he = VALUES(body_he),
  body_en = VALUES(body_en),
  variables_schema = VALUES(variables_schema),
  is_active = TRUE,
  updated_at = NOW();
