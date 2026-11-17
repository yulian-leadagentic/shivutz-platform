# R38 report · 16.11.2026

Prompt: `docs/cc-prompts/cc_prompt_R38_fixes_16_11.md`, plus the WhatsApp decisions Yulian gave in chat on 16.11 (default entity per phone, registered users only, voice, search link before the sign-up line, login code by WhatsApp).

Everything is on `pivot/v2` and on `staging`. `git rev-list --left-right --count origin/staging...origin/pivot/v2` → `0	0`. Production was not touched. Tag `pre-r38` marks the start.

## Status

| # | Item | Status | Commit(s) |
|---|---|---|---|
| 1 | Kablan banner only where a check is waiting | Done, on staging | `63ad6cf` |
| 2 | No em dash in any text a user reads, with a lock | Done, on staging; privacy policy left (see findings) | `c0c07d7` |
| 3 | Listing audience (3a) and search relevance (3b) | Done, on staging | `5508816`, `73f1ce4` |
| 4 | Results tabs | **Step 1 done; stopped for your choice of A, B or C** | `99a3651` |
| 5 | First results column "תאגידים" | Done, on staging | `6f5432e` |
| 6 | Card opens the ad screen; reveal only on its button | Done, on staging | `418a50b` |
| 7 | Shared call / WhatsApp block after a reveal, with events | Done, on staging | `eddaed1`, `b518f5b` |
| 8 | Cookie notice | Done, on staging; legal review needed | `0292214` (merge `090ca6c`) |
| W1.1 | WhatsApp: default entity per phone | Done, on staging; migration 110 ran first | `463c667` (merge `2030ada`) |
| W1.2 | WhatsApp: registered users only | Done, on staging | `d90a99c` |
| W1.3 | WhatsApp: voice notes | Built; waits for `ELEVENLABS_API_KEY` on staging notification | `fbfd89e` |
| W1.4 | WhatsApp: search link first | Done, on staging | `d486aa8` |
| W2 | Login code by WhatsApp | Built; waits for a Meta authentication template | `d962e6d`, `525365d` (merge `eba7181`) |
| F1 | 17.11 · dashboard waiting time says 48 hours (findings 3) | Done, on staging | `73f953b` |
| F2 | 17.11 · "הצג פרטים" contrast (findings 2) | Done, on staging | `a5942e8` |

Items 8, W1 and W2 were built in parallel by three background agents in their own worktrees, reviewed, merged here with `--no-ff`, and tested on the merged tree before each push.

## Commits

```
a5942e8 R38 follow-up · "הצג פרטים" is emerald-700, readable on its own colour
73f953b R38 follow-up · the dashboard waiting time says 48 hours, like the banner
62d009c R38 · the report and its screenshots
73f1ce4 R38 item 3 · the audience choice is a named radio group
2030ada Merge: WhatsApp W1, default entity, registered users only, voice, link order
d486aa8 R38 WhatsApp 4 · the search link is the first link in a reply
b518f5b R38 item 7 · the revealed email follows the RTL edge
fbfd89e R38 WhatsApp 3 · voice notes are searched too
d90a99c R38 WhatsApp 2 · registered users only
463c667 R38 WhatsApp 1 · a default entity per phone, picked on the site
090ca6c Merge: R38 item 8, the cookie notice
0292214 R38 item 8 · the cookie notice
eba7181 Merge: login code by WhatsApp (W2)
eddaed1 R38 item 7 · a revealed phone: the number, "התקשר" and "וואטסאפ"
418a50b R38 item 6 · a portal card opens the ad screen; a reveal only on its button
525365d Login screen: choose SMS or WhatsApp for the code, and say where it really went
6f5432e R38 item 5 · the first results column is "תאגידים", not "מודעה"
99a3651 R38 item 4, step 1 · three candidate designs for the results tabs
d962e6d Login OTP by WhatsApp: the channel the user picks reaches Meta as an authentication template
5508816 R38 item 3 · a service listing names its audience; a query word must be a word
c0c07d7 R38 item 2 · no em dash in any text a user reads
63ad6cf R38 item 1 · the kablan banner only where a check is waiting
7d6e007 R38 · the prompt file
```

## Evidence

