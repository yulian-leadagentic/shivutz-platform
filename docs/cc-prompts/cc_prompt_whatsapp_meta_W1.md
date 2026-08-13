# CC prompt — Track W1: WhatsApp inbound על Meta Cloud API

> **מחליף את `cc_prompt_whatsapp_vonage.md`** (שמעולם לא נכתב). ההחלטה הנעולה היום: **Meta Cloud API**. Vonage בוטל ל-WhatsApp.
> **תלוי ב-Y1:** ה-Meta app חייב להיות **Published** לפני שאפשר לדבג webhooks אמיתיים.

## ⭐ STANDING RULE
`git tag pre-w1` לפני. **staging בלבד.** DoD = root-cause + הלוגים של webhook נכנס אמיתי + ה-SHA שנפרס. עברית RTL בכל copy למשתמש.

---

## המצב היום (אמת מאומתת בקוד — אל תבזבז זמן על גילוי מחדש)

| שלב | מצב |
|---|---|
| אתה → WhatsApp → Meta | ✅ עובד |
| השרת → Meta → הטלפון | ✅ עובד (נמסר) |
| **Meta → השרת** | ❌ **אין webhook** — אין route, אין אימות חתימה, אין GET challenge |
| **השרת מבין ומחליט** | ❌ **אין קוד** |

**מה כן קיים ואסור לבנות מחדש:**

- **`db/migrations/052_whatsapp_foundation.sql` — הסכימה נייטרלית לספק ועובדת כמו שהיא עם Meta.** `whatsapp_message_log` (outbound), `support_messages` (inbound+outbound, keyed by `peer_phone`), `notification_templates.whatsapp_template_name`, `users.whatsapp_opt_in`. **אל תכתוב מיגרציה חדשה לטבלאות האלה.** רק ההערות בקובץ מזכירות Vonage.
- **`services/notification/src/messaging/index.js` — dispatcher כבר ערוץ-מודע.** `sendMessage(phone, body, { channel: 'whatsapp' })` כבר קיים, כולל כתיבה ל-`whatsapp_message_log` ו-fallback ל-SMS. **רק שתי שורות משתנות:** ה-`require('./vonageWhatsapp')` וה-`HAS_WHATSAPP()`.
- **`services/gateway/src/index.js`** — `'/api/webhooks'` כבר עושה proxy ל-notification service (שורה ~137), ו-`'/api/webhooks/vonage'` כבר ב-`PUBLIC_PREFIXES` (שורה ~161). יש לך תבנית להעתיק.
- **מנוע החיפוש** — `POST /search` ב-user-org. אל תיגע בו. W1 הוא **ערוץ-קלט**, לא מנוע.

---

## החלטות מוצר — נעולות (Yulian, 13/08/26)

1. **היקף V1 = חיפוש בלבד + לינק.** הודעה נכנסת → מנוע החיפוש → **תשובה אחת** עם 3–5 תוצאות אנונימיות + לינק לאתר. **ה-reveal והתשלום קורים באתר, לא בצ'אט.**
2. **מספר לא-רשום מחפש כרגיל** ומקבל הזמנה להירשם בלינק. אותה התנהגות כמו החיפוש הציבורי באתר.
3. **ה-webhook יושב ב-gateway** (`/api/webhooks/whatsapp`) ועושה proxy ל-notification, בעקביות עם שאר הארכיטקטורה.

### 🎯 התוצאה החשובה של החלטה #1 — קרא אותה
המשתמש **תמיד יוזם**. לכן כל תשובה נופלת בתוך **חלון 24 השעות**, ולכן היא **free-text**. כלומר: **V1 לא צריך אף template מאושר של Meta.** ה-lead-time של אישור templates **אינו חוסם** את W1. templates נדרשים רק ליזום מהשרת (התראות), וזה W2.

### ⏰ אילוץ 1 באוקטובר
מאותו תאריך כל שיחה עולה כסף. לכן: **הודעה יוצאת אחת לכל הודעה נכנסת.** לא שתיים, לא "רגע, מחפש…" ואז התוצאות. הרכב מחרוזת אחת ושלח פעם אחת.

