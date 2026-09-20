# CC prompt — M1: המיגרציה הרוחבית (הרחבת כל ה-ENUMs)

## ההכרעה שמאחורי זה

**Yulian הכריע: מרחיבים את כל ה-ENUMs** — לא עוברים ל-VARCHAR+lookup.
מיגרציה רוחבית **אחת** שפותחת את הסכימה לישות `provider` ולמסלול `service`, ואחריה **אפס מיגרציות לכל קטגוריה** שיווצר אחר כך — כי הקטגוריות הן שורות ב-`service_categories`, לא ערכי ENUM.

> 🔴 **תנאי האכיפה, ובלעדיו ההכרעה נשברת:**
> **קטגוריות נשארות דאטה. לעולם לא `category ENUM(...)` בשום טבלה.**
> ברגע שמישהו יוסיף ENUM של קטגוריות — חוזרים לנקודת ההתחלה, והמיגרציה הזאת הייתה לשווא.

## ⭐ STANDING RULE

**שלב 1 הוא גילוי בלבד. אפס `ALTER`, אפס קובץ מיגרציה, אפס קוד.**
`git tag pre-m1` לפני שלב 2. **אין `git add -A`.**
**אל תתחיל בכלל לפני ש-X0 (בדיקת הענפים) הוחזרה והוכרעה** — פירוט בסוף.

---

# 🔴 חסם קדימה — קרא לפני הכול

**אל תריץ את השלב הזה לפני ש-`cc_prompt_branch_reconcile.md` הוחזר ו-Yulian הכריע על הענף.**

הסיבה ספציפית ולא בירוקרטית: המיגרציה הזאת **מוסיפה קובץ ממוספר**. אם `staging` ו-`pivot/v2` כבר מחזיקים מספרים חופפים, או אם המיגרציה תנחת בענף שיישמט באיחוד — הנזק יתגלה רק כשהסכימות יתפצלו בין סביבות, וזה השלב הכי יקר לגלות בו.

**אם אתה לא יודע בוודאות מהו הענף הפעיל — עצור ושאל. אל תנחש.**

---

# שלב 1 · גילוי — קריאה בלבד

## 1.1 · כמה עמודות `entity_type` יש באמת?

המסמכים אומרים "8+". **אף אחד לא ספר.** ספור:

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE COLUMN_NAME = 'entity_type'
ORDER BY TABLE_SCHEMA, TABLE_NAME;
```

**הרץ את זה על כל אחת מהסכימות** — לכל שירות יש DB משלו. דווח טבלה מלאה: סכימה · טבלה · הגדרה מדויקת · nullable · default.

## 1.2 · שאר ה-ENUMs במשחק

```sql
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE DATA_TYPE = 'enum'
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;
```

**זו הרשימה המלאה של כל ENUM במערכת.** ממנה נחליט מה נוגעים ומה לא. **אל תסנן אותה בעצמך** — דווח כמו שהיא.

## 1.3 · `subscription_plans` — מה יש ומה חסר

```sql
DESCRIBE subscription_plans;
SELECT * FROM subscription_plans;
```

הטענה שצריך לאמת: **אין עמודת מחיר, רק `cardcom_plan_code`.** נכון או לא?

## 1.4 · איפה הקוד מניח שתי אפשרויות

חפש **בכל השירותים**, Node ו-Python:

- `'contractor'` · `'corporation'` — השוואות, ולידציות, `in (...)`, `Literal[...]`, JSON Schema, enums ב-TS
- `'worker'` · `'housing'` — במיוחד `query_rewriter.py` ו-`routes/search.py`
- `ad_type` · `owner_entity_type` · `entity_type`

דווח כל מקום עם **קובץ ומספר שורה**. זו הרשימה שקובעת כמה עבודה יש באמת — יותר מהמיגרציה עצמה.

## 1.5 · מספרי מיגרציה

מה המספר הפנוי הבא — **בשני הענפים**. אם הם לא מסכימים, זו תוצאה חוסמת.

```bash
git ls-tree --name-only staging  db/migrations/ | sort | tail -5
git ls-tree --name-only pivot/v2 db/migrations/ | sort | tail -5
```

## 1.6 · אילוצים

FK, `CHECK`, ו-generated columns שנשענים על אחת מהעמודות שנשנה.

**⛔ עצור. דווח. אל תמשיך בלי אישור מפורש.**

---

# שלב 2 · המיגרציה — רק אחרי אישור

## 🔴 שלושה כללי MySQL שאסור לפספס

### א׳ · ערך חדש נוסף **בסוף**, לעולם לא באמצע
ערכי ENUM נשמרים כמספרים סידוריים. **שינוי הסדר משנה את משמעות הדאטה הקיימת בשקט.**

```sql
-- ✅ נכון
MODIFY COLUMN entity_type ENUM('contractor','corporation','provider')
-- ❌ הורס דאטה
MODIFY COLUMN entity_type ENUM('contractor','provider','corporation')
```

### ב׳ · `MODIFY COLUMN` דורס את **כל** ההגדרה
אם לא תשחזר `NOT NULL` ו-`DEFAULT` — הם **נמחקים בשקט**.
לכן שלב 1.1 מבקש `IS_NULLABLE` ו-`COLUMN_DEFAULT`: **כל `MODIFY` חייב לשחזר בדיוק את מה שדווח שם.**

### ג׳ · טבלה אחת בכל הצהרה, ובסדר קבוע
בלי לולאות דינמיות. **המיגרציה חייבת להיות קריאה ולעבור סקירה בעין.**

## מה משתנה

```sql
-- 1 · כל עמודות entity_type שדווחו ב-1.1 — אף אחת לא נשכחת
ALTER TABLE <table> MODIFY COLUMN entity_type
  ENUM('contractor','corporation','provider') <NOT NULL/NULL> <DEFAULT ...>;

