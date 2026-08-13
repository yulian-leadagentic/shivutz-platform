# CC prompt — Tenders T1: אודיט end-to-end + הקשחה

## מטרה
למפות את זירת ה-tenders הקיימת ולוודא בסיס יציב לפני הרחבה. **אודיט + תיקוני-יסוד בלבד — לא פיצ'רים חדשים** (אלה T2–T5).

## ⭐ STANDING RULE
`git tag pre-tenders-t1` לפני. staging בלבד. mobile 390 + דסקטופ. DoD = מפת-מצב + תיקונים.

## Do

### 1. אודיט זרימה (דוח, לא שינוי)
עבור על הזרימה ודווח **per-שלב** מה מומש / stub / חסר, עם קובץ+endpoint:
- **יצירה:** `/contractor/tenders/new` — אילו שדות per-line נשמרים? איזה endpoint? נוצר בסטטוס מה?
- **publish-gate:** `/admin/tenders` — איך admin מאשר? מה משנה סטטוס ל-`published`?
- **bid:** `/corporation/tenders` — תאגיד רואה בקשות שפורסמו? מגיש bid per-line? ref אנונימי מיושם?
- **בחירת זוכה:** `/contractor/tenders/[id]` — קבלן רואה bids ובוחר זוכה?
- **reveal:** אישור admin לזוכה → SMS חילופי קשר — מחובר?
- טבלאות `tenders/tender_line_items/bids` — סכמה + סטטוסים בפועל.

### 2. תיקוני-יסוד (הקשחה)
- **`/contractor/tenders` empty-state:** לקבלן טרי כרגע "לא ניתן לטעון" — הפוך ל-empty-state נקי ("עדיין אין בקשות · בקשה חדשה"), לא שגיאה אדומה. (מתלכד עם פרומט empty-states — עשה במקום אחד.)
- כל מסך tenders (קבלן/תאגיד/admin): loading=skeleton, error אמיתי בלבד באדום, empty=CTA — עקבי ל-DS.
- ודא שכל endpoint של tenders מחזיר עברית מובנית (mapApiError), לא raw/אנגלית.

### 3. פערים חוסמים (רשום, אל תבנה)
כל דבר שחסר לזרימה end-to-end (למשל: אין UI להגשת bid, אין בחירת-זוכה, reveal לא מחובר) — **רשום כפער ממוספר** ל-T2–T5, אל תממש עכשיו.

## Acceptance
- [ ] דוח מיפוי per-שלב (מומש/stub/חסר + קובץ+endpoint + סטטוסים).
- [ ] `/contractor/tenders` (וכל מסכי tenders) מציגים empty-state נקי, לא שגיאה, לחשבון טרי.
- [ ] רשימת פערים ממוספרת ל-T2–T5.
- [ ] mobile 390 + דסקטופ.

## Guardrails
`git tag pre-tenders-t1`; אודיט + empty/error-handling בלבד — **בלי פיצ'רים חדשים**; DS tokens; לא לגעת בלוגיקת bid/reveal (רק לתעד); production (main) לא נגעת.
