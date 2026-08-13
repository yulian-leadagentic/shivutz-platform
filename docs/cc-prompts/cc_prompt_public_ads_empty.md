# CC prompt — מודעות ה-seed לא צפות ל-API הציבורי (חיפוש מחזיר 0)

## ממצא מאומת חי (Claude)
staging טרי, `/api/ads/public/*` = **200 אבל ריק**:
- `GET /api/ads/public/recent?limit=20` → `{"results":[]}` (**0**, נבדק עם ביטול-cache)
- `GET /api/ads/public/featured?limit=12` → `{"results":[]}` (**0**)
- `POST /api/search` → ה-AI parse עובד ("המנוע הבין: עובדים · מקצוע: flooring") אבל **0 תוצאות**.

תיקון הגייטווי (typo `geteway`) החזיר את הראוטים ל-200 — אבל **לא פתר את הריקנות**. אין מודעות ציבוריות למרות seed של 50.

## אבחון קוד (Claude — `tools/seed/seed.mjs`)
- ה-seed יוצר מודעות דרך `POST /api/organizations/ads` (שורה ~133) **בלי לקבוע `status`** → המודעה מקבלת את ברירת-המחדל של ה-endpoint.
- הערה מפורשת בקוד (~שורה 197): קביעת מנוי דורשת **admin JWT + `POST /api/admin/subscriptions/...`** — כלומר ה-seed **לא נותן לתאגידים מנוי פעיל**; הם נשארים trial.

**שתי היפותזות (בדוק שתיהן):**
1. מודעה חדשה נוצרת כ-**draft/pending** → ה-public מסנן `published` → ריק. חסר צעד "פרסום" ב-seed.
2. המאגר הציבורי דורש **תאגיד עם מנוי פעיל** (מודל pivot) → תאגידי ה-seed ב-trial → מסוננים החוצה.

## ⭐ STANDING RULE
`git tag pre-public-ads-empty` לפני. staging בלבד. דווח מספרים (כמה ads בטבלה, כמה עוברות את פילטר ה-public, ומה חסם).

## Do
1. **אשר קיום:** כמה שורות ads יש ב-DB של staging ומה ה-`status`/flags שלהן.
2. **קרא את פילטר ה-public** (`/api/ads/public/recent|featured|search`) — מה בדיוק ה-WHERE (status? public? published_at? join למנוי פעיל של הבעלים?).
3. **מצא את הפער** בין (1) ל-(2) — זו הסיבה לריקנות.
4. **תקן:**
   - אם status: גרום למודעות ה-seed להיווצר/להתפרסם כ-`published` (הוסף צעד publish, או פרמטר ביצירה).
   - אם מנוי: תן לתאגידי ה-seed מנוי פעיל (דרך ה-admin path שה-seed ציין שחסר), או הקל את הגייט ל-staging.
   - עדכן `tools/seed/seed.mjs` בהתאם, ואז `npm run seed:reset && npm run seed:staging`.
5. **אמת:** `recent` > 0, `featured` מחזיר מקודמות, ו-`POST /api/search {"query":"פועלים לריצוף"}` מחזיר תוצאות ריצוף.

Acceptance:
- [ ] `/api/ads/public/recent` מחזיר את מודעות ה-seed (>0).
- [ ] חיפוש "פועלים לריצוף" → תוצאות (לא 0).
- [ ] דיווח: כמה ads, מה חסם (status vs מנוי), ומה תוקן.

## FIX נוסף (P1) — קופי empty-state
"לא נמצאו מודעות" מציג "להסיר סינון" גם כשאין סינון פעיל. הפוך למותנה — הצע "להסיר סינון" רק כשקיים פילטר פעיל.

## הערה (P2, design) — "חיפוש AI שנראה מיושן"
אחרי שהתוצאות חוזרות, ליטוש אזור התוצאות/empty שירגיש כמו חיפוש חכם. נפרד.

## Guardrails
`git tag pre-public-ads-empty`; data/seed + פילטר-public + copy בלבד; לא לגעת בלוגיקת ה-LLM parse (עובד); production (main) לא נגעת.
