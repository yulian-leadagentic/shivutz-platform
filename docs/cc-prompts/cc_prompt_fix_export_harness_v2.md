# CC prompt — תיקון סופי ל-screens-export harness (auth + hard gate + deploy-wait)

## למה שוב
ה-export האחרון **לא שמיש**: (1) כל מסך מאובטח צולם כדף **login** (אשכול 67850 bytes זהה, כולל contractor/corp/admin) — auth לא נתפס; (2) התוכן **ישן** — הלנדינג עדיין מראה אריחים-מעל-חיפוש + 3 dropdowns + "בקרוב" גלוי + לוגו ישן, כלומר הריצה פגעה בגרסה שלפני landing-IA/logo/M3.1. הסניטי-גייט שהוגדר קודם **לא הפיל את הריצה** — הקבצים נכתבו בכל זאת.

**המטרה:** שה-export ייכשל רועש כשה-auth לא תפס, ולא ייצור אף פעם captures מטעים; ושהוא ירוץ רק מול staging שסיים deploy.

## ⭐ STANDING RULE
`git tag pre-harness-v2` לפני. harness/tooling בלבד — **בלי שינויי אפליקציה**. staging בלבד.

---

## Do

### 1. deploy-freshness gate (לפני הכל)
1. לפני צילום, בקש `GET /` ואמת שהתוכן החי הוא הגרסה הנוכחית — assertion על **סמן ייחודי מ-landing-IA**: החיפוש מופיע לפני האריחים / "סינון מתקדם" קיים / אריחי "בקרוב" מוסתרים / הלוגו החדש (`/brand/…`) נטען.
2. אם הסמן חסר → הדפס "staging stale / mid-deploy", **המתן ונסה שוב** (polling עד N דקות), ואם עדיין ישן — **exit non-zero** בלי לכתוב captures.

### 2. auth שתופס (מקור אמת אחד)
1. בדוק את חוזה ה-auth הנוכחי: `/auth/send-otp` + `/auth/login/otp`, ושם ה-cookie/token המדויק שה-app קורא ל-session (אחרי כל שינויי ה-auth).
2. תקן את שלב ה-auth לשתול את ה-cookie/token הנכון כך ש-RoleGuard רואה session.
3. השתמש ב-MASTER_OTP `999999`, טלפון multi-membership `0525278625`.

### 3. HARD sanity-gate (הפעם באמת עוצר)
1. אחרי auth, לפני צילום מסכים מאובטחים: טען `/contractor/dashboard`, ו-**assert שהתוכן אינו דף ה-login** (בדוק היעדר שדה "מספר טלפון נייד" / כפתור "שלח קוד" / כותרת "כניסה למערכת", ונוכחות אלמנט authed-only).
2. אם ה-assert נכשל → **exit non-zero מיד, בלי לכתוב שום capture מאובטח**. הדפס איזה מסך הפעיל את הכשל.
3. הוסף בדיקת "כל ה-captures המאובטחים אינם באותו byte-size/hash" — אם קבוצה שלמה זהה → כשל רועש (זה הדפוס שראינו: 67850 זהה).

### 4. הרצה + דיווח
1. הרץ **שני** viewports (390 + דסקטופ) מול staging הטרי.
2. דווח per-screen: מה נלכד — תוכן אמיתי / NoAccessCard (היכן שצפוי) / login (אמור להיות 0). אם יש login אחד — הריצה נכשלה.
3. חשבון הבדיקה קבלן+תאגיד+מנהל — מסכי תאגיד/admin אמורים להיות אמיתיים, לא NoAccessCard.

## Acceptance
- [ ] `deploy-freshness` gate: הריצה מסרבת לרוץ מול staging ישן (assert על סמן landing-IA/logo).
- [ ] auth נתפס: מסכים מאובטחים = תוכן אמיתי, **0 מסכי login**.
- [ ] hard sanity-gate: אם auth נכשל → exit non-zero, **אפס captures מטעים** נכתבים.
- [ ] בדיקת "אשכול זהה" תופסת את דפוס ה-67850.
- [ ] export טרי לשני ה-viewports; דיווח per-screen.

## Guardrails
`git tag pre-harness-v2`; test-harness/tooling בלבד, **בלי שינויי אפליקציה**; staging בלבד; לא לגעת ב-OTP crypto. דווח: שם ה-cookie/token שתוקן, הסמן ששימש ל-deploy-gate, ותוצאת הריצה (כמה אמיתי / NoAccessCard / login).
