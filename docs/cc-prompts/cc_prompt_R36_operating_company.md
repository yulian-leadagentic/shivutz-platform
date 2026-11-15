# CC prompt · R36 · The operating company on the site and in the docs

**Date:** 15.11.2026 · **Owner:** Yulian · **Branch:** the deploy branch · Small, copy and content only. Can run alongside R34 and R35.

## Decision (Yulian, 15.11)

TagidAI is operated by **אג'נטיק טכנולוגיות בע"מ** · **AGENTIC TECHNOLOGIES AND HOLDINGS LTD** · ח.פ **517362620** · registered address **רבי יוסף בוכריץ 6, ראשון לציון**. It replaces "Lead Agentic · עוסק מורשה" everywhere the site or its documents name the operator. Meta Business Verification passed for this company on 15.11.

## STANDING RULE

`git tag pre-r36`. One commit. No em dashes (—) in any string you touch.

## Changes

| Where | Now | New |
|---|---|---|
| `services/frontend/src/app/contact/page.tsx:26` | Lead Agentic · עוסק מורשה 032340283 | אג'נטיק טכנולוגיות בע"מ · ח.פ 517362620 · and the registered address on its own line |
| `services/frontend/src/components/landing/LandingFooter.tsx:53` | © {year} Lead Agentic · עוסק מורשה 032340283 — כל הזכויות שמורות | © {year} אג'נטיק טכנולוגיות בע"מ · ח.פ 517362620 · כל הזכויות שמורות |
| `services/frontend/src/app/how-it-works/page.tsx:332` | פלטפורמה של Lead Agentic. … | פלטפורמה של אג'נטיק טכנולוגיות בע"מ. … (rest unchanged) |
| Terms, privacy policy, accessibility statement (DB content seeded by `074_legal_content_and_site_settings.sql`, 3 mentions) | Lead Agentic and the עוסק number | company name, ח.פ and address. Update through the same path the admin legal screen writes to (new data migration, idempotent, or the admin API). Keep a version or `updated_at` bump so the change is traceable. Do not rewrite any other clause |
| `docs/accessibility_statement.md`, `docs/meta_verification_checklist.md`, `docs/RAILWAY_SECRETS_CHECKLIST.md`, `docs/whatsapp_setup_guide.md` | Lead Agentic | the company, where it names the operator |

Then grep the whole repo (frontend, notification templates and email bodies, `site_settings`, seed data) for `Lead Agentic`, `leadagentic`, `032340283` and `עוסק מורשה`. Report every hit and change those that name the operator.

**Leave as is:** the contact email address `yulian@leadagentic.net` (a mailbox, not the operator name) unless Yulian says otherwise; any historical migration file (fix with a new migration, never by editing an applied one).

## Acceptance

- [ ] Screenshots of `/contact`, the footer, `/how-it-works`, `/terms`, `/privacy`, `/accessibility` on staging, desktop and mobile
- [ ] Grep output: zero remaining operator mentions of Lead Agentic or the עוסק number in user-facing text
- [ ] Report the 3 legal-content rows before and after (the changed sentences only)

## Manual actions (expected)

1. Yulian: in Cardcom, confirm the terminal and the invoices are on אג'נטיק טכנולוגיות בע"מ, ח.פ 517362620.
2. Yulian: in Meta Business settings, rename the business portfolio display name from "Lead Agentic" if he wants it to match.
