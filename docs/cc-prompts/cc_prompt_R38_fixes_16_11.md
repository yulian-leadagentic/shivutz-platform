# CC prompt · R38 · Fixes from Yulian's walk-through, 16.11

**Date:** 16.11.2026 · **Owner:** Yulian · **Branch:** `pivot/v2`, deploy to staging as before
**Run after R37.** R37 changes the provider listing form (4c), the event pipeline and the categories. Items 3 and 7 here build on those. If R37 is still running, finish it first.
**Source list:** `claude/fixes_list_16_11.md` (items 1–8).

## STANDING RULE

- `git tag pre-r38` before the first change. One commit per item. Items in order. After each item: a short status, evidence, screenshots at 390 and 1280.
- **Never invent prices, legal claims or business rules.** Where a value is Yulian's, leave it empty and list it under Manual actions.
- No em dash (U+2014) in any string you write or touch.
- Staging only.

---

## 1 · Kablan verification banner on an approved contractor

`components/contractor/KablanVerifyBanner.tsx`, mounted in `app/contractor/layout.tsx:31`, shows the yellow "שדרג את הפרופיל עם אימות פנקס הקבלנים" banner on every contractor screen whenever `kablan_verified_at` is null, including contractors already approved by hand. The dashboard's "אימות" card already carries the same upgrade offer, so an approved contractor sees it twice, in a warning color.

- Approved contractor (`approval_status = 'approved'`) with no `kablan_verified_at`: **no top banner.** The offer stays only in the dashboard "אימות" card.
- The banner stays for the states that need action: `pending` (mismatch, not dismissible) and `registry_unreachable`.
- `app/contractor/dashboard/page.tsx:124`: "שני מסלולים למצוא עובדים: בחרו את המתאים" (colon instead of the em dash).

**Acceptance:** an approved, unverified contractor sees no banner on the dashboard, search or billing · a pending contractor still sees it · screenshots.

---

## 2 · No em dash in any user-facing text

Rule (Yulian, 16.11): no em dash in anything a user reads. That covers headings, body text, tooltips, `title`, `aria-label`, `placeholder`, toasts, error messages returned by any service and shown on screen, emails, WhatsApp and SMS templates, legal content and `site_settings`.

- Replace by context with a colon, comma or full stop. **Never with a hyphen.** An en dash in a number range ("5–10") stays.
- Example: `app/billing/page.tsx:242` "סביבת בדיקות: התשלומים לא באמת נגבים." · "נשמר לך: לא ייגבו חשיפות נוספות על מודעה זו."
- Scope: `services/frontend/src` (about 350 lines with Hebrew text), `services/notification/src`, user-facing `detail` strings in `user-org`, `deal`, `payment`, `auth`, and the DB content (legal pages, `site_settings`) through a **new** idempotent migration. Never edit an applied migration.
- Leave as is: code comments, internal `docs/`, test fixtures that are not user-facing.
- **Lock:** a test that fails on an em dash inside a JSX text node, a string literal passed to the user-facing attributes above, a toast or error call, or a notification template. Comments excluded.

**Acceptance:** grep before and after, by service · the test fails on a planted em dash and passes after it is removed · screenshots of five changed screens.

---

## 3 · Service listings: target audience and relevance

A contractor searching "טייח לבת ים" got the insurance listing "חבילת ביטוח משולבת לתאגידים".

**3a · Target audience.**
- `marketplace_listings.audience` ENUM-free column (`VARCHAR` with a check or an allow-list in code): `contractors` · `corporations` · `both`. Default `both`. Idempotent migration; existing rows get `both`.
- Provider listing form (the R37 4c form): a required radio "קהל יעד": קבלנים · תאגידי כוח אדם · שניהם.
- Search, browse, the home strips and the detail endpoint filter by the viewer: a contractor sees `contractors` and `both`; a corporation sees `corporations` and `both`; admin sees all; an anonymous visitor sees `both` only. Put the rule in `services/visibility.py` next to the existing viewer scope, not in each route.
- Seed: set the audience of the existing seed listings by their content and report the mapping (for example "לתאגידים" in the title → `corporations`).

**3b · Relevance.** Find out why the insurance listing matched "טייח לבת ים" (likely the OR fallback, `via_fallback` in `routes/search.py`). Report the cause first. Then: a service listing is shown only when its category was detected in the query, or it matches a real content word from the query. A region or a generic word ("עובדים") alone is not enough. Do not change worker or housing ranking.

**Acceptance:** the same query as a contractor no longer shows that listing · a listing set to `contractors` is hidden from a corporation and the reverse, through search and through the detail URL (404) · tests for both.

---

## 4 · Results tabs: a more attractive design · options first, then build

The tabs (הכל · עובדים · דיור · שירותים נלווים) work. They look like a plain table header: grey text, the count under it, an orange underline.

**Step 1, stop after it.** Build three variants behind a temporary query flag (`?tabs=a|b|c`) on staging, using only the site's design tokens and fonts. Post screenshots of each at 390 and 1280, active and inactive, with one tab at 0 results. Then **stop and wait for Yulian's choice.**

Directions to draw from:
- An icon per tab (people, home, tools), the count as a round badge beside the label.
- Active tab as a pill with a light brand background and a soft transition.
- A tab with 0 results is visually quieter; on hover or focus a short line explains why it is empty.
- The tab bar sticks under the search bar while scrolling.
- Mobile: tabs scroll horizontally instead of squeezing.

**Step 2, after the choice:** keep the chosen variant, remove the flag and the other two, and check keyboard navigation (arrow keys between tabs, `role="tablist"` / `tab` / `aria-selected`) and contrast.

