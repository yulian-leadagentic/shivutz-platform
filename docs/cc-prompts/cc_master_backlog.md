# TagidAI — Master Backlog ל-CC

> **גרסה:** 2026-08-13 · **נוצר ע"י:** Cowork audit על `C:\Users\yulia\Projects\Shivutz-platform`
> **קובץ יעד:** `docs/cc-prompts/cc_master_backlog.md`
> זה קובץ ההרצה היחיד. כל פרומט נקודתי ב-`docs/cc-prompts/` כפוף לסדר שכאן.

---

## איך CC מריץ את זה

```
קרא את docs/cc-prompts/cc_master_backlog.md.
בצע לפי הסדר, פריט אחד בכל פעם. עצור אחרי כל פריט ודווח.
```

**STANDING RULES (חלים על כל פריט, בלי יוצא מן הכלל):**

1. `git tag pre-<item-id>` **לפני** כל פריט.
2. **`staging` בלבד.** `main` (production) — רק באישור מפורש של Yulian. ראה §0 — יש בעיית-ענף פתוחה, קרא אותה לפני הקומיט הראשון.
3. Mobile-first RTL · לבדוק ב-390 **וגם** בדסקטופ.
4. DS tokens בלבד. כתום קנוני = **brand-600 `#f78203` + טקסט כהה** (זו ההחלטה העדכנית; ראה §B8 — יש פרומט ישן שסותר).
5. DoD לכל פריט: **root-cause** + **before/after** (דסקטופ+מובייל) + **ה-SHA שנפרס**.
6. אם שינוי נכנס לתוך לוגיקת מנוי / reveal / boost / חיוב — **עצור ודווח**, אל תמשיך.

---

## §0 — מצב האמת (קרא לפני שאתה נוגע בכל דבר)

מה שנמצא בפועל ברפו, נכון ל-13/08/2026:

| נושא | מצב בפועל |
|---|---|
| ענף עובד (HEAD) | **`pivot/v2`** — 25 הקומיטים האחרונים שם |
| מה ש-`CLAUDE.md` אומר | "`staging` הוא ענף הפיתוח" — **לא נכון היום** |
| קומיט אחרון | `b1087e6` Track V: voice search — Scribe proxy + landing mic button |
| Tenders | קיים בקוד: `services/deal/app/routes/tenders.py`, **7** מסכי frontend (admin · contractor list/new/[id]/[id]/edit · corporation list/[id]), `lib/api/tenders.ts`, migrations 029/030/031/035/063 |
| Voice (Track V) | נפרס — `services/frontend/src/features/voice/VoiceInputButton.tsx` + proxy ב-gateway |
| WhatsApp | בקוד יש **Vonage בלבד** (`services/notification/src/messaging/vonageWhatsapp.js`, migration 052). **אין שום קוד Meta Cloud API.** |
| חיפוש | `services/user-org/app/routes/search.py` → `query_rewriter.py` → `query_reranker.py` |
| מיגרציות | 001–068, **בלי כפילויות מספר** בצ'קאאוט הראשי ✅ |

**⚠️ פריט חוסם לפני הכל: `B1` בסעיף §B.** הוא שינוי-תיעוד של 5 שורות, והוא מונע מכל סשן CC הבא לקמט לענף הלא-נכון.

---

## §A — חוסמי-השקה (P0)

### A1 · `S1` — hallucinated enum חותך את כל תוצאות החיפוש 🔴 **הכי חמור**

**Root cause — מאומת בקוד.**
ב-`services/user-org/app/services/query_rewriter.py`, בסוף `rewrite_real()`:

```python
merged = {**fake, **{k: v for k, v in parsed.items() if v is not None}}
# Guardrail: ad_type must be one of the two values.
if merged.get("ad_type") not in ("worker", "housing"):
    merged["ad_type"] = fake["ad_type"]
```

