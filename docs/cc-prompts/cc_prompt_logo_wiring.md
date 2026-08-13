# CC prompt — שיבוץ לוגו TagidAI רספונסיבי + favicon/PWA

## נכסים (כבר בריפו — לא לייצר מחדש)
`services/frontend/public/`:
- `brand/tagidai_lockup.png` — לוקאפ מלא שקוף (לרקע **בהיר**).
- `brand/tagidai_lockup_white.png` — לוקאפ לבן+כתום (לרקע **כהה**).
- `brand/tagidai_icon.png` — אייקון מרובע שקוף (גלובוס+פועלים, בלי וורדמארק) לרקע בהיר.
- `brand/tagidai_icon_white.png` — אייקון מרובע לרקע כהה.
- `favicon-16.png` `favicon-32.png` `favicon-48.png` · `apple-touch-icon.png` (180) · `icon-192.png` `icon-512.png` (PWA).

## עיקרון — מערכת לוגו רספונסיבית
לוקאפ מלא היכן שיש מקום; אייקון קומפקטי במקומות צרים; גרסה לבנה על רקע כהה. תמיד `alt="TagidAI"`.

## ⭐ STANDING RULE
Mobile-first RTL, 390px + דסקטופ. `git tag pre-logo-wiring` לפני. Next `<Image>` עם width/height מפורשים (בלי CLS). דווח before/after.

---

## Do

### 1. קומפוננטת `<BrandLogo variant="lockup|icon" tone="light|dark" />`
עוטפת `next/image`, בוחרת את הקובץ הנכון מ-`/brand/…`, `priority` בהירו. מקור אמת אחד — כל שאר המקומות משתמשים בה.

### 2. שיבוץ לפי מקום
- **הירו של הלנדינג במובייל:** לוקאפ מלא **בולט** בראש (גובה ~56–64px), ממורכז, מעל/סמוך לחיפוש — שהמותג יורגש בכניסה. בדסקטופ גם בהירו/נאב.
- **סרגל עליון מובייל (LandingNav + TopBar המחובר):** **אייקון קומפקטי** (גובה ~28–32px) במקום הגלובוס הזעיר הנוכחי; לחיצה → דף הבית/דשבורד. לא לדחוס לוקאפ מלא לסרגל הצר.
- **דסקטופ header:** לוקאפ מלא בגובה ~36–40px.
- **כרטיסי login/register/verify + entity-picker:** לוקאפ מלא ממורכז מעל הכרטיס (כבר יש שם גלובוס זעיר — להחליף).
- **Footer:** לוקאפ (בדוק tone לפי רקע ה-footer).

### 3. Tone לפי רקע (קריטי — הלוגו הכהה נעלם על כהה)
כל משטח **כהה** (באנר ה-CTA הכהה "הכל במקום אחד…", רצועת ה-drawer הכהה, כל footer/hero כהה) → `tone="dark"` (הגרסה הלבנה). משטח בהיר → `tone="light"`. עבור על המקומות ותקן.

### 4. favicon / apple-touch / PWA (Next metadata)
ב-`app/layout.tsx` (`metadata`/`icons`) או `app/icon` convention:
- favicon: 16/32/48 · apple-touch-icon 180 · manifest עם icon-192 + icon-512.
- ודא `<title>`/`apple-mobile-web-app-title` = "TagidAI".
- הסר הפניות ל-favicon ישן אם קיים.

### 5. ניקוי מותג ישן
grep על `BuildUp` בכל ה-frontend — אם נשאר טקסט/נכס של המותג הישן, החלף/הסר. (הקובץ `docs/Logo/IconOnly_Transparent.png` הוא BuildUp ישן — לא להשתמש בו.)

---

## Acceptance
- [ ] הירו הלנדינג במובייל: לוקאפ TagidAI בולט בראש (לא גלובוס זעיר).
- [ ] סרגל עליון מובייל: אייקון קומפקטי קריא ב-~30px.
- [ ] דסקטופ header + כרטיסי auth + footer: לוקאפ תקין.
- [ ] על כל רקע כהה מוצגת הגרסה הלבנה (הלוגו לא נעלם).
- [ ] favicon/apple-touch/PWA מחוברים; טאב הדפדפן מציג את האייקון; "הוסף למסך הבית" מציג את TagidAI.
- [ ] `alt="TagidAI"` בכל מופע; בלי CLS; אין שאריות "BuildUp".
- [ ] תקין ב-390px + דסקטופ.

## Guardrails
`git tag pre-logo-wiring`; שימוש בנכסים הקיימים ב-`/brand` (לא לייצר/לצייר לוגו); `next/image` עם ממדים; קומפוננטת `BrandLogo` אחת כמקור אמת; DS tokens; production (main) לא נגעת — staging עד אישור מפורש. דווח: קבצים ששונו + היכן כל variant/tone שובץ.
