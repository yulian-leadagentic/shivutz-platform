-- 106 · R38 item 2 · no em dash in the text we store and show
--
-- Rule (Yulian, 16.11.2026): no em dash (U+2014) in anything a user
-- reads. The code side is fixed in the same round and locked by
-- scripts/em-dash-scan.mjs and scripts/em_dash_scan.py. This is the
-- database side: every em dash found on staging in our own content.
--
--   notif_db.notification_templates   subjects and bodies, he and en
--   org_db.legal_documents            accessibility, terms
--   org_db.marketplace_listings       the seed listings' titles
--   org_db.sponsor_ads                the seed sponsor ads
--
-- Each change is one REPLACE of the exact phrase around the dash,
-- chosen by context: a colon after a short label, a comma inside a
-- sentence, a full stop between two sentences. Never a hyphen. A
-- phrase that is not there is not touched, so the migration is
-- idempotent and leaves alone anything an admin has edited since.
--
-- Legal documents go the way a save from /admin/legal goes, as 100 did:
-- the body being replaced is copied to legal_document_history under its
-- version, the version is bumped, updated_by names this migration.
--
-- NOT changed:
--   * the privacy policy. R38 item 8 says its text is not to change in
--     this round; it holds 36 em dashes. Reported for a decision.
--   * legal_document_history, notification_log, sms_log: records of
--     what was shown or sent at the time.
--   * listings and sponsor ads an advertiser wrote (is_seed = 0). There
--     are none with a dash today.

USE notif_db;

UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'נמצאה התאמה מלאה לבקשתך — {{project_name}}', 'נמצאה התאמה מלאה לבקשתך: {{project_name}}') WHERE LOCATE('נמצאה התאמה מלאה לבקשתך — {{project_name}}', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'נמצאה התאמה מלאה לבקשתך — {{project_name}}', 'נמצאה התאמה מלאה לבקשתך: {{project_name}}') WHERE LOCATE('נמצאה התאמה מלאה לבקשתך — {{project_name}}', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'נמצאה התאמה מלאה לבקשתך — {{project_name}}', 'נמצאה התאמה מלאה לבקשתך: {{project_name}}') WHERE LOCATE('נמצאה התאמה מלאה לבקשתך — {{project_name}}', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'נמצאה התאמה מלאה לבקשתך — {{project_name}}', 'נמצאה התאמה מלאה לבקשתך: {{project_name}}') WHERE LOCATE('נמצאה התאמה מלאה לבקשתך — {{project_name}}', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'חשבונך אושר — ברוך הבא', 'חשבונך אושר, ברוך הבא') WHERE LOCATE('חשבונך אושר — ברוך הבא', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'חשבונך אושר — ברוך הבא', 'חשבונך אושר, ברוך הבא') WHERE LOCATE('חשבונך אושר — ברוך הבא', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'חשבונך אושר — ברוך הבא', 'חשבונך אושר, ברוך הבא') WHERE LOCATE('חשבונך אושר — ברוך הבא', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'חשבונך אושר — ברוך הבא', 'חשבונך אושר, ברוך הבא') WHERE LOCATE('חשבונך אושר — ברוך הבא', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'סתירה בדיווחי חוזה — נדרש טיפול', 'סתירה בדיווחי חוזה: נדרש טיפול') WHERE LOCATE('סתירה בדיווחי חוזה — נדרש טיפול', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'סתירה בדיווחי חוזה — נדרש טיפול', 'סתירה בדיווחי חוזה: נדרש טיפול') WHERE LOCATE('סתירה בדיווחי חוזה — נדרש טיפול', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'סתירה בדיווחי חוזה — נדרש טיפול', 'סתירה בדיווחי חוזה: נדרש טיפול') WHERE LOCATE('סתירה בדיווחי חוזה — נדרש טיפול', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'סתירה בדיווחי חוזה — נדרש טיפול', 'סתירה בדיווחי חוזה: נדרש טיפול') WHERE LOCATE('סתירה בדיווחי חוזה — נדרש טיפול', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'שלב אחרון — אימות בעלות', 'שלב אחרון: אימות בעלות') WHERE LOCATE('שלב אחרון — אימות בעלות', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'שלב אחרון — אימות בעלות', 'שלב אחרון: אימות בעלות') WHERE LOCATE('שלב אחרון — אימות בעלות', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'שלב אחרון — אימות בעלות', 'שלב אחרון: אימות בעלות') WHERE LOCATE('שלב אחרון — אימות בעלות', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'שלב אחרון — אימות בעלות', 'שלב אחרון: אימות בעלות') WHERE LOCATE('שלב אחרון — אימות בעלות', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'נדרש אימות מחדש ב-BuildUp — הרישום', 'נדרש אימות מחדש ב-BuildUp: הרישום') WHERE LOCATE('נדרש אימות מחדש ב-BuildUp — הרישום', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'נדרש אימות מחדש ב-BuildUp — הרישום', 'נדרש אימות מחדש ב-BuildUp: הרישום') WHERE LOCATE('נדרש אימות מחדש ב-BuildUp — הרישום', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'נדרש אימות מחדש ב-BuildUp — הרישום', 'נדרש אימות מחדש ב-BuildUp: הרישום') WHERE LOCATE('נדרש אימות מחדש ב-BuildUp — הרישום', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'נדרש אימות מחדש ב-BuildUp — הרישום', 'נדרש אימות מחדש ב-BuildUp: הרישום') WHERE LOCATE('נדרש אימות מחדש ב-BuildUp — הרישום', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'החשבון שלך אומת — גישה מלאה', 'החשבון שלך אומת, גישה מלאה') WHERE LOCATE('החשבון שלך אומת — גישה מלאה', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'החשבון שלך אומת — גישה מלאה', 'החשבון שלך אומת, גישה מלאה') WHERE LOCATE('החשבון שלך אומת — גישה מלאה', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'החשבון שלך אומת — גישה מלאה', 'החשבון שלך אומת, גישה מלאה') WHERE LOCATE('החשבון שלך אומת — גישה מלאה', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'החשבון שלך אומת — גישה מלאה', 'החשבון שלך אומת, גישה מלאה') WHERE LOCATE('החשבון שלך אומת — גישה מלאה', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'תאגיד הציג רשימת עובדים — נדרש אישור', 'תאגיד הציג רשימת עובדים: נדרש אישור') WHERE LOCATE('תאגיד הציג רשימת עובדים — נדרש אישור', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'תאגיד הציג רשימת עובדים — נדרש אישור', 'תאגיד הציג רשימת עובדים: נדרש אישור') WHERE LOCATE('תאגיד הציג רשימת עובדים — נדרש אישור', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'תאגיד הציג רשימת עובדים — נדרש אישור', 'תאגיד הציג רשימת עובדים: נדרש אישור') WHERE LOCATE('תאגיד הציג רשימת עובדים — נדרש אישור', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'תאגיד הציג רשימת עובדים — נדרש אישור', 'תאגיד הציג רשימת עובדים: נדרש אישור') WHERE LOCATE('תאגיד הציג רשימת עובדים — נדרש אישור', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'ברוכים הבאים ל-TagidAI — החשבון שלך פעיל', 'ברוכים הבאים ל-TagidAI, החשבון שלך פעיל') WHERE LOCATE('ברוכים הבאים ל-TagidAI — החשבון שלך פעיל', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'ברוכים הבאים ל-TagidAI — החשבון שלך פעיל', 'ברוכים הבאים ל-TagidAI, החשבון שלך פעיל') WHERE LOCATE('ברוכים הבאים ל-TagidAI — החשבון שלך פעיל', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'ברוכים הבאים ל-TagidAI — החשבון שלך פעיל', 'ברוכים הבאים ל-TagidAI, החשבון שלך פעיל') WHERE LOCATE('ברוכים הבאים ל-TagidAI — החשבון שלך פעיל', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'ברוכים הבאים ל-TagidAI — החשבון שלך פעיל', 'ברוכים הבאים ל-TagidAI, החשבון שלך פעיל') WHERE LOCATE('ברוכים הבאים ל-TagidAI — החשבון שלך פעיל', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, '</strong> — כל המשרות בבקשה מולאו', '</strong>: כל המשרות בבקשה מולאו') WHERE LOCATE('</strong> — כל המשרות בבקשה מולאו', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, '</strong> — כל המשרות בבקשה מולאו', '</strong>: כל המשרות בבקשה מולאו') WHERE LOCATE('</strong> — כל המשרות בבקשה מולאו', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, '</strong> — כל המשרות בבקשה מולאו', '</strong>: כל המשרות בבקשה מולאו') WHERE LOCATE('</strong> — כל המשרות בבקשה מולאו', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, '</strong> — כל המשרות בבקשה מולאו', '</strong>: כל המשרות בבקשה מולאו') WHERE LOCATE('</strong> — כל המשרות בבקשה מולאו', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'תוכל להתעלם מההודעה — לא יבוצע אימות', 'תוכל להתעלם מההודעה. לא יבוצע אימות') WHERE LOCATE('תוכל להתעלם מההודעה — לא יבוצע אימות', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'תוכל להתעלם מההודעה — לא יבוצע אימות', 'תוכל להתעלם מההודעה. לא יבוצע אימות') WHERE LOCATE('תוכל להתעלם מההודעה — לא יבוצע אימות', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'תוכל להתעלם מההודעה — לא יבוצע אימות', 'תוכל להתעלם מההודעה. לא יבוצע אימות') WHERE LOCATE('תוכל להתעלם מההודעה — לא יבוצע אימות', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'תוכל להתעלם מההודעה — לא יבוצע אימות', 'תוכל להתעלם מההודעה. לא יבוצע אימות') WHERE LOCATE('תוכל להתעלם מההודעה — לא יבוצע אימות', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'דרך מסך האישורים — בחירה במנהל', 'דרך מסך האישורים. בחירה במנהל') WHERE LOCATE('דרך מסך האישורים — בחירה במנהל', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'דרך מסך האישורים — בחירה במנהל', 'דרך מסך האישורים. בחירה במנהל') WHERE LOCATE('דרך מסך האישורים — בחירה במנהל', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'דרך מסך האישורים — בחירה במנהל', 'דרך מסך האישורים. בחירה במנהל') WHERE LOCATE('דרך מסך האישורים — בחירה במנהל', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'דרך מסך האישורים — בחירה במנהל', 'דרך מסך האישורים. בחירה במנהל') WHERE LOCATE('דרך מסך האישורים — בחירה במנהל', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'להגיב — לאחר מכן ההצעה תפוג', 'להגיב. לאחר מכן ההצעה תפוג') WHERE LOCATE('להגיב — לאחר מכן ההצעה תפוג', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'להגיב — לאחר מכן ההצעה תפוג', 'להגיב. לאחר מכן ההצעה תפוג') WHERE LOCATE('להגיב — לאחר מכן ההצעה תפוג', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'להגיב — לאחר מכן ההצעה תפוג', 'להגיב. לאחר מכן ההצעה תפוג') WHERE LOCATE('להגיב — לאחר מכן ההצעה תפוג', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'להגיב — לאחר מכן ההצעה תפוג', 'להגיב. לאחר מכן ההצעה תפוג') WHERE LOCATE('להגיב — לאחר מכן ההצעה תפוג', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'עם מספר הטלפון הזה — קוד OTP', 'עם מספר הטלפון הזה. קוד OTP') WHERE LOCATE('עם מספר הטלפון הזה — קוד OTP', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'עם מספר הטלפון הזה — קוד OTP', 'עם מספר הטלפון הזה. קוד OTP') WHERE LOCATE('עם מספר הטלפון הזה — קוד OTP', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'עם מספר הטלפון הזה — קוד OTP', 'עם מספר הטלפון הזה. קוד OTP') WHERE LOCATE('עם מספר הטלפון הזה — קוד OTP', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'עם מספר הטלפון הזה — קוד OTP', 'עם מספר הטלפון הזה. קוד OTP') WHERE LOCATE('עם מספר הטלפון הזה — קוד OTP', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, '{{category_name}} — בעברית חופשית', '{{category_name}}, בעברית חופשית') WHERE LOCATE('{{category_name}} — בעברית חופשית', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, '{{category_name}} — בעברית חופשית', '{{category_name}}, בעברית חופשית') WHERE LOCATE('{{category_name}} — בעברית חופשית', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, '{{category_name}} — בעברית חופשית', '{{category_name}}, בעברית חופשית') WHERE LOCATE('{{category_name}} — בעברית חופשית', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, '{{category_name}} — בעברית חופשית', '{{category_name}}, בעברית חופשית') WHERE LOCATE('{{category_name}} — בעברית חופשית', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'החשבון פעיל מיד — אין תור אישור', 'החשבון פעיל מיד, אין תור אישור') WHERE LOCATE('החשבון פעיל מיד — אין תור אישור', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'החשבון פעיל מיד — אין תור אישור', 'החשבון פעיל מיד, אין תור אישור') WHERE LOCATE('החשבון פעיל מיד — אין תור אישור', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'החשבון פעיל מיד — אין תור אישור', 'החשבון פעיל מיד, אין תור אישור') WHERE LOCATE('החשבון פעיל מיד — אין תור אישור', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'החשבון פעיל מיד — אין תור אישור', 'החשבון פעיל מיד, אין תור אישור') WHERE LOCATE('החשבון פעיל מיד — אין תור אישור', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'your request — {{project_name}}', 'your request: {{project_name}}') WHERE LOCATE('your request — {{project_name}}', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'your request — {{project_name}}', 'your request: {{project_name}}') WHERE LOCATE('your request — {{project_name}}', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'your request — {{project_name}}', 'your request: {{project_name}}') WHERE LOCATE('your request — {{project_name}}', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'your request — {{project_name}}', 'your request: {{project_name}}') WHERE LOCATE('your request — {{project_name}}', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'Final step — verify', 'Final step: verify') WHERE LOCATE('Final step — verify', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'Final step — verify', 'Final step: verify') WHERE LOCATE('Final step — verify', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'Final step — verify', 'Final step: verify') WHERE LOCATE('Final step — verify', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'Final step — verify', 'Final step: verify') WHERE LOCATE('Final step — verify', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'Re-verification required — your', 'Re-verification required: your') WHERE LOCATE('Re-verification required — your', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'Re-verification required — your', 'Re-verification required: your') WHERE LOCATE('Re-verification required — your', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'Re-verification required — your', 'Re-verification required: your') WHERE LOCATE('Re-verification required — your', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'Re-verification required — your', 'Re-verification required: your') WHERE LOCATE('Re-verification required — your', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'Account verified — full access', 'Account verified, full access') WHERE LOCATE('Account verified — full access', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'Account verified — full access', 'Account verified, full access') WHERE LOCATE('Account verified — full access', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'Account verified — full access', 'Account verified, full access') WHERE LOCATE('Account verified — full access', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'Account verified — full access', 'Account verified, full access') WHERE LOCATE('Account verified — full access', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'worker list — your approval', 'worker list: your approval') WHERE LOCATE('worker list — your approval', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'worker list — your approval', 'worker list: your approval') WHERE LOCATE('worker list — your approval', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'worker list — your approval', 'worker list: your approval') WHERE LOCATE('worker list — your approval', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'worker list — your approval', 'worker list: your approval') WHERE LOCATE('worker list — your approval', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'Welcome to TagidAI — your account', 'Welcome to TagidAI, your account') WHERE LOCATE('Welcome to TagidAI — your account', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'Welcome to TagidAI — your account', 'Welcome to TagidAI, your account') WHERE LOCATE('Welcome to TagidAI — your account', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'Welcome to TagidAI — your account', 'Welcome to TagidAI, your account') WHERE LOCATE('Welcome to TagidAI — your account', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'Welcome to TagidAI — your account', 'Welcome to TagidAI, your account') WHERE LOCATE('Welcome to TagidAI — your account', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, '</strong> — every position', '</strong>: every position') WHERE LOCATE('</strong> — every position', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, '</strong> — every position', '</strong>: every position') WHERE LOCATE('</strong> — every position', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, '</strong> — every position', '</strong>: every position') WHERE LOCATE('</strong> — every position', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, '</strong> — every position', '</strong>: every position') WHERE LOCATE('</strong> — every position', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'ignore the email — no verification', 'ignore the email. No verification') WHERE LOCATE('ignore the email — no verification', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'ignore the email — no verification', 'ignore the email. No verification') WHERE LOCATE('ignore the email — no verification', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'ignore the email — no verification', 'ignore the email. No verification') WHERE LOCATE('ignore the email — no verification', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'ignore the email — no verification', 'ignore the email. No verification') WHERE LOCATE('ignore the email — no verification', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'approvals screen — admin approval', 'approvals screen. Admin approval') WHERE LOCATE('approvals screen — admin approval', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'approvals screen — admin approval', 'approvals screen. Admin approval') WHERE LOCATE('approvals screen — admin approval', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'approvals screen — admin approval', 'approvals screen. Admin approval') WHERE LOCATE('approvals screen — admin approval', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'approvals screen — admin approval', 'approvals screen. Admin approval') WHERE LOCATE('approvals screen — admin approval', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'this phone number — an OTP code', 'this phone number. An OTP code') WHERE LOCATE('this phone number — an OTP code', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'this phone number — an OTP code', 'this phone number. An OTP code') WHERE LOCATE('this phone number — an OTP code', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'this phone number — an OTP code', 'this phone number. An OTP code') WHERE LOCATE('this phone number — an OTP code', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'this phone number — an OTP code', 'this phone number. An OTP code') WHERE LOCATE('this phone number — an OTP code', body_en) > 0;
UPDATE notification_templates SET subject_he = REPLACE(subject_he, 'active immediately — no approval queue', 'active immediately, no approval queue') WHERE LOCATE('active immediately — no approval queue', subject_he) > 0;
UPDATE notification_templates SET body_he = REPLACE(body_he, 'active immediately — no approval queue', 'active immediately, no approval queue') WHERE LOCATE('active immediately — no approval queue', body_he) > 0;
UPDATE notification_templates SET subject_en = REPLACE(subject_en, 'active immediately — no approval queue', 'active immediately, no approval queue') WHERE LOCATE('active immediately — no approval queue', subject_en) > 0;
UPDATE notification_templates SET body_en = REPLACE(body_en, 'active immediately — no approval queue', 'active immediately, no approval queue') WHERE LOCATE('active immediately — no approval queue', body_en) > 0;

