# CC prompt — Round 2: חמישה תיקונים חצי-גמורים

## הקשר
סבב האימות של 13/08 מצא שחמישה פריטים שדווחו כ"בוצע" תוקנו **במקום אחד מתוך שניים**, או שהתיקון מוסתר ע"י התנהגות שרת שעלולה להשתנות. אף אחד מהם אינו באג חדש — כולם שאריות של סבב קודם.

## ⭐ STANDING RULE
`git tag pre-round2` לפני. staging בלבד. מובייל 390 + דסקטופ. DoD: per-פריט — מה היה, מה תוקן, איפה.

---

## R1 · דשבורד התאגיד עדיין מכיל את באג ה-regex שתוקן בדשבורד הקבלן 🔴

`b3c6620` תיקן את `contractor/dashboard/page.tsx` — החליף זיהוי-שגיאה מבוסס-regex בבדיקת `ApiError.cause.status === 404`. **אבל הקובץ המקביל לא טופל:**

`services/frontend/src/app/corporation/dashboard/page.tsx:85`
```js
if (/404|not.?found|no.?subscription/i.test(msg))
```

אותו באג בדיוק, קובץ אחד ליד. `msg` הוא טקסט שגיאה — כל שינוי בנוסח (או הודעה בעברית) שובר את הזיהוי, והתאגיד מקבל באנר אדום במקום "אין מנוי פעיל".

**Do:** החל את אותו תיקון של `b3c6620` על דשבורד התאגיד. `ApiError` ב-`services/frontend/src/lib/api/client.ts:268` נושא `cause: ApiErrorPayload & { status: number }` — השתמש בו.
**Acceptance:** תאגיד בלי מנוי → empty-state עם CTA, לא אדום. grep על `/404|not.?found/` ב-`src/app/` מחזיר אפס.

---

## R2 · `/billing` אין לו empty-state בכלל — רק באנר שגיאה 🔴

הפריט דווח כ"מפריד נקי בין empty ל-error". **הוא לא מפריד — אין לו ענף empty.**

`services/frontend/src/app/billing/page.tsx:91-94` — `refresh()` עוטף את `subscriptionApi.me()` ב-try/catch יחיד; **כל** כשל, כולל 404, מציב `error`, שמרנדר את הבאנר האדום בשורה 357.

**למה זה לא נראה בפועל:** `services/payment/app/routes/subscriptions.py:101-103` עושה lazy-init של שורת trial (`if row is None: row = _insert_trial(...)`), ולכן 404 כמעט לא קורה. **התיקון בדשבורד הקבלן קוסמטי מאותה סיבה.** ברגע שה-lazy-init ישתנה, או שהקריאה תיכשל מסיבה אחרת — הקבלן רואה אדום.

**Do:** הוסף ל-`/billing` ענף empty אמיתי: 404 / אין מנוי → "אין מנוי פעיל" + CTA "רכשו מנוי". אדום נשמר ל-5xx בלבד. אותו דפוס כמו הדשבורד.
**Acceptance:** אילוץ ידני של 404 מ-`subscriptionApi.me()` → empty-state, לא אדום. 500 → אדום.

---

## R3 · QA-3: `upgrade()` עדיין מדליף שגיאה גולמית 🟡

`5c8e5df` המיר את `refresh()` / `addMember()` / `removeMember()` ל-`mapApiError`, אבל דילג על אחד:

`services/frontend/src/app/billing/page.tsx:147`
```js
setError((e as Error).message ?? 'שגיאה בשדרוג');
```

שדרוג-tier שנכשל מציג קוד מכונה באנגלית בתוך הבאנר האדום — בדיוק מה ש-QA-3 בא לסגור.

**Do:** העבר גם את `upgrade()` דרך `mapApiError`.
**Acceptance:** כשל שדרוג מדומה → הודעה בעברית. grep על `(e as Error).message` ב-`app/billing/` מחזיר אפס.

---

## R4 · הבטחת "עמלה" חיה בעמוד הרישום של התאגיד 🔴

`4d54185` ניקה את "עמלה" מדיאלוג האישור ב-admin. אבל נשאר מופע אחד, **והוא גרוע יותר** — הוא מול משתמש אמיתי, ברגע הרישום:

`services/frontend/src/app/register/corporation/page.tsx:67`
> "על כל עובד שאוייש בעסקה ייגבה תעריף עמלה אחיד מהתאגיד … הקבלן אינו משלם עמלה בעסקה זו."

המוצר עבר pivot **מעמלה-לעסקה → מנוי/ליסטינגים** (migration 067 מחק את העמודות). התאגיד נרשם היום מול הבטחה חוזית שאינה נכונה.

**⚠️ אמת מול Yulian לפני שאתה מנסח מחדש** — זה טקסט מסחרי, לא copy. אל תמציא מודל תמחור.

**Do:** החלף בנוסח שמתאר את המודל בפועל (מנוי/ליסטינגים). אם יש ספק — הצג ל-Yulian שתי אפשרויות נוסח ועצור.
**גם:** `services/notification/src/testCatalog.js:201,452,455` מכיל `commission_amount: 2500` ו-`event_type: 'commission.invoiced'` — דאטת-בדיקה של אירוע שכבר לא קיים. מחק.
**Acceptance:** `git grep -n "עמלה" -- services ':!*node_modules*'` מחזיר אפס. אין `commission.*` ב-testCatalog.

---

## R5 · `tools/screens-export/README.md` מבטיח יכולת שאינה קיימת 🟡

`README.md:44-45` טוען שה-harness "logs in once per contractor + corporation + admin, if the phone has multiple memberships". **הקוד לא עושה זאת.**

`screens.spec.ts` מתחבר בזרימת OTP **יחידה** (`LOGIN_PHONE` :19, `MASTER_OTP` :20, `/api/auth/send-otp` → `/api/auth/login/otp` :254-264), ופותח context אחד לכל **viewport** (`ensureLoggedInContext(browser, viewport)` :383) — לא לכל ישות. ה-`role` מ-`roleFromJwt` משמש רק כדי להכשיר NoAccessCard לגיטימיים (:418-460). הביקור השיורי ב-`/select-entity` (:394) הוא `.catch(() => {})` ריק.

זו הסיבה ש-`reveal-paywall` בצד התאגיד לא אומת — **וה-README מסתיר את זה.**

**Do:** תקן את ה-README שיתאר את מה שהקוד עושה (ישות אחת, לפי `LOGIN_PHONE`). **אל תממש כאן דו-ישותיות** — זו משימה נפרדת.
**Acceptance:** ה-README תואם לקוד; מצוין במפורש שמסכי corp/admin ייצאו כ-NoAccessCard.

---

## Guardrails
`git tag pre-round2`. staging בלבד. **R4 — עצור ושאל את Yulian** אם נוסח התמחור אינו חד-משמעי. לא לגעת בלוגיקת מנוי/reveal/חיוב — R1/R2 הם טיפול-שגיאות בלבד. לא לממש harness דו-ישותי בסבב הזה.