**רק `ad_type` מאומת.** `profession_code`, `origin_country`, `region`, `quantity` עוברים מ-Haiku **ישר ל-SQL** בלי בדיקה. ב-`routes/search.py`:

```python
if filters.get("profession_code"):
    wheres.append("(a.profession_code IS NULL OR a.profession_code = %s)")
```

ולכן ערך שלא קיים ב-enum (`"laborer"`, `"construction_worker"`, `"CHN"` במקום `"CN"`, `"merkaz"` במקום `"center"`) **לא נכשל — הוא מסנן**. הוא מתאים רק למודעות שהשדה בהן NULL, ולכן `"פועלים סינים"` מחזיר 0 בזמן שהמלאי קיים.

> **⚠️ הבהרה — זו אינה חולשת אבטחה.** הערכים עוברים כ-bound parameters (`cur.execute(sql, params)`), וה-f-string מרכיב רק ליטרלים סטטיים + `RESULT_LIMIT=50`. **אין SQL injection.** הנזק הוא תוצאות שגויות/ריקות בלבד. אל תבנה שכבת סניטציה נגד injection — בנה **אימות enum**.

**התקדים כבר קיים ברפו.** קובץ אחד ליד, `query_reranker.py`, כן מגן:
```python
def _extract_id_list(text, valid_ids):
    """...drop anything that isn't in the candidate set — the model
       sometimes hallucinates UUIDs on the retry path."""
```
אותו דפוס בדיוק חסר ב-rewriter.

**Do:**
1. הגדר ב-`query_rewriter.py` שלוש קבוצות-אמת. **עדיף לשאוב מה-DB** (`worker_db.profession_types.code`, `origin_countries.code`, `regions.code`) עם cache בזיכרון; אם זה מסבך — לפחות `frozenset(PROFESSION_KEYWORDS.values())` וכו', שכבר קיימות בקובץ.
2. אחרי ה-merge, לכל אחד מ-`profession_code` / `origin_country` / `region`: אם הערך **לא** בקבוצה → **הפל אותו ל-`None`** (אל תחזיר לערך של fake — fake כבר במקום מה-merge) ורשום `print(f"[qrewrite] enum_reject field={k} value={v!r} query={query[:60]!r}")`.
3. `quantity`: כפה `int`, הפל אם `<= 0` או `> 9999`.
4. זרוק מפתחות שה-LLM המציא ואינם בסכימה (whitelist של 6 המפתחות).
5. הוסף טסט: mock ל-Anthropic שמחזיר `{"profession_code":"laborer","origin_country":"CHN"}` → שני הפילטרים נופלים, החיפוש מחזיר את אותן תוצאות כמו בלי פילטר.

**Acceptance:**
- [ ] `"פועלים סינים"` מחזיר > 0 כשקיימות מודעות מתאימות בסטייג'ינג.
- [ ] enum שגוי מ-LLM מופיע בלוג כ-`enum_reject` **ואינו מגיע ל-SQL**.
- [ ] אף נתיב לא מחזיר 500 — בלי enum תקף פשוט אין פילטר.
- [ ] טסט יחידה עם LLM ממוקק עובר.

**Guardrails:** `git tag pre-s1`; לא לגעת ב-reranker; לא לשנות את דירוג הרלוונטיות כשה-LLM מחזיר ערכים תקפים — ההתנהגות זהה, רק הזבל נחסם.

---

### A2 · `S2` — יש להוכיח שנתיב ה-LLM בכלל רץ 🔴

**Root cause — מאומת.**

```python
FAKE_MODE = os.getenv("LLM_REWRITER_FAKE_MODE", "1") == "1"
```

ברירת המחדל היא **`"1"` = fake**. כלומר: גם אם `ANTHROPIC_API_KEY` מוגדר, בלי `LLM_REWRITER_FAKE_MODE=0` מפורש — **החיפוש הוא התאמת-מחרוזות בלבד**, ו-Haiku לא נקרא.

