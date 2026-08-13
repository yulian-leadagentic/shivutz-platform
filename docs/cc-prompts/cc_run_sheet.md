# CC Run Sheet — 13/08/2026

**קובץ הרצה יחיד. בצע את השלבים לפי הסדר, מ-0 עד 9, בלי לעצור לשאלות — למעט שלב 7 שמסומן במפורש כ-STOP.**

כל ממצא כאן **אומת בקוד** מול `pivot/v2` ב-HEAD `b3c6620`. השורות והנתיבים מדויקים. אל תבזבז זמן על גילוי מחדש — לך ישר לתיקון, ואם משהו לא תואם למה שכתוב כאן, **דווח על הפער** ואל תנחש.

---

## PRE-FLIGHT — קרא לפני השלב הראשון

1. **ענף.** הרץ `git rev-parse --abbrev-ref HEAD`. אתה אמור להיות על **`pivot/v2`**. `CLAUDE.md` עדיין אומר במקום אחד ש-`staging` הוא הענף הפעיל — **זה לא נכון**. קמט לענף שאתה באמת עליו. **אל תיגע ב-`main`.**
2. **`git status` לא אמין.** כל הרפו מסומן modified בגלל המרת CRLF (`git diff --numstat db/migrations/001_initial_schema.sql` → `471 471`, כלומר כל שורה "השתנתה"). **אף פעם `git add -A`.** stage קבצים במפורש בשם. לסקירת העבודה שלך: `git diff -w -- <file>`.
3. **`git tag pre-<step>` לפני כל שלב.** קומיט נפרד לכל שלב, עם ההודעה שכתובה בשלב.
4. **staging בלבד.** production (`main`) רק באישור מפורש של Yulian.
5. אחרי כל שלב: **דווח בשורה אחת** — מה היה, מה תוקן, ה-SHA. ואז המשך לשלב הבא.

---

# שלב 0 · לקמט את `docs/cc-prompts/`

**למה:** `git ls-files docs/cc-prompts/` מחזיר **0**. כל קבצי ההרצה יושבים על הדיסק ולא בהיסטוריה. זו הסיבה שסשן קודם דיווח "queue empty" — הוא פשוט לא ראה את הבקלוג. אם תיפתח worktree, גם אתה לא תראה אותם.

אלה קבצים **חדשים**, ולכן ה-CRLF churn לא נוגע בהם — הקומיט נקי.

```
git add docs/cc-prompts/
git commit -m "docs: track CC run files (backlog, W1, round2, run sheet)"
```

**Acceptance:** `git ls-files docs/cc-prompts/ | wc -l` > 0.

---

# שלב 1 · S1 — enum מומצא חותך את כל תוצאות החיפוש 🔴 חוסם-השקה

`git tag pre-s1`

## Root cause (מאומת)

`services/user-org/app/services/query_rewriter.py:222-226`:

```python
fake = rewrite_fake(query)
merged = {**fake, **{k: v for k, v in parsed.items() if v is not None}}
# Guardrail: ad_type must be one of the two values.
if merged.get("ad_type") not in ("worker", "housing"):
    merged["ad_type"] = fake["ad_type"]
```

**רק `ad_type` מאומת.** `profession_code`, `origin_country`, `region`, `quantity` עוברים מ-Haiku ישר החוצה. ערכי ה-enum המותרים קיימים רק כ**פרוזה ב-system prompt** (שורות 198-202), לא כקוד.

ואז ב-`services/user-org/app/routes/search.py:86-94`:

```python
if filters.get("profession_code"):
    wheres.append("(a.profession_code IS NULL OR a.profession_code = %s)")
    params.append(filters["profession_code"])
```

ערך שלא קיים ב-enum (`"laborer"`, `"construction_worker"`, `"CHN"` במקום `"CN"`, `"merkaz"` במקום `"center"`) **לא נכשל — הוא מסנן**. הוא מתאים רק למודעות שהשדה בהן NULL. לכן `"פועלים סינים"` מחזיר 0 בזמן שהמלאי קיים.

