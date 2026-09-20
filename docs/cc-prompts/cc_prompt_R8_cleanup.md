# R8 · ניקיון — והסיבה שהוא לא קוסמטי

## ⭐ `git tag pre-r8`. **אחרי R6. הסבב האחרון בחלון ההשקה.**

**סבב קצר. אין כאן קוד מוצר.**

---

# §1 · 🔴 worktree נטוש בנפח 785MB — והוא מרעיל כל חיפוש בריפו

```
$ git worktree list
/…/Shivutz-platform                                              0ac3b94 [pivot/v2]
C:/…/Shivutz-platform/.claude/.claude/worktrees/crazy-hermann-09dfbb
                                                                 4352f1b [claude/crazy-hermann-09dfbb] prunable
```

```
$ du -sh .claude/.claude/worktrees/crazy-hermann-09dfbb
785M
```

**עותק מלא ושני של הריפו, תקוע על קומיט מלפני חודשים, מסומן `prunable` ע״י git עצמו.**
⚠️ **שים לב לנתיב: `.claude/.claude/` — `.claude` כפול. הוא נוצר מנתיב שגוי מלכתחילה.**

## 🔴 למה זה לא ״סדר וניקיון״

**הריצתי `grep -rn "flooring"` על הריפו כדי לאמת ממצא ב-R16. כל שמונה התוצאות הראשונות הגיעו מה-worktree הנטוש:**

```
./.claude/.claude/worktrees/crazy-hermann-09dfbb/db/migrations/001_initial_schema.sql:219
./.claude/.claude/worktrees/crazy-hermann-09dfbb/services/frontend/src/features/workers/csv.ts:104
...
```

> **כלומר כל `grep` רחב בריפו הזה מחזיר קודם את הקוד של לפני חודשיים.**
> **שנינו קוראים קוד דרך חיפוש. זה בדיוק האופן שבו נקרא קובץ לא נכון ומדווח ממצא שגוי.**

**זה כבר קרה השבוע. זה יקרה שוב.**

## Do

1. **בדוק מה יש שם לפני שאתה נוגע** — `git log --oneline -3 4352f1b` ו-`git status` בתוך ה-worktree. **אם יש שם עבודה לא-ממוזגת, עצור ודווח. אל תמחק**
2. **אם נקי:** `git worktree prune -v` — הדבק את הפלט
3. **אם התיקייה נשארת אחרי ה-prune** — **העבר אותה ל-`_to_delete/`. אל תמחק בעצמך.** Yulian מוחק
4. **הענף `claude/crazy-hermann-09dfbb`** — אם הוא ממוזג במלואו, דווח והצע מחיקה. **אל תמחק ענף בלי אישור**
5. 🔴 **אמת שזה עבד:** אותו `grep -rn "flooring"` — **אפס תוצאות מ-`.claude/`.** הדבק לפני ואחרי

---

# §2 · `services/job-match;C/` — פחות ממה שחשבנו

```
$ ls -la "services/job-match;C"     →  ריק לחלוטין
$ git ls-files "services/job-match;C"  →  0
```

**תיקייה ריקה, לא במעקב git.** (git לא עוקב אחרי תיקיות ריקות בכלל.) **תוצאה של פקודה שהשתבשה עם `;C` בשם.**

**Do: העבר ל-`_to_delete/` ודווח.** ⚠️ **השם מכיל `;` — צטט את הנתיב במרכאות בכל פקודה.**

---

# §3 · 🔴 61 קבצי prompt לא במעקב — זה השורש של ״הקובץ לא קיים״

```
$ git status --porcelain docs/cc-prompts/ | grep -c '^??'
61
```

> **זו הסיבה שדיווחת שלוש פעמים שקובץ שנשלח אליך לא קיים בשום ענף.**
> **הוא היה על הדיסק. הוא פשוט מעולם לא נוסף ל-git.**

**Do:**

- 🔴 **`git add` לכל 61, לפי שם.** **לעולם לא `-A`** — §4 מסביר למה בדיוק כאן
- **קומיט אחד:** `docs(cc-prompts): track 61 prompt and report files`
- **`git status --porcelain docs/cc-prompts/ | grep -c '^??'` → `0`.** הדבק

