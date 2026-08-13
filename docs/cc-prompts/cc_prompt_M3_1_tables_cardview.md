# CC prompt — M3.1: המרת שאר הטבלאות ל-card-view במובייל (390px). עצמאי.

## הקשר
טבלאות רחבות ב-390px = כשל מס' 1 במובייל. `contractor/tenders` **כבר הומר ל-card-view ועובד יפה** — הוא **תבנית-האמת**: שכפל את אותו דפוס לשאר הטבלאות. השאר עדיין `<table>` רחב שנחתך במובייל.

## ⭐ STANDING RULE
Mobile-first RTL, 390px + דסקטופ. `git tag pre-m3-1-cardview` לפני. יעדי מגע ≥44px. אימות מול `screens-export/mobile/` + `desktop/`. דווח per-screen + before/after.

---

## הדפוס (מ-tenders — לשכפל)
- **≤sm:** כל שורת טבלה → **כרטיס אנכי**: שדה:ערך אחד מתחת לשני; תגיות מצב עם טקסט (לא צבע בלבד); פעולות (ערוך/מחק/צפה) ככפתורים גלויים ≥44px בתחתית הכרטיס.
- **≥sm:** הטבלה נשארת `<table>` רגילה — בלי רגרסיה בדסקטופ.
- מימוש: או קומפוננטת `<ResponsiveTable>` משותפת, או `hidden sm:table` לטבלה + `sm:hidden` לרשימת כרטיסים. העדף קומפוננטה משותפת אם קל.

---

## היקף — לפי עדיפות

### שלב A — user-facing (קודם, קריטי)
- **corporation/workers** — טבלת עובדים.
- **corporation/ads** (מודעות שלי) — אם מוצג כטבלה; אם כבר כרטיסים, דלג ותעד.
- כל טבלה user-facing נוספת ב-contractor/corporation שעדיין `<table>` (מלבד tenders שכבר בוצע).

### שלב B — admin (×17)
- כל טבלאות ה-admin (approvals, orgs, users, tenders, workers, ads וכו').
- כאן מותר **גם** horizontal-scroll מבוקר כחלופה כשיש הרבה עמודות מספריות: **עמודה ראשונה sticky** (מזהה/שם) + scroll-hint גלוי. אף פעם לא טבלה שנחתכת בשקט מחוץ למסך.

---

## Acceptance
- [ ] כל טבלה user-facing (שלב A) ב-390px = card-view קריא (שדה:ערך, פעולות ≥44px), בלי חיתוך/overflow אופקי.
- [ ] כל טבלאות admin (שלב B) = card-view או horizontal-scroll עם עמודה sticky + hint — אף אחת לא נחתכת בשקט.
- [ ] דסקטופ (≥sm): כל הטבלאות נשארות טבלה רגילה, אפס רגרסיה.
- [ ] תגיות מצב עם טקסט (לא צבע בלבד); כפתורי פעולה = כתום קנוני; מספרים/מזהים `dir=ltr`.
- [ ] דיווח per-screen: אילו הומרו ל-card-view, אילו ל-scroll, אילו כבר היו תקינים (דלגו).

## Guardrails
`git tag pre-m3-1-cardview`; layout/reflow בלבד — **לא לגעת ב-queries/דאטה/מיון/פילטור** (רק העברת אותם נתונים לתצוגת כרטיס); DS tokens; שכפל את דפוס ה-tenders הקיים במקום להמציא חדש; production (main) לא נגעת — staging עד אישור מפורש.