USE org_db;

INSERT INTO legal_document_history (id, slug, version, body_md, replaced_by)
SELECT UUID(), slug, version, body_md, 'migration_106'
  FROM legal_documents WHERE slug = 'accessibility' AND (LOCATE('שינויי מצב בתהליך החיפוש — טעינה, מספר תוצאות, שגיאה — מוכרזים', body_md) > 0 OR LOCATE('אם נתקלתם בקושי — נשמח', body_md) > 0 OR LOCATE('ואם רלוונטי — טכנולוגיה מסייעת', body_md) > 0);
UPDATE legal_documents
   SET body_md = REPLACE(REPLACE(REPLACE(body_md, 'שינויי מצב בתהליך החיפוש — טעינה, מספר תוצאות, שגיאה — מוכרזים', 'שינויי מצב בתהליך החיפוש (טעינה, מספר תוצאות, שגיאה) מוכרזים'), 'אם נתקלתם בקושי — נשמח', 'אם נתקלתם בקושי, נשמח'), 'ואם רלוונטי — טכנולוגיה מסייעת', 'ואם רלוונטי, טכנולוגיה מסייעת'),
       version = version + 1,
       updated_by = 'migration_106'
 WHERE slug = 'accessibility' AND (LOCATE('שינויי מצב בתהליך החיפוש — טעינה, מספר תוצאות, שגיאה — מוכרזים', body_md) > 0 OR LOCATE('אם נתקלתם בקושי — נשמח', body_md) > 0 OR LOCATE('ואם רלוונטי — טכנולוגיה מסייעת', body_md) > 0);