> **⚠️ זו אינה חולשת אבטחה.** הערכים עוברים כ-bound parameters (`cur.execute(sql, params)` שורה 119), וה-f-string מרכיב רק ליטרלים סטטיים + `RESULT_LIMIT=50`. **אין SQL injection.** אל תבנה סניטציה נגד injection — בנה **אימות enum**.

> **התקדים כבר קיים ברפו.** `query_reranker.py`, פונקציה `_extract_id_list`, כבר זורק UUIDs שהמודל המציא מול `valid_ids`. אותו דפוס בדיוק, קובץ אחד ליד. חקה אותו.

## Do

1. הגדר שלוש קבוצות-אמת ב-`query_rewriter.py`. **עדיף לשאוב מה-DB** (`worker_db.profession_types.code`, `origin_countries.code`, `regions.code`) עם cache בזיכרון; אם זה מסבך את השירות — לפחות `frozenset(PROFESSION_KEYWORDS.values())`, `frozenset(ORIGIN_KEYWORDS.values())`, `frozenset(REGION_KEYWORDS.values())`, שכבר קיימות בקובץ.
2. אחרי ה-merge, לכל אחד מ-`profession_code` / `origin_country` / `region`: אם הערך **לא** בקבוצה → **הפל אותו ל-`None`** (לא לערך של fake — fake כבר במקום מה-merge), ורשום:
   `print(f"[qrewrite] enum_reject field={k} value={v!r} query={query[:60]!r}")`
3. `quantity`: כפה `int`; הפל אם `<= 0` או `> 9999`.
4. זרוק מפתחות שה-LLM המציא ואינם בסכימה — whitelist של 6 המפתחות בלבד.
5. **טסט:** mock ל-Anthropic שמחזיר `{"profession_code":"laborer","origin_country":"CHN","region":"merkaz"}` → שלושת הפילטרים נופלים, והחיפוש מחזיר את אותן תוצאות כמו בלי פילטר.

## Acceptance
- [ ] `"פועלים סינים"` מחזיר > 0 כשקיימות מודעות מתאימות.
- [ ] enum שגוי מופיע בלוג כ-`enum_reject` **ואינו מגיע ל-SQL**.
- [ ] אף נתיב לא מחזיר 500 — בלי enum תקף פשוט אין פילטר.
- [ ] טסט היחידה עובר.

**Commit:** `search S1: validate LLM enums against real code sets before filtering`

---

# שלב 2 · S2 — נתיב ה-LLM כנראה בכלל לא רץ 🔴 חוסם-השקה

`git tag pre-s2`

## Root cause (מאומת)

`query_rewriter.py:22`:
```python
FAKE_MODE = os.getenv("LLM_REWRITER_FAKE_MODE", "1") == "1"
```

ברירת המחדל היא **`"1"` = fake**. ובתחתית הקובץ:
```python
def rewrite(query: str) -> dict:
    if FAKE_MODE:
        return rewrite_fake(query)
    return rewrite_real(query)
```

**אין שום בדיקת API-key בבחירת המצב** — למרות שה-docstring בראש הקובץ מבטיח *"real mode fires when ANTHROPIC_API_KEY is set AND LLM_REWRITER_FAKE_MODE is not '1'"*. **ה-docstring שגוי, ו-`rewrite_real` הוא dead code כברירת מחדל.**

ובנוסף: `ANTHROPIC_API_KEY` מופיע **רק בשני קבצי ה-Python** בכל הרפו. הוא לא ב-`.env.example` ולא ב-`docker-compose.yml`. `user-org` מקבל `env_file: .env` — ולכן **מקומית החיפוש הוא התאמת-מחרוזות בלבד, תמיד.**

## Do

