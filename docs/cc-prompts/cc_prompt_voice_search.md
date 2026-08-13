# CC prompt — Track V: חיפוש קולי (ElevenLabs Scribe → החיפוש הקיים)

## מטרה
הקבלן יכול **לדבר במקום להקליד** לחיפוש — גם באתר בנייה, ידיים תפוסות. הקול → תמלול → **שדה החיפוש הקיים** (`POST /api/search`). לא לגעת בלוגיקת החיפוש — רק להזין אותה בקול.

## ⭐ STANDING RULE
Mobile-first RTL, 390px + דסקטופ. `git tag pre-voice-search` לפני. יעדי מגע ≥44px. DoD + before/after.

## החלטות נעולות
- STT = **ElevenLabs Scribe** (חשבון קיים).
- **מפתח:** קרא מ-env `ELEVENLABS_API_KEY`. ה-placeholder `ELEVENLABS_API_KEY=-` כבר קיים בקובץ ה-env/ini. הערך האמיתי → **Railway staging secrets**, **לא ב-commit**. ודא שקובץ ה-env **gitignored** ושאין מפתח אמיתי ב-git. **המפתח בצד-שרת בלבד — אסור בלקוח.**
- רוכב על `POST /api/search` הקיים — בלי שינוי בלוגיקת ה-parse/re-rank.

## Do

### V1 — Backend proxy ל-Scribe
- endpoint חדש `POST /api/voice/transcribe`: מקבל audio (webm/mp3/m4a), קורא ל-ElevenLabs Scribe עם `process.env.ELEVENLABS_API_KEY`, מחזיר `{ transcript, lang }`.
- timeout + טיפול שגיאות בעברית (mapApiError). לוג בלי המפתח.
- **שפה:** עברית. אם Scribe תומך ב-keyterms/vocabulary bias — העבר את ה-enums (מקצועות/אזורים/מדינות מוצא) כרמז. (אם לא נתמך — דלג; ה-LLM של החיפוש מתקן ז'רגון ממילא.)

### V2 — Frontend: כפתור מיקרופון בשדה החיפוש
- כפתור מיקרופון בתוך/ליד שדה החיפוש (≥44px), **tap-להתחלה / tap-לעצירה** עם אינדיקציית הקלטה ברורה (גל/נקודה אדומה) + auto-stop אחרי שקט קצר.
- הקלטה עם `MediaRecorder` → העלאה ל-`/api/voice/transcribe`.
- **התמלול מוצג בשדה החיפוש לאישור/עריכה** — **לא** חיפוש אוטומטי מיידי (עברית + מקצועות = טעויות STT; המשתמש מאשר/מתקן ואז מחפש). כפתור "חפש" בולט אחרי התמלול.
- **הרשאות:** בקשת הרשאת מיקרופון; דחייה → הודעה ברורה בעברית ("אין גישה למיקרופון — אפשר בהגדרות").

### V3 — נגישות/מובייל
- הכפתור מתויג (`aria-label="חיפוש קולי"`); מצב הקלטה מוכרז (aria-live); RTL; עובד ב-Chrome/Safari מובייל.

## Acceptance
- [ ] כפתור מיקרופון בחיפוש; הקלטה → תמלול עברי מוצג לאישור/עריכה → חיפוש רץ ומחזיר תוצאות.
- [ ] המפתח נקרא מ-`ELEVENLABS_API_KEY` בצד-שרת, אף פעם לא בלקוח; אין מפתח אמיתי ב-git.
- [ ] דחיית הרשאת מיקרופון → הודעה עברית ברורה, בלי קריסה.
- [ ] תקין 390px + דסקטופ; יעדי מגע ≥44px; a11y (label + aria-live).
- [ ] בדיקה: "צריך ארבעה רתכים במרכז" → תמלול סביר → חיפוש מחזיר תוצאות רתכים.

## Guardrails
`git tag pre-voice-search`; **לא לגעת בלוגיקת `/api/search`** (רק להזין אותה); מפתח Scribe מ-env בצד-שרת בלבד (לא ב-git/לקוח); DS tokens; production (main) לא נגעת. דווח: ה-endpoint שנוסף, שהמפתח מ-env ולא נכתב ל-git, ותוצאת בדיקת התמלול→חיפוש.