INSERT INTO legal_document_history (id, slug, version, body_md, replaced_by)
SELECT UUID(), slug, version, body_md, 'migration_106'
  FROM legal_documents WHERE slug = 'terms' AND (LOCATE('הסכם ותנאיו — נחתמים', body_md) > 0 OR LOCATE('**משתמשים עסקיים בלבד** — בגירים', body_md) > 0 OR LOCATE('**אינה נצברת** — מכסה', body_md) > 0 OR LOCATE('חשיפה שנוצלה — נספרת', body_md) > 0);
UPDATE legal_documents
   SET body_md = REPLACE(REPLACE(REPLACE(REPLACE(body_md, 'הסכם ותנאיו — נחתמים', 'הסכם ותנאיו נחתמים'), '**משתמשים עסקיים בלבד** — בגירים', '**משתמשים עסקיים בלבד**: בגירים'), '**אינה נצברת** — מכסה', '**אינה נצברת**: מכסה'), 'חשיפה שנוצלה — נספרת', 'חשיפה שנוצלה נספרת'),
       version = version + 1,
       updated_by = 'migration_106'
 WHERE slug = 'terms' AND (LOCATE('הסכם ותנאיו — נחתמים', body_md) > 0 OR LOCATE('**משתמשים עסקיים בלבד** — בגירים', body_md) > 0 OR LOCATE('**אינה נצברת** — מכסה', body_md) > 0 OR LOCATE('חשיפה שנוצלה — נספרת', body_md) > 0);