Screenshots are in `docs/cc-prompts/r38_shots/`, named `item<N>-<width>-<what>`. Browser checks of logged-in screens ran on the local frontend with the API stubbed in the page (fake contractor or provider identity, no gateway), so no real reveal was spent and no message was sent. Staging checks ran read-only inside the staging user-org container.

**Tests on the final merged tree:** frontend 98/98 (including the em-dash lock), `tsc --noEmit` clean; user-org 307 passed; notification 339 checks in 5 files; auth `send-otp-channel` passes (run in the local auth container); both em-dash scans report 0.

### 1 · Kablan banner
- The banner shows only when `approval_status === 'pending'`: "בקשת האימות בבדיקה", or the registry-unreachable variant. The upgrade banner and its session dismiss are gone.
- The dashboard line now reads "שני מסלולים למצוא עובדים: בחרו את המתאים".
- Shots: `item1-1280-pending-banner.jpg`, `item1-390-pending-banner.jpg`.

### 2 · Em dash
- 410 text nodes in 88 frontend files, plus the user-facing Python strings in user-org, payment and admin, and the seed script.
- Migration 106 fixes the database content: notification templates, the accessibility statement and terms (with a history row and version bump), seed listing titles and seed sponsor ads. A dry run on staging in a rolled-back transaction touched 42 rows; a second run touched 0.
- On staging, 106 is in the ledger (15:17 UTC). Rows still containing U+2014: 0 in notification template subjects and bodies, 0 in listing titles, 0 in sponsor ad headlines and bodies.
- Locks: `services/frontend/tests/no-em-dash.test.mjs` (7 tests) and `scripts/test_em_dash_scan.py` (5 tests). A dash planted on purpose fails them.
- Five screens: how-it-works (`item2-*-how-it-works.jpg`), the contractor dashboard (item 1 shots), the search results (item 4 shots), the provider form (item 3 shots) and the reveals page (item 7 shots).

### 3 · Audience and relevance
- **3a.** A service listing must name its audience: "קהל יעד *", with "קבלנים", "תאגידי כוח אדם" or "שניהם". The server refuses a missing one (`audience_required`) and an unknown one (`audience_invalid`). Who sees what:
  - a contractor sees contractors + both;
  - a corporation sees corporations + both;
  - anyone else sees both;
  - an admin sees everything;
  - an advertiser always sees their own.
