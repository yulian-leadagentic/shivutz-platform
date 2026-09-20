# R19 · 🔴 תאריך המבצע קיים בארבעה מקומות — ורק אחד מהם הוגדר

## ⭐ `git tag pre-r19`. **§1 נוגע בנתיב הכסף.**

---

# §1 · הממצא

**R10 §0 קבע `31.12.2026`. מיגרציה `088` כתבה אותו ל-`site_settings.launch_promo_end`.**
**ואז בדקתי מי עוד קורא את התאריך הזה.**

| מקור | השירות | מה הוא שולט | מוגדר? |
|---|---|---|---|
| `site_settings.launch_promo_end` | `user-org` | האם הרשמה חדשה נרשמת `price_paid=0` | ✅ `088` |
| `FREE_LAUNCH_UNTIL` | **`payment`** | 🔴 **האם החיוב בפועל מדולג** | ❌ |
| `FREE_LAUNCH_UNTIL` | `notification` | נוסח המייל | ❌ |
| `NEXT_PUBLIC_FREE_LAUNCH_UNTIL` | `frontend` | הבאנר שהמשתמש רואה | ❌ |

**שלושת משתני הסביבה אינם ב-`.env.example` ואינם ב-`ENVIRONMENTS.md`. בדקתי.**

## 🔴 ומה קורה כשהם לא מוגדרים

`services/payment/app/services/cardcom.py:31-40`

```python
def _free_launch_active() -> bool:
    if not FREE_LAUNCH_UNTIL:
        return False          # ← לא מוגדר = המבצע לא פעיל
```

**ושתי נקודות הקריאה:**

```python
:281   if _free_launch_active(): return _free_launch_result(...)   # charge_token
:491   if _free_launch_active(): return _free_launch_result(...)   # capture
```

> 🔴 **כלומר: `user-org` רושם `price_paid=0` כי `site_settings` אומר מבצע — ובאותו רגע `payment` הולך לחיוב אמיתי, כי אצלו המבצע לא קיים.**
> **״אמרנו לו חינם, חייבנו אותו.״**

**ובמקביל:** הבאנר לא מרונדר (`FreeLaunchBanner.tsx:6`) והמייל אומר את הדבר הלא נכון (`handlers.js:20`) — **אותו שורש, פחות נזק.**

## ⚠️ ולמה זה לא התפוצץ עדיין

**`PAYMENT_FAKE_MODE=1` מסווה את זה.** אף חיוב אמיתי לא יוצא.

> 🔴 **הרגע שבו המסכה יורדת הוא בדיוק הרגע שבו מפתחות Cardcom נכנסים ו-`PAYMENT_FAKE_MODE` מכובה.**
> **כלומר הבאג ממתין בדיוק לאירוע שאחריו הוא עולה כסף אמיתי ללקוח אמיתי.**

---

# §2 · התיקון — שלושת המשתנים, ואז שומר

## 2a · הגדר ותעד

```
payment       FREE_LAUNCH_UNTIL=2026-12-31
notification  FREE_LAUNCH_UNTIL=2026-12-31
frontend      NEXT_PUBLIC_FREE_LAUNCH_UNTIL=2026-12-31
```

- **ל-`.env.example` ול-`docs/ENVIRONMENTS.md`** — **בדיוק בתבנית שכתבת ל-`FRONTEND_URL` ב-`ENVIRONMENTS.md:136`.** היא טובה. חזור עליה
- 🔴 **ציין במפורש שהערך חייב להיות זהה ל-`site_settings.launch_promo_end`, ומי שולט במה**
- ⚠️ **`NEXT_PUBLIC_*` נצרב בזמן build.** **שינוי מחייב פריסה מחדש של הפרונט, לא רק restart.** תעד את זה — אחרת מישהו ישנה אותו ב-Railway ויתהה למה שום דבר לא קרה
- **הגדר בסטייג׳ינג ואמת.** 🔴 **הדבק את הערך משלושת השירותים**

## 2b · 🔴 שומר עקביות — בבדיקה, לא בפרודקשן

**24 יום להשקה. אל תבנה מנגנון סנכרון בין שירותים.**

**במקום זה — בדיקה ב-`--suite core`:**

```
קרא  site_settings.launch_promo_end
קרא  FREE_LAUNCH_UNTIL          (payment, notification)
קרא  NEXT_PUBLIC_FREE_LAUNCH_UNTIL  (frontend)
ארבעתם שווים?  → עבר
אחרת → נפל, ומפרט את ארבעת הערכים בשמם
```

- 🔴 **ערך חסר הוא כישלון, לא דילוג.** זו כל הנקודה
- ⚠️ **אם ערך של שירות אינו נגיש לבדיקה** — חשוף אותו בנקודת `/health` או `/config` של אותו שירות, **בלי סודות**, רק התאריך. **אם גם זה לא אפשרי — דווח ואל תמציא.**
- **הדגם כישלון:** שנה זמנית אחד → הבדיקה נופלת ונוקבת בשם. החזר. **הדבק את שתי ההרצות**

🔴 **בדיקה שלא ראית נופלת אינה בדיקה.** R16 §4, שוב.

---

# §3 · שאר משתני הסביבה שאינם מתועדים