1. הפוך את ברירת המחדל: fake רק אם **אין** `ANTHROPIC_API_KEY`, או אם `LLM_REWRITER_FAKE_MODE=1` **מפורש**. **עדכן את ה-docstring שיתאר את מה שהקוד עושה.**
2. הדפס בעליית השירות שורה אחת: `[qrewrite] mode=real model=... timeout=...` או `[qrewrite] mode=fake reason=no_api_key`.
3. הוסף ל-`.env.example` **ול-`docs/RAILWAY_SECRETS_CHECKLIST.md`** (שמות + ערכי-דמה בלבד — **בלי סודות אמיתיים**):
   `ANTHROPIC_API_KEY` · `ANTHROPIC_MODEL` · `LLM_REWRITER_FAKE_MODE` · `LLM_REWRITER_TIMEOUT_S` · `LLM_RERANK_ENABLED` · `LLM_RERANK_MIN` · `LLM_RERANK_TOP_N`
4. **באותו סיבוב — יישר את כל הפער.** המפתחות הבאים קיימים ב-`.env` ובשימוש בקוד, אבל **חסרים לגמרי מ-`.env.example`**:
   `ADMIN_EMAIL` · `CARDCOM_API_NAME` · `CARDCOM_API_PASSWORD` · `CARDCOM_BASE_URL` · `CARDCOM_TERMINAL_NUMBER` · `CARDCOM_WEBHOOK_SECRET` · `ELEVENLABS_API_KEY` · `JOB_DB_NAME` · `JOB_MATCH_SERVICE_URL` · `MASTER_OTP` · `MATCH_CACHE_TTL_SECONDS` · `PAYMENT_DB_NAME` · `PAYMENT_FAKE_MODE` · `PAYMENT_SERVICE_URL` · `SMS_PROVIDER` · `TOKEN_ENCRYPTION_KEY` · `VONAGE_API_KEY` · `VONAGE_API_SECRET` · `VONAGE_FROM` · `VONAGE_SIGNATURE_SECRET`

## Acceptance
- [ ] `docker compose up` מקומי מדפיס `mode=fake reason=no_api_key` — **במפורש, לא בשקט**.
- [ ] עם `ANTHROPIC_API_KEY` מוגדר → `mode=real`.
- [ ] `.env.example` מכסה כל מפתח שהקוד קורא. **אפס סודות אמיתיים בקובץ.**
- [ ] דווח מה הלוג של `user-org` בסטייג'ינג מראה — `real` או `fake`.

**Commit:** `search S2: select LLM mode by API key presence + document every env var`

---

# שלב 3 · S3 — regex הכמות תופס כל מספר במחרוזת 🟡

`git tag pre-s3`

`query_rewriter.py`:
```python
def _quantity(text): m = re.search(r"\d+", text); return int(m.group(0)) if m else None
```

`"פועלים סינים ל-3 חודשים"` → `quantity=3` → `a.quantity >= 3`. `"רתך עם 10 שנות ניסיון"` → `quantity=10`. הפילטר מצטמצם בשקט על שאילתות טבעיות לגמרי.

**Do:** קבל מספר רק כשהוא צמוד למילת-כמות (`עובדים|פועלים|איש|אנשים|מיטות|חדרים`) או עומד בראש השאילתה. אחרת `None`.

## Acceptance
- [ ] `"פועלים סינים ל-3 חודשים"` → `quantity=None`
- [ ] `"רתך עם 10 שנות ניסיון"` → `quantity=None`
- [ ] `"20 פועלים"` → `20` · `"צריך 15 עובדים למרכז"` → `15`

**Commit:** `search S3: only treat a number as quantity when it modifies a count noun`

---

# שלב 4 · R1 — דשבורד התאגיד עדיין נושא את באג ה-regex שתוקן בקבלן 🔴

`git tag pre-r1`

`b3c6620` תיקן את `contractor/dashboard/page.tsx` — החליף זיהוי-שגיאה מבוסס-regex בבדיקת status. **הקובץ המקביל לא טופל:**

`services/frontend/src/app/corporation/dashboard/page.tsx:85`
```js
if (/404|not.?found|no.?subscription/i.test(msg))
```

`msg` הוא טקסט שגיאה. כל שינוי בנוסח — או הודעה בעברית — שובר את הזיהוי, והתאגיד מקבל **באנר אדום** במקום "אין מנוי פעיל".

