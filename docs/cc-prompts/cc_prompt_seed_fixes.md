# CC prompt — תיקוני seed קטנים (catalog + עושר)

שני תיקונים על ה-seed שכבר עובד (`recent` מחזיר מודעות אמיתיות ✓). לא דחוף.

## SF-1 — התאמת מקצוע לכותרת בקטלוג (באג נתונים)
מאומת חי: מודעות "2 רתכים מסרי לנקה" ו-"4 רתכים מאוקראינה" מתויגות `profession_code: "scaffolding"` — אבל **רתך = welding, לא פיגומים**. הכותרת והקוד לא תואמים → חיפוש "רתך" לא ימצא אותן.
Do: ב-`tools/seed/catalog.mjs` — התאם `profession_code` לכותרת בכל המודעות (רתכים→`welding`, ריצוף→`flooring`, טיח→`plastering`, ברזלן→..., וכו'). ודא שכל `profession_code` חוקי מול ה-enum. `npm run seed:reset && npm run seed:staging`.
Acceptance: כל מודעה — הכותרת בעברית תואמת ל-`profession_code`; חיפוש "רתך" מחזיר את מודעות הרתכים.

## SF-2 — להגיע ל-~50 מודעות (עושר לדמו, עדיפות נמוכה)
כרגע רק 6 מודעות ציבוריות: tier Basic מוגבל ל-`active_ads=3` (2 תאגידים ראשונים × 3), ו-8 התאגידים הנותרים נחסמו ב-IP rate-limit על login.
Do (כשנוח, לא דחוף):
1. תן לתאגידי ה-seed **tier גבוה יותר** (advanced=15 / pro=unlimited) דרך `POST /api/admin/subscriptions/…` — צריך wiring של SEED_ADMIN ב-runner.
2. הרץ cycle 2 אחרי ~10 דק' (reset של ה-rate-limit) לשאר התאגידים.
Acceptance: `recent` מחזיר ~40–50 מודעות מגוונות.
Guardrail: `git tag pre-seed-fixes`; catalog+seed בלבד; staging בלבד.
