# CC prompt — R1: יישור הענף המקומי + סגירת שארית הכותרת

## מה כבר נבדק — אל תבדוק שוב

X0 הורץ ישירות מול הרפו (`docs/cc-prompts/X0_branch_report.md`). **התוצאות סופיות:**

| | |
|---|---|
| `origin/staging` = `origin/pivot/v2` = `bf331f2` | ✅ האיחוד בוצע. **אין מה למזג** |
| מספרי מיגרציה | ✅ **אין כפילויות.** אחרונה 068 → **הפנוי הבא: 069** |
| **D3** שגיאת reveal | ✅ **סגור** — `RevealModal.tsx:64`, קומיט `04946fa`. **אל תיגע** |
| **D2** NMC | ✅ **סגור** — נבדק: `:752` משתמש ב-`exact === 0 && near === 0`, ו-`:843` הוא fallback לשני מעברים ריקים. **תקין. אל תיגע** |

**⛔ הפרומטים `cc_prompt_branch_reconcile.md` ו-`cc_prompt_d3_reveal_error.md` מבוטלים. אל תריץ אותם.**

**נשארו שני דברים, ושניהם קטנים.** זה כל התוכן של R1.

---

# §0 · 🔴 `staging` המקומי 183 קומיטים מאחור — לפני כל דבר אחר

```
staging   1dc7493 [origin/staging: behind 183]
```

`origin/staging` מעודכן; **המצביע המקומי לא**. מהרגע שההוראה היא "עובדים על `staging`", `git checkout staging` נותן עץ עבודה מלפני 183 קומיטים.

## הרצה — בסדר הזה בדיוק

```bash
git fetch origin

# 🔴 שער בטיחות — חייב לחזור ריק
git log --oneline origin/staging..staging
```

> **אם הפלט לא ריק — עצור ודווח מיד.** יש עבודה מקומית ב-`staging` שאינה ב-origin, ו-`reset --hard` ימחק אותה. **אל תמשיך.**

**רק אם ריק:**

```bash
git branch -f staging origin/staging     # לא עומדים על staging
git rev-parse staging origin/staging     # אימות — שני SHA זהים
```

## ניקוי worktree

```bash
git worktree prune
git worktree list
```

> 🔴 **`git worktree prune` בטוח — הוא מנקה רישום בלבד.**
> **אל תמחק את הענף `claude/crazy-hermann-09dfbb`.** הוא מסומן `ahead 50` מול ה-origin שלו.
> קודם:
> ```bash
> git log --oneline pivot/v2..claude/crazy-hermann-09dfbb | head -60
> ```
> **ריק → דווח והמתן לאישור למחיקה. לא ריק → עצור ודווח מה שם. אל תמחק בשום מקרה בסבב הזה.**

---

# §1 · D1b — הכותרת הישנה שרדה במשטח שני

## הממצא

```
services/frontend/src/app/page.tsx:545
  הפלטפורמה לקבלנים ולתאגידי כוח אדם            ✅ הנוסח שהוכרע

services/frontend/src/components/landing/HeroSection.tsx:66
  פלטפורמת השיבוץ הראשונה בישראל                ❌ הנוסח הישן, עדיין בקוד
```

> **זו בדיוק אותה תקלה כמו תג ה-LIVE:** מחרוזת שיושבת על שני משטחים ותוקנה באחד.
> ההערה ב-`HeroSection.tsx:29` אומרת שהרכיב *"reduced"* — כלומר ייתכן שהוא כבר לא מרונדר בכלל.

## שלב 1 · להכריע — מרונדר או מת

```bash
grep -rn "HeroSection" services/frontend/src --include=*.tsx
```

**דווח תשובה חד-משמעית: האם `<HeroSection` מרונדר ע"י איזשהו עמוד או layout, כן או לא?**
(מהחיפוש עד כה כל ההופעות נראות כהגדרה והערות — **אבל אמת, אל תסתמך על זה.**)

## שלב 2 · לפי התשובה

| ממצא | פעולה |
|---|---|
| **מרונדר** | להחליף את המחרוזת בשורה 66 לנוסח שהוכרע. **לשמור על תגית ה-`<h1>`** אם קיימת |
| **לא מרונדר** | **למחוק את הקובץ `HeroSection.tsx`** + כל import מת שנשאר |

> **אל תשאיר נוסח מת בקוד.** בדיוק זה מה שגורם לו לחזור — מישהו יעתיק ממנו, או ירונדר את הרכיב מחדש בעתיד. **מחיקה, לא הערה.**

## שלב 3 · סריקת ודאות

```bash
grep -rn "פלטפורמת השיבוץ" services/frontend/src docs
```
**חייב לחזור ריק.** אם המחרוזת קיימת במקום נוסף — **דווח, אל תתקן על דעת עצמך.**

---

# Acceptance

- [ ] `git rev-parse staging origin/staging` → **שני SHA זהים**
- [ ] `git log origin/staging..staging` → **ריק**
- [ ] `git worktree list` → רק הצ'קאאוט הראשי
- [ ] הענף `claude/crazy-hermann-09dfbb` — **עדיין קיים**, ודווח מה יש בו
- [ ] `grep -rn "פלטפורמת השיבוץ" services/frontend/src` → **ריק**
- [ ] **`npm run build` בפרונט עובר** — קריטי אם מחקת את `HeroSection`
- [ ] **צילום `scroll=0` ב-390 ובדסקטופ** — הכותרת הנכונה, במלואה, בלי מילה יתומה
- [ ] רגרסיה: חיפוש `"רצפים סינים"` עדיין מחזיר תוצאות

---

# דווח

1. פלט `git log origin/staging..staging` **לפני** התיקון
2. `git rev-parse staging origin/staging` אחרי
3. תשובת שלב 1 — `HeroSection` מרונדר או לא, עם הראיה
4. מה עשית — תיקון מחרוזת או מחיקת קובץ
5. פלט `git log pivot/v2..claude/crazy-hermann-09dfbb`
6. **הצילומים**
7. `git diff -w --stat`

---

# Guardrails

`git tag pre-r1` לפני.
**אין `git add -A`** — קבצים בשם מפורש. CRLF הופך את `git status` ללא-אמין.
**אל תמחק אף ענף** בסבב הזה. **אל תעשה push ל-`main`.**
**אל תיגע:** `query_rewriter.py` · `routes/search.py` · לוגיקת NM · reveal/מנוי/חיוב · טוקני DS · צבע כפתור "חפש" (תקין).
**אל תתחיל את M1/M2/M3** — הם סבב נפרד.

> **DoD = ראיה.** דוח "בוצע" בלי צילום ובלי פלט git נחשב לדוח שלילי.