- On staging, migration 107 is in the ledger (15:36 UTC), and the listings split 12 both, 3 contractors, 1 corporations. A contractor browsing gets 15, i.e. all but the one for corporations.
- **3b cause:** the word filter was an AND pass with `LIKE '%token%'`. So "לבת" matched inside "משולבת", and "ים" matched inside "לתאגידים". It was not the fallback. Each word is now matched as a whole word, with Hebrew prefix letters and plural endings allowed (MySQL `REGEXP`, checked on 8.0.45 and on staging's 9.4.0). Generic words like "שירות" no longer count. A trade word is put back when it is the only word left ("פיגומים").
- On staging, "טייח לבת ים" as a contractor now returns 1 worker ad and 0 marketplace matches.
- The form's radio group now carries the legend as its name and points at the error (`73f1ce4`, found in the browser check).
- Shots: `item3-*-audience-required.jpg`, taken after pressing "פרסם מודעה" with no audience. No request was sent.

### 4 · Results tabs, step 1 (stopped here)
- Three designs sit behind `?tabs=a|b|c`. Without the flag the page shows the current design.
  - **A:** underline tabs with icon and count.
  - **B:** pills with a count badge.
  - **C:** B, sticky, scrolling sideways on a phone.
- In all three, an empty tab is quiet ("אין תוצאות מהסוג הזה לחיפוש הזה"), a tab that needs login is marked locked, and arrow keys move between tabs (RTL aware).
- **At 390:** A truncates its labels ("עו…", "ש…"), B wraps "שירותים נלווים" to a second row, and C keeps one row and scrolls inside the bar (the page itself does not scroll sideways).
- Shots: `item4-1280-design-{a,b,c}.jpg`, `item4-390-design-{a,b,c}.jpg`. They show a combined answer: the workers of one real staging search plus the housing of another, so that more than one tab has a count. Real searches on staging each returned one type only.

### 5 · Column
- The header and the mobile `data-l` label read "תאגידים". The sponsor badge "מודעה" is unchanged. It is visible in the item 4 shots.

### 6 · Ad screen
- **6a finding:** a "פרסום חדש בפורטל" card linked to `/?reveal=<id>`. For a signed-in contractor that ran the reveal at once and spent one reveal from the month. The result went to a search row the home page does not show, so the click looked dead and invited another click.
- Yulian's contractor `73ac1629` has 19 reveal rows in all, 5 of them in November. They are 09.11 (one), and 16.11 at 09:01:49 and 09:03:41 (both on ad `cda4cecd`), 09:04:18 and 09:04:31 UTC.
- The monthly count is `COUNT(*)` of rows, so the duplicate counts twice. The rows have no source column, so a card origin cannot be proven, but the pair two minutes apart fits the card path. Nothing was deleted (manual action 2).
- **6b:** a card links to `/?ad=<id>` and opens the ad screen: the same drawer as the listing drawer, a bottom sheet on a phone. It shows trade, workers, origin, region, experience, the description and "תאגיד רשום" (for housing: city, beds, price), and never the corporation.
- "הצג פרטים" runs the existing reveal flow unchanged. A quota or renewal modal opened from it now appears instead of the drawer, not behind it.
- Checked in the browser:
  - a card click sends no request;
  - "הצג פרטים" sends exactly one (`GET /ads/<id>/contact-reveal`);
  - Esc closes and drops `?ad=`, focus returns to the card, and the scroll position is kept;
  - a missing ad shows "המודעה כבר לא זמינה.";
  - an anonymous visitor on a shared link gets "כדי לראות את המודעה יש להתחבר." and "להתחברות" (`/login?next=%2F%3Fad%3D<id>`).
- Shot: `item6-1280-ad-screen.jpg`.

### 7 · Contact block
- `ContactActions` is used on the result rows, the ad screen, the listing drawer and "החשיפות שלי". It shows:
  - the number in local form (052-590-0200) with a copy button;
  - "התקשר" (`tel:`);
  - for an Israeli mobile only, "וואטסאפ", which opens `wa.me/972…` with "שלום, ראיתי ב-TagidAI את המודעה '<title>' ואשמח לפרטים". A landline gets "התקשר" only.
- Each click posts `contact_call` or `contact_whatsapp` with the ad or listing id and never the number. The events go through `POST /events` with the existing gates (allow-list, live target, no self-clicks, no actor); 30 events tests pass.
- Browser check:
  - both events were sent;
  - an 03 number showed "התקשר" only;
  - a removed ad on "החשיפות שלי" records no event;
  - the listing drawer's orange frame is gone.
- Shots: `item7-*-ad-screen-revealed.jpg`, `item7-*-my-reveals.jpg`.

### 8 · Cookie notice
- The site sets essential cookies only: `access_token`, `refresh_token` and `coming_soon_bypass`. It loads no analytics, pixel or third-party script. So this is an informational notice ("האתר משתמש בעוגיות חיוניות בלבד…", a link "במדיניות הפרטיות", and "הבנתי"), remembered in `localStorage`, not a consent request.
- `docs/COOKIES.md` holds the rule for later: an analytics tool loads only after an explicit opt-in, and the notice then becomes a consent request.
- The prompt called `coming_soon_bypass` staging-only. It is not: it is how the team passes the prod coming-soon gate. It is still essential.
- Keyboard order is link, then button. The notice stays 12px clear of the accessibility button at 390. Shots: `item8-*`.

### W1 · WhatsApp
- **Default entity.** The choice is a flag on `auth_db.entity_memberships`, from migration 110: a UNIQUE generated column allows one per user, and a CHECK allows only an active, accepted membership.
  - Users pick on "חשבון ומנוי" → "היישות לוואטסאפ" (`/billing#whatsapp`, also on `/provider/billing` and in admin users).
  - A phone with one membership is that membership. With several and none picked, it gets one reply with the pick link and no search.
  - **Deploy order:** 110 was run on staging and verified (columns, UNIQUE, CHECK) before the code was pushed. The entrypoint then recorded it at 16:04 UTC.
  - Every active membership on staging (20 of 20) has `invitation_accepted_at`, which both the CHECK and the sender lookup need.
  - `GET /users/me/whatsapp-entity` on staging for Yulian returns his three memberships with `choice_needed: true`.
- **Registered only:** a number with no registered user gets one reply, "החיפוש בוואטסאפ פתוח למשתמשים רשומים. להרשמה: …/#register". Nothing is searched or transcribed for it.
- **Voice:** the audio is downloaded from Meta (token sent to Meta hosts only, 10 MB cap) and transcribed with ElevenLabs Scribe (`heb`). The transcript is searched as text. Any failure gets "לא הצלחתי להבין את ההודעה הקולית, נסו לכתוב במקום". The key and transcripts are never logged.
- **Link order:** title, results, the search link, then the "what you cannot see" line, so the preview card leads to the results.

### W2 · Login code by WhatsApp
- The login screen asks "איך לקבל את הקוד?" (SMS by default, or WhatsApp). The code screen says where the code really went, from the server's answer. Resend offers both channels.
- `/auth/send-otp` takes `channel`. Notification sends a WhatsApp AUTHENTICATION template when `WHATSAPP_OTP_TEMPLATE_NAME` is set, and falls back to SMS otherwise or on any failure.
- Until the template exists, every code goes by SMS and the screen says "ב-SMS". Registration and invite keep SMS.

## Not verified
- Logged-in screens (items 1, 3, 6, 7) were checked locally against a stubbed API, not on staging with a real login. The staging frontend bundle does contain the ad screen.
- `tel:` and `wa.me` were not opened on a real phone; the clicks were caught in the page.
- Item 8: not on staging and not on a real phone, so the iPhone safe-area offset is untested.
- W1 end to end with real WhatsApp messages: the pick reply, the invitation, a voice note. Voice waits for the ElevenLabs key.
- W2 with Meta: there is no template yet.
- Item 4 shots used a combined search answer (see item 4).

## Findings
1. **Privacy policy still has 36 em dashes.** It was left out of migration 106 on purpose: it is a legal text, and item 8 sends it to a lawyer anyway (its section 9 says "ולכן אין באנר הסכמה"). Fix the dashes in the same legal pass.
2. **Fixed 17.11 (`a5942e8`).** The green "הצג פרטים" (`.results-cta`) was emerald-600 with white text, 3.77:1. It is now emerald-700 (#047857), measured in the browser at 5.48:1, with emerald-800 on hover (7.68:1); the "נחשף" text after a reveal uses the same emerald-700. Shots: `fix2-390-reveal-button.jpg`, `fix2-1280-reveal-button.jpg`. About ten other buttons and badges still use white on emerald-600 (the `success` variant in `components/ui/button.tsx`, the "how it works" registration button, several admin approve buttons); they were not part of this fix.
3. **Contractor dashboard copy disagrees with itself.**
   - Fixed 17.11 (`73f953b`): the verification card said "עד 24 שעות עסקיות" under a banner that says 48. You chose 48; the card now reads "בדרך כלל עד 48 שעות". Shots: `fix1-390-dashboard-48h.jpg`, `fix1-1280-dashboard-48h.jpg`.
   - Still open: the card addresses the reader in the feminine ("תוכלי").
   - "חיפוש בחופש" reads like a typo.
   - All of this predates R38 and was left for you to decide.
4. **"החשיפות שלי" at 390** is a table that scrolls sideways inside its frame, so the contact column is off-screen until scrolled. This predates R38; a card layout on phones would fix it.
5. **The cookie notice covers about 135px at the bottom of a phone screen until dismissed**, including form fields such as "קהל יעד". It shows once by design.
6. **Audience rules to confirm:**
   - an admin acting as an entity still sees every audience;
   - a service provider sees "both" listings only.
   - The generic-word list in `search_normalize.py` (`_MARKETPLACE_GENERIC_WORDS`) is my judgement; please look at it.
7. **W1 decisions to confirm:**
   1. the card's location (billing pages and admin users, not the team page);
   2. a user with no active membership, such as admin only, counts as not registered;
   3. no automatic default when a second membership appears;
   4. the new line for a contractor in review, and no line for a rejected or suspended one;
   5. the reply "כרגע אני מבין רק הודעות טקסט" is now wrong, since voice works, and should be reworded;
   6. every audio message is transcribed, forwarded audio included;
   7. the screen cannot clear a default (the API can).
8. **W2 decisions to confirm:**
   - The explicit choice on the login screen replaced the old `whatsapp_opt_in` flag as the trigger. The column stays.
   - The registration checkbox "קבל קודי אימות והתראות בWhatsApp במקום SMS" now overpromises.
   - A number that is not on WhatsApp gets no instant fallback: Meta accepts the send and reports the failure later. "שלח שוב ב: SMS" is the safety net. A real fix would send the SMS on a failed status in `whatsappWebhook.js`.
   - Meta writes the template's body text.
9. **6a:** reveal rows have no source column, so where a reveal came from can never be shown. Worth adding if quota disputes matter.
10. **Agent worktrees start from `main` (569b0fb, June), 504 commits behind `pivot/v2`**, without `docs/cc-prompts`. All three agents noticed and fast-forwarded. This is backlog item B1 again.
11. **Files left as found:** `docs/cc-prompts/cc_prompt_whatsapp_meta_W1.md` has an uncommitted addition (a Meta test ladder dated 16/08), and `docs/cc-prompts/cc_prompt_R39_fixes_16_11_b.md` is untracked. Neither was part of this round, so I did not commit them.
12. **Leftover folders in local containers** (a safety check blocks `rm -rf` there):
    - auth: `/tmp/r38w2_1794844167`;
    - notification: `/tmp/r38w_n1` to `/tmp/r38w_n7`;
    - user-org: `/tmp/r38w_uo1`, `/tmp/r38w_uo2`;
    - mysql: `/tmp/r38w110a`.
    - They go when the containers are recreated.

## `git diff -w --stat pre-r38..HEAD`

```
 db/migrations/106_r38_no_em_dash_in_content.sql                       | 170 ++++++++++++++++++++
 db/migrations/107_r38_listing_audience.sql                            |  47 ++++++
 db/migrations/110_r38_default_entity.sql                              |  59 +++++++
 docs/COOKIES.md                                                       |  47 ++++++
 docs/cc-prompts/cc_prompt_R38_fixes_16_11.md                          | 145 +++++++++++++++++
 scripts/em-dash-scan.mjs                                              | 119 ++++++++++++++
 scripts/em_dash_scan.py                                               | 132 ++++++++++++++++
 scripts/seed_marketplace.py                                           |  33 +++-
 scripts/test_em_dash_scan.py                                          |  42 +++++
 services/admin/app/routes/users.py                                    |   4 +-
 services/auth/src/routes/auth.js                                      |  53 +++----
 services/auth/test/send-otp-channel.test.js                           | 169 ++++++++++++++++++++
 services/frontend/src/app/admin/ads/page.tsx                          |   4 +-
 services/frontend/src/app/admin/approvals/page.tsx                    |  10 +-
 services/frontend/src/app/admin/gov-corps-registry/page.tsx           |  18 +--
 services/frontend/src/app/admin/layout.tsx                            |   2 +-
 services/frontend/src/app/admin/leads/page.tsx                        |   2 +-
 services/frontend/src/app/admin/legal/page.tsx                        |   4 +-
 services/frontend/src/app/admin/marketplace/page.tsx                  |   6 +-
 services/frontend/src/app/admin/notifications-test/page.tsx           |  16 +-
 services/frontend/src/app/admin/orgs/[id]/page.tsx                    |  28 ++--
 services/frontend/src/app/admin/orgs/page.tsx                         |  38 ++---
 services/frontend/src/app/admin/origins/page.tsx                      |   4 +-
 services/frontend/src/app/admin/registration-log/page.tsx             |   8 +-
 services/frontend/src/app/admin/sponsors/page.tsx                     |  26 +--
 services/frontend/src/app/admin/subscription-plans/page.tsx           |   2 +-
 services/frontend/src/app/admin/subscriptions/page.tsx                |  10 +-
 services/frontend/src/app/admin/support/page.tsx                      |   4 +-
 services/frontend/src/app/admin/tenders/page.tsx                      |  18 +--
 services/frontend/src/app/admin/users/page.tsx                        |  32 ++--
 services/frontend/src/app/billing/page.tsx                            |  31 +++-
 services/frontend/src/app/contact/page.tsx                            |   4 +-
 services/frontend/src/app/contractor/dashboard/page.tsx               |   6 +-
 services/frontend/src/app/contractor/documents/page.tsx               |   4 +-
 services/frontend/src/app/contractor/reveals/page.tsx                 |  13 +-
 services/frontend/src/app/contractor/tenders/[id]/page.tsx            |  16 +-
 services/frontend/src/app/contractor/tenders/page.tsx                 |   4 +-
 services/frontend/src/app/contractor/users/page.tsx                   |  42 ++---
 services/frontend/src/app/contractor/verify-kablan/page.tsx           |   6 +-
 services/frontend/src/app/corporation/ads/page.tsx                    |   6 +-
 services/frontend/src/app/corporation/marketplace/[id]/edit/page.tsx  |   2 +-
 services/frontend/src/app/corporation/marketplace/new/page.tsx        |   2 +-
 services/frontend/src/app/corporation/marketplace/page.tsx            |   8 +-
 services/frontend/src/app/corporation/reveals/page.tsx                |   2 +-
 services/frontend/src/app/corporation/tenders/[id]/page.tsx           |   2 +-
 services/frontend/src/app/corporation/tenders/page.tsx                |   4 +-
 services/frontend/src/app/corporation/users/page.tsx                  |  42 ++---
 services/frontend/src/app/corporation/workers/new/page.tsx            |   2 +-
 services/frontend/src/app/corporation/workers/page.tsx                |  18 +--
 services/frontend/src/app/how-it-works/page.tsx                       |  32 ++--
 services/frontend/src/app/invite/accept/[token]/page.tsx              |   6 +-
 services/frontend/src/app/layout.tsx                                  |   8 +-
 services/frontend/src/app/login/page.tsx                              |  96 ++++++++++--
 services/frontend/src/app/manifest.ts                                 |   2 +-
 services/frontend/src/app/membership-request/accept/[token]/page.tsx  |   2 +-
 services/frontend/src/app/page.tsx                                    | 138 +++++++++++-----
 services/frontend/src/app/provider/billing/page.tsx                   |   3 +
 services/frontend/src/app/provider/marketplace/new/page.tsx           |  68 +++++++-
 services/frontend/src/app/register/contractor/page.tsx                |  14 +-
 services/frontend/src/app/register/contractor/verify/page.tsx         |   6 +-
 services/frontend/src/app/register/corporation/page.tsx               |  16 +-
 services/frontend/src/app/register/provider/page.tsx                  |   2 +-
 services/frontend/src/components/admin/OrgSummaryHeader.tsx           |  20 +--
 services/frontend/src/components/ads/AdDetailDrawer.tsx               | 269 ++++++++++++++++++++++++++++++++
 services/frontend/src/components/contact/ContactActions.tsx           | 137 ++++++++++++++++
 services/frontend/src/components/contractor/FindStepsIndicator.tsx    |   2 +-
 services/frontend/src/components/contractor/KablanVerifyBanner.tsx    |  88 +++--------
 services/frontend/src/components/corporation/GovRegistrySection.tsx   |   4 +-
 services/frontend/src/components/landing/HeroSection.tsx              |   2 +-
 services/frontend/src/components/landing/LandingFooter.tsx            |   2 +-
 services/frontend/src/components/landing/LandingNav.tsx               |   2 +-
 services/frontend/src/components/landing/LeadCaptureModal.tsx         |   6 +-
 services/frontend/src/components/landing/LiveShowcase.tsx             |   4 +-
 services/frontend/src/components/landing/MarketplacePreview.tsx       |   8 +-
 services/frontend/src/components/landing/RegistrationCTASection.tsx   |   6 +-
 services/frontend/src/components/layout/RoleGuard.tsx                 |   2 +-
 services/frontend/src/components/marketplace/ListingDetailPanel.tsx   |  15 +-
 services/frontend/src/components/privacy/CookieNotice.tsx             |  69 ++++++++
 services/frontend/src/components/search/ResultTypeFilter.tsx          | 163 +++++++++++++++++--
 services/frontend/src/components/shared/WhatsAppEntityCard.tsx        | 158 +++++++++++++++++++
 services/frontend/src/components/team/EditMemberModal.tsx             |  10 +-
 services/frontend/src/components/tenders/TenderForm.tsx               |   2 +-
 services/frontend/src/features/ads/HousingAdForm.tsx                  |   2 +-
 services/frontend/src/features/ads/WorkerAdForm.tsx                   |   2 +-
 services/frontend/src/features/advertising/AdCarousel.tsx             |   2 +-
 services/frontend/src/features/advertising/MarketplaceSponsors.tsx    |   2 +-
 services/frontend/src/features/advertising/RevealModal.tsx            |   2 +-
 services/frontend/src/features/corporation/PublishFirstAdBanner.tsx   |   2 +-
 services/frontend/src/features/live-activity/mocks.ts                 |  42 ++---
 services/frontend/src/features/subscription/SeatGrantModal.tsx        |   4 +-
 services/frontend/src/features/subscription/SeatUpgradeModal.tsx      |   2 +-
 .../frontend/src/features/workers/components/ExcelUploadSection.tsx   |   2 +-
 services/frontend/src/i18n/he.ts                                      |   2 +-
 services/frontend/src/lib/adEvents.ts                                 |   9 +-
 services/frontend/src/lib/api/auth.ts                                 |  12 +-
 services/frontend/src/lib/api/client.ts                               |   4 +-
 services/frontend/src/lib/api/errors.ts                               |  14 +-
 services/frontend/src/lib/api/index.ts                                |   2 +-
 services/frontend/src/lib/api/marketplace.ts                          |   5 +
 services/frontend/src/lib/api/whatsappEntity.ts                       |  38 +++++
 services/frontend/src/lib/email.ts                                    |   2 +-
 services/frontend/src/lib/labels.ts                                   |   2 +-
 services/frontend/src/types/index.ts                                  |   2 +
 services/frontend/tests/no-em-dash.test.mjs                           |  58 +++++++
 services/gateway/src/auth.js                                          |   2 +-
 services/notification/src/consumers/handlers.js                       |  40 ++---
 services/notification/src/cron/adExpiringReminder.js                  |   2 +-
 services/notification/src/cron/graceReminder.js                       |  10 +-
 services/notification/src/cron/subscriptionRenewal.js                 |   2 +-
 services/notification/src/cron/trialEndingReminder.js                 |   2 +-
 services/notification/src/mailer/sendgrid.js                          |   2 +-
 services/notification/src/messaging/index.js                          |   3 +
 services/notification/src/messaging/metaWhatsapp.js                   | 100 ++++++++++--
 services/notification/src/routes/notifications.js                     |  43 ++---
 services/notification/src/sms/vonage.js                               |   2 +-
 services/notification/src/sms/vonageWebhookAuth.js                    |   6 +-
 services/notification/src/testCatalog.js                              |  48 +++---
 services/notification/src/whatsapp/composeReply.js                    |  40 ++++-
 services/notification/src/whatsapp/handleInbound.js                   | 104 +++++++++---
 services/notification/src/whatsapp/transcribe.js                      |  44 ++++++
 services/notification/test/helpers.js                                 |  42 ++++-
 services/notification/test/messaging-dispatch.test.js                 | 104 +++++++++---
 services/notification/test/whatsapp-compose.test.js                   |  66 ++++++--
 services/notification/test/whatsapp-inbound.test.js                   | 169 +++++++++++++++++---
 services/notification/test/whatsapp-webhook.test.js                   |   3 +
 services/payment/app/routes/subscriptions.py                          |   2 +-
 services/user-org/app/routes/contractors.py                           |   2 +-
 services/user-org/app/routes/corporations.py                          |   2 +-
 services/user-org/app/routes/events.py                                |  42 ++++-
 services/user-org/app/routes/marketplace.py                           |  52 +++++-
 services/user-org/app/routes/search.py                                |  18 ++-
 services/user-org/app/routes/test_events.py                           |  59 ++++++-
 services/user-org/app/routes/test_plan_management.py                  |   2 +-
 services/user-org/app/routes/test_provider_plans.py                   |   4 +-
 services/user-org/app/routes/test_whatsapp_entity.py                  | 220 ++++++++++++++++++++++++++
 services/user-org/app/routes/users.py                                 |  87 ++++++++++-
 services/user-org/app/services/search_normalize.py                    | 118 +++++++++++---
 services/user-org/app/services/test_listing_attributes.py             |  14 +-
 services/user-org/app/services/test_listing_audience.py               | 146 +++++++++++++++++
 services/user-org/app/services/visibility.py                          |  47 +++++-
 services/user-org/app/services/whatsapp_entity.py                     | 109 +++++++++++++
 141 files changed, 4046 insertions(+), 752 deletions(-)
```

(This report and `docs/cc-prompts/r38_shots/` are added in the commit after this stat.)

## Manual actions

הפעולות שנשארו לך, לפי סדר החשיבות. שמות כפתורים ומסכים כתובים כפי שהם מופיעים על המסך.

1. **לבחור עיצוב לשוניות (פריט 4).** להתחבר ל-staging כקבלן ולפתוח שלושה קישורים:
   - `https://staging.tagidai.com/?q=דיור לעובדים במרכז&tabs=a`
   - אותו קישור עם `tabs=b`
   - אותו קישור עם `tabs=c`
   - לבדוק גם בטלפון. ההבדלים: A מקצר את השמות בטלפון; B יורד לשורה שנייה; C נשאר בשורה אחת, נגלל הצידה ונדבק למעלה.
   - לכתוב לי איזה מהם. אחרי הבחירה אשאיר רק אותו ואסיר את הדגל.
2. **להחליט על שורות החשיפה (פריט 6a).** בחשבון הקבלן "בוני הנגב בע"מ" יש 5 חשיפות בנובמבר, ושתיים מהן על אותה מודעה בהפרש של שתי דקות. כנראה שהקליק על הכרטיס הוא שגרם להן. לכתוב לי אם למחוק את הכפולה (או את כולן), או להשאיר.
3. **לבחור חשבון לוואטסאפ.** ב-staging: "חשבון ומנוי" ← "היישות לוואטסאפ" ← לבחור חשבון. עד שתבחר, כל הודעה מהמספר שלך תקבל תשובה עם הקישור לבחירה, בלי חיפוש.
4. **להגדיר את מפתח ElevenLabs ב-staging (הודעות קוליות).**
   - Railway ← הפרויקט BuildUp ← הסביבה staging ← השירות notification ← Variables ← New Variable.
   - שם: `ELEVENLABS_API_KEY`. ערך: אותו מפתח שמוגדר היום בשירות gateway (אפשר להעתיק משם).
   - לשמור ולחכות ל-redeploy. אחר כך לשלוח הודעה קולית קצרה למספר העסקי ולבדוק שמגיעות תוצאות.
5. **ליצור תבנית אימות בוואטסאפ (קוד כניסה).**
   - WhatsApp Manager ← Message templates ← Create template.
   - Category: Authentication. שם: `tagidai_otp`. Language: Hebrew.
   - Code delivery: Copy code. אפשר להפעיל את המלצת האבטחה, ולקבוע תוקף של 10 דקות.
   - לשלוח לאישור. אחרי האישור: Railway ← staging ← notification ← Variables ← `WHATSAPP_OTP_TEMPLATE_NAME` = `tagidai_otp`.
6. **טוקן קבוע לוואטסאפ.** הטוקן שהוגדר הוא הזמני ממסך API Setup ויפוג בערך 24 שעות אחרי שהוגדר (16.11 אחר הצהריים). צריך System User token קבוע; הניסיון הקודם נתקע כי קוד ה-SMS של Meta לא הגיע. עד אז, כשהטוקן יפוג, צריך להחליף אותו שוב ב-`WHATSAPP_ACCESS_TOKEN` בשירות notification.
7. **עורך דין פרטיות.** להעביר לבדיקה:
   - את הודעת העוגיות;
   - את סעיף 9 במדיניות הפרטיות ("ולכן אין באנר הסכמה");
   - את 36 הקווים הארוכים שעוד נשארו במדיניות. הם יתוקנו באותו סבב.
8. **לאשר החלטות** (פירוט בסעיפים 6 עד 8 ב-Findings):
   - כללי קהל היעד;
   - רשימת המילים הכלליות בחיפוש;
   - שבע ההחלטות של וואטסאפ W1;
   - הבחירה במסך הכניסה במקום הדגל `whatsapp_opt_in`;
   - ניסוח תיבת הסימון בהרשמה;
   - ניסוח התשובה "כרגע אני מבין רק הודעות טקסט".
9. **מ-R37, עדיין פתוח:** ערכי מסוף הבדיקות של Cardcom ב-staging, ואחריהם `PAYMENT_FAKE_MODE=0`.