UPDATE marketplace_listings SET title = 'קורס בטיחות בגובה, הסמכה תקפה' WHERE is_seed = 1 AND title = 'קורס בטיחות בגובה — הסמכה תקפה';
UPDATE marketplace_listings SET title = 'מתחם מגורים, 3 דירות סמוכות' WHERE is_seed = 1 AND title = 'מתחם מגורים — 3 דירות סמוכות';
UPDATE marketplace_listings SET title = 'כלי עבודה חשמליים, השכרה חודשית' WHERE is_seed = 1 AND title = 'כלי עבודה חשמליים — השכרה חודשית';
UPDATE marketplace_listings SET title = 'הסעות יומיות לאתרי בנייה, מיניבוס 20 מקומות' WHERE is_seed = 1 AND title = 'הסעות יומיות לאתרי בנייה — מיניבוס 20 מקומות';
UPDATE marketplace_listings SET title = 'ציוד מגן ובטיחות, חבילה חודשית' WHERE is_seed = 1 AND title = 'ציוד מגן ובטיחות — חבילה חודשית';
UPDATE marketplace_listings SET title = 'פיגומים להשכרה, מערכת מודולרית' WHERE is_seed = 1 AND title = 'פיגומים להשכרה — מערכת מודולרית';
UPDATE marketplace_listings SET title = 'ביטוח רפואי לעובדים זרים, כיסוי מלא' WHERE is_seed = 1 AND title = 'ביטוח רפואי לעובדים זרים — כיסוי מלא';

