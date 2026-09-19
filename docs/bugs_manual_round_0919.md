# R12 · Manual QA round · 2026-09-19

Findings from Yulian's manual pass on staging + response.
Prompt: `docs/cc-prompts/cc_prompt_R12_manual_round.md`. Baseline tag: `pre-r12`.

## §1 · Search — counter, empty state, per-entity tuning

### What the manual round surfaced

Yulian: *"חיפשתי רצפים ולא קיבלתי תוצאות. פשוט מאוד."*

### Why the earlier diagnosis was wrong

The prior response classified the "no results" symptom as an H12 side-effect and
offered three options that all treated search as *worker search*. That reading
missed two things:

1. **`U6 §2` federated search.** `/search` returns `marketplace_matches`
   alongside `results` — a corp querying `רצפים` may legitimately get zero
   worker rows AND relevant service listings on the same page. Housing,
   transport, insurance, equipment: the fourth business channel is built
   into the same endpoint.
2. **The visible counter still read two of three sources.** The SR-only status
   region at `page.tsx:1481-1503` was already fixed in R5 §4 to include
   `marketplace_matches`; the visible readout at `page.tsx:1097-1103` was not.
   A query like `קורס עברית` that lands only in marketplace read as
   `0 תוצאות` in the header even while the real card rendered below —
   which is exactly what made "search is broken" a plausible reading for
   the earlier diagnosis too.

The `service_provider → total 0` cell in the earlier table was misread as
"scope closes everything." `viewer_scope_wheres` gates `ads` alone
(`search.py:294,297,351`); `_search_marketplace()` at `search.py:215` takes no
scope argument. Providers do get marketplace hits — the counter simply hid them.

### What §1 changes

All edits are in [services/frontend/src/app/page.tsx](services/frontend/src/app/page.tsx).
`viewer_scope_wheres` and every other H12 site untouched (`git diff visibility.py` empty).

**1b · Visible counter (§1b).** Now sums all three sources; single-source cases
collapse to the short `N תוצאות` form, mixed cases spell out each source.

```tsx
const exact  = resp.results.length;
const near   = resp.near_matches?.length ?? 0;
const market = resp.marketplace_matches?.length ?? 0;
const total  = exact + near + market;
const populated = [exact, near, market].filter((n) => n > 0).length;
if (total === 0) return '0 תוצאות';
if (populated === 1) return total === 1 ? 'תוצאה אחת' : `${total} תוצאות`;
// else assemble mixed "N מדויקות · M קרובות · K שירותים נלווים"
```

Same three-source arithmetic as the SR-only region — the two surfaces now
compute the same total, not two.

**1c · Empty state per entity.**

| Entity | Workers-block empty state |
|---|---|
| **Contractor / anon** | Unchanged amber `לא נמצאו מודעות התואמות` + NM near-matches. Suppressed when marketplace has hits (R5 §4). |
| **Corporation** | New slate panel: `מודעות עובדים של תאגידים אחרים אינן מוצגות לתאגידים. אלה המודעות שלך שתואמות לחיפוש — כרגע אין.` + CTA button `פרסמו מודעת עובדים חדשה →` linking to `/corporation/ads/new/worker`. Renders whenever the corp's own worker set is empty, **independent of the marketplace section** (the corp's "why don't I see workers" answer is H12, not "no match"). |
| **Service provider** | Ads column doesn't render at all. Fallback: when marketplace is also empty, a plain amber panel `לא נמצאו תוצאות לחיפוש · נסה לנסח אחרת או לחפש שירות אחר` renders in the results column. |

Marketplace section itself renders normally for all three entities — the
"שירותים נלווים" heading is the fourth business channel and belongs everywhere.

The marketplace-preamble one-liner (`לא נמצאו עובדים או דיור לחיפוש הזה. מצאנו התאמה בשירותים הנלווים.`)
is now suppressed for corp + provider — for a corp its "no workers" phrasing
is wrong (the reason is H12, not a match failure), and for a provider it
refers to a section they can't see anyway.

**1d · Placeholder per entity.** `נסה: 20 פועלים סינים במרכז` unchanged for
contractor + anonymous (F1 decision). Corp + provider now see
`חפש דיור, הסעות, ביטוח, ציוד`.

### Counter calculation — worked examples

Working through the acceptance queries with the concrete arithmetic:

| Query · caller | exact | near | market | total | header text |
|---|---|---|---|---|---|
| `קורס עברית` · contractor | 0 | 0 | 1 | 1 | `תוצאה אחת` |
| `רצפים` · corp without a flooring ad | 0 | 0 | 0-3 (services) | 0..3 | `0 תוצאות` / `N שירותים נלווים` |
| `רצפים` · corp with a flooring ad | 1 | 0 | 0-3 | 1..4 | single-source `תוצאה אחת` / mixed `1 מדויקות · N שירותים נלווים` |
| `ביטוח` · provider | (ads section hidden) | — | 1+ | 1+ | `תוצאה אחת` |
| Query with no matches for anyone | 0 | 0 | 0 | 0 | `0 תוצאות` + amber block per entity |

### Files touched

- [services/frontend/src/app/page.tsx](services/frontend/src/app/page.tsx) — counter, empty state, provider gate, placeholder.
  - New import: `getAccessToken`, `getEntityType` from `@/lib/auth`.
  - New state: `entityType`, derived `isCorp` + `isProvider`.
- [services/user-org/app/services/visibility.py](services/user-org/app/services/visibility.py) — **not touched**. `git diff` empty. H12 stays where it was.

### Screenshots

Pending — will be captured on staging once Railway redeploys `pivot/v2` past the R12 §1 commit.
Placeholder paths so this doc stays parseable:

- `docs/screens/r12_1_contractor_hebrew_course.png` — contractor, `קורס עברית`, header `תוצאה אחת`, no "not found" block, marketplace card visible.
- `docs/screens/r12_1_corp_no_ownad.png` — corp without a flooring ad, `רצפים`, slate corp panel + publish button, marketplace section as normal.
- `docs/screens/r12_1_corp_with_ownad.png` — corp with own flooring ad, `רצפים`, own card visible.
- `docs/screens/r12_1_provider_insurance.png` — provider, `ביטוח`, marketplace results only, no workers section, no explanation panel.
- `docs/screens/r12_1_empty_contractor.png`, `_corp.png`, `_provider.png` — a query with zero matches everywhere, per-entity block appears.

### Guardrails held

- **H12 not touched.** `git diff services/user-org/app/services/visibility.py` = 0 lines.
- **Search NOT hidden from corps.** Placeholder + empty state + marketplace still active.
- **Other corps' ads NOT opened.** Visibility fragment unchanged.
- **Marketplace renders for all three entities.** Only the ads column is gated by entity.
- **One counter.** The visible readout and the SR-only status region compute from the same three-source formula.

---

## §2 · §3 · §4 · §5 — pending

Not started in this pass. The prompt says §1 first; the rest lands in a follow-up commit.
