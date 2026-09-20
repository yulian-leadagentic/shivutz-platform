# L9 + L10 · Report

Per `docs/cc-prompts/RUN_L9_L10.md` §4. **One report at end of run.**

Branch: `pivot/v2` — dual-pushed to `origin/pivot/v2` + `origin/staging`.
Run completed: 2026-09-12.

---

## 1 · Railway status (pre-migration verification)

```
Workspace:       yulian-leadagentic's Projects
Project:         BuildUp
Project ID:      32a056b2-1656-4c35-abd7-cd71e6b63afc
Environment:     Staging
Environment ID:  ff2e802f-7d38-4402-b939-3c540a4bd85c
Linked service:  user-org
```

Confirmed BuildUp / Staging (not Planwise) BEFORE any migration ran — §0.2 guardrail satisfied.

---

## 2 · `subscription_plans` — six rows on staging

```
{'entity_type': 'contractor',  'tier': 'basic',    'monthly_price_nis': 300, 'included_users': 5,  'extra_user_price_nis': 80,   'max_users': 10}
{'entity_type': 'contractor',  'tier': 'advanced', 'monthly_price_nis': 450, 'included_users': 5,  'extra_user_price_nis': 80,   'max_users': 20}
{'entity_type': 'contractor',  'tier': 'pro',      'monthly_price_nis': 650, 'included_users': 5,  'extra_user_price_nis': 80,   'max_users': None}
{'entity_type': 'corporation', 'tier': 'basic',    'monthly_price_nis': 80,  'included_users': 3,  'extra_user_price_nis': None, 'max_users': 3}
{'entity_type': 'corporation', 'tier': 'advanced', 'monthly_price_nis': 140, 'included_users': 6,  'extra_user_price_nis': None, 'max_users': 6}
{'entity_type': 'corporation', 'tier': 'pro',      'monthly_price_nis': 170, 'included_users': 12, 'extra_user_price_nis': None, 'max_users': 12}
```

- All contractor prices non-NULL (300 / 450 / 650). ✓
- Corp `extra_user_price_nis` all NULL — extras not sold this round per L4. ✓
- 450 + 650 still pending Yulian sign-off (L4 §11 item).

---

## 3 · `payment_events` counts (§2b stop-point cleared)

```
BEFORE BACKFILL:
(payment_events is empty — nothing to backfill)
```

- Table exists, has zero rows. `looks_real = 0` trivially.
- **§2b stop-point cleared cleanly** — no backfill needed, no real charges ever ran.

**After L10 code deploys** the first fake-mode subscription start on staging will insert a row with `is_fake = TRUE` (source: `PAYMENT_FAKE_MODE` env), because `record_event()` was updated to write from the service flag rather than the txn-id prefix. `grep -rn "INSERT INTO payment_events" services` → **one hit** (`services/payment/app/services/payment_events.py:61`), confirming the single write point spec §2c required.

---

## 4 · XSS defence

**Two layers, both server-side (SSR):**

| Layer | Where | What it blocks |
|---|---|---|
| markdown-it `{ html: false }` | `services/frontend/src/lib/legal-render.ts:12-17` | Raw HTML in `body_md` is escaped at parse time — `<script>` in the source becomes `&lt;script&gt;` |
| isomorphic-dompurify | `services/frontend/src/lib/legal-render.ts:47-55` | ALLOWED_TAGS whitelist (no `script`, `iframe`, `style`), ALLOWED_URI_REGEXP rejects `javascript:` and `data:` URLs |

Both layers run during Next.js SSR — the browser never receives unsafe HTML on first paint. The **same** function is reused for the admin live preview, so anything the admin sees rendered under "תצוגה מקדימה" is bit-identical to what a public visitor sees after save.

**Manual XSS test — pending on staging deploy:** paste `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` into a legal_documents.body_md via `/admin/legal`, view the public page + browser console. Expected: literal text renders, zero JS executes.

---

## 5 · Markdown library choice + configuration

**Library:** `markdown-it@14.1.0`
**Sanitizer:** `isomorphic-dompurify@2.14.0`
**Types:** `@types/markdown-it@14.1.2`

Configuration (`services/frontend/src/lib/legal-render.ts`):

```ts
const md = new MarkdownIt({
  html:        false,   // ← layer 1: no raw HTML from markdown source
  linkify:     true,
  breaks:      false,
  typographer: false,
});

// Every http(s) <a> gets rel="noopener noreferrer" target="_blank"
md.renderer.rules.link_open = (tokens, idx, ...) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:\/\//i.test(href)) {
    tokens[idx].attrSet('rel', 'noopener noreferrer');
    tokens[idx].attrSet('target', '_blank');
  }
  return defaultLinkRender(tokens, idx, ...);
};

DOMPurify.sanitize(raw, {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'h1'..'h6', 'strong', 'em', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|#)/i,
});
```

**Why markdown-it over marked:** `html:false` is a first-class option and the plugin system exposes a clean linkify hook. `marked` deprecated its `sanitize` option in v5 and pushes DOMPurify anyway.

---

## 6 · Third parties in `/privacy`

Named in the seeded `body_md` (spec §3 checklist):

1. **Anthropic (Claude)** — search-query rewriting
2. **ElevenLabs** — voice transcription
3. **Cardcom** — payment tokenisation + processing (card details never stored by us)
4. **Vonage** — SMS + WhatsApp
5. **data.gov.il** — contractor registry lookup (rishum haqablanim)
6. **Railway / MySQL** — hosting infrastructure

