# CC prompt · R35 · WhatsApp on Meta Cloud API: inbound search and one reply

**Date:** 15.11.2026 · **Owner:** Yulian · **Branch:** the deploy branch · **Staging only.** Production only on Yulian's explicit go.
**Replaces** `cc_prompt_whatsapp_meta_W1.md` (13.08), which was never implemented. Read it for background; this prompt is the one to execute.

## Where things stand (checked in code on 15.11)

- Outbound WhatsApp still goes through **Vonage**: `services/notification/src/messaging/index.js` requires `./vonageWhatsapp`, and `HAS_WHATSAPP()` checks `VONAGE_APPLICATION_ID / VONAGE_PRIVATE_KEY / VONAGE_WHATSAPP_NUMBER`.
- **No Meta code anywhere** (no `graph.facebook.com`, no webhook route for Meta).
- Schema exists and is provider-neutral: `db/migrations/052_whatsapp_foundation.sql` (`whatsapp_message_log`, `support_messages`, `notification_templates.whatsapp_template_name`, `users.whatsapp_opt_in`). Do not recreate these tables.
- Gateway: `'/api/webhooks'` proxies to the notification service; `'/api/webhooks/vonage'` is in `PUBLIC_PREFIXES`. The gateway already uses `express.raw` for one path (`:102`); notification uses `express.json` globally (`index.js:18`).
- On the Meta side: the number is registered on Cloud API and a manual send worked in August. Business verification is **in review** (resubmitted 15.11). The app may not be Live yet. Unverified accounts can still receive messages and reply inside the 24-hour window, which is all R35 needs.
- SMS stays on Vonage. Do not touch `services/notification/src/sms/*`.

## Locked product decisions

1. **V1 = search by message + one reply with a link.** Inbound text → the existing search → **exactly one** outbound message with 3–5 anonymous results and a link to the site. Reveal and payment happen on the site, never in the chat.
2. **Who sees what follows the search visibility matrix (R32 D1).** The sender is identified by phone number (Meta verifies the sender's number):
   - phone matches a user with **one** contractor membership → search with that contractor's scope (approved: workers, housing, services · pending: housing and services)
   - phone matches a corporation user → corporation scope
   - anything else (unknown number, provider, multi-entity user) → anonymous scope (services only) plus one line inviting to sign up
   - **Never** contact details or corporation names in the chat, for anyone.
3. **One outbound per inbound.** Since 1.10.2026 Meta charges per service message inside the 24-hour window (1,000 free per number per month, then the utility rate). No "searching…" message, no follow-ups.
4. No templates in R35. Templates (proactive notifications, OTP over WhatsApp) are a later round.

## STANDING RULE

`git tag pre-r35`. Staging only. DoD = real inbound webhook logs + the deployed SHA. Hebrew RTL in every user-facing string. Report ends with **Manual actions**.

---

## 1 · Send layer: Vonage → Meta

Create `services/notification/src/messaging/metaWhatsapp.js` with the same contract as `vonageWhatsapp.js`: `send(phone, message, opts) → { messageId }`.
- `POST https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, `Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}` (System User token).
- Text: `{ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: true } }`. Implement the template branch as a skeleton only.
- `to` is E.164 **without** `+`. `messageId` = the returned `wamid`.
- In `messaging/index.js`: require `./metaWhatsapp`, `HAS_WHATSAPP()` checks `WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID`, provider string `'meta-cloud'`.
- Delete `vonageWhatsapp.js` and its env vars (`VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY`, `VONAGE_WHATSAPP_NUMBER`) **only after** grepping that nothing else uses them (the Vonage SMS path uses `VONAGE_API_KEY / SECRET / FROM`, which stay). Report what you found.
- Check every existing caller of `channel: 'whatsapp'` or `'auto'` (OTP opt-in from WhatsApp P2, `WHATSAPP_OTP_TEMPLATE_NAME`). Outside the 24-hour window those need an approved template; until one exists they must fall back to SMS, not fail. Report each caller.

## 2 · Webhook: verify + receive

Gateway: add `'/api/webhooks/whatsapp'` to `PUBLIC_PREFIXES` (secured by `X-Hub-Signature-256`, not a user JWT). Confirm the proxy forwards the raw body untouched.

Notification, `routes/whatsappWebhook.js`, mounted **before** the global `express.json` with `express.raw({ type: 'application/json' })` for this path only:
- **GET** `/webhooks/whatsapp`: `hub.mode === 'subscribe' && hub.verify_token === WHATSAPP_VERIFY_TOKEN` → 200 with `hub.challenge` as plain text; else 403.
- **POST**:
  1. Verify `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(raw body, `WHATSAPP_APP_SECRET`), `crypto.timingSafeEqual`. Bad → 401, nothing stored.
  2. **Reply 200 immediately**, process asynchronously (search can take seconds; Meta retries if no 200 in time).
  3. `value.messages[]` → inbound. `value.statuses[]` → update `whatsapp_message_log` status by `wamid`.
  4. **Dedup on the inbound `wamid`**: insert into `support_messages` (`direction='inbound'`, `message_uuid=wamid`); if it already exists, stop silently.
  5. Non-text (image, document, location, audio) → store, reply once: "כרגע אני מבין רק הודעות טקסט. מה אתם מחפשים?" No speech-to-text in R35.

