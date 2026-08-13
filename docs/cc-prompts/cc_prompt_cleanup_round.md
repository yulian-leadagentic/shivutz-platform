# CC prompt — סבב ניקוי זנבות (3 פריטים). הרץ בסדר.

## ⭐ STANDING RULE
Mobile-first RTL, 390px + דסקטופ. `git tag pre-<item>` לפני כל פריט. דווח before/after + קובץ/שורה לכל תיקון.

---

## CU-1 (P0) — סגירת פער: אריח-נחיתה לתפקיד שהמשתמש לא חבר בו
בעקבות תיקון ה-entity-switch: אריחי ה-LiveShowcase מפנים משתמש מחובר בתפקיד ההפוך ל-`/select-entity?intent=<role>` — **בלי לבדוק חברות**. משתמש **קבלן-בלבד** שלוחץ אריח "תאגיד" מגיע ל-`/select-entity?intent=corporation` בלי חברות תואמת → dead-end (picker עם ישות אחת / bounce ל-login).

⚠️ **חשבון הבדיקה `0525278625` מסתיר את הבאג** — הוא multi-membership (קבלן+תאגיד+מנהל), אז ל-intent תמיד יש התאמה. חובה לבדוק את הלוגיקה, לא רק את החשבון הזה.

Do:
1. ב-`select-entity/page.tsx`: כש-`?intent=<role>` קיים אבל **אין חברות תואמת** ל-role הזה ברשימת ה-memberships → `router.replace('/register/<intent>?add=1')` (add-role), לא picker ולא `/login`.
2. אם `intent` קיים ו**יש בדיוק חברות אחת** תואמת → auto-prime + ניווט ישיר לדשבורד שלה (בלי picker).
3. אם `intent` קיים ו**יש כמה** תואמות → picker מסונן ל-role הזה.
4. ודא שהגבול נשמר: NoAccessCard "הוסף חשבון" + אריח לא-חבר → שניהם `/register/<role>?add=1`.

Acceptance:
- [ ] קבלן-בלבד → אריח "תאגיד" → `/register/corporation?add=1` (add-role), **לא** login ולא picker ריק.
- [ ] מחובר עם חברות אחת תואמת ל-intent → ישר לדשבורד, בלי picker.
- [ ] מחובר עם כמה תואמות → picker מסונן.
- [ ] multi-membership (0525278625) עדיין עובד כמו קודם.
Guardrails: `git tag pre-intent-gap`; FE-only, לא לגעת ב-OTP/auth; לעבור דרך אותו `/auth/memberships`.

---

## CU-2 (קטן) — מונה הקרוסלה מציג "3 / 1" (RTL bidi)
בכרטיס המקודם המונה מוצג הפוך ("3 / 1" במקום "1 / 3"). ה-clamp תיקן טווח, אבל המחרוזת מתהפכת ויזואלית כי היא בהקשר RTL.
Do:
1. עטוף את אלמנט המונה ב-`dir="ltr"` (bidi isolation) — עקבי עם כלל ה-DS "מספרים/קודים = LTR".
2. ודא הפורמט `current / total` (למשל "1 / 3"), נספר מ-1, `current ≤ total`.
Acceptance: המונה קורא "1 / 3" נכון ב-390px + דסקטופ; אף פעם לא הפוך ולא מחוץ לטווח.
Guardrails: `git tag pre-counter-ltr`; שינוי תצוגה בלבד.

---

## CU-3 (P1) — "המנוי שלך —" לא נטען (מקף ריק)
בדשבורד הקבלן ובחיוב מוצג "המנוי שלך —" עם מקף ריק גם כשיש/אין מנוי — אין tier נוכחי ואין מד trial/מכסת-חשיפות (O6).
Do:
1. אבחן: פתח את קריאת ה-API של נתוני המנוי (subscription/tier) בדשבורד — האם היא נכשלת בשקט (4xx/5xx), מחזירה ריק, או שה-FE לא ממפה את התגובה? הדפס את ה-status + ה-payload.
2. אם שגיאת API → תקן את המקור (endpoint/מיפוי). אם אין מנוי פעיל → הצג **empty-state אמיתי** ("אין מנוי פעיל · רכוש מנוי") במקום מקף ריק.
3. אם יש מנוי → הצג tier נוכחי + מד trial/מכסת-חשיפות (O6) קריא, כולל 390px.
4. השתמש במסר שגיאה מובנה בעברית (חוזה P0-1 `mapApiError`) אם הקריאה נכשלת — לא מקף שקט.
Acceptance: הדשבורד מציג tier נוכחי אמיתי / empty-state ברור / שגיאה בעברית — לעולם לא מקף ריק מעורפל; מד trial/מכסה נראה כשרלוונטי; קריא ב-390px.
Guardrails: `git tag pre-subscription-load`; לא לגעת בלוגיקת חיוב/Cardcom — קריאה+תצוגה בלבד; דווח את ה-root cause (שגיאה שקטה vs אין-מנוי).

---

## אחרי הכל
דווח SHA שנפרס בסטייג'ינג + before/after לכל CU. production (main) לא נגעת — staging עד אישור מפורש.
