# R11 · מצב בדיקה חייב להריץ את אותו קוד כמו מצב אמיתי

## ⭐ `git tag pre-r11`. **תיקון ממוקד בחיוב. קרא את §0 לפני שאתה נוגע במשהו.**

## הרקע

עצרת נכון. `/subscriptions/start` במצב fake הוא `UPDATE` שקט — לא קורא ל-`charge_token`, לא קורא ל-`record_event`. מסלול החידוש באותו מצב **כן** קורא לשניהם.

---

# §0 · 🔴 האבחנה שלך מכילה את התשובה

כתבת:

> *"fake-mode renewal_batch DOES call charge_token (which returns a FAKE-\<hex\> txn id)"*

**כלומר `charge_token` כבר יודע לזייף בעצמו.** מסלול החידוש קורא לו ונותן לו להחליט.

**ל-`/start` יש ענף fake משלו שעוקף אותו לגמרי.**

> 🔴 **זה לא חוסר ב-`record_event`. זה שהפיצול בין fake לאמיתי יושב במקום הלא נכון —
> בראש הזרימה במקום בגבול הרשת.**
> **כל עוד זה כך, שני הענפים ימשיכו להיפרד בכל פעם שמישהו נוגע באחד מהם. זה בדיוק מה שקרה.**

## ולמה זה חשוב יותר משורת אודיט חסרה

**כל התרגיל הזה נועד להוכיח שהשרשרת עובדת.**

**אם מצב fake לא מריץ את אותו קוד כמו מצב אמיתי — ״אומת ב-fake״ לא שווה כמעט כלום.**

זו בדיוק הטעות שנתפסה לפני יומיים עם ה-monkey-patch של `decrypt_token`: **מצב בדיקה שמדלג על הקוד הנבדק אינו בדיקה.**

---

# §1 · לפני שאתה מוסיף עשר שורות — בדוק אם אפשר למחוק עשרים

## שלב 1 · אבחן

**קרא את `charge_token` ב-`services/payment/app/services/cardcom.py`.**

**דווח, לפני כל שינוי:**

- **האם הוא מטפל ב-`PAYMENT_FAKE_MODE` בעצמו** ומחזיר `FAKE-<hex>` בלי לגעת ברשת?
- **מה בדיוק הוא מחזיר** במצב fake — `invoice_number`? `invoice_url`? `response_code`?
- **מה `/start` צריך מהתשובה** שאולי חסר שם

## שלב 2 · אם `charge_token` שלם — **מחק את הענף**

```
/start  →  מוחק את ענף ה-PAYMENT_FAKE_MODE
        →  קורא ל-charge_token כמו המסלול האמיתי
        →  record_event, invoice_data והתקדמות התקופה קורים פעם אחת, בקוד אחד
```

🔴 **זו התוצאה הרצויה: מסלול אחד, ואי אפשר יותר ששני הענפים ייפרדו.**

## שלב 3 · אם `charge_token` חסר משהו

**דווח מה חסר** — ואז לך על הגרסה שהצעת: `record_event(kind='subscription_start', outcome='ok', amount_nis=price, provider_transaction_id=FAKE-…)` בענף ה-fake, **באותה תבנית בדיוק כמו החידוש.**

⚠️ **אבל אז תעד בהערה מעל הענף למה הוא קיים בנפרד** — אחרת מישהו ימחק אותו בעוד חודש בלי להבין.

## שלב 4 · השכן

**`purchase_seats` גם לו יש `if PAYMENT_FAKE_MODE:` משלו** (R4).

🔴 **דווח האם הוא סובל מאותה בעיה. אל תתקן אותו בסבב הזה בלי לדווח קודם** — הוא נבדק השבוע ואני לא רוצה שני שינויים בחיוב באותו דיף.

---

# §2 · גבולות השינוי

🔴 **אל תיגע ב:**

- חישוב הסכום — `base_price + extra_seats_paid × extra_user_price_nis`
- תנאי ה-402 והשערים
- שרשרת הכישלון — `_apply_failure`, `rebill_attempts`, `next_attempt_at`
- `skipped_no_payment_method` מ-R9
- לוגיקת החשבונית `_invoice_data_for`