וגרוע יותר: ה-docstring בראש הקובץ מבטיח *"real mode fires when ANTHROPIC_API_KEY is set AND LLM_REWRITER_FAKE_MODE is not '1'"* — אבל `rewrite()` **בודק `FAKE_MODE` בלבד**:
```python
def rewrite(query: str) -> dict:
    if FAKE_MODE:
        return rewrite_fake(query)
    return rewrite_real(query)
```
**אין שום בדיקת API-key בבחירת המצב.** ה-docstring פשוט שגוי.

ובנוסף: `ANTHROPIC_API_KEY` **לא קיים** ב-`.env`, לא ב-`.env.example`, ולא ב-`docker-compose.yml`. חיפוש על פני כל הרפו מחזיר אותו רק בשני קבצי ה-Python עצמם. `user-org` מקבל `env_file: .env` — ולכן **מקומית החיפוש תמיד fake**.

**Do:**
1. הפוך את ברירת המחדל: fake רק אם אין `ANTHROPIC_API_KEY`, או אם `LLM_REWRITER_FAKE_MODE=1` מפורש. עדכן את ה-docstring שיתאים לקוד.
2. הדפס בעליית השירות שורה אחת: `[qrewrite] mode=real model=... timeout=...` / `mode=fake reason=no_api_key`.
3. הוסף ל-`.env.example` **ולסעיף הרלוונטי ב-`docs/RAILWAY_SECRETS_CHECKLIST.md`**: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `LLM_REWRITER_FAKE_MODE`, `LLM_REWRITER_TIMEOUT_S`, `LLM_RERANK_ENABLED`, `LLM_RERANK_MIN`, `LLM_RERANK_TOP_N`.
4. **בונוס באותו סיבוב:** `ELEVENLABS_API_KEY` נמצא ב-`.env` ובשימוש ב-`services/gateway/src/index.js`, אבל חסר ב-`.env.example`. הוסף. (ראה §B9 — יש עוד ~15 מפתחות בפער הזה.)

**Acceptance:**
- [ ] הלוג של `user-org` בסטייג'ינג מראה `mode=real`.
- [ ] `docker compose up` מקומי מראה `mode=fake reason=no_api_key` — במפורש, לא בשקט.
- [ ] `.env.example` מכסה כל מפתח שהקוד קורא.

**Guardrails:** `git tag pre-s2`; **אל תכתוב סודות אמיתיים ל-`.env.example`** — שמות מפתח וערכי-דמה בלבד.

---

### A3 · `S3` — regex הכמות תופס כל מספר במחרוזת 🟡

```python
def _quantity(text): m = re.search(r"\d+", text); return int(m.group(0)) if m else None
```

`"פועלים סינים ל-3 חודשים"` → `quantity=3` → `a.quantity >= 3`. `"רתך עם 10 שנות ניסיון"` → `quantity=10`. הפילטר הזה מצטמצם בשקט על שאילתות טבעיות לגמרי.

**Do:** קבל מספר רק כשהוא צמוד למילת-כמות (`עובדים|פועלים|איש|אנשים|מיטות|חדרים`) או עומד בראש השאילתה; אחרת `None`. בדוק את 6 השאילתות שב-Acceptance.

**Acceptance:** `"פועלים סינים ל-3 חודשים"` ו-`"רתך עם 10 שנות ניסיון"` → `quantity=None`. `"20 פועלים"` / `"צריך 15 עובדים למרכז"` → `20`/`15`.

---

## §B — היגיינת רפו ותיעוד (P0 — לפני כל פיתוח)

### B1 · מודל הענפים ב-`CLAUDE.md` שגוי 🔴 **בצע ראשון**

`CLAUDE.md` אומר במפורש *"The active development branch is **`staging`**, not `main`"*. בפועל HEAD יושב על **`pivot/v2`**, וכל 25 הקומיטים האחרונים שם. `git log main..staging` מחזיר קומיטים ישנים בלבד.

