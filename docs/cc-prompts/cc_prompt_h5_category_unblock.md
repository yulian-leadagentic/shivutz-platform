# CC prompt — H5: לשחרר את הקטגוריות שחסומות ב-UI

## 🔴 קרא קודם — ממצא ארכיטקטוני שמשנה את M2

**מערכת הקטגוריות והמנויים כבר קיימת, מלאה, ועובדת.** אימתתי בקוד:

| רכיב | מה יש | איפה |
|---|---|---|
| `marketplace_categories` | `code · name_he/en/ar · icon_slug · sort_order · is_active` | `021` |
| `marketplace_subscription_tiers` | `category_code · name_he/en · **price_nis** · slot_count · duration_days · is_active` | `021` |
| **אדמין — CRUD מלא** | `listCategories · createCategory · updateCategory · listTiers · createTier · updateTier` | `lib/api/marketplaceAdmin.ts:70` |
| **מסך אדמין** | בחירת קטגוריה → ניהול מסלולי מנוי, עם דיאלוג אישור למחיקה | `app/admin/marketplace/page.tsx` |
| **מסך רכישה לתאגיד** | קטגוריות → מסלולים → מחיר → רכישה + חידוש אוטומטי | `app/corporation/marketplace/subscribe/page.tsx` |

> ### 🔴 המשמעות ל-`cc_prompt_m2_service_tables.md`
> **M2 מציע ליצור `service_categories` ו-`provider_categories` — שמשכפלים את `marketplace_categories` ו-`marketplace_subscription_tiers`.**
> **אל תריץ את M2 כמו שהוא.** נדרשת הכרעה: להרחיב את הקיים או לבנות במקביל. **בנייה במקביל תיצור שתי מערכות קטגוריות בפרויקט אחד** — ומישהו יבחר את הלא-נכונה.
>
> **הפרומט הזה לא מכריע את זה. הוא רק פותח את החסימה.** ההכרעה תגיע אחריו.

## ⭐ STANDING RULE
`git tag pre-h5` לפני. **`staging`.** אין `git add -A`.
**זה שינוי קטן. אל תרחיב אותו.**

---

# §1 · החסימה — קבוע קשיח אחד

`services/frontend/src/app/corporation/marketplace/new/page.tsx:12`

```js
const CATEGORIES = [
  { value: 'housing',   label: 'דיור' },
  { value: 'equipment', label: 'ציוד' },
  { value: 'services',  label: 'שירותים' },
  { value: 'other',     label: 'אחר' },
];
```

**זו החסימה.** האדמין יוצר קטגוריה חמישית ב-`marketplace_categories` — **טופס יצירת המודעה של התאגיד לעולם לא יציג אותה.** ה-CRUD באדמין עובד, והתוצר שלו לא מגיע לשום מקום.

## Do

**החלף את הקבוע בטעינה מה-API** — אותו מקור שהאדמין כותב אליו.

- `listCategories()` בטעינת העמוד, מסונן ל-`is_active`, ממוין לפי `sort_order`
- התווית מ-`name_he`
- **בזמן טעינה — skeleton, לא רשימה ריקה.** רשימה ריקה נראית כמו באג
- **אם הקריאה נכשלת — ליפול לקבוע הקיים**, לא לרשימה ריקה. **אל תמחק את הקבוע**, השאר אותו כ-fallback עם הערה

## §1b · סרוק אחרים

```bash
grep -rn "'housing'\|'equipment'\|'services'\|'other'" services/frontend/src --include=*.tsx --include=*.ts
```

**דווח כל מקום נוסף שבו רשימת הקטגוריות קשיחה** — סינונים, תוויות, אייקונים, ה-marketplace הציבורי. **תקן רק את מה שחוסם יצירה או תצוגה של קטגוריה חדשה. דווח את השאר, אל תיגע.**

---

# §2 · מחיר לקטגוריה — לאמת שזה באמת עובד מקצה לקצה

**Yulian ביקש שאדמין יוכל לקבוע מחיר מנוי לכל קטגוריה. לפי הקוד — זה קיים.** תפקידך לאמת, לא לבנות.

**הרץ בסטייג'ינג ודווח, עם צילומים:**

1. `/admin/marketplace` — **צור קטגוריה חדשה** (למשל `transport` · `הסעות`)
2. **הוסף לה מסלול מנוי** עם מחיר, מספר סלוטים ומשך
3. `/corporation/marketplace/subscribe` — **האם הקטגוריה והמחיר מופיעים לתאגיד?**
4. `/corporation/marketplace/new` — **האם הקטגוריה מופיעה בטופס?** (לפני §1 — לא. אחרי — כן)
5. **האם אפשר לרכוש?** ⚠️ **אל תשלים רכישה אמיתית** — עצור לפני החיוב ודווח מה קורה. `PAYMENT_FAKE_MODE` לא אומת בסטייג'ינג

**אם משהו בשרשרת שבור — דווח איפה. אל תתקן בלי אישור**, זה נוגע בחיוב.

---

# Acceptance

- [ ] קטגוריה שנוצרה באדמין **מופיעה בטופס יצירת המודעה** בלי פריסה
- [ ] כשל ב-API → **נפילה לקבוע**, לא רשימה ריקה
- [ ] הקבוע **עדיין בקוד** כ-fallback, עם הערה
- [ ] רשימת כל שאר המקומות הקשיחים — **דווחה, לא תוקנה**
- [ ] §2 — חמשת השלבים, עם צילומים
- [ ] רגרסיה: יצירת מודעת marketplace קיימת עובדת · מסך הרכישה נטען
- [ ] `npm run build` עובר

## דווח
1. הדיף של `new/page.tsx`
2. פלט ה-grep מ-§1b
3. **צילומי §2** — אדמין יוצר קטגוריה ומסלול, ותאגיד רואה אותם
4. איפה השרשרת נשברת, אם בכלל
5. **המלצתך:** להרחיב את `marketplace_categories` למסלול ספקי השירות, או לבנות טבלאות נפרדות? **המלצה בלבד — ההכרעה של Yulian**
6. `git diff -w --stat`

## Guardrails
`git tag pre-h5`. **אל תיצור טבלאות חדשות.** **אל תריץ את M2.**
**אל תיגע** בחיוב/Cardcom · `marketplace_subscription_tiers` schema · `query_rewriter.py` · reveal/מנוי.
**אל תשלים רכישה אמיתית בסטייג'ינג.**
