# TagidAI — אינדקס פרומטי CC

> **עודכן:** 2026-08-13 (סבב סנכרון Cowork)
> **⚠️ נקודת הכניסה היחידה היא `cc_master_backlog.md`.** הקבצים כאן הם פרומטים נקודתיים שהוא מפעיל לפי סדר. אל תריץ מהם ישירות בלי לקרוא אותו קודם.

---

## איך מריצים

```
קרא את docs/cc-prompts/cc_master_backlog.md.
בצע לפי הסדר, פריט אחד בכל פעם. עצור אחרי כל פריט ודווח.
```

**כלל קבוע:** `git tag pre-<item>` לפני · טסטים אחרי כל צעד · DoD = root-cause + before/after (דסקטופ+מובייל) + SHA שנפרס · Mobile-first RTL (390 + דסקטופ) · DS tokens · כתום קנוני **brand-600 `#f78203` + טקסט כהה** · **staging בלבד — production (main) רק באישור מפורש של Yulian.**

**⚠️ ענף:** ה-HEAD בפועל הוא `pivot/v2`, לא `staging`. `CLAUDE.md` עדיין אומר `staging` — זה פריט B1 ב-backlog, בצע אותו ראשון.

---

## 🗺️ מפות-על

| קובץ | מה בפנים |
|---|---|
| **`cc_master_backlog.md`** ⭐ | **קובץ ההרצה.** חוסמי-השקה, היגיינת רפו, טראקים, סדר, וחסמים שאינם קוד. |
| `claude/tagidai_roadmap_tracks.md` (Project) | מפת המסלולים + החלטות נעולות. |
| `claude/tagidai_design_system.md` (Project) | ה-DS הקנוני. גובר על כל ערך צבע בפרומט ישן. |
| `claude/cc_prompts_P0_wave1.md` / `_P1_wave2.md` (Project) | גלי הפרומטים הקודמים. **L1 מכיל ערך צבע מיושן — ראה B8.** |

---

## ▶️ מוכן להרצה (לפי סדר ה-backlog)

| קובץ | מה | סטטוס |
|---|---|---|
| `cc_prompt_empty_states.md` | קבלן טרי מקבל שגיאה אדומה במקום empty-state (4 מסכים) | מוכן · מתלכד עם QA-5 ו-Tenders-T1 |
| `cc_prompt_commission_leak.md` | שריד "עמלה" בדיאלוג אישור-ארגון (פספוס D3) | מוכן · קטן |
| `cc_prompt_tenders_T1_audit.md` | Tenders T1: אודיט end-to-end + הקשחה | מוכן · התשתית קיימת בקוד |
| `cc_prompt_reveal_paywall.md` | "הצג פרטי תאגיד" → reveal מגודר-מנוי | **נשלח, טרם אומת** — חסום ע"י harness דו-ישותי |

---

## ✅ בוצע ואומת חי

gateway deploy · `/api/ads` public 200 + 6 מודעות · חיפוש "רתך" (POST חי) · seed staging · entity-switch ללא re-auth · cleanup round · landing mobile IA · M3.1 card-view (קבלן) · logo wiring · favicon (QA-6) · אישורים+SMS · SF-1 (רתך→scaffolding) · QA-1 · **Track V — voice search** (`b1087e6`).

## 🕐 פתוח / נדחה

QA-2 · QA-3 · QA-4 · QA-5 (מתלכד עם empty-states) · QA-7 רישיון OCR · harness דו-ישותי · L2/L3 הקשחת חיפוש · Ads track A1–A4 (חסום: החלטת סלוט) · Tenders T2–T5 (חסום: החלטת שער-זוכה) · Track W WhatsApp (חסום: Publish ל-Meta app) · טקסונומיית מקצועות · STT→ivrit.ai (עתידי) · seed ל-50.

## 🗑️ הפניות מתות שנוקו

`cc_master_workplan.md` · `cc_prompt_search_quality_V1.md` · `cc_prompt_whatsapp_vonage.md` · `claude/HANDOFF_COWORK.md` — **אף אחד מהם לא קיים.** התוכן שלהם נכתב מחדש לתוך `cc_master_backlog.md` (§A לחיפוש, §C6 ל-WhatsApp).

---

## 📁 שאר הקבצים בתיקייה (היסטוריה — בוצעו)

`cc_prompt_M1_mobile_landing.md` · `cc_prompt_M1fix_mobile_round2.md` · `cc_prompt_M2_mobile_forms.md` · `cc_prompt_M3_mobile_tables_dashboards.md` · `cc_prompt_M3_1_tables_cardview.md` · `cc_prompt_landing_mobile_ia.md` · `cc_prompt_logo_wiring.md` · `cc_prompt_cleanup_round.md` · `cc_prompt_entity_switch_no_reauth.md` · `cc_prompt_seed_staging.md` · `cc_prompt_seed_fixes.md` · `cc_prompt_public_ads_empty.md` · `cc_prompt_qa_realdata_round.md` · `cc_prompt_fix_export_harness_v2.md` · `cc_prompt_voice_search.md`
