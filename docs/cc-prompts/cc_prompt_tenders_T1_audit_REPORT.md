# R7 · Tenders T1 audit — closed

Executed 2026-09-18. Audit + hardening pass per
`cc_prompt_tenders_T1_audit.md`. No new features (per the guardrail);
the six T2–T5 gaps at the bottom are enumerated only, not built.

## Per-stage map

| # | Stage | Frontend | Backend (`services/deal/app/routes/tenders.py`) | Status |
|---|---|---|---|---|
| 1 | Create tender | [new/page.tsx:15](services/frontend/src/app/contractor/tenders/new/page.tsx) → [TenderForm.tsx:17-95](services/frontend/src/components/tenders/TenderForm.tsx) | `POST /tenders` (`create_tender` L219) | **DONE** — per-line: `profession_type`, `origin_country`, `quantity`, `min_experience`; header: `title`, `target_start_date`, `notes`. Lands `pending_admin` unless caller is `tier_2` + kablan-verified → auto `open` (mig 063), fires `tender.published` else `tender.pending_admin`. |
| 2 | Publish gate | [admin/tenders:500-512](services/frontend/src/app/admin/tenders/page.tsx) | `POST /tenders/{id}/admin/publish` (`admin_publish` L995) | **DONE** — SQL flips `status='open'`, fires `tender.published`. Reject via `admin_reject` L1040 with `rejection_reason`. |
| 3 | Bid submission | [corp inbox](services/frontend/src/app/corporation/tenders/page.tsx) + [detail](services/frontend/src/app/corporation/tenders/[id]/page.tsx:103-151) | `GET /tenders/open` L322, `GET /tenders/my-bids` L359, `POST /tenders/{id}/bids` (`submit_bid` L455) | **DONE** — per-line bid items (mig 030): `tender_item_id`, `quantity_offered`, `hourly_rate` (aliased `unit_price`), housing yes/no + notes (mig 035). Contractor stays masked (`contractor_anon:"קבלן"`). Per-corp anon ref via `_corp_ref_no` L137 → "בקשה מספר N". Bid lands `pending_admin` (mig 032), hidden from contractor until `admin_approve_bid` L570. |
| 4 | Winner select (per-line) | [contractor detail:145-154, 214-226, 386-471](services/frontend/src/app/contractor/tenders/[id]/page.tsx) | `POST /tenders/{id}/select` (`select_lines` L651) | **DONE** — line-level `selected=1`, moves tender → `awaiting_admin`, fires `tender.contact_requested`. Corps stay masked as `תאגיד N` via `_anon_label_map` L173. |
| 5 | Reveal / contact exchange | Admin banner + button [admin/tenders:515-528](services/frontend/src/app/admin/tenders/page.tsx); contact panels on both party detail pages | `POST /tenders/{id}/admin/approve` (`admin_approve` L1075) | **DONE** — sets `revealed_at`, `status='in_progress'`, `bids.confirmed`, fires `tender.revealed`. SMS via [notifyTenderRevealed](services/notification/src/consumers/handlers.js:663-685) — Hebrew SMS to contractor + each winning corp with deep link. Templates in `testCatalog.js:395-427`. |
| 6 | DB schema | — | — | **DONE** — see below. |

### Tables (deal_db)

- **`foreign_tenders`** (029/030/031/063). Statuses: `pending_admin`, `open`, `awaiting_admin`, `in_progress`, `closed`, `cancelled`, `frozen`, `rejected`.
- **`foreign_tender_items`** (029/030): id, tender_id, profession_type, origin_country, quantity, min_experience, notes.
- **`foreign_bids`** (029/030/032/035). Statuses: `pending_admin`, `submitted`, `selected`, `confirmed`, `rejected`, `withdrawn`. Fields: total_price (legacy), currency, delivery_estimate_days (legacy), arrival_date, notes, includes_housing, housing_notes, admin approval columns.
- **`foreign_bid_items`** (029/030): tender_item_id, profession_type, quantity_offered, unit_price (aliased `hourly_rate`), selected.
- **`foreign_tender_corp_ref`** (031): per-corp anon ref numbering, unique `(tender_id, corporation_id)`.

## Hardening applied (this pass)

