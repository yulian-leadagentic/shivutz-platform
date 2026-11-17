# CC prompt · R41 · Brand name on the coming-soon page (for WhatsApp display-name approval)

**Date:** 17.11.2026 · **Owner:** Yulian · **Small, run now, before anything else in the queue.**

## Why

Meta rejected the WhatsApp display name "TagidAI". The business profile now points to `https://www.tagidai.com`. In production that URL shows the coming-soon page (`services/frontend/src/app/coming-soon/page.tsx`): the logo as an image (`alt="TagidAI"`), "השקה בקרוב" and "Coming Soon". The name TagidAI never appears as text and the operating company is not named. Meta's reviewer must be able to read the brand and the company on the page.

## Change (design stays as it is)

In `app/coming-soon/page.tsx`:

1. Under the logo, the brand name as text: **TagidAI**.
2. One line under the heading: "פלטפורמה לקבלנים ולתאגידי כוח אדם בענף הבנייה".
3. A small footer line, the same wording R36 uses on the full site:
   "TagidAI מופעל על ידי אג'נטיק טכנולוגיות והחזקות בע"מ · ח.פ 517362620"
   and under it a `mailto:` link: `tagid@tagidai.com`.
4. Page `<title>`: "TagidAI · השקה בקרוב". Meta description: the line from step 2.
5. No em dash (U+2014) anywhere.

Do not touch the bypass cookie logic or the middleware.

## Deploy

- Commit, push to `pivot/v2` and `staging`, check staging.
- **Deploy this page to production.** Yulian approves this production deploy for this change only. Nothing else goes to production with it. If the production branch carries other unreleased commits, stop and report instead of deploying.
- After deploy, fetch `https://www.tagidai.com` and confirm the text "TagidAI", the company line and the email are in the HTML.

## Report

Three lines: commit, production deploy status, and the HTML check. Then Yulian resubmits the display name in Meta.
