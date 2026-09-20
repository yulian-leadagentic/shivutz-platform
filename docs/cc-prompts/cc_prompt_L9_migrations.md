# L9 — מיגרציות · הרצה, `is_fake`, וכלל סדר

## ⭐ קרא את `cc_launch_runsheet.md`. `git tag pre-l9`. **הפריט הדחוף ביותר כרגע.**

---

# §0 · למה זה דחוף

**הקוד של L4 ו-L5 נדחף ל-`staging` (דיפלוי אוטומטי). מיגרציות 071 ו-072 לא רצו שם.**

מה שהקוד קורא ולא קיים בסכימה:

| חסר | מיגרציה | מה נשבר |
|---|---|---|
| `subscription_plans.included_users` · `extra_user_price_nis` | 071 | כל בדיקת מושבים — הזמנת משתמש, מסך צוות |
| טבלת `payment_events` | 072 | כל מסלול חיוב וחידוש |
| `subscriptions.last_renewal_attempt_at` · `rebill_attempts` · `next_attempt_at` | 072 | אצוות החידוש |

**סטייג'ינג כנראה שבור ברגע זה. §1 קודם לכל השאר.**

---

# §1 · להריץ את 071 ו-072 על סטייג'ינג

```
python scripts/run_migrations.py    # מול Staging
```

## אימות — הדבק את הפלט המלא

```sql
SELECT entity_type, tier, monthly_price_nis, included_users,
       extra_user_price_nis, max_users
  FROM payment_db.subscription_plans
 ORDER BY entity_type, tier;
```
**ציפייה: שש שורות. אף `monthly_price_nis` של קבלן אינו `NULL`.**

```sql
SHOW TABLES IN payment_db LIKE 'payment_events';
SHOW COLUMNS FROM payment_db.subscriptions
 LIKE '%renewal%';
```

🔴 **אם משהו לא תואם — עצור ודווח. אל תריץ ידנית חלקים מהמיגרציה כדי "לסדר".**

⚠️ **`071` משתמש ב-`ALTER TABLE ... ADD COLUMN` בלי הגנת `IF NOT EXISTS`** (MySQL 8 לא תומך). **אם הוא כבר רץ חלקית — הוא ייפול.** במקרה כזה: **דווח את השגיאה המדויקת לפני שאתה נוגע.** הדפוס להגנה קיים ברפו ב-`045_contractor_registry_snapshot.sql` (שער `INFORMATION_SCHEMA`).

---

# §2 · מיגרציה 073 — `is_fake`

## מה כבר נכון, ואל תיגע בו

**בדקתי את `cardcom.py`. CC כבר עשה כאן את הדבר הנכון:**

```python
# cardcom.py:249
fake_txn = f"FAKE-{uuid.uuid4().hex[:16]}"
...
"raw": {"fake": True, "reason": "PAYMENT_FAKE_MODE=1"},
```

**מזהה העסקה המדומה נושא קידומת `FAKE-`** — הוא לעולם לא `NULL` ולעולם לא נראה כמו מזהה Cardcom. ✅ **זה תקין ונשאר.**

> **תיקון להערה קודמת שלי:** חששתי שרשומות דמה ייכתבו עם `provider_transaction_id = NULL` ויתערבבו עם רשומות אמיתיות. **זה לא נכון** — `NULL` מופיע רק במסלול שגיאת רשת (`subscriptions.py:268`), וזו התנהגות נכונה.

## מה כן חסר

**הסימון היחיד שקיים יושב בתוך `raw`, שהוא עמודת `TEXT`.**

זה לא מספיק:
- **אי אפשר לסנן דוח או ייצוא לפי שדה בתוך blob** בלי `LIKE '%fake%'`, שהוא שביר
- ביום שיהיה חיוב אמיתי ראשון, **התאמה מול Cardcom תדרוש לפרסר טקסט** כדי להחליט מה לספור
- זה בדיוק ההיגיון של `is_seed` מ-H7. **על כסף הוא מחייב יותר, לא פחות**

## Do

**מיגרציה חדשה. בדוק `ls db/migrations | tail` — אל תסמוך על המספר שכתוב פה.**

```sql
USE payment_db;

ALTER TABLE payment_events
  ADD COLUMN is_fake BOOLEAN NOT NULL DEFAULT FALSE AFTER kind;

CREATE INDEX idx_payment_events_real
  ON payment_events (is_fake, created_at);
```

## §2b · Backfill — בזהירות

**כל מה שקיים היום ב-`payment_events` נוצר תחת `PAYMENT_FAKE_MODE=1`** — אין עדיין ולו חיוב אמיתי אחד.

🔴 **אל תריץ `UPDATE` גורף לפני שספרת.** קודם:

```sql
SELECT is_fake,
       SUM(provider_transaction_id LIKE 'FAKE-%') AS looks_fake,
       SUM(provider_transaction_id IS NULL)       AS null_txn,
       SUM(provider_transaction_id NOT LIKE 'FAKE-%'
           AND provider_transaction_id IS NOT NULL) AS looks_real,
       COUNT(*) AS total
  FROM payment_events GROUP BY is_fake;
```

- **`looks_real` חייב להיות 0.** אם הוא לא — **עצור ודווח מיד.** זה אומר שחיוב אמיתי כבר קרה, וזו שיחה אחרת לגמרי
- רק אחרי ש-`looks_real = 0`:
```sql
UPDATE payment_events SET is_fake = TRUE
 WHERE provider_transaction_id LIKE 'FAKE-%';
```
- **שורות עם `provider_transaction_id IS NULL`** (שגיאות רשת) — **השאר `is_fake = FALSE`.** הן לא דמה; הן ניסיונות שנכשלו

## §2c · נקודת הכתיבה

`services/payment/app/services/payment_events.py` → `record_event()` — **זו נקודת הכתיבה היחידה. התיקון שם ורק שם.**

```python
is_fake = PAYMENT_FAKE_MODE
```

- **מהדגל, לא מ-`raw` ולא מהקידומת.** המקור הוא מצב השירות
- `grep -rn "INSERT INTO payment_events"` — **ודא שאין נקודת כתיבה שנייה.** אם יש, דווח

---

# §3 · כלל סדר — לתעד ב-`CLAUDE.md`

**מה שקרה כאן:** קוד שקורא סכימה נדחף ל-`staging` לפני שהסכימה עלתה.

**הוסף ל-`CLAUDE.md`, בסעיף משלו:**

```
## Migrations before code

`origin/staging` auto-deploys. A push of code that reads a new column
or table BEFORE that migration has run on the staging DB takes staging
down until it does.

Order, always:
  1. run the migration on staging
  2. verify the schema
  3. push the code

This is not a style preference — it is the deploy order.
```

**עדכן גם את `docs/ENVIRONMENTS.md`** אם יש שם תיאור זרימת פריסה.

---

# §4 · לאמת שסטייג'ינג חי שוב

**אחרי §1 ו-§2 — בדוק שמה שנשבר עובד:**

- [ ] `/contractor/users` נטען. **מסך הצוות מציג `X מתוך 5`.** צילום
- [ ] הזמנת משתמש כשיש פחות מ-5 → **עוברת**
- [ ] הזמנה כשיש 5 → **`402 seat_upgrade_required` עם המחיר.** הדבק
- [ ] `/billing` נטען בלי שגיאה. צילום
- [ ] **לוג עליית `payment` מראה `mode=fake`.** הדבק את השורה
- [ ] פתיחת מנוי (fake) → `active` + **שורה ב-`payment_events` עם `is_fake = TRUE`.** הדבק את השורה

---

# Acceptance

- [ ] שש שורות `subscription_plans` — **הדבק מלא**
- [ ] `payment_events` קיימת · שלוש העמודות ב-`subscriptions` קיימות
- [ ] **טבלת הספירה מ-§2b — הדבק לפני ה-`UPDATE`**
- [ ] 🔴 **`looks_real = 0`.** אם לא — עצור
- [ ] אחרי ה-backfill: `SELECT is_fake, COUNT(*) FROM payment_events GROUP BY is_fake` — **הדבק**
- [ ] `record_event` כותב `is_fake` מהדגל. הדבק את הדיף
- [ ] `grep -rn "INSERT INTO payment_events"` → **נקודת כתיבה אחת**
- [ ] `CLAUDE.md` מעודכן
- [ ] חמש בדיקות §4 — צילומים
- [ ] רגרסיה: L1–L8 לא נשברו · חיפוש · חשיפה · היסטוריה
- [ ] `npm run build` עובר

## דווח

1. פלט האימות של §1 — מלא
2. **טבלת הספירה מ-§2b, לפני ואחרי**
3. מספר המיגרציה שהשתמשת בו
4. הדיף של `record_event`
5. צילומי §4
6. `git diff -w --stat`

## Guardrails

`git tag pre-l9`.

🔴 **אל תריץ מיגרציות על production.** סטייג'ינג בלבד.

🔴 **`looks_real > 0` ⇒ עצור ודווח.** אל תעשה backfill על דאטה שאולי אמיתית.

🔴 **אל תיגע ב-`FAKE-` prefix ב-`cardcom.py`.** הוא נכון.

🔴 **אל תשנה את `071` או `072`.** הן כבר בקומיט. **תיקון = מיגרציה חדשה**, לא עריכה של קיימת.

**אל תיגע** בלוגיקת החיוב עצמה · `charge_token` · האצוות · L1–L8.