## 3 · Migration (next free number, after `097`)

Make `support_messages.message_uuid` and `whatsapp_message_log.message_uuid` **UNIQUE** (052 created plain indexes). Check for non-NULL duplicates first and report. Idempotent.

## 4 · Inbound → search → one reply

`services/notification/src/whatsapp/handleInbound.js`:
1. **Normalize the phone** (`972…` from Meta vs `+972…` in the DB). One function, unit-tested both ways.
2. **Rate limit per number** in Redis: max 10 searches per hour and 1 per 5 seconds. Over the limit → one short reply ("קיבלתי כמה הודעות, עונה על האחרונה") and stop.
3. **Identify the sender** per decision 2 and build the identity headers the search service expects (`x-user-role`, `x-entity-type`, `x-entity-id`). Call user-org's search **directly on the internal network**, not through the public gateway. Verify the exact internal path and print it.
4. Search timeout 10 s; on failure one Hebrew reply ("לא הצלחתי לחפש כרגע, נסו שוב עוד רגע") and a log line.
5. **Compose one message, under 1,000 characters:**
   - Title line with what was understood (the `filters` the search returned).
   - Up to 5 results, one or two lines each: workers → profession · origin · region · quantity; housing → city · beds · whole unit or beds; services → category · area. Nothing that identifies the corporation or provider.
   - If the viewer's scope hid workers or housing (`hidden_types`), one line: "מודעות עובדים ודיור זמינות לקבלנים רשומים: <link to register>".
   - Zero results → "לא מצאתי התאמות ל־<query>. אפשר לנסח אחרת, למשל: 10 רצפים במרכז" + link.
   - Always end with the link: `${FRONTEND_URL}/?q=<encodeURIComponent(query)>`, with `&type=services` when only services came back.
6. Send through the dispatcher (`channel: 'whatsapp'`), store the outbound row in `support_messages` with `in_reply_to` = the inbound row.

## 5 · Env and docs

Add to `.env.example` and `docs/RAILWAY_SECRETS_CHECKLIST.md` (names and dummy values only):
```
WHATSAPP_ACCESS_TOKEN      # permanent System User token
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_WABA_ID
WHATSAPP_APP_SECRET        # verifies X-Hub-Signature-256
WHATSAPP_VERIFY_TOKEN      # a random string we choose; same value is entered in Meta
WHATSAPP_API_VERSION       # e.g. v23.0, use the current one
```
Generate a strong random `WHATSAPP_VERIFY_TOKEN` value and give it to Yulian in the report, since it is ours and not a Meta secret. Update `docs/whatsapp-templates.md` and the header comment of `052_whatsapp_foundation.sql` (Meta, not Vonage).

---

## Acceptance (staging)

Before Yulian adds the real secrets, test against recorded Meta payloads with a test secret and mark what is still unverified. After he adds them:
- [ ] GET with the right verify token returns the challenge; wrong token → 403; **Meta shows the webhook as verified**
- [ ] POST with a valid signature → 200; forged signature → 401 and nothing stored
- [ ] A real message from Yulian's phone → one inbound row, then **exactly one** WhatsApp reply
- [ ] "20 פועלים סינים במרכז" from an approved contractor's phone → worker results, no contact details, link
- [ ] Same text from an unknown number → services only (or none) + the sign-up line + link
- [ ] Meta delivers the same webhook twice → one row, one reply
- [ ] 12 messages in a row → rate limit kicks in
- [ ] `whatsapp_message_log` moves `submitted → delivered → read` from real status callbacks
- [ ] SMS OTP via Vonage still works (run a real OTP)

## Guardrails

Do not touch: the search engine (`query_rewriter.py`, `query_reranker.py`, `routes/search.py` logic), reveal, subscription, billing, `sms/*`. If search breaks during this work, stop and report. Not in R35: speech-to-text, reveal in chat, proactive templates, interactive lists.

## Manual actions (expected, for Yulian)

1. Railway, staging, notification service: set the six `WHATSAPP_*` variables, then **redeploy**.
2. Meta App Dashboard → WhatsApp → Configuration: callback URL `https://staging.tagidai.com/api/webhooks/whatsapp`, verify token = the value from the report, then subscribe to the **messages** field.
3. WhatsApp Manager: add a payment method (service messages are billable since 1.10.2026).
4. When business verification is approved: switch the Meta app to Live.
