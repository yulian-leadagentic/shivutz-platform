# R17 · 🔴 `FRONTEND_URL` — ברירת מחדל אחת חריגה, בדיוק במסלול שזה עתה נחת

## ⭐ `git tag pre-r17`. **קצר. אבל §1 חוסם השקה.**

---

# §1 · 🔴 ברירת המחדל בזרימת הספק מצביעה לדומיין נטוש, בסאב-דומיין של סטייג׳ינג

`services/user-org/app/routes/providers.py:407`

```python
frontend_url = os.getenv("FRONTEND_URL", "https://staging.buildupai.net")
```

## מה שהופך את זה לחד־משמעי — כל שאר הקוד עושה את זה נכון

```
services/admin/app/routes/users.py:23           →  https://www.tagidai.com
services/user-org/app/routes/contractors.py:21  →  https://www.tagidai.com
services/notification/src/consumers/handlers.js:10 → https://www.tagidai.com
services/user-org/app/routes/providers.py:407   →  https://staging.buildupai.net   ← 🔴
```

**ארבעה מקומות. שלושה נכונים. אחד חריג — והוא החדש ביותר.**

⚠️ **והוא שגוי בשני צירים בבת אחת:** `buildupai.net` הוא **הדומיין הנטוש** (`middleware.ts:45` אומר זאת במפורש: *"the legacy domain"*), ו-`staging.` הוא **סביבת הבדיקות**.

## 🔴 ולמה זה דחוף היום ולא מחר

**`FRONTEND_URL` אינו מתועד.** בדקתי — הוא לא ב-`.env.example` ולא ב-`docs/ENVIRONMENTS.md`.

> **כלומר אין שום ערובה שהוא מוגדר על `user-org` בפרודקשן.**
> **וכשהוא לא מוגדר — `{cta_url}` במייל הברוכים־הבאים שזה עתה שלחת ב-R10 §6 מצביע ל-`https://staging.buildupai.net/provider/marketplace/new`.**

**זו בדיוק הדרישה שהוגדרה במפורש:** *״לאחר הרישום המשתמש צריך לעבור למסך יצירת המודעה שלו.״* **הקישור הזה נבנה מהשורה הזו.**

**מפרסם משלם ראשון מקבל מייל שמוביל אותו לדומיין מת.**

## ⚠️ וההערה שכבר הזהירה מזה

`services/notification/src/consumers/handlers.js:6-8`

> *"point at a legacy host when FRONTEND_URL is unset in a service env"*

**מישהו כבר זיהה את הסיכון וכתב עליו הערה. `providers.py` פשוט לא קיבל את התיקון.**

## Do

1. 🔴 **`providers.py:407` → `https://www.tagidai.com`.** זהה לשלושת האחרים
2. 🔴 **`FRONTEND_URL` ל-`.env.example` ול-`docs/ENVIRONMENTS.md`** — שורה לכל שירות שקורא אותו: `user-org` · `admin` · `notification`
3. **אמת בסטייג׳ינג שהוא מוגדר בפועל על שלושת השירותים.** 🔴 **הדבק את הערך בכל אחד. אם חסר באחד — דווח, זה שלי להגדיר**
4. ⚠️ **`grep` על כל `getenv`/`process.env` עם ברירת מחדל שהיא URL** — **יש עוד חריגים? דווח את כולם בטבלה.** אל תתקן בלי לדווח

---

# §2 · שני ה-CTA של מכירת הפרסום מצביעים לתיבה בדומיין הנטוש

```
features/advertising/AdSidebar.tsx:14        mailto:ads@buildupai.net
features/advertising/InlineSponsoredAd.tsx:13 mailto:ads@buildupai.net
```

**שתיהן מרונדרות בדף הבית** (`page.tsx` מייבא את שתיהן), **ושתיהן קריאייטיב בית — ״מקום פרסום זמין״ · ״פרסום כאן״.**

✅ **צדקת שלא לחווט להן אירועים ב-R6 §1a** — אין להן `sponsor_ads.id`, ההוק היה no-op. **השיקול היה נכון.**

> 🔴 **אבל אלה בדיוק שתי נקודות ההמרה שבהן מפרסם פוטנציאלי אומר ״אני רוצה לפרסם כאן״ — והן מצביעות לתיבה בדומיין נטוש.**
> **זה אפיק ההכנסה שבשבילו בנינו את R6. אם התיבה לא קיימת, כל פנייה נופלת בשקט.**