כל סשן CC חדש קורא את `CLAUDE.md` בשניות הראשונות ויקמט לענף הלא-נכון. זה שינוי-תיעוד של 5 שורות שמונע אובדן עבודה.

**Do:** עדכן את סעיף "Branch model — important" ב-`CLAUDE.md` וב-`README.md` וב-`docs/ENVIRONMENTS.md` כך שישקפו את המצב האמיתי: `pivot/v2` → `staging` → `main`, כולל מי נפרס לאן ב-Railway. **החלט מפורשות** אם `staging` עדיין בשרשרת או שהיא נטושה, ותעד.

**Acceptance:** שלושת הקבצים אומרים אותו דבר, והדבר תואם ל-`git rev-parse --abbrev-ref HEAD`.

---

### B2 · CRLF הופך את `git status` לחסר-שימוש 🔴

`git status` מסמן **~68 מיגרציות + רוב הרפו** כ-modified. `git diff --numstat db/migrations/001_initial_schema.sql` → `471 471` — כלומר כל שורה בקובץ "השתנתה". זו המרת סופי-שורה, לא עבודה. `core.autocrlf` לא מוגדר.

התוצאה: אי אפשר לראות מה באמת שונה, ו**כל קומיט הבא יגרור אלפי שינויי-פאנטום** שיסתירו את השינוי האמיתי בסקירה.