---

## 5 · Results table column: "מודעה" → "תאגידים"

- `app/page.tsx:3149`, worker table headers: "מודעה" → "תאגידים".
- `app/page.tsx:3266`, the mobile label `data-l="מודעה"` → "תאגידים".
- `app/page.tsx:3150`, housing table headers: same change. Every row there is a corporation's too.
- **Do not change** the "מודעה" badge on sponsored slots (`app/page.tsx:3074, 3101`). It marks an ad.

---

## 6 · "פרסום חדש בפורטל" cards open the ad, never reveal

Today each card (`app/page.tsx:2891`) links to `/?reveal=<id>`, which runs `revealFor` directly (`app/page.tsx:1266`). For a signed-in contractor that attempts a contact reveal whose result is shown only on a search-result row, which the home page does not have. So nothing visible happens.

**6a · Check first and report.** Did a card click consume a reveal from the contractor's monthly quota? Yulian's test contractor shows "חשיפות החודש: 1 / 40". Check `contact_reveals` for that contractor and say whether that row came from a card click. If any reveal was created this way on staging, list it; do not delete anything without Yulian's word.

**6b · Ad screen.**
- A card click opens an ad screen: a drawer in the style of `ListingDetailDrawer` (R32 S5), for worker ads and housing ads.
- Worker ad: profession, quantity, origin, region, experience, description, "תאגיד רשום" badge (no identifying corporation details, decision of 19.09), published date. Housing ad: the housing fields already shown in search.
- At the bottom, the existing "הצג פרטים" reveal button with the existing quota, paywall and anonymous-to-registration flow. **A reveal happens only on that button. Never on a card click.**
- The screen has its own URL, `/?ad=<id>`, so it can be shared and reopened. `?reveal=` keeps working only as the return path after registration (the existing O1 / H11 flow).
- Close on Esc and on the backdrop, focus trapped while open, focus returns to the card on close.

**Acceptance:** clicking a worker card and a housing card as anonymous, contractor and corporation opens the screen and creates no `contact_reveals` row · "הצג פרטים" inside it reveals exactly once · `/?ad=<id>` opens the screen directly.

---

## 7 · After a reveal: "התקשר" and "וואטסאפ"

Today the revealed number is one `tel:` link (`+972525900200`) inside an orange frame. Follow what Israeli listing sites do (yad2, Madlan); do not invent a new pattern.

- One shared component, used everywhere a phone is revealed: worker ad row, housing row, `ListingDetailDrawer`, the new ad screen from item 6, and the "החשיפות שלי" pages.
- The number in local format, `052-590-0200`, with a small copy button.
- **"התקשר"** button: `tel:` link.
- **"וואטסאפ"** button (WhatsApp icon, green): `https://wa.me/972XXXXXXXXX?text=…` with a prefilled message naming the ad, for example: "שלום, ראיתי ב-TagidAI את המודעה '4 רתכים מאוקראינה · דרום' ואשמח לפרטים". URL-encode the text.
- WhatsApp only for Israeli mobile numbers (05X). A landline gets "התקשר" only.
- No orange frame around the number.
- Each click is an event, `contact_call` and `contact_whatsapp`, through the R34 5c event pipeline with the same gates, so a corporation or provider can later see how people reached them. No phone number in the event payload.

**Acceptance:** screenshots in all five places at 390 and 1280 · a landline shows no WhatsApp button · the wa.me link opens with the right number and text · both events recorded on staging.

---

## 8 · Cookie notice

What exists: only essential cookies (`lib/auth.ts` access and refresh tokens; the staging-only `coming_soon_bypass` in `middleware.ts`), `sessionStorage` for events and pending intents, no analytics, pixel or third-party tracker. The privacy policy (section 9, DB content) already says essential cookies only. Nothing on the site tells the user.

- A small notice at the bottom of the screen, not blocking the page, shown on the first visit only: "האתר משתמש בעוגיות חיוניות בלבד, לשמירת ההתחברות שלך. פרטים במדיניות הפרטיות." with a link to the cookies section of `/privacy` and a "הבנתי" button. After "הבנתי" it does not return (remember the choice in `localStorage`, wrapped in try/catch).
- No consent toggles while there are only essential cookies.
- Accessibility: `role="region"`, `aria-label="הודעת עוגיות"`, reachable by keyboard, does not cover the accessibility widget or the sticky search on mobile, contrast checked.
- Add a short comment and a note in `docs/` stating the rule for later: **any analytics or advertising tool must load only after an explicit opt-in, and the notice then becomes a consent request with "מאשר" and "לא מאשר".**
- Do not change the privacy policy text in this round.

**Acceptance:** screenshots at 390 and 1280 · shown on first visit, gone after "הבנתי" and on reload · keyboard path works.

---

## Guardrails

- Do not touch: reveal billing and quotas (except reading them in 6a), the search ranking for workers and housing, corporation housing publishing.
- No new npm or pip dependency without asking (use the existing icon set; if it has no WhatsApp icon, an inline SVG is fine).
- If anything here contradicts what you find in the code, stop at that item, report, and carry on with the next independent item.

## Report

`docs/cc-prompts/r38_report_1116.md`, in the shape of the R33 and R34 reports: status table, commits, evidence, the 3b cause, the 6a finding, what you did not verify, findings, `git diff -w --stat pre-r38..HEAD`, Manual actions.

## Manual actions (expected, for Yulian)

1. Choose one of the three tab designs (item 4).
2. Decide about any reveal 6a finds that came from a card click.
3. Have a privacy lawyer approve the cookie notice wording and section 9 of the privacy policy.
