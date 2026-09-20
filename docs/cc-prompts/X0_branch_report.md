# X0 — דוח מיפוי ענפים
**27/08/2026 · הורץ ישירות מול `C:\Users\yulia\Projects\Shivutz-platform` · קריאה בלבד**

> **הפרומט `cc_prompt_branch_reconcile.md` בוצע. אין צורך להריץ אותו שוב.**
> CC צדק: האיחוד כבר קרה. **אבל נשארה סכנה אחת שלא זוהתה — סעיף 2.**

---

## 1 · ✅ האיחוד בוצע — CC צדק

```
origin/pivot/v2   bf331f2
origin/staging    bf331f2   ← זהים
pivot/v2..staging = ריק
staging..pivot/v2 = ריק (מול origin)
```

**X0b (החלטת איחוד) — אין מה להחליט.** הענפים זהים. ה-`git push origin pivot/v2:staging` היה fast-forward נקי, ולא נאבדה עבודה.

---

## 2 · 🔴 מה ש-CC פספס — `staging` **המקומי** 183 קומיטים מאחור

```
staging   1dc7493 [origin/staging: behind 183]
```

**`origin/staging` מעודכן. `staging` המקומי לא.**

המשמעות מיידית ומסוכנת: **`git checkout staging` על המכונה הזאת נותן עץ עבודה מלפני 183 קומיטים.** כל מי שיעבוד "על staging" לפי ההוראה החדשה — ויכתוב עליו — יבנה על בסיס ישן, ו-`git push` יידחה או יגרור merge מיותר.

**התיקון, לפני כל דבר אחר:**
```bash
git fetch origin
git branch -f staging origin/staging     # אם לא עומדים על staging
# או, אם עומדים עליו:
git checkout staging && git reset --hard origin/staging
```

> ⚠️ **לפני `reset --hard` — לוודא ש-`staging` המקומי לא מחזיק עבודה לא-מקומטת.** `git log origin/staging..staging` צריך לחזור ריק. **אם הוא לא ריק — עצור ודווח.**

---

## 3 · 🟡 `main` — 44 קומיטים מאחור, ועם Vonage

```
main              20839d5 [origin/main: behind 44]
origin/main       569b0fb  "Vonage Messages API: 200-OK stubs..."
```

**פרודקשן מחזיק את ספק ה-WhatsApp שבוטל.** לא דחוף — אין משתמשים חיים — אבל צריך לדעת שזה שם. **לא נוגעים ב-`main` בלי אישור מפורש.**

---

## 4 · ✅ מיגרציות — נקי

- **אין מספרים כפולים.** בדיקה על כל `db/migrations/`
- **קבצים זהים** בין הענפים (טריוויאלי — אותו SHA)
- **האחרונה: `068_drop_deal_lifecycle_storage.sql`**

> ### 🎯 **המספר הפנוי ל-M1 הוא `069`.** זו התשובה שחסמה את M1.

---

## 5 · 🟡 Worktree — prunable, **אבל אל תמחק**

```
.claude/.claude/worktrees/crazy-hermann-09dfbb   4352f1b   prunable
claude/crazy-hermann-09dfbb  [origin/...: ahead 50]
```

ה-worktree מת, **אבל הענף שלו מסומן `ahead 50` מול ה-origin שלו.**

**`git worktree prune` בטוח** (מנקה רק את הרישום).
**מחיקת הענף — לא, עד שיוכח ש-50 הקומיטים כלולים ב-`pivot/v2`:**
```bash
git log --oneline pivot/v2..claude/crazy-hermann-09dfbb
```
ריק → אפשר למחוק. לא ריק → **עצור ודווח.**

---

## 6 · 🔴 חוב פתוח — התמונה השתנתה, שני ממצאים חדשים

### D1 · הכותרת — **בוצע חלקית. יש משטח שני**

```
services/frontend/src/app/page.tsx:545
  הפלטפורמה לקבלנים ולתאגידי כוח אדם            ✅

services/frontend/src/components/landing/HeroSection.tsx:66
  פלטפורמת השיבוץ הראשונה בישראל                ❌ הנוסח הישן, עדיין שם
```

> **זו בדיוק אותה תקלה כמו תג ה-LIVE:** הנוסח יושב על שני משטחים, ותוקן באחד.
> ההערה ב-`HeroSection.tsx:29` אומרת שהרכיב "reduced" — כלומר ייתכן שהוא כבר לא מרונדר.
> **פעולה ל-CC:** לקבוע אם `HeroSection` מרונדר בפועל. **מרונדר → לתקן את הנוסח. לא מרונדר → למחוק את הרכיב.** להשאיר נוסח מת בקוד זה מה שגורם לו לחזור.

### D2 · NMC — **כנראה בוצע, טעון אימות אחד**

```
page.tsx:752   if (exact === 0 && near === 0) return 'לא נמצאו מודעות התואמות לחיפוש';   ✅ התנאי הנכון
page.tsx:843   'לא נמצאו מודעות התואמות'                                                  ❓ תנאי לא ידוע
```
**פעולה:** לצטט את התנאי שעוטף את `:843`. אם הוא לא `exact === 0` — הסתירה עדיין חיה שם.

### D3 · שגיאת reveal — **✅ בוצע, ובוצע נכון**

```
RevealModal.tsx:64   if (block?.kind !== 'error') clearPendingReveal();
```
בדיוק הכלל שנדרש. ושתי הקריאות הנוספות **תקינות ואינן באג**:
- `page.tsx:327` — נתיב הצלחה. הכוונה מומשה ✅
- `page.tsx:416` — `המודעה כבר לא זמינה`. זו **תשובה מוצרית**, לא כשל טכני ✅

**קומיט `04946fa`. `cc_prompt_d3_reveal_error.md` — סגור, לא להריץ.**

### D4 · נרדפות — **פתוח.** `cc_prompt_synonyms.md`

---

# ✅ הסדר המתוקן

```
1 · לתקן את staging המקומי  (סעיף 2)          ← לפני הכול
2 · D1b  HeroSection — לתקן או למחוק
3 · D2   לצטט את התנאי ב-page.tsx:843
4 · D4   נרדפות
5 · X1   mode=real            ← Yulian, דקה
6 · X2   seed_coverage
7 · M1   מיגרציה 069 → M2 → M3 → M3b → M4
```

**בוטלו:** `cc_prompt_branch_reconcile.md` (בוצע) · `cc_prompt_d3_reveal_error.md` (בוצע) · X0b (אין מה להחליט).
