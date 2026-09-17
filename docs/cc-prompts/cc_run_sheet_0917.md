# Run Sheet · 17.09 — ריצה רציפה

**מחליף את `cc_run_sheet_0916.md`.** נכתב אחרי מעבר מלא על הריפו החי ב-17.09, לא מהזיכרון.

**‏12 ימי עבודה מלאים + 5 ימי חול המועד עד 14.10.**

---

# R0 · 🔴 `staging` מפגר ב-4 קומיטים אחרי `pivot/v2`

## זה לא ניתוח. זו מדידה

```
origin/staging   9881804   U8 §5a
origin/pivot/v2  c2548e3   U11
git rev-list --left-right --count origin/staging...origin/pivot/v2  →  0  4
```

**ארבעת הקומיטים שלא על סטייג׳ינג:**

| | |
|---|---|
| `601c0ef` | U7 Phase A — יסודות `service_provider` |
| `1f2cfbb` | U7 Phase B+C — הרשמת ספק + CTA תלת-תפקידי |
| `40668a5` | U7 Phase D — `placements` + באנר וקרוסלה בשוק |
| `c2548e3` | U11 — ארבעת מסכי הניהול |

> **זה מסביר הכל:** מסכי הניהול שבורים כי U11 לא שם. אין ספק שירותים כי U7 לא שם.
> **שלושה סבבי אבחון רצו מול שרת שלא מכיל את הקוד שאובחן.**

## Do — לפני כל דבר אחר

1. **`git push origin pivot/v2:staging`**
2. **פרוס את כל השירותים** — `frontend`, `admin`, `user-org`, `auth`, `gateway`
3. 🔴 **ודא שהמיגרציות 077 ו-078 רצו.** `SELECT name FROM auth_db._migrations WHERE name LIKE '07%' ORDER BY name;` — **הדבק. אם חסרות, הרץ**
4. **אמת בדפדפן** — `/admin/subscriptions` נטען, `/register/provider` קיים

🔴 **אל תמשיך ל-R1 לפני ששלושת אלה ירוקים.**

⚠️ **ולמה זה קרה:** דיווחת "dual-push" בסבבים קודמים, וארבעת האחרונים הלכו רק ל-`pivot/v2`.
**מעכשיו — אחרי כל `git push`, הרץ `git rev-list --left-right --count origin/staging...origin/pivot/v2` והדבק את הפלט בדוח.** `0 0` או שלא סיימת.

---

# R1 · U11 §2 — התיקון לא נכתב

**בדקתי בקוד הנוכחי:**

```tsx
// services/frontend/src/app/admin/gov-corps-registry/page.tsx:260
.then((res) => setRows(res.rows as unknown as RegistryRow[]))
```

**ההמרה הכפולה עדיין שם.** הדוח של U11 תיאר הידוק טיפוסים — **אבל `as unknown as` מבטל אותו לחלוטין.**

`matchable_count=222` הוא אגרגט מה-DB: **ל-222 שורות יש `business_number` כרגע**, והמסך מציג 450 ריקות.

1. **`console.log(JSON.stringify(res.rows[0]))` — הדבק גולמי**
2. **מחק את `as unknown as`. הדבק את שגיאת הקומפיילר**
3. **תקן לפי מה שהיא אומרת**

## R1b · §1 — שאלה שלא נענתה בשני סבבים

```sql
SELECT name FROM auth_db._migrations WHERE name LIKE '07%' ORDER BY name;
```

🔴 **אם 071 או 072 חסרות — תיקון ה-COLLATE לא רלוונטי. דווח, אל תתקן קוד.**

---

# R2 · 🔴 U7 פספס את רכיב ההצטרפות שמופיע בדף הבית

**זה הרכיב שבצילום של Yulian, ו-U7 לא נגע בו.**

```
services/frontend/src/features/advertising/RoleRegisterPicker.tsx
   קומיט אחרון: 0717186 (H8) — לפני U7
   מרונדר ב-app/page.tsx:1923
```

**ומה שיש בו היום:**

```tsx
const ROLES: RoleTile[] = [ קבלן, תאגיד כוח אדם ];   // שניים

// Kept out of ROLES so it doesn't render…
const _SERVICE_PROVIDER_TILE_DISABLED: RoleTile = {
  title: 'מתווכים ובעלי מקצוע',
  desc:  'בקרוב — פרסום פניות לתחומים משיקים…',
  soon:  true,
};
void _SERVICE_PROVIDER_TILE_DISABLED;
```