**אתה משנה **איפה** הפיצול בין fake לאמיתי עובר. לא **מה** קורה בכל צד.**

---

# §3 · הרצה מלאה מאפס אחרי התיקון

**לא להמשיך מהמצב הנוכחי. ישות בדיקה נקייה, מההתחלה:**

```
1  POST /payments/payment-methods     encrypt_token אמיתי
2  POST /subscriptions/start          עכשיו דרך charge_token
3  הקרון עצמו יורה                     לא קריאה ידנית ל-handler
```

🔴 **שלב 3 דרך הקרון בלבד.** אם הקרון לא יורה — **זה ממצא, לא מכשול לעקוף.** עצור ודווח.

---

# Acceptance

## §1

- [ ] 🔴 **מה `charge_token` עושה במצב fake — דווח לפני כל שינוי**
- [ ] **הכרעה: מחיקת הענף או `record_event` בתוכו.** נמק
- [ ] **אם נמחק:** `grep -n "PAYMENT_FAKE_MODE" services/payment/app/routes/subscriptions.py` — **הדבק. הענף ב-`/start` לא שם**
- [ ] **אם נשאר:** ההערה שמסבירה למה
- [ ] **דוח על `purchase_seats`** — כן/לא, בלי תיקון

## §3 — השרשרת

- [ ] **אמצעי תשלום נשמר.** `provider_token` הוא צופן אמיתי, לא `FAKECT:`. הדבק את האורך והתחילית
- [ ] 🔴 **`/start` → `payment_events` עם `kind='subscription_start'`, `outcome='ok'`, סכום נכון, `is_fake=TRUE`.** הדבק את השורה
- [ ] **חשבונית — `invoice_number` בשדה**
- [ ] 🔴 **הקרון ירה מעצמו. הדבק את ההוכחה** — לוג עם חותמת זמן, לא קריאה ידנית
- [ ] 🔴 **`decrypt_token` רץ ולא נפל.** הדבק
- [ ] **`payment_events` — שלוש השורות בסדר: `subscription_start` → `renewal`. הדבק את כולן עם הסכומים**

## רגרסיה — חובה

- [ ] 🔴 **חידוש = מסלול + `extra_seats_paid` × מחיר. `extra_seats_granted` לא נגבה.** הדבק את החישוב
- [ ] **מנוי בלי אמצעי תשלום → `skipped_no_payment_method`, לא הושעה** *(R9)*
- [ ] **מנוי עם כרטיס שנדחה → עדיין נכנס לשרשרת הכישלון**
- [ ] **`comped` לא נאסף**
- [ ] **הרצה כפולה של הקרון → אין חיוב כפול**
- [ ] `--suite all` · `npm run build`
- [ ] 🔴 `git rev-list --left-right --count origin/staging...origin/pivot/v2` → `0 0`

## דווח

1. 🔴 **מה `charge_token` עושה ב-fake**
2. **איזו דרך נבחרה ולמה**
3. 🔴 **שלוש שורות `payment_events` המלאות**
4. **הוכחת הקרון והוכחת ה-decrypt**
5. **`purchase_seats` — כן/לא**
6. `git diff -w --stat`

## Guardrails

`git tag pre-r11`. **סטייג׳ינג בלבד. שני הענפים, ובדוק `rev-list`.**

🔴 **`PAYMENT_FAKE_MODE=true`. אל תשלים רכישה אמיתית.**

🔴 **אל תיגע בסכומים, בשערים, או בשרשרת הכישלון.**

🔴 **אל תתקן את `purchase_seats` בסבב הזה.** דווח בלבד.

🔴 **אל תעקוף את הקרון.** אם הוא לא יורה — זה ממצא.

🔴 **אל תשתמש ב-monkey-patch ואל תריץ handler in-process.** אם משהו נופל — עצור ודווח.

🔴 **`git add` לפי שם קובץ. לעולם לא `-A`.** **וכולל `docs/cc-prompts/*.md`.**

**אל תיגע** ב-R9 · R10 · `viewer_scope_wheres` · חשיפה · `query_rewriter.py`.
