# L10 — תוכן משפטי בניהול · הרחבה ל-L6

## ⭐ קרא את `cc_launch_runsheet.md`. `git tag pre-l10`. **אחרי L9.**

## ההחלטה של Yulian

> *"רכז נגישות — יוליאן אברמוביץ׳. נשנה אחר כך — גם לזה תכין תשתית לשינוי קל דרך מסכי הניהול."*

**זה השינוי המהותי בפריט:** התוכן המשפטי מפסיק להיות קוד ונעשה **דאטה שנערכת באדמין**. הנוסח שנכנס עכשיו הוא בסיסי ומספיק — **מה שחשוב הוא שהחלפתו לא תדרוש מפתח ולא תדרוש פריסה.**

---

# §0 · מה כבר קיים מ-L6 — אל תבנה מחדש

**L6 נחת בקומיט `930c564`.** קיימים: `/terms` · `/privacy` · `/accessibility` · `/contact`, קישורי הפוטר, והערת הטיוטה.

**L10 לא כותב את הדפים מחדש. הוא מעביר את התוכן שלהם ל-DB ובונה מסך עריכה.**

---

# §1 · שתי טבלאות. לא יותר.

**מיגרציה חדשה. בדוק `ls db/migrations | tail`.**

## 1.1 · `legal_documents` — גוף הדפים

```sql
USE org_db;

CREATE TABLE IF NOT EXISTS legal_documents (
  slug          VARCHAR(32)  NOT NULL PRIMARY KEY,   -- terms | privacy | accessibility
  title_he      VARCHAR(200) NOT NULL,
  body_md       MEDIUMTEXT   NOT NULL,
  version       INT          NOT NULL DEFAULT 1,
  effective_at  DATE             NULL,   -- "עודכן לאחרונה" שמוצג בדף
  is_draft      BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    VARCHAR(64)      NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS legal_document_history (
  id           CHAR(36)    NOT NULL PRIMARY KEY,
  slug         VARCHAR(32) NOT NULL,
  version      INT         NOT NULL,
  body_md      MEDIUMTEXT  NOT NULL,
  replaced_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  replaced_by  VARCHAR(64)     NULL,
  INDEX idx_legal_hist (slug, version)
);
```

> 🔴 **ההיסטוריה אינה מותרות.** מסמך משפטי חייב לענות על *"מה בדיוק הופיע באתר ביום שהמשתמש נרשם?"*. **כל שמירה כותבת את הגרסה הקודמת ל-history ומעלה `version` ב-1.** זה שמונה שורות קוד והוא מה שהופך את זה למסמך ולא לפוסט.

**`is_draft`** — כל עוד `TRUE`, הדף מציג את הערת הטיוטה. **האדמין מוריד אותה כשהנוסח מאושר, בלי פריסה.**

## 1.2 · `site_settings` — עובדות שחוזרות בכמה מקומות

```sql
CREATE TABLE IF NOT EXISTS site_settings (
  setting_key  VARCHAR(64)  NOT NULL PRIMARY KEY,
  setting_val  VARCHAR(500)     NULL,
  label_he     VARCHAR(200) NOT NULL,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**זרע:**

| `setting_key` | ערך | `label_he` |
|---|---|---|
| `company_legal_name` | `Lead Agentic` | השם המשפטי |
| `company_number` | `NULL` | ח.פ |
| `company_address` | `NULL` | כתובת |
| `support_email` | `NULL` | מייל תמיכה |
| `a11y_coordinator_name` | **`יוליאן אברמוביץ׳`** | שם רכז הנגישות |
| `a11y_coordinator_phone` | `NULL` | טלפון רכז הנגישות |
| `a11y_coordinator_email` | `NULL` | מייל רכז הנגישות |

🔴 **`NULL` ולא מחרוזת ריקה ולא ערך מומצא.** ח.פ שגוי במסמך משפטי גרוע מח.פ חסר.

---

# §2 · איך הדפים קוראים את זה

```
DB (legal_documents)  →  אם חסר  →  קובץ ב-docs/  →  אם חסר  →  404
```

**הנפילה לקובץ הכרחית:** `docs/accessibility_statement.md` כבר קיים ברפו. **דף משפטי לא יציג מסך ריק כי שורה נמחקה בטעות.**

- **ה-endpoint הציבורי לקריאה:** `GET /legal/{slug}` — **ללא אימות**
- 🔴 **ודא שהוא בנתיבים הציבוריים בגייטוויי.** L2 סגר את `/api/search`; **דף תנאי שימוש שדורש התחברות הוא באג משפטי**, לא רק UX
- **הכותרת "עודכן לאחרונה"** מ-`effective_at`, ואם הוא `NULL` — מ-`updated_at`

## 🔴 §2b · הצגת רכז הנגישות — התנהגות מותנית

```
יש name  ∧  (יש phone  ∨  יש email)
    ⇒ מוצג מקטע "רכז נגישות" מלא