**Do:** החל את אותו תיקון של `b3c6620`. `ApiError` ב-`services/frontend/src/lib/api/client.ts:268` נושא `cause: ApiErrorPayload & { status: number }` — בדוק `status === 404`, לא regex.

## Acceptance
- [ ] תאגיד בלי מנוי → empty-state עם CTA, לא אדום.
- [ ] `git grep -n "404|not.\?found" -- services/frontend/src/app` מחזיר אפס.

**Commit:** `corp dashboard: gate no-subscription on ApiError.status, matching b3c6620`

---

# שלב 5 · R2 — ל-`/billing` אין empty-state בכלל 🔴

`git tag pre-r2`

דווח בסבב קודם כ"מפריד נקי בין empty ל-error". **הוא לא מפריד — אין לו ענף empty.**

`services/frontend/src/app/billing/page.tsx:91-94` — `refresh()` עוטף את `subscriptionApi.me()` ב-try/catch יחיד; **כל** כשל, כולל 404, מציב `error`, שמרנדר את הבאנר האדום בשורה 357.

**למה זה לא נראה היום:** `services/payment/app/routes/subscriptions.py:101-103` עושה lazy-init של שורת trial (`if row is None: row = _insert_trial(...)`), ולכן 404 כמעט לא קורה. **זו גם הסיבה שהתיקון בדשבורד הקבלן קוסמטי.** ברגע שה-lazy-init ישתנה — הקבלן רואה אדום.

**Do:** הוסף ל-`/billing` ענף empty אמיתי — 404 / אין מנוי → "אין מנוי פעיל" + CTA "רכשו מנוי". **אדום נשמר ל-5xx בלבד.** אותו דפוס ויזואלי כמו הדשבורד.

## Acceptance
- [ ] אילוץ ידני של 404 מ-`subscriptionApi.me()` → empty-state, לא אדום.
- [ ] 500 → אדום.

**Commit:** `billing: real empty state for no-subscription; red reserved for 5xx`

---

# שלב 6 · R3 — `upgrade()` עדיין מדליף שגיאה גולמית 🟡

`git tag pre-r3`

`5c8e5df` (QA-3) המיר `refresh()` / `addMember()` / `removeMember()` ל-`mapApiError`, ודילג על אחד:

`services/frontend/src/app/billing/page.tsx:147`
```js
setError((e as Error).message ?? 'שגיאה בשדרוג');
```

שדרוג-tier שנכשל מציג קוד מכונה באנגלית בתוך הבאנר האדום — בדיוק מה ש-QA-3 בא לסגור.

**Do:** העבר גם את `upgrade()` דרך `mapApiError`.

## Acceptance
- [ ] כשל שדרוג מדומה → הודעה בעברית.
- [ ] `git grep -n "(e as Error).message" -- services/frontend/src/app/billing` מחזיר אפס.

**Commit:** `billing QA-3 follow-up: route upgrade() errors through mapApiError`

---

# שלב 7 · R4 — הבטחת "עמלה" חיה בעמוד הרישום ⛔ STOP AND ASK

`git tag pre-r4`

`4d54185` ניקה "עמלה" מדיאלוג האישור ב-admin. נשאר מופע אחד — **והוא גרוע יותר, כי הוא מול משתמש אמיתי ברגע הרישום:**

`services/frontend/src/app/register/corporation/page.tsx:67`
> "על כל עובד שאוייש בעסקה ייגבה תעריף עמלה אחיד מהתאגיד … הקבלן אינו משלם עמלה בעסקה זו."

המוצר עבר pivot **מעמלה-לעסקה → מנוי/ליסטינגים** (migration 067 מחק את העמודות). התאגיד נרשם היום מול הבטחה חוזית שאינה נכונה.

## ⛔ עצור כאן

זה **טקסט מסחרי, לא copy**. **אל תמציא מודל תמחור.** הצג ל-Yulian שתי הצעות נוסח שמתארות את המודל בפועל (מנוי/ליסטינגים), ו**חכה לאישור** לפני שאתה כותב.