UPDATE sponsor_ads SET headline_he = REPLACE(headline_he, 'ליסינג טרקטורים ומחפרונים — ללא מקדמה', 'ליסינג טרקטורים ומחפרונים, ללא מקדמה') WHERE is_seed = 1 AND LOCATE('ליסינג טרקטורים ומחפרונים — ללא מקדמה', headline_he) > 0;
UPDATE sponsor_ads SET body_he = REPLACE(body_he, 'וחוזים מסודרים — בלי שתצטרך', 'וחוזים מסודרים, בלי שתצטרך') WHERE is_seed = 1 AND LOCATE('וחוזים מסודרים — בלי שתצטרך', body_he) > 0;
UPDATE sponsor_ads SET body_he = REPLACE(body_he, 'וציוד מטבח — אספקה והרכבה', 'וציוד מטבח: אספקה והרכבה') WHERE is_seed = 1 AND LOCATE('וציוד מטבח — אספקה והרכבה', body_he) > 0;
UPDATE sponsor_ads SET headline_he = REPLACE(headline_he, 'כלי ריצוף מקצועיים — משלוח לאתר', 'כלי ריצוף מקצועיים, משלוח לאתר') WHERE is_seed = 1 AND LOCATE('כלי ריצוף מקצועיים — משלוח לאתר', headline_he) > 0;
UPDATE sponsor_ads SET headline_he = REPLACE(headline_he, 'ביטוח עובדים זרים — חובה לפני', 'ביטוח עובדים זרים: חובה לפני') WHERE is_seed = 1 AND LOCATE('ביטוח עובדים זרים — חובה לפני', headline_he) > 0;