> **האריח השלישי הוצא מהמערך בכוונה, עם הערה: "כשזרימת ספק השירותים תנחת, שקול להחליף את 'בקרוב'".**
> **הזרימה נחתה ב-`1f2cfbb`. האריח לא הוחזר.**

**`RegistrationCTASection` כן תוקן** — שלושת ה-`href` שם. **שני רכיבים, אחד תוקן.**

## Do

- **החזר את האריח ל-`ROLES`** עם `href: '/register/provider'`, בלי `soon`
- **הכותרת:** `הצטרפו לפלטפורמה` → **`הרשם עכשיו`** (שורה 57). ⚠️ **זו הבקשה המקורית של Yulian מ-14.09 ועוד לא בוצעה באף רכיב**
- **הנוסח:** `מתווכים ובעלי מקצוע` → **`ספק שירותים נלווים`**, ותיאור שמתאר מה שקיים — לא "בקרוב"
- 🔴 **`grep -rn "הצטרפו לפלטפורמה\|בחרו את הכובע" services/frontend/src`** — **ודא שלא נשאר מופע שלישי.** זו הפעם השנייה שרכיב הצטרפות נשכח
- **מערך תפקידים אחד לשני הרכיבים.** הדבק את ההגדרה ואת הקוראים

---

# R3 · U10 ואז U9 — כתובים, לא הורצו

**אימתתי בקוד שאף אחד מהם לא רץ.**

## U10 — `cc_prompt_U10_recent_cards.md`

`app/page.tsx:1885` עדיין `<div key={ad.id} …>` בלי `<Link>`.

## U9 — `cc_prompt_U9_how_it_works.md`

**ארבע השורות עדיין שם:**

| שורה | מה כתוב | הבעיה |
|---|---|---|
| 50 | `טלפון של מוקד הזמנות` | תאגיד כוח אדם אינו מוקד |
| **156** | `מודעות דיור **וציוד**` | 🔴 **סותר את U8 §2 שכבר בקוד** — תאגיד יקבל 403 |
| 160 | `המודעות **והצפיות** הפעילות` | `max_reveals_per_month` הוא `NULL` בכל מסלולי התאגיד (059:35-37) |
| 181 | `מרשם החברות ו**מרשם היבואנים**` | לאמת מול `corporations.py` |

🔴 **שורה 156 היא היחידה שמבטיחה למשתמש משהו שהשרת דוחה. קדימות.**

---

# R4 · רכישת מושב נוסף — **שער החלטה**

**מה שקיים:** `contractors.py:855` ו-`corporations.py:689` מחזירים **402 `seat_upgrade_required`** עם המחיר.
**מה שחסר:** מסלול לשלם.

> **הקבלן מקבל הודעה עם מחיר ואין כפתור.**

🔴 **Yulian — האם רכישת מושב נכנסת להשקה, או שקבלן שמגיע ל-5 פונה לתמיכה?**
**שתיהן לגיטימיות. אל תבנה בלי תשובה.**

---

# R5 · להוכיח את החידוש החודשי

**הקוד קיים ומלא** — `POST /payments/internal/renewal-batch`, `subscriptions.py:426`, קורא `INTERNAL_BATCH_SECRET`, עם `RENEWAL_BATCH_LIMIT=100` והגנת `last_renewal_attempt_at`.

**מה שלא קיים: הוכחה שהוא רץ אי פעם.**

1. **הגדר `INTERNAL_BATCH_SECRET` בסטייג׳ינג.** ⚠️ `.env.example:93` כבר מכיל את השם — **ערך דמה בלבד, לעולם לא סוד אמיתי**
2. **מנוי בדיקה** עם `current_period_end` בעבר, `status='active'`, ישות `is_seed`
3. **הרץ במצב fake**
4. **אמת שלושה:**
   - `payment_events` — רשומה שנייה, `is_fake=TRUE`
   - `current_period_end` התקדם
   - 🔴 **הרצה חוזרת מיד → לא מחייבת פעמיים.** **אי-אידמפוטנטיות כאן היא חיוב כפול ללקוח אמיתי**