Three tender list pages had `catch(() => setError(true))` — a boolean flag that swallowed the actual error and rendered a generic red "לא ניתן לטעון את הבקשות" with no detail, no retry. Same pattern replaced on all three with:

- `error: string | null` holding the mapped Hebrew message.
- Extracted `load()` callback + retry button.
- Error box renders the mapped message + "נסה שוב".
- Empty state (fresh account) untouched — those already existed and were correct.

| Page | Change |
|---|---|
| [contractor/tenders/page.tsx](services/frontend/src/app/contractor/tenders/page.tsx) | `error` typed; retry wired; error banner now shows real reason. |
| [corporation/tenders/page.tsx](services/frontend/src/app/corporation/tenders/page.tsx) | Same treatment; imports `mapApiError` + `Button`. |
| [admin/tenders/page.tsx](services/frontend/src/app/admin/tenders/page.tsx) | Same treatment; uses inline `<button>` (page already imports its own primitives). |

Backend error strings on `services/deal/app/routes/tenders.py` are already Hebrew-mappable — every `HTTPException` uses `snake_case` codes registered in `services/frontend/src/lib/api/errors.ts:167-183`. No backend change needed.

Detail pages ([contractor/tenders/[id]/page.tsx:183-187](services/frontend/src/app/contractor/tenders/[id]/page.tsx) + [corporation/tenders/[id]/page.tsx:154-158](services/frontend/src/app/corporation/tenders/[id]/page.tsx)) already route through `mapApiError` — untouched.

## Gaps (T2–T5 — enumerated, NOT built)

1. **Admin SLA notifications missing.** `tender.pending_admin`, `tender.contact_requested`, and `tender.bid_pending_admin` events are published but have **no consumer** in `services/notification/src/consumers/handlers.js` (only `tender.published`, `tender.bid_submitted`, `tender.revealed` are wired via `consumers/index.js:46-48`). An admin is not paged when a tender awaits publish, a bid awaits approval, or a contact-request awaits reveal. **Blocking for launch SLA.**
2. **Contractor can edit tender while a `pending_admin` bid exists.** `tenders.py:809-814` `has_responses_cannot_edit` counts only `submitted/selected/confirmed`. An invisible `pending_admin` bid still references the items being replaced → stale `bid_item.tender_item_id`. **Data-integrity gap.**
3. **`admin_approve` silently rejects `pending_admin` bids** (`tenders.py:1108`) with no SMS. Corps whose bids never made it get no notification.
4. **`submit_bid` validation** at `tenders.py:473` returns `{"code":"missing_hourly_rate","professions":[…]}` — FE mapping picks up the code but drops the profession list. Corp page re-validates client-side, so display is fine; flag only if backend copy needs the list.
5. **Rejected-bid grouping in corp inbox** buckets admin-rejected under "לא נבחרה" (`corp/tenders/page.tsx:20`) — misleading. Consider splitting to "נדחתה על ידי מנהל" vs "לא נבחרה".
6. **Dead code**: `admin_close` endpoint (`tenders.py:1136`) has no UI. `region` col (029) + `delivery_estimate_days`, `total_price` (030) are legacy columns never written/read.

## Surprises

- `auto_published` is `TINYINT` in DB, typed `boolean` on the FE — `_ser()` doesn't cast, FE receives `0`/`1`. Falsy check works, flag if strict.
- `_should_auto_publish` swallows all exceptions and defaults to manual. Fail-safe, but the same DB blip that lets a legitimate tier_2 slip through to `pending_admin` would look identical to "not tier_2". Documented in-source.
- No FK on `foreign_bid_items.tender_item_id` → cascade only works via the tender → items → bids chain. Combined with gap #2 above, that's the data-integrity issue worth watching.
- Reveal SMS is fired via `tender.revealed` even for admin-force-approve where no bid was selected (409 blocks this today, so not exercised, but worth noting).

## Guardrail check

- No new features. Only `error` handling changed; the empty-state, loading state, and all business logic untouched.
- No changes to bid/reveal endpoints or their DB writes.
- No touches to `main`.

## Regression

- FE typecheck clean (`npx tsc --noEmit` exit 0).
- The three edited pages read the SAME `tenderApi` + `mapApiError` + `Button` symbols already imported elsewhere — no new deps.
