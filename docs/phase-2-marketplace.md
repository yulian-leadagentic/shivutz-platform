# Phase 2 — Public Classifieds Marketplace (Yad2-style)

**Status**: Design · **Author**: initial draft · **Target**: start after Phase 1 (J5 payment flow) is verified in simulation.

---

## 1. Vision

A second product inside the Shivutz platform: a **consumer-facing classifieds marketplace** where any user can browse listings without signing in, and any registered business / individual can purchase a publishing package to list their services or products. Think Yad2 / OLX in style: category-driven, location-aware, messaging-enabled, paid posting.

This is **separate** from the existing B2B "Housing / Equipment / Services" marketplace that runs inside the worker-placement flow (`/marketplace`). That one serves corporations with surplus capacity inside a deal context. The phase-2 marketplace is **public**, **paid**, and addresses **any** category the admin enables.

## 2. Personas

| Persona | Actions | Auth |
|---|---|---|
| **Browser** (any visitor) | Search / filter / view listings, click-to-call, send a message | None for browse; phone+OTP to message |
| **Advertiser** | Register as business (עוסק מורשה / תאגיד / חברה) or private individual, buy a package, publish ads, manage ads, reply to inquiries | Phone+OTP; business registration flow |
| **Admin** | Manage categories, set category pricing, moderate listings, issue refunds, view analytics | Existing admin auth |

## 3. Key design decisions to confirm before building

1. **Is the same Shivutz account reused, or is this a separate user pool?**
   - Recommended: **extend existing `users` table** with a `roles` set (already exists) and add a new `role='advertiser'`. Auth reuses phone+OTP. A single person can be contractor-of-corp-X and an advertiser simultaneously.
2. **Categories — who defines them?**
   - Admin-managed. Each category has: `name_he`, `slug`, `price_per_day_nis`, `min_days`, `max_images`, optional parent for hierarchy.
3. **Pricing formula**:
   - `total = items × days × category.price_per_day_nis`
   - Admin can override per-listing (e.g. promo).
4. **Payment flow**:
   - **Immediate charge** (not J5). This is a retail purchase — no 48h grace period. Cardcom LowProfile with `DealType=1`, receipt issued on success, listing goes live.
   - Auto-renewal: if opted in, store the Cardcom token; scheduler charges at renewal time.
5. **Search access**: fully public — no auth required to browse, search, filter. Lightweight phone-OTP only when a visitor wants to **message** a seller (prevents spam).
6. **Listing fields** — mirror Yad2:
   - title, description, price (optional), city/area, images (up to `category.max_images`), contact phone (shown on-click), contact name, optional extra fields by category (e.g. year for cars, size for real estate).
7. **Moderation**:
   - Auto-publish after payment clears; admin can soft-remove (hide) any listing with a reason.
   - Optional pre-publish review for high-risk categories (admin setting per category).
8. **Messaging**:
   - Reuse the deal-messaging pattern (RabbitMQ + polling). Scoped per listing.
   - Seller sees inquiries in their management screen; buyers see their own outgoing thread.

## 4. Information architecture

```
/                                   existing public landing (extend with a "Marketplace" CTA)
/classifieds/                       browse home: popular categories, top cities, featured
/classifieds/c/:category             category listing page with filters (city, price range, keyword)
/classifieds/l/:listingId            single listing detail (images, description, contact, message button)
/classifieds/search?q=…              keyword search across all categories
/classifieds/publish                 (auth required) 1-page publish wizard
/classifieds/my/listings             (auth required) my listings
/classifieds/my/listings/:id/edit    (auth required) edit listing
/classifieds/my/messages             (auth required) inbox threads per listing
/classifieds/my/billing              (auth required) purchases + auto-renewal settings

/admin/classifieds/categories        admin: category + pricing management
/admin/classifieds/listings          admin: moderation queue, search all listings
/admin/classifieds/analytics         admin: impressions, clicks, revenue per category
```

## 5. Backend domain model

### New service: `classifieds-service` (Python/FastAPI, pattern matches existing services)

Tables in a new `classifieds_db`:

```sql
categories (
  id UUID PK,
  parent_id UUID NULL,               -- hierarchy
  slug VARCHAR(80) UNIQUE,
  name_he VARCHAR(120),
  icon_slug VARCHAR(40),
  price_per_day_nis DECIMAL(8,2),
  min_days SMALLINT DEFAULT 7,
  max_days SMALLINT DEFAULT 90,
  max_images SMALLINT DEFAULT 6,
  requires_moderation BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order SMALLINT,
  created_at, updated_at
)

listings (
  id UUID PK,
  category_id UUID FK → categories.id,
  advertiser_user_id UUID,           -- FK into auth_db.users (cross-schema by id)
  advertiser_business_type ENUM('individual','osek_murshe','corporation','company') NULL,
  advertiser_business_number VARCHAR(20) NULL,
  title VARCHAR(200),
  description TEXT,
  price_nis DECIMAL(10,2) NULL,
  city VARCHAR(80),
  region VARCHAR(40),                -- reuses existing regions enum
  contact_phone VARCHAR(20),
  contact_name VARCHAR(120),
  extra_fields JSON NULL,            -- per-category schema
  status ENUM('pending','active','paused','expired','removed'),
  auto_renew BOOLEAN DEFAULT FALSE,
  auto_renew_token_ref UUID NULL,    -- FK → payment_db.payment_methods
  published_at DATETIME,
  expires_at DATETIME,
  last_boosted_at DATETIME NULL,
  view_count INT DEFAULT 0,
  contact_click_count INT DEFAULT 0,
  created_at, updated_at
)

listing_images (
  id UUID PK,
  listing_id UUID FK → listings.id,
  url TEXT,
  sort_order SMALLINT,
  width SMALLINT, height SMALLINT,
  created_at
)

listing_purchases (
  id UUID PK,
  listing_id UUID FK,
  advertiser_user_id UUID,
  quantity INT DEFAULT 1,                  -- items × count
  days INT,
  unit_price_nis DECIMAL(8,2),
  total_amount_nis DECIMAL(10,2),
  vat_amount_nis DECIMAL(10,2),
  payment_transaction_id UUID,             -- FK → payment_db.payment_transactions
  status ENUM('pending','paid','refunded','failed'),
  auto_renew BOOLEAN DEFAULT FALSE,
  created_at, paid_at, refunded_at
)

listing_messages (
  id UUID PK,
  listing_id UUID FK,
  buyer_user_id UUID,                      -- phone-OTP user
  sender_role ENUM('buyer','advertiser'),
  content TEXT,
  created_at
)
```

Index highlights: `listings(status, expires_at)` for public browse; `listings(advertiser_user_id)` for "my listings"; `listing_messages(listing_id, created_at)` for threads.

### Reused services

- **auth-service** — extend users with a `roles` JSON array or a `user_roles` join table; add `'advertiser'` and `'consumer'` values.
- **payment-service** — reuse Cardcom SDK; add a new endpoint `POST /payments/classifieds/purchase` that does an **immediate J4 charge** and returns a transaction id for the purchase record.
- **notification-service** — add new events: `classifieds.listing.published`, `classifieds.message.received`, `classifieds.renewal.charged`, `classifieds.renewal.failed`.

## 6. Public API surface (summary)

```
# Public (no auth)
GET  /api/classifieds/categories                     → [{id, slug, name_he, icon, priceDescription}]
GET  /api/classifieds/listings?category=…&city=…&q=… → paginated envelope
GET  /api/classifieds/listings/{id}                  → full detail

# Advertiser (auth required)
POST /api/classifieds/listings                       → create draft listing (status=pending)
POST /api/classifieds/listings/{id}/purchase         → quote + payment, flips status=active on success
PATCH /api/classifieds/listings/{id}                 → edit
DELETE /api/classifieds/listings/{id}                → soft delete
POST /api/classifieds/listings/{id}/images           → upload (multipart)
GET  /api/classifieds/my/listings                    → my listings
GET  /api/classifieds/my/billing                     → purchases + auto-renewal

# Messaging (auth required; buyer goes through phone-OTP first)
POST /api/classifieds/listings/{id}/messages         → send message
GET  /api/classifieds/my/threads                     → list of threads
GET  /api/classifieds/my/threads/{listingId}         → messages in thread

# Admin
GET/POST/PATCH/DELETE /api/admin/classifieds/categories
PATCH /api/admin/classifieds/listings/{id}           → moderate (hide / restore / force-expire)
GET  /api/admin/classifieds/analytics                → revenue, impressions, clicks
```

All list endpoints adopt the `{items, page, page_size, total}` envelope (M6 standard). Error responses use the unified `{error: {code, message, details?}}` shape (M7 standard).

## 7. Publisher purchase flow (single-page wizard)

The user requested a **fast** path. Here's the proposed 4-step UI that collapses into a single scrollable screen when the viewport allows:

```
Step 1 — Category
  Grid of active categories (same layout as Yad2 tile grid). One click selects.

Step 2 — Business identification (auto-detect where possible)
  Segmented control: [אני פרטי] [עוסק מורשה] [תאגיד / חברה]
    Private       → no extra fields.
    Osek murshe   → business number field + live lookup against our corp/contractor tables and/or a public registry later.
    Corp/Company  → same + display company name.
  We pre-fill from existing profile if the user is already registered as a contractor/corporation.

Step 3 — Listing details
  Title, description, city (with autocomplete from regions), price (optional),
  contact name + phone (pre-filled from OTP), images (drag & drop, max = category.max_images).

Step 4 — Package + payment
  Quantity (if advertising more than one similar item) × days (slider preset to category.min_days).
  Live price preview: `X × Y × ₪Z = Total`.
  Checkbox: "חידוש אוטומטי בתום החבילה — חיוב בכרטיס המחובר".
  [Pay & Publish] → Cardcom LowProfile (immediate charge) → return → listing goes live.
```

Flow-time estimate for a warm user: ~60 seconds from landing on `/classifieds/publish` to the listing being live.

## 8. Payment details

- **Purchase**: immediate charge via Cardcom `DealType=1`. Amount shown on Cardcom's page.
- **Auto-renewal**: on successful purchase, if the checkbox was ticked, also store the Cardcom token (`CreateToken=True` in the LowProfile payload). The renewal scheduler charges the stored token N hours before `expires_at` using the same `grace_period_hours` infrastructure but inverted (pre-charge, not post-authorize).
- **Refunds**: admin can issue full/partial via the existing `refund_transaction` function. Refund → listing status=removed.
- **Failed renewal**: `listing.status=expired`, push notification to the advertiser, retry schedule identical to Pattern B (`retry_delays_hours = [24, 48, 72]`).

## 9. Admin surface

Extends the existing admin shell:

- `/admin/classifieds/categories` — CRUD. Each row: icon, name_he, price, min/max days, max images, active toggle, reorder. Inline edit.
- `/admin/classifieds/listings` — paginated table with status filter, category filter, text search. Row actions: hide / restore / force-expire / refund. Click row → detail drawer with images, purchase history, messages preview.
- `/admin/classifieds/analytics` — KPI cards (total revenue, MRR, listings active, listings created this week), category revenue breakdown, top cities, daily revenue chart.
- **Simulation panel extension**: reuse the phase-1 admin simulation. Add "expire listing now", "force renewal charge to fail", etc. — for QA.

## 10. Phased delivery

| Phase | Scope | Why split |
|---|---|---|
| **2.0 — Foundations** | classifieds-service skeleton, `categories` CRUD + admin UI, public GET endpoints serving empty data | lets us ship deployable infra without any listings |
| **2.1 — Create flow** | Publish wizard UI, listing CRUD (status=pending), image upload, purchase endpoint using existing Cardcom SDK | first usable iteration — real listings |
| **2.2 — Browse flow** | Public browse / category / detail pages, filtering, pagination, popular-searches widget | consumer-facing; mostly SSR for SEO |
| **2.3 — Messaging** | Buyer phone-OTP (reuse), thread UI, notification hooks | delays — not critical for MVP revenue |
| **2.4 — Auto-renewal** | Token save at purchase, renewal scheduler, retry + failure notifications | depends on 2.1 being stable |
| **2.5 — Moderation + analytics** | Admin listings table, KPIs, hide/restore | grows naturally once there's real volume |

Estimated engineering effort (single dev, assuming phase 1 context carries over): 2.0 ≈ 3 days, 2.1 ≈ 5 days, 2.2 ≈ 4 days, 2.3 ≈ 3 days, 2.4 ≈ 2 days, 2.5 ≈ 3 days. Total ~20 dev-days, realistically ~4 calendar weeks with review/QA.

## 11. Open questions

1. Is image hosting in our S3-equivalent, or Cloudinary / BunnyCDN? Phase 1 has no image storage yet — this is net-new infrastructure.
2. Is the existing regions enum enough for the `city` field, or do we need a proper Israeli-cities list (all 1000+ cities/towns)?
3. Auto-extend-package vs. force expire at `expires_at`? If auto-renewal is off and the user didn't pay before expiry, the listing goes into `expired`. Do we hide it immediately or show "תוקף פג" for N days so buyers can still find the advertiser to re-up?
4. Does the "private individual" (non-business) path require any compliance (ID scan, etc.) or is phone verification enough?
5. Do we want "promoted / boosted" listings as a paid upsell from day one, or phase 2.6 later?
6. Hebrew / English / Arabic UI — do we need i18n beyond Hebrew for browse?

## 12. Pre-build gates

Before any code lands, I want explicit product sign-off on:
- [ ] Section 3 decisions (especially: reuse existing `users`, role `advertiser`, immediate-charge payment)
- [ ] Initial category list (can start with 5–10 and admin grows it)
- [ ] Image storage choice (open question 1)
- [ ] Minimum viable scope = which of phases 2.0–2.5 ship in the first release