**מה כן לעשות בלי לשאול, באותו קומיט:**
`services/notification/src/testCatalog.js:201,452,455` מכיל `commission_amount: 2500` ו-`event_type: 'commission.invoiced'` — דאטת-בדיקה של אירוע שכבר לא קיים. **מחק.**

## Acceptance
- [ ] `git grep -n "עמלה" -- services ':!*node_modules*'` מחזיר אפס (אחרי אישור הנוסח).
- [ ] אין `commission.*` ב-`testCatalog.js`.

**Commit:** `remove post-pivot commission remnants from corp registration + test catalog`

---

# שלב 8 · R5 — README של ה-harness מבטיח יכולת שאינה קיימת 🟡

`git tag pre-r5`

`tools/screens-export/README.md:44-45` טוען שה-harness *"logs in once per contractor + corporation + admin, if the phone has multiple memberships"*. **הקוד לא עושה זאת.**

`screens.spec.ts` מתחבר בזרימת OTP **יחידה** (`LOGIN_PHONE` :19, `MASTER_OTP` :20, `/api/auth/send-otp` → `/api/auth/login/otp` :254-264), ופותח context אחד לכל **viewport** (`ensureLoggedInContext(browser, viewport)` :383) — **לא לכל ישות**. ה-`role` מ-`roleFromJwt` משמש רק להכשרת NoAccessCard לגיטימיים (:418-460). הביקור השיורי ב-`/select-entity` (:394) הוא `.catch(() => {})` ריק.

זו הסיבה ש-`reveal-paywall` בצד התאגיד מעולם לא אומת — **וה-README מסתיר את זה.**

**Do:** תקן את ה-README שיתאר את מה שהקוד עושה: ישות אחת, לפי `LOGIN_PHONE`; מסכי `corporation__*` ו-`admin__*` ייצאו כ-NoAccessCard.

**⚠️ אל תממש דו-ישותיות כאן.** זו משימה נפרדת שתוכננה בנפרד.

## Acceptance
- [ ] README תואם לקוד, וכולל את מגבלת הישות היחידה במפורש.

**Commit:** `screens-export: README describes actual single-entity login`

---

# שלב 9 · דוח סיום

הפק דוח קצר, פריט אחד לשורה:

| שלב | סטטוס | SHA | הערה |
|---|---|---|---|
| 0 docs tracked | | | |
| 1 S1 enum guard | | | |
| 2 S2 mode+env | | | |
| 3 S3 quantity | | | |
| 4 R1 corp dashboard | | | |
| 5 R2 billing empty | | | |
| 6 R3 upgrade | | | |
| 7 R4 commission | | | ממתין לאישור נוסח? |
| 8 R5 harness README | | | |

**ובנוסף דווח במפורש:**
- מה הלוג של `user-org` בסטייג'ינג מראה — `mode=real` או `mode=fake`.
- האם `"פועלים סינים"` מחזיר תוצאות בסטייג'ינג **אחרי** S1+S2.
- כל מקום שבו המציאות בקוד **לא תאמה** למה שכתוב ב-run sheet הזה.

---

## מחוץ לתחום — אל תיגע בסבב הזה

- **Track W1 (WhatsApp/Meta)** — הפרומט מוכן ב-`docs/cc-prompts/cc_prompt_whatsapp_meta_W1.md`, אבל הוא **חסום** עד ש-Yulian יעשה Publish ל-Meta app. אל תתחיל.
- **harness דו-ישותי** — משימה נפרדת.
- **רענון favicon** — ה-favicon **עובד** (כל הנכסים ב-`public/brand/` מקומטים ומקושרים מ-`layout.tsx` ו-`manifest.ts`). מה שממתין הוא בחירה עיצובית, לא באג. `tagidai_icon_simple.png` כבר בתיקייה, untracked ולא מקושר.
- **נורמליזציית CRLF** — משנה כל קובץ ברפו, ולכן חייבת קומיט משלה בסבב נפרד. אל תערבב אותה כאן.
- **לוגיקת מנוי / reveal / boost / Cardcom** — אם שינוי כלשהו מתחיל להיכנס לשם, **עצור ודווח**.
