# R12 · Manual QA round · 2026-09-19

Findings from Yulian's manual pass on staging + response.
Prompt: `docs/cc-prompts/cc_prompt_R12_manual_round.md`. Baseline tag: `pre-r12`.

## §1 · Search — policy correction: open to everyone

### Two rounds of correction

**Yulian's first message:** *"חיפשתי רצפים ולא קיבלתי תוצאות. פשוט מאוד."*

I read that as a UX bug on the corp-empty branch and shipped a per-entity
empty-state (`R12 §1c/§1d`) — corp explanation panel + provider gate on the
ads column + placeholder swap. The prompt itself framed H12 as settled:
`אל תיגע ב-visibility.py · H12 הוכרע`.

**Yulian's second message (this round):**
> *"מה זה משנה כולם יכולים לחפש ולמצא תוצאות. יש הגבלה רק על צפיה
> בפרטים של עובדים של תאגידים שם זה מוגבל רק לקבלנים."*

*"What does it matter, everyone can search and find results. The only
restriction is on viewing worker DETAILS of corporations — that's
restricted to contractors."*

That reverses the read of H12 the prompt was written against.
Search is **open to every caller** (anon, contractor, corp, service_provider,
admin). The contractor-only restriction lives **on the reveal endpoint alone**,
and is already enforced there (`services/user-org/app/routes/ads.py:1123` —
`contact_reveal` calls `require_no_service_provider` + `require_contractor_approved`
+ subscription/tier gates).

### What ships

Two backend + one FE change; keeps only the R5 §4 counter fix from the first §1 pass.

**Backend — `services/user-org/app/services/visibility.py`.**
`viewer_scope_wheres` was returning per-role SQL predicates that scoped `ads`
reads:

- `corporation` caller → `("(a.ad_type <> 'worker' OR a.owner_entity_id = %s)", [id])`
- `service_provider` caller → `("1=0", [])`
- everyone else → `([], [])`

Now returns `([], [])` for **every caller**. The function stays (with an
`# noqa: ARG001` on the unused args) as the single reversal point should the
policy ever change again — one edit here reintroduces per-role scoping across
all five ads read paths at once, and every existing caller already passes the
`(x_entity_id, x_entity_type)` headers so the signature is a stable contract.

Module docstring rewritten to reflect the new policy (search open · reveal
gate lives on the reveal endpoint).

**Backend — no change to** `contact_reveal` at `ads.py:1123`. `require_no_service_provider` +
contractor approval + subscription entitlement + tier reveal quota were
already there and are the correct gate.

**Backend — no change to** the gateway (`services/gateway/src/index.js:196`).
Anonymous callers still redirect to `/login` for `/api/search`; that's what
Yulian picked in the clarification question. Everyone signed in — regardless
of entity type — hits the search path unrestricted.

**Frontend — `services/frontend/src/app/page.tsx`.** Reverted every R12 §1c/§1d
branch I added earlier this session:

- `getAccessToken` + `getEntityType` imports removed.
- `entityType`, `isCorp`, `isProvider` state + `useEffect` removed.
- Placeholder back to plain `נסה: 20 פועלים סינים במרכז` for every viewer.
- `{!isProvider && (…)}` gate on the ads column removed — column renders
  for every viewer.
- Corp slate panel (`מודעות עובדים של תאגידים אחרים…` + publish CTA) removed.
- `{!isCorp && …}` guard on the amber "לא נמצאו מודעות התואמות" block removed
  — same amber renders for every viewer whose whole search came up empty.
- `{!isCorp && !isProvider && …}` guard on the marketplace preamble removed —
  same preamble renders for every viewer when workers side is empty but
  services matched.
- Provider fallback `bg-amber-50` block after the marketplace section removed.

**Frontend — kept: the counter fix (§1b).** The visible readout at
`page.tsx:1097` sums `results + near_matches + marketplace_matches`, so a
query that lands only in marketplace no longer reads `0 תוצאות` next to a
real card. This was the underlying R5 §4 gap and stays useful independent
of the H12 read.

### Yulian's specific reproduction

- Direct HTTP call to `/search` with `x-entity-id=73ac1629`, `x-entity-type=contractor`
  (your `בוני הנגב` id), body `{"query":"רצפים"}` →
  `status=200 · total=1 · results=1 · filters.profession_code=flooring`.
- With this shipped, the SAME call as `corporation` or `service_provider` also
  returns `total=1` because `viewer_scope_wheres` no longer narrows the WHERE.
- The mobile session on the phone still holds the JWT from the deleted
  `service_provider` membership → log out + log back in → pick `בוני הנגב`
  → search `רצפים` → the flooring ad renders.

### Cleanup of the seed memberships I never should have created

Removed three `entity_memberships` I inserted for QA convenience:
- corp עליונים (3e20211f), corp כוח אדם גלובל (5fc35fa9), service_provider יוליאן אברמוביץ (9c7c02fd).

`+972525278625` is back to its two pre-existing memberships (contractor
`בוני הנגב` + corp `יוליאן תאגיד`).

Memory `feedback_pre_launch_state.md` / `feedback_deploy_flow.md` already
captured the "mirror to staging + paste rev-list every report" rule from the
earlier miss. Adding one more note in the next memory pass: do NOT mutate the
user's live-account state for QA.

### Files touched (this round)

- [services/user-org/app/services/visibility.py](services/user-org/app/services/visibility.py) — `viewer_scope_wheres` reduced to `([], [])`; module docstring updated.
- [services/frontend/src/app/page.tsx](services/frontend/src/app/page.tsx) — every R12 §1c/§1d branch reverted; counter fix retained.
- [services/frontend/src/app/layout.tsx](services/frontend/src/app/layout.tsx) — `build-tag` → `2026-09-19-r12s1-open` (deploy verification anchor).

### Guardrails

- Contact reveal untouched · providers still 403 there · pending contractors still 403 there.
- `require_contractor_approved` still runs on every ads read path.
- No accessibility widget, no fake contact info — §5 unchanged.
- `git rev-list --left-right --count origin/staging...origin/pivot/v2` → pasted at the bottom of this report on commit.

---

## §2 · §3 · §4 · §5 — pending

Not started in this pass.