אחרת
    ⇒ המקטע לא מרונדר בכלל
    ⇒ באדמין מוצגת אזהרה בולטת:
       "הצהרת הנגישות אינה מלאה — חסרים פרטי התקשרות לרכז הנגישות"
```

> **למה מותנה ולא `[[להשלמה]]` על המסך:** תקנות הנגישות דורשות **דרך ליצור קשר**, לא שם בלבד. **שם בלי טלפון לא עומד בדרישה, והוא גם נראה מוזר למבקר.** מקטע שלא מוצג עדיף על מקטע חצי.
>
> **Yulian מסר שם. טלפון ומייל עדיין חסרים — זו הערה לדיווח, לא חסם.**

---

# §3 · רשימת הצדדים השלישיים — במדיניות הפרטיות

**נכנסת לגוף `privacy` בזרע.** אלה השירותים שהקוד באמת שולח אליהם דאטה — **אימתי כל אחד מול הקוד לפני שאתה כותב:**

| שירות | מה נשלח | איפה בקוד |
|---|---|---|
| **Anthropic (Claude)** | **טקסט שאילתת החיפוש** | `services/user-org/app/services/query_rewriter.py` |
| **ElevenLabs** | **הקלטת קול לתמלול** | proxy ב-`services/gateway/src/index.js` |
| **Cardcom** | פרטי תשלום — **אנחנו שומרים טוקן בלבד, לא מספר כרטיס** | `services/payment/app/services/cardcom.py` |
| **Vonage** | טלפון + תוכן SMS/WhatsApp | `services/notification/src/messaging/` |
| **data.gov.il** | ח.פ ומספר קבלן, לאימות מול פנקס הקבלנים | `services/user-org/app/integrations/data_gov_il.py` |

🔴 **אם מצאת ספק שישי שלא ברשימה — הוסף אותו ודווח.** רשימה חלקית במדיניות פרטיות גרועה מרשימה כללית.

**וגם, בסעיף משלו:** `contact_reveals` שומר **מי חשף פרטים של מי ומתי**, ולתאגיד מוצגים נתוני חשיפה **בלי פרטי הקבלן** (L7). **כתוב את זה במפורש.**

---

# §4 · מסכי האדמין

`/admin/legal` — שתי לשוניות.

## 4.1 · מסמכים

- רשימה: שלושת ה-slugs · גרסה · עודכן · `טיוטה`/`מאושר`
- עריכה: `textarea` ל-Markdown + **תצוגה מקדימה חיה** + `effective_at` + מתג `is_draft`
- **שמירה** → history + `version + 1` + `updated_by` מ-`x-user-id`
- **צפייה בגרסאות קודמות** — קריאה בלבד. בלי שחזור בסבב הזה

## 4.2 · הגדרות

טופס פשוט על `site_settings`, **מוצג לפי `label_he`**. שדה ריק נשמר כ-`NULL`.

**אזהרה בראש הלשונית** כשחסרים פרטי רכז הנגישות (§2b).

---

# §5 · 🔴 אבטחה — הסעיף שאסור לקצר

## 5.1 · Markdown מהאדמין הוא קלט לא-בטוח

**זהו טקסט שנכתב בטופס ומרונדר לכל מבקר. זה וקטור XSS קלאסי.**

- **רנדר Markdown עם HTML גולמי מושבת.** `marked` → `{ sanitize }` או `markdown-it` → `html: false`
- **ואם בכל זאת נדרש HTML — סניטציה אחרי הרינדור** (DOMPurify או שווה-ערך). **שתי שכבות, לא אחת**
- ⚠️ **ב-Next, `dangerouslySetInnerHTML` על תוכן מה-DB בלי סניטציה הוא בדיוק הבאג הזה.** אם השתמשת בו — **הוכח בדיווח איפה הסניטציה**
- **בדיקה מפורשת:** שמור `<script>alert(1)</script>` וגם `<img src=x onerror=alert(1)>` בגוף מסמך, פתח את הדף הציבורי, **והראה שלא רצה שום סקריפט**

## 5.2 · כתיבה לאדמין בלבד

- הנתיבים תחת `/api/admin/legal` — **הגייטוויי כבר חוסם `/api/admin` ל-`role=admin`** (`index.js:203,274`)
- ⚠️ **`services/admin` אין בו קוד הרשאה משלו** — הוא נשען לגמרי על הגייטוויי. **אל תתקן את זה כאן**, אבל **אל תוסיף נתיב כתיבה מחוץ ל-`/api/admin/`**
- **הקריאה הציבורית ב-`GET /legal/{slug}` בלבד**, והיא לא חושפת `updated_by` ולא היסטוריה

---

# Acceptance

- [ ] שלוש הטבלאות נוצרו. `SHOW TABLES` — הדבק
- [ ] `SELECT * FROM site_settings` — **שבע שורות, `a11y_coordinator_name = יוליאן אברמוביץ׳`.** הדבק
- [ ] שלושת הדפים נטענים **מה-DB**. צילום
- [ ] **מחק שורה מ-`legal_documents` → הדף עדיין עולה מהקובץ.** צילום. (החזר אחרי)
- [ ] 🔴 **שלושת הדפים נטענים בלי טוקן, בחלון פרטי.** צילום
- [ ] עריכה באדמין → **הדף הציבורי משתנה בלי פריסה.** צילום לפני/אחרי
- [ ] **`version` עלה ב-1 ונוצרה שורת history.** הדבק
- [ ] `is_draft = FALSE` → **הערת הטיוטה נעלמת.** צילום
- [ ] 🔴 **XSS: שמור `<script>alert(1)</script>` ו-`<img src=x onerror=alert(1)>` → שום סקריפט לא רץ.** צילום של הדף ושל הקונסולה
- [ ] מדיניות הפרטיות מזכירה **בשמם**: Anthropic · ElevenLabs · Cardcom · Vonage · data.gov.il
- [ ] מדיניות הפרטיות מתייחסת ל-`contact_reveals`
- [ ] **בלי טלפון/מייל לרכז → מקטע הנגישות לא מרונדר**, ובאדמין יש אזהרה. שני צילומים
- [ ] עם טלפון → **המקטע מופיע.** צילום
- [ ] משתמש לא-אדמין → `POST /api/admin/legal/...` → **403.** הדבק
- [ ] 390 + דסקטופ · RTL · מקלדת בלבד
- [ ] `npm run build` עובר

## דווח

1. `SELECT * FROM site_settings` מלא
2. **צילום בדיקת ה-XSS** — הדף והקונסולה
3. **איזו ספרייה מרנדרת Markdown ואיך היא מוגדרת** — ציטוט הקונפיגורציה
4. הרשימה הסופית של הצדדים השלישיים, **ואם מצאת ספק שישי**
5. **חסרים: טלפון ומייל לרכז הנגישות** — בשורה נפרדת ל-Yulian
6. `git diff -w --stat`

## Guardrails

`git tag pre-l10`.

🔴 **XSS — שתי שכבות, ובדיקה מוכחת.** תוכן מהאדמין מרונדר לכל מבקר.

🔴 **הדפים המשפטיים נשארים ציבוריים.** L2 סגר את החיפוש; **הוא לא סוגר את `/terms`.**

🔴 **אל תמציא ח.פ, כתובת או טלפון.** `NULL` ודיווח.

🔴 **אל תמחק את `docs/accessibility_statement.md`** — הוא הנפילה לאחור.

**הנוסח בסבב הזה בסיסי בכוונה.** המטרה היא **התשתית להחלפה**, לא הניסוח הסופי. **אל תשקיע בניסוח משפטי — השקע במנגנון.**

**אל תיגע** ב-L1–L9 · חיוב · חשיפה · `query_rewriter.py`.