⚠️ **קבצים לא-במעקב גם מחוץ ל-`docs/cc-prompts`:** `docs/Logo` · `docs/migration` · `marketing-screenshots/` · `tools/screens-export` · `"Claude outputs/"` · `worktree`.
**אל תוסיף אותם.** **רשום אותם בדוח עם שורה אחת לכל אחד: מה זה ולמה כן/לא לעקוב.** 🔴 **`"Claude outputs/"` ו-`worktree` — בדוק אם הם שאריות כמו §1 ודווח.**
**Yulian מכריע. שקול `.gitignore` במקום מעקב.**

---

# §4 · 🔴 438 הקבצים ה״משונים״ — אל תיגע

**רובם CRLF, לא שינוי תוכן.**

🔴 **אל תנרמל שורות. לא עכשיו, לא ב-`.gitattributes`, לא ב-`git add --renormalize`.**

> **נרמול שורות על כל הריפו 24 יום לפני השקה הוא דיף של אלפי קבצים שאף אחד לא יכול לקרוא — ובתוכו כל שינוי אמיתי נעלם.**
> **סיכון בלי תמורה. אחרי 14.10.**

**וזו גם הסיבה ש-`git add -A` אסור כאן:** הוא יבלע את 438 הקבצים לתוך הקומיט של §3.

---

# §5 · `.git/index.lock`

**תיעוד, לא משימה.** ה-lock נתקע שוב השבוע.

```
Unable to create '.git/index.lock': File exists
→  mv .git/index.lock .git/index.lock.stale.$(date +%s)
```

🔴 **אל תנסה שוב את אותה פקודה. הזז, המשך.** **אל תמחק — ב-VM המחובר `rm` נכשל.**
**יש כמה `.stale.*` מהשבוע — רשום אותם בדוח, אל תנקה.**

---

# Acceptance

- [ ] 🔴 **`git worktree list` — שורה אחת בלבד.** הדבק
- [ ] 🔴 **`grep -rn "flooring"` לפני ואחרי — אפס תוצאות מ-`.claude/`.** הדבק את שניהם
- [ ] **מה היה ב-`4352f1b`.** דווח לפני שנגעת
- [ ] **785MB השתחררו.** `du -sh .` לפני ואחרי
- [ ] **`"services/job-match;C"` הועברה ל-`_to_delete/`**
- [ ] 🔴 **`git status --porcelain docs/cc-prompts/ | grep -c '^??'` → `0`.** הדבק
- [ ] **`git log --stat -1` על קומיט §3 — רק `.md` תחת `docs/cc-prompts/`.** 🔴 **אם יש שם קובץ קוד, `-A` נכנס בטעות. בטל והתחל מחדש**
- [ ] **ששת הפריטים הלא-במעקב — שורה לכל אחד.** דווח
- [ ] 🔴 **אפס נרמול שורות.** `git diff --stat` על קוד → ריק
- [ ] `--suite all` · `--suite matrix` · `npm run build` · `npm test`
- [ ] 🔴 `git rev-list --left-right --count origin/staging...origin/pivot/v2` → **`0 0`. הדבק**

## דווח

1. 🔴 **ה-`grep` לפני ואחרי**
2. **מה היה ב-worktree ובענף**
3. **ששת הפריטים הלא-במעקב + המלצה**
4. **`git log --stat -1`**
5. `du -sh .` לפני ואחרי

---

## Guardrails

`git tag pre-r8`. **סטייג׳ינג בלבד. שני הענפים.**

🔴 **אפס שינוי קוד מוצר בסבב הזה.** אם נגעת בקובץ תחת `services/` שאינו התיקייה הריקה — עצור ודווח.

🔴 **אל תמחק. `_to_delete/`.** גם worktree, גם התיקייה הריקה.

🔴 **אל תמחק ענף בלי אישור.**

🔴 **אפס נרמול שורות.**

🔴 **`git add` לפי שם. לעולם לא `-A`** — כאן במיוחד.