**Do:** קומיט אחד ייעודי, לבדו:
1. `.gitattributes` בשורש: `* text=auto eol=lf` + `*.sql text eol=lf` + `*.png binary` (וכו').
2. `git add --renormalize .`
3. קומיט בהודעה `chore: normalize line endings (no functional change)`.
4. אמת: `git status --short` נקי מ-`M` פאנטומיים.

**Guardrails:** `git tag pre-b2`; **הקומיט הזה לבדו** — אל תערבב איתו שום שינוי תוכן.

---

### B3 · כפילויות icon מיותרות ב-`public/` 🟢 *(ירד מ-🔴 אחרי אימות)*

**מה חשבתי בהתחלה:** שנכסי המותג לא מקומטים ולכן ה-build מחזיר 404.
**מה שנמצא באימות:** **אין 404.** הקוד מפנה ל-`/brand/...` בלבד:

```
layout.tsx:30   { url: '/brand/favicon-32.png', ... }
layout.tsx:33   apple: '/brand/apple-touch-icon.png',
manifest.ts:30  { src: '/brand/icon-192.png', ... }
manifest.ts:31  { src: '/brand/icon-512.png', ... }
```

וכל הקבצים תחת `services/frontend/public/brand/` **מקומטים ותקינים** ✅.

הקבצים ה-untracked יושבים ב-**שורש** `public/` (`public/favicon-32.png`, `public/icon-192.png`…) ו**אף אחד לא מפנה אליהם**. הם פלט של `public/brand/generate-tagidai.py` שנשפך למקום הלא-נכון. `tagidai_icon_simple.png` — אפס הפניות בכל הרפו.

**Do:** מחק את כפילויות ה-PNG משורש `public/` (השאר את `public/brand/` כמות שהוא). ודא ש-`generate-tagidai.py` כותב ל-`brand/` ולא לשורש, או הוסף שורת `.gitignore`.

**Acceptance:** `git status` נקי מ-untracked ב-`services/frontend/public/`; ה-favicon בסטייג'ינג עדיין עובד (regression check).

---

### B4 · worktree ישן ו-prunable 🟢 *(ירד מ-🔴 אחרי אימות)*

**מה חשבתי בהתחלה:** התנגשות מיגרציות ממתינה.
**מה שנמצא באימות:** **ההתנגשות כבר נפתרה.** אותן שלוש מיגרציות קיימות ב-`pivot/v2` **ממוספרות מחדש** כ-`055_subscriptions.sql` / `056_ads.sql` / `057_contact_reveals.sql`. מישהו כבר טיפל בזה.

מה שנשאר: `git worktree list` מסמן את `crazy-hermann-09dfbb` כ-**`prunable`** — checkout מת (כולל `node_modules` ו-`.next`) על `4352f1b`. הנתיב בפועל הוא `.claude/.claude/worktrees/` (`.claude` כפול, כמו ש-`CLAUDE.md` מתאר).

**Do:** `git worktree prune`, ואז הכרע אם למחוק את ענף `claude/crazy-hermann-09dfbb` (מקומי + origin). דווח `git log pivot/v2..claude/crazy-hermann-09dfbb --oneline` לפני המחיקה — אם ריק, מחק בלי היסוס.

**Acceptance:** `git worktree list` מציג רק את הצ'קאאוט הראשי; החלטה על הענף מתועדת.

---

### B5 · זבל בשורש הרפו 🟢

| פריט | מה זה |
|---|---|
| `db;C/` | תיקייה ריקה — פקודת Windows שבורה |
| `scripts;C/` | תיקייה ריקה — אותה סיבה |
| `doc` | קובץ 5 בתים, תוכן: `Doc` |
| `worktree` | קובץ 35 בתים untracked, תוכן: `=== Copying dirty files main - ===` |

**Do:** מחק את ארבעתם. (`db;C` ו-`scripts;C` הן תיקיות ריקות — git לא עוקב אחריהן ממילא; `doc` כן מקומט.)

---

### B6 · קבצים שמסמכים מפנים אליהם ואינם קיימים 🔴

הפניות חיות שמצביעות לשום מקום:

| הפניה | מאיפה | מצב |
|---|---|---|
| `claude/HANDOFF_COWORK.md` | מהוראות ההרצה של Yulian ל-Cowork | **לא קיים** — לא ברפו ולא ב-Project |
| `cc_master_workplan.md` | סיכום הסשן של 13/08 | **לא קיים** ב-`docs/cc-prompts/` |
| `cc_prompt_search_quality_V1.md` | סיכום הסשן של 13/08 | **לא קיים** |
| `cc_prompt_whatsapp_vonage.md` | `claude/tagidai_roadmap_tracks.md` ("פרומט מוכן") | **לא קיים** |

**מסקנה:** תוצרי הסשן של 13/08 לא נשמרו לדיסק. הקובץ הזה (`cc_master_backlog.md`) מחליף את `cc_master_workplan.md`; §A מחליף את `cc_prompt_search_quality_V1.md`.

**Do:** אחרי שהקובץ הזה נקלט — נקה מ-`claude/tagidai_roadmap_tracks.md` את ההפניה ל-`cc_prompt_whatsapp_vonage.md` (או כתוב אותו מחדש כ-Meta; ראה §C-W).

---

### B7 · סתירת WhatsApp בשלושה כיוונים 🔴

| מקור | מה הוא אומר |
|---|---|
| `claude/tagidai_roadmap_tracks.md` (13/08) | 🔒 **החלטה נעולה:** "WhatsApp provider = **Vonage** (Messages API) — הוחלף מ-Twilio (12/08/26, Yulian)" |
| הקוד | `services/notification/src/messaging/vonageWhatsapp.js` + migration `052_whatsapp_foundation.sql` — **Vonage בלבד** |
| `.env` | `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_FROM`, `VONAGE_SIGNATURE_SECRET` — **ואפס משתני Meta** |
| המציאות (Yulian, 13/08) | **Vonage בוטל. המספר יושב על Meta Cloud API.** ההודעה נשלחה מהשרת ונמסרה. |

כלומר **המסמך ה"נעול" והקוד שניהם מתארים ספק שכבר בוטל**, ואין ברפו שום עקבה של Meta Cloud API — לא `WHATSAPP_TOKEN`, לא `PHONE_NUMBER_ID`, לא `WABA_ID`, לא `META_APP_SECRET`, לא `VERIFY_TOKEN`, לא webhook.

**Do (תיעוד — מיידי):** עדכן את ההחלטה הנעולה ב-`claude/tagidai_roadmap_tracks.md` ל-Meta Cloud API, כולל תאריך ההיפוך והסיבה.
**Do (קוד — ראה §C-W):** זה טרק שלם, לא תיקון.

---

### B8 · צבע הכפתור הראשי — סתירה חיה בפרומט שטרם הורץ 🟡

`claude/tagidai_design_system.md` קובע: כתום קנוני **brand-600 `#f78203` + טקסט כהה**, ומוסיף במפורש *"מחליף את ההחלטה הקודמת של brand-800+לבן, שנראתה חומה-בוצית"*.

אבל `claude/cc_prompts_P1_wave2.md`, פריט **L1** (עדיין לא הורץ), עדיין מורה:
> "restyle "חפש" to Primary using the DS action token (`--btn-bg` = brand-800 `#a5530b`, white text; hover brand-900 `#7a3d07`)"

מי שירוץ על L1 כמו שהוא **יחזיר את הבאג שתוקן**.

**Do:** תקן את L1 ב-`claude/cc_prompts_P1_wave2.md` ל-brand-600 + טקסט כהה, ואמת שאותו ערך ישן לא שרד גם ב-`docs/tagidai_design_system.html`.

---

### B9 · `.env.example` מפגר אחרי `.env` 🟡

מפתחות שהקוד קורא וקיימים ב-`.env`, אך **חסרים לגמרי** מ-`.env.example`:

```
ADMIN_EMAIL · CARDCOM_API_NAME · CARDCOM_API_PASSWORD · CARDCOM_BASE_URL
CARDCOM_TERMINAL_NUMBER · CARDCOM_WEBHOOK_SECRET · ELEVENLABS_API_KEY
JOB_DB_NAME · JOB_MATCH_SERVICE_URL · MASTER_OTP · MATCH_CACHE_TTL_SECONDS
PAYMENT_DB_NAME · PAYMENT_FAKE_MODE · PAYMENT_SERVICE_URL · SMS_PROVIDER
TOKEN_ENCRYPTION_KEY · VONAGE_API_KEY · VONAGE_API_SECRET · VONAGE_FROM
VONAGE_SIGNATURE_SECRET
```

מתאחד עם §A2. מפתח חדש שמקים סביבה לפי `.env.example` מקבל stack שבור בשקט.

**Do:** יישר `.env.example` מול הקוד (לא מול `.env` — שמות + ערכי-דמה + הערה אחת לכל אחד), ויישר את `docs/RAILWAY_SECRETS_CHECKLIST.md` באותו סיבוב. **בלי סודות אמיתיים.**

---

### B10 · `docs/cc-prompts/` כולה untracked 🟡

כל 20 קבצי הפרומטים, `docs/Logo/`, `docs/migration/`, `marketing-screenshots/` — לא ב-git. הם קיימים רק על מכונה אחת.

**Do:** קמט את `docs/cc-prompts/`. לגבי `docs/Logo/` ו-`docs/12_worker_images/` (וידאו של ~60MB) ו-`marketing-screenshots/` — הכרע: `.gitignore` מפורש, או Git LFS. אל תשאיר במצב ביניים.

---

## §C — טראקים (אחרי §A ו-§B)

הסדר להלן. אל תתחיל טרק לפני ש-§A ו-§B סגורים.

### C1 · `empty-states` — קבלן טרי רואה שגיאה אדומה
פרומט מוכן: **`docs/cc-prompts/cc_prompt_empty_states.md`**. ארבעה מסכים (דשבורד / billing / tenders / marketplace). מתלכד עם QA-5 ועם Tenders-T1 — **בצע במקום אחד**.

### C2 · `commission-leak` — שריד "עמלה" בדיאלוג אישור-ארגון
פרומט מוכן: **`docs/cc-prompts/cc_prompt_commission_leak.md`**. פספוס של ניקוי D3 (migration 067). קטן.

### C3 · `reveal-paywall` — אימות
פרומט: **`docs/cc-prompts/cc_prompt_reveal_paywall.md`**. CC כבר שלח תיקון (`111fb62`, `6a41c7f`) — **טרם אומת ויזואלית**, כי ה-harness נכנס רק כישות קבלן ולכן כל מסכי `corporation__*` ו-`admin__*` יצאו NoAccessCard.
**חסם:** צריך **harness דו-ישותי** (capture גם כ-corp) לפני שאפשר לסמן ✅.

### C4 · `Tenders T1` — אודיט + הקשחה
פרומט מוכן: **`docs/cc-prompts/cc_prompt_tenders_T1_audit.md`**. התשתית קיימת (ראה §0), אז האודיט ירוץ. אודיט בלבד — בלי פיצ'רים חדשים.

### C5 · `Ads / Promotions` (A1→A4)
טרק לבנייה. יושב על טבלת `promotions` הקיימת (migrations 064/065). **החלטה פתוחה של Yulian:** סלוט בלעדי מול רוטציה. אל תתחיל בלי הכרעה.

### C6 · `Track W1` — WhatsApp inbound על **Meta Cloud API**
**פרומט מוכן: `docs/cc-prompts/cc_prompt_whatsapp_meta_W1.md`** ⭐ (13/08/26)

**מצב מאומת:** יוצא ✅ עובד · **נכנס ❌ אין webhook** · **מוח ❌ אין קוד**.

**מה שכבר קיים ואסור לבנות מחדש:** migration `052` נייטרלי-לספק ועובד עם Meta כמו שהוא (`whatsapp_message_log`, `support_messages`, `whatsapp_template_name`, `whatsapp_opt_in`) · `messaging/index.js` כבר dispatcher ערוץ-מודע — משתנות **שתי שורות** · `/api/webhooks` כבר עושה proxy ל-notification, ו-`/api/webhooks/vonage` כבר ב-`PUBLIC_PREFIXES` כתבנית להעתקה.

**החלטות מוצר נעולות (Yulian, 13/08):**
1. V1 = **חיפוש בלבד + לינק**. reveal ותשלום באתר, לא בצ'אט.
2. מספר לא-רשום **מחפש כרגיל** ומקבל הזמנה להירשם.
3. ה-webhook ב-**gateway** (`/api/webhooks/whatsapp`) → proxy ל-notification.

> **🎯 תוצאה חשובה:** המשתמש תמיד יוזם ⇒ כל תשובה בחלון 24ש' ⇒ **free-text** ⇒ **V1 לא צריך אף template מאושר.** ה-lead-time של אישור templates **אינו חוסם** את W1.

**W2** (נדחה): templates ליזום · רשימות אינטראקטיביות · reveal בצ'אט. **W3** (נדחה): STT להודעה קולית → אותה שכבת Scribe מ-Track V.

**⚠️ תלות חיצונית — לא קוד:** ה-Meta app חייב להיות **Published** כדי לאמת webhooks אמיתיים. אפשר לממש הכל בלעדיו ולבדוק מול payload מוקלט, אבל האימות הסופי חסום. ראה §D/Y1.

### C7 · `L2` / `L3` — הקשחת נתיב החיפוש
מ-`claude/cc_prompts_P1_wave2.md`, עדיין פתוחים: פילטרים מובנים לצד הטקסט החופשי (L2) + rate-limit לאנונימי, cache, מדידת p95 (L3). **הרץ אחרי S1/S2** — אין טעם להקשיח נתיב שעדיין מסנן זבל.

---

## §D — חסמים שאינם קוד (Yulian, לא CC)

| # | מה | למה זה חוסם |
|---|---|---|
| Y1 | **Publish את ה-Meta app** | חוסם את כל §C6. שתי דקות. בלי זה webhooks אמיתיים לא מגיעים, והדיבוג יילך לכיוון שגוי. |
| Y2 | `leadagentic.net` חייב להציג **שם משפטי + כתובת + טלפון** | אחרת Business Verification יידחה שוב (השם המשפטי הוא **Lead Agentic**, לא TagidAi). |
| Y3 | הכרעה: **סלוט בלעדי מול רוטציה** ב-Ads | חוסם את §C5. |
| Y4 | הכרעה: מה בדיוק admin מתעד בשער-הזוכה ב-Tenders | חוסם את T2. |
| Y5 | הכרעה: האם `staging` עדיין בשרשרת הענפים | חוסם את §B1. |

**⏰ 1 באוקטובר** — כל תשובה של בוט ה-WhatsApp מתחילה לעלות כסף. לכן העיצוב של §C6 חייב להיות **הודעה יוצאת אחת לחיפוש**, לא שיחה מרובת-סבבים.

---

## סדר ההרצה — תקציר

```
B1  (מודל ענפים — תיעוד, 5 דקות)     ← ראשון, מונע אובדן עבודה
B2  (CRLF — קומיט נורמליזציה לבדו)    ← שני, בלעדיו כל diff לא-קריא
B5  (מחיקת זבל)                       ← נוסע יחד עם B2
──────────────────────────────────────
S1  (enum guard)                      🔴 חוסם-השקה
S2  (הוכחת mode=real + env)           🔴
S3  (regex כמות)                      🟡
──────────────────────────────────────
B3  (מחיקת כפילויות icon)             🟢
B4  (worktree prune)                  🟢
B6→B10 (תיעוד/סתירות/‏env.example)
──────────────────────────────────────
C1  empty-states  →  C2  commission-leak
C3  reveal-paywall (חסום: harness דו-ישותי)
C4  Tenders T1
C7  L2/L3   →   C5 Ads (חסום Y3)   →   C6 WhatsApp/Meta (חסום Y1)
```

---

## מה אומת בפועל בסקירה הזאת

✅ נקרא ואומת בקוד: `query_rewriter.py` · `query_reranker.py` · `routes/search.py` · `CLAUDE.md` · `README.md` · `docs/cc-prompts/README.md` · 4 פרומטי CC · `docker-compose.yml` (בלוק user-org) · מפתחות `.env` ו-`.env.example` (שמות בלבד) · `git log`/`branch`/`status`/`diff --numstat` · רשימת המיגרציות בשני הצ'קאאוטים · `claude/tagidai_roadmap_tracks.md` · `claude/cc_prompts_P1_wave2.md` · `claude/tagidai_design_system.md`.

🔁 **סבב אימות שני (subagent, על הרפו החי)** — 12 טענות נבדקו מול הקוד. 10 אושרו, **2 הופרכו ותוקנו בקובץ הזה**:
- **B3 ירד 🔴→🟢** — אין 404. הקוד מפנה ל-`/brand/...`, וכל הקבצים שם מקומטים. ה-untracked בשורש `public/` הם כפילויות שאיש לא מפנה אליהן.
- **B4 ירד 🔴→🟢** — התנגשות המיגרציות **כבר נפתרה**: 052–054 מהworktree קיימות ב-`pivot/v2` כ-055–057. נשאר רק worktree `prunable`.
- תוקן גם: אין SQL injection ב-S1 (bound params) · `rewrite()` לא בודק API-key כלל · 7 מסכי tenders ולא 6.

❌ **לא** אומת (לא נבדק חי): התנהגות סטייג'ינג בדפדפן · מצב ה-Meta app · האם `staging` עדיין בשרשרת הענפים · האם T1/D1 בוצעו במלואם (migrations 063/064/065 קיימים — האודיט יכריע).