---

## Do

### 1. שכבת השליחה — החלף Vonage ב-Meta

צור `services/notification/src/messaging/metaWhatsapp.js` עם אותו חוזה בדיוק כמו `vonageWhatsapp.js`: `send(phone, message, opts) → { messageId }`.

- Endpoint: `POST https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages`
- Auth: `Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}` (System User token קבוע — לא token זמני של משתמש)
- Free-text: `{ messaging_product: "whatsapp", to, type: "text", text: { body } }`
- Template (ל-W2, ממש את השלד): `type: "template", template: { name, language: { code: "he" }, components: [...] }`
- הצלחה: 200 עם `{ messages: [{ id: "wamid.XXX" }] }` → `messageId = wamid`
- **`to` בפורמט E.164 בלי `+`** (`972525278625`)

עדכן `messaging/index.js`: `require('./metaWhatsapp')`, ו-`HAS_WHATSAPP()` בודק `WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID`. שנה את מחרוזת ה-`provider` מ-`'vonage-whatsapp'` ל-`'meta-cloud'`.

**מחק את `vonageWhatsapp.js`.** אין משתמשים חיים, אין תאימות לאחור (house style). **⚠️ אל תיגע ב-`services/notification/src/sms/vonage.js` — ה-SMS נשאר על Vonage.** אלה שני מוצרים נפרדים.

### 2. ה-webhook — GET verify + POST receive

**Gateway** (`services/gateway/src/index.js`): הוסף `'/api/webhooks/whatsapp'` ל-`PUBLIC_PREFIXES` עם הערה שהוא מאובטח ב-`X-Hub-Signature-256`, לא ב-JWT משתמש.

**⚠️ הגוף הגולמי (raw body) הוא הדבר שהכי קל לשבור כאן.** חתימת HMAC מחושבת על ה-**bytes בדיוק כפי שנשלחו**. אם `express.json()` פירסר את הגוף לפני האימות — ה-JSON המסודר-מחדש ייתן חתימה שונה, והאימות ייכשל תמיד באופן שנראה כמו "Meta שולחת חתימה שגויה". **בדוק במפורש** שהנתיב הזה מקבל `express.raw({ type: 'application/json' })` **לפני** כל JSON parser, גם ב-gateway (ה-proxy) וגם ב-notification. דווח מה מצאת.

**Notification** — צור `services/notification/src/routes/whatsappWebhook.js`:

**`GET /webhooks/whatsapp`** — אימות חד-פעמי של Meta:
```
hub.mode === 'subscribe' && hub.verify_token === WHATSAPP_VERIFY_TOKEN
  → 200 עם hub.challenge כ-text/plain גולמי (לא JSON, בלי מרכאות)
  → אחרת 403
```