5. **מנוי שאמור להסתיים — מסתיים**

⚠️ **PAY-4 כבר מומש** — `_invoice_data_for` (`subscriptions.py:350`) ממלא `InvoiceHead`/`InvoiceLines` ל-Cardcom, ו-`invoice_number`/`invoice_url` נתפסים גם מהחיוב וגם מה-webhook.
🔴 **אז בדוק גם: החידוש מנפיק חשבונית, לא רק חיוב.** הדבק את השדות מהאירוע השני.

---

# R6 · פרסום — **שער החלטה פתוח מ-13.08**

`078` הוסיפה `placements` בלבד. **הערת `069:22-28` עדיין תקפה מילה במילה:**

```
* NO price column. Yulian hasn't decided flat-per-category vs CPM
* NO impression/click event tracking
```

> **סלוט בלעדי לקטגוריה, או רוטציה?** **ההכרעה קובעת את הסכימה.** ניחוש = מיגרציה שתתבטל.

🔴 **אל תתחיל בלי תשובה. הזכר את זה בכל דוח עד שייסגר.**

---

# R7 · Tenders

**מה שקיים:** קומיט אחד — `461cccf "tenders T1 hardening: route detail-page errors through mapApiError"`. **פריט אחד מתוך האודיט.**

**`docs/cc-prompts/cc_prompt_tenders_T1_audit.md` — הרץ אותו במלואו.**

🔴 **T2 ואילך חסום** על שער-הזוכה.

---

# R8 · ניקיון שאותר בסריקה

- 🔴 **`services/job-match;C/`** — ספרייה עם נקודה-פסיק בשם, תוצאה של פקודה שהשתבשה. **בדוק מה בתוכה. אם היא זבל — העבר ל-`_to_delete/` ודווח. אל תמחק בעצמך**
- **438 קבצים מסומנים כמשונים** ברובם CRLF. 🔴 **זו הסיבה ש-`git add -A` אסור. אל תנסה "לתקן" את זה לפני ההשקה** — נרמול שורות על כל הריפו ערב השקה הוא סיכון בלי תמורה
- **`.git/index.lock` תקוע — הזזתי אותו ל-`.git/index.lock.stale`.** אם אתה נתקל ב-`Unable to create '.git/index.lock'` — **זה מה שקרה, והפתרון הוא להזיז ולא לנסות שוב**

---

# מחוץ לחלון

| | ראיה |
|---|---|
| **WhatsApp / Meta** | `services/notification/src/messaging/` מכיל **`vonageWhatsapp.js` בלבד**. אין `WHATSAPP_TOKEN` / `PHONE_NUMBER_ID` ב-`.env.example` — רק `VONAGE_*`. **כתיבה מאפס** |
| **Tenders T2+** | שער-הזוכה |
| **פורטל עובדים רב-לשוני** | שלב עתידי בתוכנית |

---

# דיווח בכל שלב

1. 🔴 **`git rev-list --left-right --count origin/staging...origin/pivot/v2` — הדבק. חייב `0 0`**
2. **מה ראית בדפדפן אחרי הפריסה** — לא "עבר"
3. תשובות גולמיות לכל אבחון
4. `git diff -w --stat`
5. **מה נשאר פתוח ולמה** — רשימה כנה עדיפה על V שקרי

# Guardrails

🔴 **סטייג׳ינג בלבד. `main` רק באישור מפורש של Yulian.**
🔴 **`git add` לפי שם קובץ. לעולם לא `-A`** — 438 קבצים משונים מ-CRLF.
🔴 **`git tag pre-<שלב>` לפני כל שלב.**
🔴 **`PAYMENT_FAKE_MODE` — אל תשלים רכישה אמיתית.**
🔴 **`MASTER_OTP=999999` — מקומי וסטייג׳ינג בלבד.**
🔴 **`.env.example` — שמות וערכי דמה. אפס סודות אמיתיים.**
🔴 **מפתחות API בצד שרת ולפי שירות:** `ANTHROPIC_API_KEY`→user-org · `ELEVENLABS_API_KEY`→gateway · `WHATSAPP_*`→notification.
🔴 **אל תמציא ח.פ שנראה אמיתי.**
🔴 **R4 ו-R6 אינם שלך להכריע.**