**סרקתי את כל `process.env.X` ו-`getenv("X")` מול `.env.example`. 31 חסרים. רובם תשתית משעממת** — `PORT` · `NODE_ENV` · `SERVICE_NAME` · `DB_NAME` · `AUTH_PORT` · `NOTIF_PORT` · `UPLOAD_DIR` · `INTERNAL_API_URL` · `NOTIF_SERVICE_URL`. **אל תתעד אותם.**

## 🔴 אלה כן — כולם משנים התנהגות בפרודקשן

| משתנה | למה זה חשוב |
|---|---|
| **`COMING_SOON_MODE`** | 🔴 **ברירת המחדל ל-`tagidai.com` היא שער סגור.** ההשקה עצמה היא הגדרת `0`. **לא מתועד בשום מקום** |
| **`COMING_SOON_PREVIEW_KEY`** | הדרך לראות את הפרודקשן לפני שפותחים לכולם |
| **`NEXT_PUBLIC_API_URL`** | בסיס ה-API של הדפדפן. שגוי בפרודקשן = כל האתר מת. ⚠️ **build-time** |
| **`INFORU_API_KEY` · `INFORU_USERNAME` · `INFORU_SENDER`** | 🔴 **מסירת SMS = קודי OTP.** בלי אלה **אף אחד לא מתחבר ביום ההשקה** |
| **`TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` · `TWILIO_FROM_NUMBER`** | ספק SMS חלופי. **תעד איזה משניהם פעיל בפרודקשן ולמה** |
| **`CLOUDINARY_UPLOAD_FOLDER`** | זהה בשתי הסביבות = תמונות פרודקשן נוחתות בתיקיית הסטייג׳ינג |
| `AD_EXPIRY_DAYS_AHEAD` · `TRIAL_ENDING_DAYS_AHEAD` | חלונות התראה של הקרון. שמות + ברירות מחדל |
| `LLM_RERANK_TIMEOUT_S` · `LLM_RERANK_CACHE_TTL` · `LLM_REWRITER_CACHE_TTL` · `LLM_REWRITER_SLOW_S` | כוונון החיפוש. שורה אחת לכולם יחד |

🔴 **שמות וערכי דמה ב-`.env.example`. לעולם לא סוד אמיתי.** הכלל הקבוע.

⚠️ **`INFORU` מול `TWILIO` — שניהם בקוד. דווח מי מהם באמת פעיל ומה קורה כששניהם מוגדרים.** אל תסיר אף אחד.

---

# Acceptance

## §1-§2

- [ ] 🔴 **שלושת המשתנים מוגדרים בסטייג׳ינג.** הדבק משלושת השירותים
- [ ] **מתועדים בשני הקבצים, בתבנית של `ENVIRONMENTS.md:136`**
- [ ] 🔴 **מצוין שהם חייבים להיות זהים ל-`site_settings.launch_promo_end`**
- [ ] ⚠️ **מתועד ש-`NEXT_PUBLIC_*` נצרב ב-build**
- [ ] 🔴 **בדיקת העקביות ב-`--suite core`.** הדבק
- [ ] 🔴 **הדגמת כישלון — לפני ואחרי, מלא**
- [ ] **ערך חסר → כישלון, לא דילוג.** הדגם
- [ ] 🔴 **מסלול מקצה לקצה:** הרשמת ספק `@example.com` → `price_paid=0` בטבלה **ו**-`_free_launch_active()` מחזיר `True`. **הדבק את שניהם מאותה הרשמה**

## §3

- [ ] כל שורות הטבלה מתועדות. הדבק את הדיף של `.env.example`
- [ ] 🔴 **`COMING_SOON_MODE` ו-`COMING_SOON_PREVIEW_KEY` מתועדים, כולל מה קורה כשלא מוגדרים** בפרודקשן
- [ ] **INFORU מול TWILIO — מי פעיל.** דווח
- [ ] 🔴 **אפס סודות אמיתיים.** `git diff .env.example` — הדבק במלואו
- [ ] **משתני התשתית לא נוספו**

## רגרסיה

- [ ] R17 · R18 — ללא שינוי
- [ ] מטריצת R13 · R15 · R16
- [ ] `--suite all` · `--suite matrix` · `npm run build` · `npm test`
- [ ] 🔴 `git rev-list --left-right --count origin/staging...origin/pivot/v2` → **`0 0`. הדבק**

## דווח

1. 🔴 **המסלול מקצה לקצה — `price_paid` ו-`_free_launch_active()` יחד**
2. 🔴 **הדגמת הכישלון של שומר העקביות**
3. **הדיף של `.env.example`**
4. **INFORU מול TWILIO**
5. `git diff -w --stat`

---

## Guardrails

`git tag pre-r19`. **סטייג׳ינג בלבד. שני הענפים. הדבק `rev-list`.**

🔴 **אל תשנה את לוגיקת `cardcom.py`.** היא נכונה — רק לא הוזנה. **אם נראה לך שצריך לשנות אותה, עצור ודווח.**

🔴 **השומר בבדיקה, לא בפרודקשן.** אפס סנכרון בין שירותים.

🔴 **אל תשנה את `site_settings.launch_promo_end`.** `2026-12-31` נכון; שאר המקומות מיושרים אליו.

🔴 **`.env.example` — שמות וערכי דמה בלבד.**

🔴 **אל תיגע** בחשיפה · במטריצת R13 · ב-R15 · ב-R16 · בחיוב עצמו.

🔴 **`git add` לפי שם קובץ. לעולם לא `-A`.** **וכולל `docs/cc-prompts/*.md`.**
