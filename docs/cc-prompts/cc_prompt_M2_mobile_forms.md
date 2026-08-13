# CC prompt — Wave M2: טפסים ו-onboarding (מובייל 390px) — ממוקד, עצמאי

## הקשר קצר
טפסי ה-onboarding (login / register / verify-OTP) עושים reflow תקין במובייל, אבל שני כשלים חוזרים (מהצילום `screens-export/mobile/register__contractor.png`):
- **מרווח ריק אנכי ענק בראש** — הכרטיס ממורכז אנכית, אז בטלפונים גבוהים חצי מהמסך ריק והטופס "צף" למטה.
- tap targets ו-input semantics לא אופטימליים למובייל (מקלדת לא נכונה, אין autocomplete לקוד OTP, top-bar צפוף).

**המשימה כאן: להפוך את כל טפסי ה-onboarding לנוחים ב-390px.** לא לגעת בלוגיקת OTP/auth — רק layout, input attributes, ו-tap targets.

---

## ⭐ STANDING RULE
Mobile-first RTL. כל קריטריון קבלה חייב לעבור ב-**390px וגם דסקטופ**. יעדי מגע ≥44px. אימות מול `screens-export/mobile/` + `screens-export/desktop/` (login / register__contractor / register__corporation / verify). `git tag pre-m2-mobile-forms` לפני העבודה. דווח before/after לשני ה-viewports.

---

## M2.1 — יישור עליון של כרטיסי הטפסים
- להחליף מרכוז אנכי (`items-center` / `min-h-screen justify-center`) ב-**יישור לראש** במובייל: הכרטיס מתחיל למעלה עם padding-top סביר (24–32px), לא צף באמצע.
- בדסקטופ אפשר להשאיר מרכוז — אבל במובייל (390px) הטופס חייב להתחיל למעלה כדי שיהיה נגיש לאגודל בלי גלילה מיותרת.
- חל על: `login`, `register/contractor`, `register/corporation`, מסך verify-OTP.

## M2.2 — Input semantics ו-tap targets
- שדות מספר (טלפון, ח.פ, קוד OTP): `inputmode="numeric"` + `type="tel"` (טלפון) → מקלדת מספרים נפתחת ישר.
- שדה ה-OTP: `autocomplete="one-time-code"` (כדי ש-iOS/Android יציעו את הקוד מה-SMS אוטומטית) + `aria-live` להודעת שגיאה.
- שדה הטלפון: `autocomplete="tel"`.
- כל שדה קלט ≥44px גובה; כל כפתור/צ'קבוקס (כולל opt-in ל-WhatsApp ו-T&C) — יעד מגע ≥44px.
- מספרים/קודים ב-`dir="ltr"` בתוך שדה RTL.

## M2.3 — Top-bar במובייל (onboarding)
- ה-top-bar במסכי onboarding צפוף במובייל (org-switcher + פעמון + back + hamburger נדחסים). לפשט: במסכי login/register להסתיר את מה שלא רלוונטי לפני התחברות (org-switcher/פעמון), להשאיר רק לוגו + back אם צריך.
- אם ה-top-bar משותף גלובלית — להשתמש ב-conditional לפי route (onboarding vs authed), לא לשכפל קומפוננטה.

---

## Primary button (G1 — נעול)
כל כפתור Primary/CTA בטפסים ("שלח קוד" / "אמת" / "הצטרף") = **כתום חי `#F5821F` + טקסט כהה `#111827`** (AA ~6:1); hover = `#a5530b`. disabled = מובחן (מעומעם). token-driven — בלי hex per-page. (זה גם מאחד את "שלח קוד" שכבר כתום עם "הצטרף" שהיה חום.)

---

## Acceptance (סיכום — חייב לעבור בשני ה-viewports)
- [ ] מובייל: כל טופס onboarding מתחיל בראש המסך (padding-top סביר), בלי חצי מסך ריק מעליו.
- [ ] מקלדת מספרים נפתחת לשדות טלפון/ח.פ/OTP; OTP מציע autocomplete מה-SMS.
- [ ] כל שדה/כפתור/צ'קבוקס ≥44px יעד מגע.
- [ ] מספרים/קודים מיושרים LTR בתוך RTL.
- [ ] top-bar ב-onboarding מפושט במובייל (בלי אלמנטים לא-רלוונטיים לפני login).
- [ ] כפתורי Primary = כתום חי #F5821F + טקסט כהה; disabled מובחן.
- [ ] דסקטופ לא נסוג.

## Guardrails
`git tag pre-m2-mobile-forms`; layout / input-attributes / tap-targets בלבד — **לא לגעת בלוגיקת OTP/auth/crypto** ולא ב-routing; DS tokens (בלי hex ישיר); אם ה-export עדיין מראה עיצוב ישן — לוודא ש-staging סיים deploy ולצלם מחדש לפני שקובעים "לא תוקן".
