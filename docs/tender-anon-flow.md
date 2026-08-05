# Tender anonymity → contact-reveal flow

**One-liner:** In a foreign-worker import request, both sides stay
anonymous to each other until the admin approves a specific bid. At
that moment the contractor sees the corp's identity and the corp
gets an SMS with the contractor's number.

## Life of a tender

| Step | Who acts | What contractor sees | What corp sees |
|------|----------|----------------------|----------------|
| 1. Publish | Contractor | Their tender ref, all fields | Nothing yet |
| 2. Broadcast | Cron | Tender live on `/contractor/tenders/[id]` | Row appears in `/corporation/tenders` inbox — **contractor is anonymous** (label "קבלן #123" derived from `contractor_anon` counter) |
| 3. Bid | Corp | Bid appears on the tender, labelled with anon corp label (`corp_anon` — "תאגיד ב") | Their bid in own dashboard |
| 4. Select | Contractor | Marks winning bids per line — status → `awaiting_admin` | Bid status changes to "ממתין למנהל" |
| 5. Admin approve | Admin (`/admin/tenders`) | Both parties get SMS with the other side's contact info | Same |

## Contractor's view of the corp

Before admin approval: **corp is opaque** — only the anon label
("תאגיד ב"), the bid financials, and the arrival date. No name, no
phone, no email.

After admin approval + reveal: full corp identity — name, phone,
email — inline on the tender row.

## Corp's view of the contractor

Before admin approval: **contractor is opaque** — only the tender ref
number ("קבלן #123") and the line-item requirements. No name,
company, phone, email.

After admin approval: SMS to the corp's registered contact_phone
with the contractor's name + phone. Format:

> TagidAI — הבקשה מס' 123 אושרה. הפרטים: [שם קבלן], [טלפון].
> יש ליצור קשר תוך 48 שעות.

## Why the double-approval

The contractor picks a winning bid → **admin verifies the bid is
legitimate and the corp is licensed** → THEN identities are exposed.
This prevents corps from harvesting contractor phone numbers by
submitting spam bids that don't get selected, and gives the admin a
last-look at reveals that will move real money off-platform.

## Frontend surfaces that render this

- `services/frontend/src/app/contractor/tenders/[id]/page.tsx` — the
  pipeline strip (Wave 3 C3) shows the current step; the "אישור
  מנהל וחשיפה" step is where anonymity breaks
- `services/frontend/src/app/corporation/tenders/[id]/page.tsx` —
  bid submission page, keeps contractor anonymised
- `services/frontend/src/app/admin/tenders/page.tsx` — where the
  admin can view bid + approve → triggers `tender.bid_approved` event
  → notification service fans SMS to both parties

## Backend

- `services/deal/app/routes/tenders.py` — the anonymity is computed
  server-side; API responses omit sensitive fields until reveal
- `services/notification/src/consumers/handlers.js` — `tender.bid_approved`
  handler sends the reveal SMS to both parties

## Related

- Global auto-approve gate for tier_2 kablan-verified contractors:
  see [[project-pivot-v2-decisions]] (T1). Auto-approve applies to
  the tender's publish state ONLY — bid approval (the reveal moment)
  is always manual.
