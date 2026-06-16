# WhatsApp templates for Meta approval (via Vonage)

This document is the **source-of-truth wording sheet** for the WhatsApp message templates we need to register with Meta through the Vonage dashboard. Each template here corresponds to a current SMS body in `services/notification/src/consumers/handlers.js` (or the auth-side OTP body in `services/auth/src/routes/auth.js`).

## How to use this file

For each template below:

1. Copy the **template name** (snake_case, latin) — that's the name we'll set on `notification_templates.whatsapp_template_name` and on `WHATSAPP_OTP_TEMPLATE_NAME` env var.
2. Copy the **body** into the Vonage dashboard → Application → Messages → WhatsApp Templates.
3. Pick the **category** (Meta requires one of: AUTHENTICATION / UTILITY / MARKETING).
4. The **parameters** are positional — Meta uses `{{1}}`, `{{2}}` etc. The order matches the list in this doc.
5. **Language**: Hebrew (`he`).
6. Submit → wait ~24h for Meta approval.

Until a template is approved, the code falls back to SMS automatically. Approval is **opt-in per template** — you can roll out one at a time.

---

## P2 — OTP (authentication)

This is the **only template required for P2**. Once approved, opted-in users start receiving OTPs via WhatsApp instead of SMS.

### `tagidai_otp_he`

- **Category**: AUTHENTICATION
- **Language**: he (Hebrew)
- **Body**:
  ```
  קוד האימות שלך לכניסה לפורטל TagidAI הוא: {{1}}
  בתוקף 10 דקות. אל תשתף קוד זה.
  ```
- **Parameters**: `{{1}}` = 6-digit OTP code
- **Meta notes**: AUTHENTICATION templates are simpler to approve and have no copy restrictions beyond "must contain the code". Meta will also require a "Copy code" button on the template — Vonage's dashboard exposes this as a button type.

---

## P3 — Deal / event notifications (utility + marketing)

These are the SMS bodies currently in `handlers.js`. Each becomes one template. Categories are my best read of Meta's rules; verify on submission.

### 1. `tagidai_match_found_he`  — match notification to contractor

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — נמצאה התאמה מלאה לחיפוש "{{1}}" ({{2}} עובדים). לצפייה: {{3}}
  ```
- **Parameters**: `{{1}}` profession, `{{2}}` worker_count, `{{3}}` URL

### 2. `tagidai_corp_demand_he`  — corp gets a new contractor request

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — יש דרישה חדשה ממתינה לעובדי {{1}}. אנא פתח את לוח העסקאות: {{2}}
  ```
- **Parameters**: `{{1}}` profession_he, `{{2}}` URL

### 3. `tagidai_rematch_offer_he`  — additional corp can fill a contractor's request

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, תאגיד נוסף יכול לתת מענה לדרישה שלך ל-{{2}}. היכנס לבדוק: {{3}}
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` profession_he, `{{3}}` URL

### 4. `tagidai_account_approved_contractor_he`  — contractor approval

- **Category**: UTILITY
- **Body**:
  ```
  {{1}}, החשבון שלך בפורטל TagidAI אושר ✓
  לאיתור עובדים: {{2}}
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` URL

### 5. `tagidai_account_approved_corp_he`  — corp approval (text variant)

- **Category**: UTILITY
- **Body**:
  ```
  {{1}}, החשבון שלך בפורטל TagidAI אושר ✓
  כניסה לחשבון: {{2}}
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` URL

### 6. `tagidai_corp_committed_he`  — corp offered workers

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, תאגיד הציע {{2}} עובדי {{3}} לבקשתך. בדוק ואשר תוך 48 שעות: {{4}}
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` worker_count, `{{3}}` profession_he, `{{4}}` URL

### 7. `tagidai_contractor_approved_he`  — contractor approved the list

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, אישרת רשימה של {{2}} עובדים. בעוד 48 שעות יבוצע החיוב ויישלחו פרטי הקשר של התאגיד.
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` worker_count

### 8. `tagidai_corp_cancelled_he`  — corp cancelled before capture

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, {{2}} ביטל את העסקה לפני החיוב. לא חויבת. החיפוש חזר לפעיל.
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` corp_name

### 9. `tagidai_deal_message_he`  — in-deal chat message

- **Category**: UTILITY
- **Body**:
  ```
  הודעה חדשה מ{{1}} בעסקה. צפייה: {{2}}
  ```
- **Parameters**: `{{1}}` sender_label (הקבלן / התאגיד), `{{2}}` URL

### 10. `tagidai_team_invite_he`  — team member invite

