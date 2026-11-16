# Cookies and the cookie notice

R38 item 8, 16.11.2026.

## The rule

**Any analytics or advertising tool must load only after an explicit opt-in.
When the first one is added, the cookie notice becomes a consent request with
"מאשר" and "לא מאשר", and the tool's script is not loaded until the visitor
chooses "מאשר".**

This covers anything that sets a non-essential cookie or reads the visitor's
browser for measurement or marketing: Google Analytics / Tag Manager, Meta or
TikTok pixels, Hotjar, Clarity, Segment, embedded third-party players, and
similar. The privacy policy (section 9, legal content in the DB) promises the
same: a consent banner appears if this changes.

## What the site stores today (verified 16.11.2026)

| Name | Where | Kind | Set by |
|---|---|---|---|
| `access_token` | cookie, 24 h | essential: keeps you signed in | `services/frontend/src/lib/auth.ts` |
| `refresh_token` | cookie, 30 days | essential: renews the sign-in | `services/frontend/src/lib/auth.ts` |
| `coming_soon_bypass` | cookie, httpOnly | essential: team preview behind the prod coming-soon gate | `services/frontend/src/app/api/coming-soon-bypass/route.ts`, read in `middleware.ts` |
| `cookie_notice_ack` | localStorage | remembers that the notice was dismissed | `services/frontend/src/components/privacy/CookieNotice.tsx` |
| `pivot.dismiss_publish_first_banner` | localStorage | remembers that a corporation closed the "first ad" nudge | `features/corporation/PublishFirstAdBanner.tsx` |
| `tagidai_notif_test_history_v1` | localStorage | admin-only test page history | `app/admin/notifications-test/page.tsx` |
| event session id, prospect, pending search and reveal, login intent, return path | sessionStorage | per tab, cleared on close | `lib/adEvents.ts`, `features/prospect/*`, `app/login`, `app/select-entity` |

No analytics, pixel or third-party script is loaded. Fonts come through
`next/font`, which serves them from our own origin. No backend service sets a
cookie.

## The notice

`CookieNotice` is mounted once in `services/frontend/src/app/layout.tsx`. It is
shown on the first visit, links to `/privacy`, and is dismissed for good with
"הבנתי" (stored in `localStorage` under `cookie_notice_ack`). No toggles while
the site has essential cookies only.

The link goes to `/privacy` without an anchor: the legal renderer
(`lib/legal-render.ts`) gives headings no `id` and strips `id` attributes, so
section 9 has nothing to link to.

When the rule above kicks in: replace "הבנתי" with "מאשר" and "לא מאשר", store
the choice, load the tool only on "מאשר", give the visitor a way to change the
choice later, and update section 9 of the privacy policy with a lawyer.
