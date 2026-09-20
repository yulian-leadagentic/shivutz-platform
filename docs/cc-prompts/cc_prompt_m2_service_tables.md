# CC prompt — M2: הטבלאות של מסלול ספקי השירות

## מה זה

ארבע טבלאות חדשות. **סכימה בלבד — אפס UI, אפס API, אפס חיבור לחיפוש.**
M2 לא נוגעת בשום דבר קיים, ולכן אפשר להריץ אותה בביטחון מיד אחרי ש-M1 התייצבה.

## ⭐ STANDING RULE
`git tag pre-m2` לפני. **רק אחרי ש-M1 עברה את סוללת הרגרסיה שלה.**
**אין `git add -A`.** מיגרציה אחת, קובץ אחד, ממוספר לפי הענף שהוכרע ב-X0.

> 🔴 **התנאי שמחזיק את כל ההכרעה הארכיטקטונית:**
> **הקטגוריות הן שורות, לא ENUM.** אין ואסור שיהיה `category ENUM(...)` בשום מקום כאן.

---

# הטבלאות

## 1 · `service_categories` — הלב

```sql
CREATE TABLE service_categories (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  code                   VARCHAR(64)  NOT NULL UNIQUE,
  slug                   VARCHAR(96)  NOT NULL UNIQUE,
  parent_id              INT          NULL,

  name_he                VARCHAR(128) NOT NULL,
  name_en                VARCHAR(128) NULL,
  description_he         TEXT         NULL,
  icon                   VARCHAR(64)  NULL,

  is_active              TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order             INT          NOT NULL DEFAULT 0,

  -- תמחור, לכל קטגוריה
  monthly_price_nis      DECIMAL(8,2) NULL,
  trial_days             INT          NOT NULL DEFAULT 14,
  featured_price_per_day DECIMAL(6,2) NULL,

  -- חיפוש
  search_synonyms_he     JSON         NULL,

  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_sc_parent FOREIGN KEY (parent_id)
    REFERENCES service_categories(id) ON DELETE RESTRICT
);
```

**ארבעה כללי טקסונומיה — נאכפים בקוד, לא רק בהערה:**

- **`slug` קבוע לנצח.** שינוי שם תצוגה **לא** משנה URL. שינוי slug שובר קישורים ו-SEO. **האכיפה ב-M3**
- **`is_active=0`, לעולם לא `DELETE`.** ה-FK הוא `RESTRICT` בכוונה — ספקים מחוברים לקטגוריה
- **מקסימום שתי רמות.** קטגוריה עם `parent_id` לא יכולה בעצמה להיות הורה. **בדיקה ב-M3**
- **מתחילים צר** — 8–12 קטגוריות, ומפצלים כשאחת מתמלאת

## 2 · `service_providers`

```sql
CREATE TABLE service_providers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  entity_id       INT          NOT NULL,
  legal_name      VARCHAR(191) NOT NULL,
  display_name    VARCHAR(191) NOT NULL,
  description_he  TEXT         NULL,
  logo_url        VARCHAR(512) NULL,
  gallery         JSON         NULL,

  phone           VARCHAR(32)  NULL,
  email           VARCHAR(191) NULL,
  website         VARCHAR(512) NULL,
  address         VARCHAR(255) NULL,
  region_code     VARCHAR(32)  NULL,

  license_number  VARCHAR(64)  NULL,
  years_active    INT          NULL,

  approval_status VARCHAR(32)  NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

> **`approval_status` הוא `VARCHAR` ולא ENUM — בכוונה.** אותו היגיון בדיוק שהוביל להכרעה הארכיטקטונית: מצב אישור חדש לא צריך מיגרציה. **אל תהפוך אותו ל-ENUM.**
>
> **`region_code` — בדוק אם קיימת טבלת אזורים** והוסף FK אם כן. אם לא — השאר טקסט **ודווח**, אל תיצור טבלה על דעת עצמך.

## 3 · `provider_categories` — רבים-לרבים

```sql
CREATE TABLE provider_categories (
  provider_id INT NOT NULL,
  category_id INT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_id, category_id),
  CONSTRAINT fk_pc_provider FOREIGN KEY (provider_id)
    REFERENCES service_providers(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_category FOREIGN KEY (category_id)
    REFERENCES service_categories(id) ON DELETE RESTRICT
);
```

ספק יכול לשבת ביותר מקטגוריה אחת (רו״ח שגם יועץ מס).
**החיוב לפי הקטגוריה היקרה, לא לפי סכום** — אחרת ספקים יצמצמו לקטגוריה אחת וייפגע הכיסוי. **ההחלטה הזאת שייכת ל-M3; כאן רק מאפשרים אותה.**

## 4 · `provider_contact_events`

```sql
CREATE TABLE provider_contact_events (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  provider_id      INT         NOT NULL,
  viewer_entity_id INT         NULL,          -- NULL = אנונימי
  event_type       VARCHAR(32) NOT NULL,      -- profile_view | phone_click | email_click | website_click | whatsapp_click
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pce_provider_time (provider_id, created_at),
  CONSTRAINT fk_pce_provider FOREIGN KEY (provider_id)
    REFERENCES service_providers(id) ON DELETE CASCADE
);
```

> **זו הטבלה שמחזיקה את המנוי.** ספק שמשלם חודשית חייב לראות הוכחת ערך. בלעדיה החידוש הראשון נופל.
>
> 🔴 **אזהרת ניסוח שנגזרת מהתמלול:** **צפייה היא לא ליד.** כשהמספרים יוצגו ב-M3 ואילך — `צפיות בפרופיל` ו-`לחיצות על טלפון` בנפרד, **ולעולם לא "לידים"**. ספק שיקרא 37 צפיות כ-37 פניות ירגיש מרומה, והחידוש ייפול על תחושת הונאה.

---

# Acceptance

- [ ] המיגרציה רצה נקי על DB ריק **וגם** על עותק של סטייג'ינג
- [ ] `INSERT` קטגוריה → ספק → שיוך → אירוע — כל השרשרת עובדת
- [ ] `DELETE` על קטגוריה שיש לה ספקים — **נכשל** (`RESTRICT` עובד)
- [ ] `DELETE` על ספק — מוחק את השיוכים ואת האירועים (`CASCADE`)
- [ ] `slug` ו-`code` כפולים — **נכשלים**
- [ ] **רגרסיה:** חיפוש עובדים/דיור, יצירת מודעה, התחברות, reveal — **לא נגעו**
- [ ] אין שום ENUM חדש בטבלאות האלה

## דווח
`SHOW CREATE TABLE` לארבעתן · מספר המיגרציה והענף · תוצאות הסוללה · `git diff -w --stat`.

## Guardrails
`git tag pre-m2`. **אל תיצור UI, API או routes** — זה M3.
**אל תיגע** בטבלאות קיימות (זה היה M1) · reveal/מנוי/חיוב · `query_rewriter.py`.
**אל תשתמש ב-ENUM** באף עמודה כאן.
**אל תזין קטגוריות ראשוניות** — Yulian מזין אותן דרך האדמין ב-M3, וזו הבדיקה האמיתית שהמודל מחזיק.