- **Category**: UTILITY
- **Body**:
  ```
  שלום! {{1}} מזמין אותך להצטרף לצוות "{{2}}" בפורטל TagidAI בתפקיד {{3}}.
  להתחברות והצטרפות לפלטפורמה: {{4}}
  ```
- **Parameters**: `{{1}}` inviter_name, `{{2}}` entity_name, `{{3}}` role_label, `{{4}}` URL

### 11. `tagidai_membership_request_he`  — request to join a team

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, {{2}} ({{3}}) מבקש להצטרף לצוות {{4}} "{{5}}".
  לאישור או דחייה: {{6}}
  ```
- **Parameters**: `{{1}}` owner_name, `{{2}}` requester_name, `{{3}}` requester_phone, `{{4}}` entity_kind, `{{5}}` entity_name, `{{6}}` URL

### 12. `tagidai_membership_approved_he`

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, בקשתך להצטרף לצוות {{2}} אושרה. תוכל להיכנס למערכת עם מספר הטלפון שלך.
  כניסה: {{3}}
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` entity_kind, `{{3}}` URL

### 13. `tagidai_membership_rejected_he`

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, בקשתך להצטרף לצוות {{2}} נדחתה על ידי הבעלים.
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` entity_kind

### 14. `tagidai_corp_ownership_verify_he`  — corp ownership 6-digit OTP

- **Category**: AUTHENTICATION
- **Body**:
  ```
  TagidAI — קוד אימות בעלות לעסק שלך: {{1}}
  בתוקף 10 דקות. אל תשתף קוד זה.
  ```
- **Parameters**: `{{1}}` 6-digit code

### 15. `tagidai_kablan_revoked_he`  — registry status change

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, הרישום של {{2}} כבר לא מופיע בפנקס הקבלנים. אנא בדוק את הפרטים והעלה רישיון מעודכן.
  ```
- **Parameters**: `{{1}}` first_name, `{{2}}` company_name

### 16. `tagidai_kablan_verified_he`  — auto-verification success

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — {{1}}, החשבון שלך אומת בהצלחה ✓ אתה יכול עכשיו להגיש בקשות לתאגידים.
  ```
- **Parameters**: `{{1}}` first_name

### 17. `tagidai_no_match_corp_he`  — corp gets notified about an unfilled search

- **Category**: MARKETING (this is closer to a lead/opportunity nudge)
- **Body**:
  ```
  TagidAI — קבלן מחפש {{1}} עובדי {{2}} {{3}}{{4}}, ולא נמצאו התאמות פעילות.
  אם תוכל לתת מענה, היכנס למערכת.
  ```
- **Parameters**: `{{1}}` qty, `{{2}}` profession_he, `{{3}}` recruitment, `{{4}}` region

### 18. `tagidai_tender_published_he`  — new import tender broadcast

- **Category**: MARKETING
- **Body**:
  ```
  TagidAI — מכרז ייבוא חדש: קבלן מבקש {{1}} עובדים מחו״ל ({{2}}). לפרטים והגשת הצעה: {{3}}
  ```
- **Parameters**: `{{1}}` qty, `{{2}}` profession_he, `{{3}}` URL

### 19. `tagidai_tender_bid_received_he`  — tender bid received

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — התקבלה הצעה חדשה למכרז הייבוא שלך. היכנס לבדוק ולבחור: {{1}}
  ```
- **Parameters**: `{{1}}` URL

### 20. `tagidai_tender_approved_he` — tender admin approval revealed

- **Category**: UTILITY
- **Body**:
  ```
  TagidAI — מכרז הייבוא אושר ע״י מנהל המערכת. פרטי התאגיד הזוכה נחשפו: {{1}}
  ```
- **Parameters**: `{{1}}` URL

---

## Submission order suggestion

1. **`tagidai_otp_he`** first — unlocks P2.
2. **`tagidai_corp_committed_he`** + **`tagidai_contractor_approved_he`** — the two most-sent deal-flow messages; biggest user impact.
3. The rest in any order.

## Numbers per template

Meta has caps on how many messages a single template can send per 24h, based on your business verification tier. Vonage's dashboard surfaces the limits. The OTP template will be the hottest — pre-warm the tier before launch.

## When templates change

If the wording above needs revisions (typos, brand line adjustments, etc.), edit this file first, get the new wording approved with Meta, then update `WHATSAPP_OTP_TEMPLATE_NAME` env var (for the OTP) or the `notification_templates.whatsapp_template_name` row (for others) to point at the new template name. Old templates can stay in Meta — Meta versions templates by name, not content.