**`POST /webhooks/whatsapp`** — קבלה:
1. אמת `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(raw body, `WHATSAPP_APP_SECRET`). השווה ב-`crypto.timingSafeEqual`. חתימה שגויה → **401 והפסק**.
2. **ענה 200 מיד**, ורק אז עבד את ההודעה אסינכרונית. **Meta חוזרת ומנסה אם לא קיבלה 200 תוך ~5 שניות** — וחיפוש עם LLM לוקח יותר מזה. אם תעבד לפני התשובה, תקבל הודעות כפולות ותשלם פעמיים.
3. הבחן בין שני סוגי payload תחת `entry[0].changes[0].value`:
   - **`messages[]`** → הודעה נכנסת מהמשתמש
   - **`statuses[]`** → עדכון מסירה על משהו ש**אנחנו** שלחנו → עדכן `whatsapp_message_log` (`sent`/`delivered`/`read`/`failed`) לפי `statuses[0].id` מול `message_uuid`
4. **דדופ על `messages[0].id` (ה-wamid).** Meta מוסרת כפילויות. שמור ל-`support_messages` עם `direction='inbound'` ו-`message_uuid=wamid`; אם ה-wamid כבר קיים — **צא בשקט**.
5. סוגי הודעה שאינם טקסט (`image`/`document`/`location`/`audio`) → שמור ל-`support_messages` וענה תשובה קצרה אחת: "כרגע אני מבין רק הודעות טקסט. מה אתה מחפש?" **`audio` → אל תממש STT ב-W1** — זה W3, אחרי שהחיפוש הטקסטואלי מוכח.

### 3. מיגרציה 069 — UNIQUE לדדופ

`052` יצר `ix_support_uuid` ו-`ix_whatsapp_log_uuid` כאינדקסים **רגילים**. לדדופ אמין צריך אילוץ, לא נוחות-שאילתה:
- `support_messages.message_uuid` → **UNIQUE** (מאפשר `INSERT ... ON DUPLICATE KEY UPDATE` כשומר-סף אטומי)
- `whatsapp_message_log.message_uuid` → **UNIQUE**

שים לב לשורות קיימות עם `NULL` — ב-MySQL כמה `NULL` מותרים ב-UNIQUE, אז זה בטוח. **אמת שאין כפילויות לא-NULL לפני שאתה מוסיף את האילוץ.**

### 4. המוח — הודעה נכנסת → חיפוש → תשובה אחת

צור `services/notification/src/whatsapp/handleInbound.js`:

1. **נרמל את המספר.** Meta נותנת `from` בפורמט `972525278625` (בלי `+`). ה-DB מחזיק `+972525278625`. **זה מקור באגים קלאסי** — כתוב פונקציית נרמול אחת ובדוק אותה בשני הכיוונים.
2. **Rate-limit לכל מספר** ב-Redis: לכל היותר **10 חיפושים בשעה**, ו-**1 לכל 5 שניות**. מעבר לזה — תשובה קצרה אחת ("קיבלתי כמה הודעות, אני עונה על האחרונה") ועצור. אנחנו מרשים למספרים לא-רשומים לחפש, ולכן זה מה שמגן על החשבון מהצפה ומעלויות.
3. **זהה את השולח:** חפש ב-`users` לפי טלפון מנורמל. נמצא → זכור `user_id` ללוג. לא נמצא → המשך בכל מקרה (החלטת מוצר #2).
4. **קרא לחיפוש:** `POST ${USER_ORG_SERVICE_URL}/search` עם `{ query: <טקסט ההודעה> }`. **⚠️ אמת את הנתיב הפנימי המדויק** — ה-gateway ממפה `/api/search` ל-user-org וייתכן שהוא מסיר את הקידומת `/api`. הדפס את מה שמצאת. timeout 10s; כשל → תשובה אחת בעברית ("לא הצלחתי לחפש כרגע, נסה שוב עוד רגע") ו-log.
5. **הרכב תשובה אחת** (מחרוזת אחת, שליחה אחת):
   - 0 תוצאות → "לא מצאתי התאמות ל-<השאילתה>. נסה לנסח אחרת, למשל: *20 פועלים סינים במרכז*" + לינק
   - יש תוצאות → כותרת קצרה, **3–5** תוצאות מקסימום, כל אחת שורה או שתיים: מקצוע · מוצא · אזור · כמות. **בלי שום פרט קשר** — זה בדיוק אותו חוזה אנונימיות של `_serialize_ad`. לסיום: `${FRONTEND_URL}/?q=<encodeURIComponent(query)>` לצפייה מלאה וחשיפת פרטים.
   - **משתמש לא-רשום** → הוסף שורה אחת: "להצגת פרטי התאגיד צריך חשבון — ההרשמה לוקחת דקה: <לינק>"
   - שמור על ההודעה מתחת ל-**1024 תווים**. WhatsApp חותך הודעות ארוכות.
6. שלח דרך `sendMessage(phone, body, { channel: 'whatsapp' })` — ה-dispatcher הקיים — ושמור את היוצאת ל-`support_messages` עם `direction='outbound'` ו-`in_reply_to` = מזהה שורת הנכנסת.

### 5. משתני סביבה

הוסף ל-`.env.example` **ול-`docs/RAILWAY_SECRETS_CHECKLIST.md`** (שמות + ערכי-דמה בלבד, **בלי סודות אמיתיים**):
```
WHATSAPP_ACCESS_TOKEN      # System User token קבוע (לא token זמני)
WHATSAPP_PHONE_NUMBER_ID   # מזהה המספר, לא המספר עצמו
WHATSAPP_WABA_ID
WHATSAPP_APP_SECRET        # לאימות X-Hub-Signature-256
WHATSAPP_VERIFY_TOKEN      # מחרוזת שאנחנו בוחרים; חייבת להתאים למה שהוזן ב-Meta
WHATSAPP_API_VERSION       # למשל v21.0
```
**הסר** את `VONAGE_APPLICATION_ID` / `VONAGE_PRIVATE_KEY` / `VONAGE_WHATSAPP_NUMBER` אם הם מופיעים. `VONAGE_API_KEY`/`SECRET`/`FROM` **נשארים** — הם ה-SMS.

### 6. תיעוד
עדכן את `docs/whatsapp-templates.md`: Meta במקום Vonage, **וציין שב-V1 לא נדרש אף template** (כל התשובות בחלון 24ש'). עדכן את הערות ה-Vonage בראש `052_whatsapp_foundation.sql`.

---

## Acceptance

- [ ] **GET** `/api/webhooks/whatsapp` עם ה-verify token הנכון מחזיר את ה-challenge כטקסט גולמי; עם token שגוי → 403. **Meta מציגה את ה-webhook כמאומת בקונסולה.**
- [ ] **POST** עם חתימה תקינה → 200. עם חתימה מזויפת → 401, ואף הודעה לא נשמרת.
- [ ] הודעה אמיתית מהטלפון של Yulian → שורת `support_messages` `direction='inbound'`, ואז **הודעה אחת בדיוק** חוזרת ל-WhatsApp עם תוצאות חיפוש.
- [ ] `"20 פועלים סינים במרכז"` → תוצאות רלוונטיות **בלי שום פרט קשר** + לינק לאתר.
- [ ] שאילתה בלי התאמות → הודעת "לא מצאתי" עם הצעת ניסוח, לא שגיאה ולא שתיקה.
- [ ] מספר לא-רשום → מקבל תוצאות **וגם** את שורת ההרשמה.
- [ ] **Meta שולחת את אותו webhook פעמיים → נשמרת שורה אחת, נשלחת תשובה אחת.**
- [ ] 12 הודעות ברצף → ה-rate-limit נכנס, החשבון לא מוצף.
- [ ] `whatsapp_message_log` עובר `submitted → delivered` מ-callback ה-status האמיתי.
- [ ] `vonageWhatsapp.js` נמחק; **SMS דרך Vonage עדיין עובד** (הרץ OTP אמיתי כדי להוכיח).

## Guardrails

`git tag pre-w1`. **staging בלבד** — production רק באישור מפורש של Yulian.
**אל תיגע ב:** מנוע החיפוש (`query_rewriter.py` / `query_reranker.py` / `routes/search.py`) · לוגיקת reveal/מנוי/חיוב · `services/notification/src/sms/*`.
**אל תממש ב-W1:** STT להודעות קוליות (W3) · reveal בצ'אט (החלטת מוצר — נדחה) · templates ליזום (W2) · רשימות אינטראקטיביות (W2).
אם משהו מהחיפוש נשבר תוך כדי — **עצור ודווח**, אל תתקן בתוך הטרק הזה.

**תלות חוסמת:** בלי **Y1 (Publish ל-Meta app)** אי אפשר לאמת את הסעיפים המסומנים ✅-webhook. אם ה-app עדיין לא published — ממש הכל, כתוב את הטסטים מול payload מוקלט, וסמן במפורש בדוח מה נשאר לא-מאומת.
