# R24 §3 · /how-it-works copy proposals — **לאישור Yulian**

Per R24 §3 guardrail, this file **proposes** replacement copy for three sentences on `/how-it-works` that promise anonymous access to content that R13 gated behind login. Nothing has been shipped to `services/frontend/src/app/how-it-works/page.tsx` — the current strings are still there. Yulian picks a variant (or writes his own) and the R25 or later prompt ships the final copy.

---

## Sentence 1 — line 31, contractor pitch step 1

**Current:**
> מקלידים או מדברים בעברית טבעית. אין טופס למלא, אין הרשמה — כל מה שצריך זו שאלה אחת.

**Why this needs to change:** R13 blocks worker-ads and housing-ads for anonymous visitors. The sentence promises "no registration" but a visitor searching for workers gets 0 results + a login CTA. That is a broken promise, not a UX bug.

**Proposals — pick one:**

**Variant A (soft — keeps the anon-search value prop):** *לאישור Yulian*
> מקלידים או מדברים בעברית טבעית. השאלה עצמה חינם — לצפייה בפרטי המודעה נדרשת התחברות קצרה.

**Variant B (accurate + expectations set upfront):** *לאישור Yulian*
> מקלידים או מדברים בעברית טבעית — בלי טופס. שירותים נלווים גלויים מיד; לפרטי עובדים ודיור נכנסים ב-SMS מהיר.

**Variant C (minimal edit):** *לאישור Yulian*
> מקלידים או מדברים בעברית טבעית. שירותים נלווים גלויים מיד — לפרטי מודעות עובדים נדרשת התחברות.

---

## Sentence 2 — line 143, subscription block

**Current:**
> המנוי כולל מספר חשיפות בחודש — הגלישה במודעות עצמה תמיד חינם.

**Why this needs to change:** "הגלישה במודעות עצמה תמיד חינם" is true for a contractor with an active subscription. An anonymous visitor sees the login CTA on worker/housing ads — not "the ad itself". Without the audience-qualifier the sentence contradicts what a first-time visitor experiences.

**Proposals — pick one:**

**Variant A (add audience qualifier):** *לאישור Yulian*
> לקבלן מחובר: המנוי כולל מספר חשיפות בחודש, והגלישה במודעות עצמה תמיד חינם.

**Variant B (invert framing):** *לאישור Yulian*
> אחרי ההתחברות, גלישה במודעות היא ללא עלות. המנוי נחוץ רק כדי לחשוף פרטי קשר של תאגידים ומעסיקים.

---

## Sentence 3 — line 238, services-block

**Current:**
> הצפייה חופשית לגמרי — כמו שאר המודעות בפלטפורמה.

**Why this needs to change:** The current text is TRUE for the שירותים נלווים context this section is in — services ads ARE viewable anonymously. **But** the tail "כמו שאר המודעות בפלטפורמה" is misleading because "שאר המודעות" (worker + housing) are NOT viewable anonymously. Trim the tail.

**Proposals — pick one:**

**Variant A (trim only):** *לאישור Yulian*
> הצפייה חופשית לגמרי — גם לגולשים אנונימיים.

**Variant B (positive contrast):** *לאישור Yulian*
> הצפייה בשירותים הנלווים חופשית לחלוטין, גם ללא התחברות — בשונה ממודעות עובדים ודיור, שדורשות חשבון.

**Variant C (minimal):** *לאישור Yulian*
> הצפייה בשירותים נלווים חופשית לגמרי.

---

## How to ship the approved copy

Once Yulian picks variants:

1. Reply here with `A/A/A` (or a specific set).
2. Next prompt commits the exact strings into `services/frontend/src/app/how-it-works/page.tsx` at lines 31 / 143 / 238.
3. `git diff` is one file, three string replacements.

Do not commit these strings yet — the R24 guardrail explicitly says "propose, don't ship".

---

# ✅ ההכרעה — 22.09.2026

## משפט 1 · שורה 31 — **וריאנט D, חדש**

**אף אחת משלוש ההצעות לא נבחרה.** A ו-C מכניסים הגבלה לתוך ה-pitch של שלב 1, ו-A גם מדייק לכיוון השגוי — **מודעת שירותים נלווים כן נצפית במלואה בלי התחברות**, אז ״לצפייה בפרטי המודעה נדרשת התחברות״ אינו נכון.

```
מקלידים או מדברים בעברית טבעית. אין טופס למלא — כל מה שצריך זו שאלה אחת.
```

🔴 **מחיקת שתי מילים בלבד: ״אין הרשמה,״.**

**הנימוק:** ההבטחה השבורה היא ״אין הרשמה״ ותו לא. **ושלב 3 בעמוד כבר אומר זאת מפורשות** — *״ההרשמה נדרשת רק כדי לחשוף את פרטי הקשר״*. **אין צורך להקדים את ההגבלה לשלב 1; העמוד מטפל בה במקום הנכון.** ⚠️ **טעינת שלב 1 בתנאים הופכת pitch להסתייגות.**

## משפט 2 · שורה 143 — **וריאנט B**

```
אחרי ההתחברות, גלישה במודעות היא ללא עלות.
המנוי נחוץ רק כדי לחשוף פרטי קשר של תאגידים ומעסיקים.
```

**למה B ולא A:** A מוסיף מוסגר ומתקן. **B מנסח את מודל התמחור עצמו — גלישה חינם, משלמים רק כדי ליצור קשר.** גם מדויק וגם משפט מכירה טוב יותר מזה שהוא מחליף.

## משפט 3 · שורה 238 — **וריאנט C**

```
הצפייה בשירותים נלווים חופשית לגמרי.
```

**למה C:** B אומר לקורא במפורש שמודעות אחרות דורשות חשבון — **בתוך מקטע שכל תפקידו למכור את אנכיות השירותים הנלווים.** שלילה מיותרת במקום הלא נכון. A תקין, אבל ״גולשים אנונימיים״ היא מילה של מפתחים ולא של לקוח.

---

## Do

**שלוש החלפות מחרוזת בקובץ אחד:** `services/frontend/src/app/how-it-works/page.tsx`

- [ ] שורות 31 · 143 · 238
- [ ] 🔴 **`git diff` — קובץ אחד, שלוש שורות**
- [ ] **צילום שלושת המקטעים ב-390 אחרי**

---

# ✅ §4 · אקורדיון מול קישור — ההכרעה: **משאירים אקורדיון**

**אימתת שהוא נגיש** — `role="button"` · `tabIndex=0` · `aria-expanded` · Enter/Space/Escape. **זה עונה על ההסתייגות שלי ב-R23 §4, שהייתה על נגישות ולא על העדפה.**

🔴 **והתבנית נכונה למוצר הזה:** **הפעולה שהמשתמש בא בשבילה היא החשיפה, לא עמוד פרטים.** ניווט החוצה וחזרה מוסיף שני מסכים למסלול שכל כולו ״מצא וצור קשר״.

⚠️ **ומה שנראה כאי-עקביות מול `/marketplace` — מוצדק:** מודעת שירותים נלווים יש לה עמוד פרטים עם תמונות ותיאור, ולכן היא קישור. **מודעת עובדים נפתחת במקום כי אין לה מה להראות מעבר לפרטי הקשר.** תוכן שונה, affordance שונה.

**אל תשנה. סגור.**