## Do

- **החלף את ברירת המחדל ב-`href` בשתיהן.** ⚠️ **אל תמציא כתובת** — השתמש ב-`ads@tagidai.com` **וסמן `לאישור Yulian`**
- **ודא שה-`subject` המקודד נשאר תקין** אחרי השינוי. הדבק את שני ה-`href` המלאים
- ⚠️ **הן כבר מקבלות `href` כ-prop.** **בדוק אם `page.tsx` מעביר ערך משלו** — אם כן, תקן גם שם

---

# §3 · מה לא בסבב הזה

🔴 **אל תגע בהערות שמזכירות `staging.buildupai.net` בתוך טקסט הסבר** — `page.tsx:58,524,540`, `admin/leads/page.tsx:42`, `admin/orgs/[id]/page.tsx:96`, `corporation/marketplace/subscribe/page.tsx:46`.

**הן מתעדות היכן נמדדו נתונים היסטוריים. שינוי שלהן משכתב היסטוריה ומנפח את הדיף.**

🔴 **`middleware.ts:55-56` — `buildupai.net` ו-`www.buildupai.net` נשארים ברשימה.** הם שם בכוונה, להפניית הדומיין הישן.

---

# Acceptance

## §1

- [ ] 🔴 **`providers.py:407` → `www.tagidai.com`.** הדבק את השורה
- [ ] 🔴 **ארבע ברירות המחדל זהות.** `grep` על כל ארבע — הדבק
- [ ] **`FRONTEND_URL` ב-`.env.example` וב-`ENVIRONMENTS.md`,** עם שלושת השירותים
- [ ] 🔴 **הערך בפועל בסטייג׳ינג בשלושת השירותים.** הדבק
- [ ] 🔴 **הרשמת ספק חדש `@example.com` → המייל מגיע → `{cta_url}` הוא `tagidai.com`, לא `buildupai.net`.** **צילום של הקישור כפי שהתקבל במייל** — לא של הקוד
- [ ] **לחיצה על הקישור נוחתת על `/provider/marketplace/new` עם הקטגוריה.** צילום
- [ ] **טבלת כל ברירות המחדל שהן URL.** דווח

## §2

- [ ] שני ה-`href` מעודכנים. הדבק את שניהם במלואם
- [ ] ה-`subject` המקודד עדיין תקין. **לחץ על שניהם וצלם את חלון הדואר שנפתח**
- [ ] `page.tsx` — מעביר `href` משלו? דווח
- [ ] `לאישור Yulian` מסומן

## §3

- [ ] 🔴 **`git diff` — אפס שינוי בהערות ההיסטוריות וב-`middleware.ts`.** הדבק `--stat`

## רגרסיה

- [ ] R10 §6 — המייל עדיין נשלח ונראה תקין
- [ ] R6 — האירועים עדיין נרשמים
- [ ] מטריצת R13 · R15 · R16 — ללא שינוי
- [ ] `--suite all` · `--suite matrix` · `npm run build` · `npm test`
- [ ] 🔴 `git rev-list --left-right --count origin/staging...origin/pivot/v2` → **`0 0`. הדבק**

## דווח

1. 🔴 **צילום הקישור מתוך המייל שהתקבל**
2. **ארבע ברירות המחדל אחרי התיקון**
3. **`FRONTEND_URL` בפועל בשלושת השירותים**
4. **טבלת ברירות המחדל שהן URL**
5. `git diff -w --stat`

---

## Guardrails

`git tag pre-r17`. **סטייג׳ינג בלבד. שני הענפים. הדבק `rev-list`.**

🔴 **`www.tagidai.com`. לא `staging.`, לא `buildupai`.**

🔴 **אל תמציא כתובת דואר.** `ads@tagidai.com` מסומן לאישור.

🔴 **אל תיגע בהערות ההיסטוריות וב-`middleware.ts`.**

🔴 **אל תיגע** בחשיפה · במטריצת R13 · ב-R15 · ב-R16 · בחיוב.

🔴 **`git add` לפי שם קובץ. לעולם לא `-A`.** **וכולל `docs/cc-prompts/*.md`.**