**Sixth vendor search — none found beyond the five spec-listed.** Reviewed:
- `services/user-org/app/services/query_rewriter.py` → Anthropic only
- `services/gateway/src/index.js` voice proxy → ElevenLabs only
- `services/notification/src/messaging/` → Vonage only
- `services/payment/app/services/cardcom.py` → Cardcom only
- `services/user-org/app/integrations/data_gov_il.py` → data.gov.il only

Railway/MySQL added as infrastructure disclosure (visitors' data is stored there) — not a "vendor the code sends data to" in the same active sense, but worth naming.

`contact_reveals` addressed explicitly in §4 of the seeded privacy body (spec §3 "must include" rule): "לתאגיד המפרסם מוצג מדד מספרי של החשיפות שהמודעה שלו קיבלה".

---

## 7 · `SELECT * FROM site_settings` (staging)

```
{'setting_key': 'a11y_coordinator_email', 'setting_val': None,               'label_he': 'מייל רכז הנגישות'}
{'setting_key': 'a11y_coordinator_name',  'setting_val': 'יוליאן אברמוביץ׳', 'label_he': 'שם רכז הנגישות'}
{'setting_key': 'a11y_coordinator_phone', 'setting_val': None,               'label_he': 'טלפון רכז הנגישות'}
{'setting_key': 'company_address',        'setting_val': None,               'label_he': 'כתובת'}
{'setting_key': 'company_legal_name',     'setting_val': 'Lead Agentic',     'label_he': 'השם המשפטי'}
{'setting_key': 'company_number',         'setting_val': None,               'label_he': 'ח.פ / עוסק מורשה'}
{'setting_key': 'support_email',          'setting_val': None,               'label_he': 'מייל תמיכה'}
```

**7 rows, 2 populated, 5 NULL** per spec §1.2 guardrail.

---

## 8 · Missing to Yulian

**`a11y_coordinator_phone` + `a11y_coordinator_email` are NULL on staging.** Add them via `/admin/legal` → Settings tab (once the Railway deploy finishes rebuilding the frontend).

Until they're set, the `/accessibility` page shows the statement body but **omits the coordinator section entirely** (spec §2b — "a name without a contact method doesn't meet the regulation and looks strange to a visitor"). The admin Settings tab shows an amber warning banner while this state persists.

Also outstanding from L4 launch report: **`company_number` + `company_address` + `support_email`** — I did NOT populate these from the L6 accessibility_statement values, following the spec §1.2 guardrail literally ("NULL, not empty string and not an invented value"). If you want the values from `docs/accessibility_statement.md` (`032340283`, `רבי יוסף בוכריץ 6...`, `yulian@leadagentic.net`) copied in, do it via /admin/legal → Settings.

---

## 9 · `git diff -w --stat pre-l9..HEAD`

```
CLAUDE.md                                          |  44 +-
db/migrations/073_payment_events_is_fake.sql       |  27 +
db/migrations/074_legal_content_and_site_settings.sql |  82 ++
services/admin/app/main.py                         |   5 +-
services/admin/app/routes/legal.py                 | 247 ++++++
services/frontend/package-lock.json                | 896 ++++++++++++++++++++-
services/frontend/package.json                     |   9 +-
services/frontend/src/app/accessibility/page.tsx   | 163 ++--
services/frontend/src/app/admin/legal/page.tsx     | 255 ++++++
services/frontend/src/app/privacy/page.tsx         | 166 +---
services/frontend/src/app/terms/page.tsx           | 142 +---
services/frontend/src/lib/api/legal.ts             |  85 ++
services/frontend/src/lib/legal-fallback.ts        |  32 +
services/frontend/src/lib/legal-render.ts          |  64 ++
services/gateway/src/index.js                      |   4 +
services/payment/app/services/payment_events.py    |  18 +-
services/user-org/app/main.py                      |   7 +-
services/user-org/app/routes/legal.py              |  86 ++
18 files changed, 1989 insertions(+), 343 deletions(-)
```

Two commits:
- `717035d` L9 — 071+072 verify, migration 073 (is_fake), record_event fix, CLAUDE.md rule
- `fa759f5` L10 — migration 074 (3 legal tables + seed), admin CRUD, public reader, gateway public path, 3 page rewrites, admin editor, markdown-it + DOMPurify sanitizer

---

## 10 · What still needs manual verification on staging

After Railway auto-deploy picks up `fa759f5`:

- [ ] `[payment] mode=fake` log line on payment startup — should already be present from L5.
- [ ] `/contractor/users` shows "X מתוך 5" tile.
- [ ] Invite < 5 seats → passes. Invite at 5 → `402 seat_upgrade_required` with `price=80`.
- [ ] `/terms` + `/privacy` + `/accessibility` all render in a **private window** (no token) — critical L10 test.
- [ ] Delete a row from `legal_documents` → `/terms` (or `/privacy`) → 404, `/accessibility` → renders from file fallback. Restore the row after.
- [ ] `/admin/legal` → edit terms body → save → version increments to 2, history row appears, public page updates within 60s (revalidate window).
- [ ] Toggle `is_draft=false` on terms → amber banner disappears.
- [ ] **XSS test:** paste `<script>alert(1)</script>` + `<img src=x onerror=alert(1)>` into a body_md, save, open the public page — zero JS executes, both render as literal text.
- [ ] Non-admin token → `POST /api/admin/legal/documents/terms` → 403.
- [ ] Fill `a11y_coordinator_phone` (or email) via /admin/legal → refresh `/accessibility` → coordinator section appears.

Ping me the results (screenshots + curl outputs) and I'll add them to this report.