-- 2 · המסלול החדש
ALTER TABLE ads MODIFY COLUMN ad_type
  ENUM('worker','housing','service') <כפי שדווח>;

ALTER TABLE ads MODIFY COLUMN owner_entity_type
  ENUM('corporation','provider') <כפי שדווח>;

-- 3 · מחיר — רק אם 1.3 אישר שהוא חסר
ALTER TABLE subscription_plans ADD COLUMN price_nis DECIMAL(8,2) NULL;
```

> **`ads.ad_type` הוא הסיכון הגבוה ביותר במיגרציה הזאת.** הוא נמצא בכל נתיב החיפוש. אחריו — סוללת רגרסיה מלאה, לא בדיקה מדגמית.

## מה **לא** נכנס ל-M1

**הטבלאות החדשות** — `service_categories`, `service_providers`, `provider_categories`, `provider_contact_events` — **הן M2, מיגרציה נפרדת.**

**למה בנפרד:** M1 נוגעת בכל מה שקיים ועובד היום; M2 מוסיפה דברים חדשים שלא משפיעים על כלום. **ערבוב שלהן אומר שכשל בחדש מחייב גלגול לאחור של הרוחבי.** נפרד = M1 מתייצבת לבד.

---

# שלב 3 · הקוד

לכל מקום מ-1.4:

- **ולידציות** — להרחיב לשלוש אפשרויות, או **להסיר** אם הן רק משכפלות את ה-ENUM
- **טיפוסי TS** — `'contractor' | 'corporation' | 'provider'`
- **`query_rewriter.py`** — הממד `vertical`. **הכלל מ-`ed15382` בתוקף: ערך לא תקף → נסיגה ל-fake, לעולם לא ל-`None`**
- **בדיקות הרשאה** — `provider` לא מקבל בטעות הרשאות של `corporation`. **זו הנקודה היחידה כאן עם משמעות אבטחתית.** אם משהו מסתמך על "כל מי שאינו contractor" — **עצור ודווח**

---

# Acceptance — רגרסיה קודם, חדש אחר כך

## חלק א׳ · שום דבר קיים לא נשבר 🔴 **החשוב מהשניים**

- [ ] `"רצפים סינים"` · `"חשמלאים בצפון"` · `"דיור ל-20 פועלים"` — **מספר תוצאות זהה לפני ואחרי.** דווח את שני המספרים
- [ ] יצירת מודעת `worker` ומודעת `housing` — עוברות
- [ ] התחברות כ-contractor וכ-corporation — עוברות
- [ ] reveal של פרטי קשר — עובד
- [ ] `SELECT ad_type, COUNT(*) FROM ads GROUP BY ad_type` — **זהה לפני ואחרי**
- [ ] אף עמודה לא איבדה `NOT NULL` או `DEFAULT` — הרץ מחדש את 1.1 והשווה

## חלק ב׳ · החדש אפשרי

- [ ] `INSERT` עם `entity_type='provider'` — מצליח
- [ ] `INSERT` עם `ad_type='service'` — מצליח
- [ ] `entity_type='hacker'` — **נכשל.** ה-ENUM עדיין סוגר

---

## דווח

1. פלט מלא של 1.1 ו-1.2 — **לפני ואחרי**
2. רשימת המקומות מ-1.4, עם שורות
3. ה-SQL של המיגרציה במלואו
4. **טבלת ספירות לפני/אחרי** של הסוללה
5. `git diff -w --stat`
6. מספר המיגרציה, והענף שאליו קומטה

## Guardrails

**אל תרחיב ENUM שלא ברשימה.** אם 1.2 חשף ENUMs נוספים — **דווח, אל תיגע.**
**אל תשנה סדר ערכים.** אף פעם, בשום ENUM.
**אל תיצור את הטבלאות החדשות** — הן M2.
**אל תיגע** ב-reveal / מנוי / boost / Cardcom.
**`main` — לא נגעים.**
**אם משהו במיגרציה נכשל באמצע — עצור ודווח. אל תמשיך לטבלה הבאה.**
