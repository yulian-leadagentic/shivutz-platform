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

### Live verification on staging — one row per acceptance item

Captured against staging (build-tag `2026-09-19-r12s1`, commit `892ffa1`).
Values were read directly from the live DOM via `javascript_tool` right after
the search fired, so they are the exact strings the browser rendered — no
transcription risk.

| # | Entity + query | Placeholder | Header (visible counter) | Workers-block | Marketplace | Screenshot |
|---|---|---|---|---|---|---|
| 1 | contractor `בוני הנגב` · `קורס עברית` | `נסה: 20 פועלים סינים במרכז` | `14 תוצאות מדויקות · שירות אחד נלווה` (mixed source) | 14 ad cards, no amber | `שירותים נלווים · תוצאה אחת` — 1 card | inline in conversation |
| 2 | corp `עליונים` (no flooring ad) · `רצפים` | `חפש דיור, הסעות, ביטוח, ציוד` | `0 תוצאות` | **corp slate panel + פרסמו מודעת עובדים חדשה** → `/corporation/ads/new/worker` · no amber block | (no marketplace hit — section absent) | inline in conversation |
| 3 | corp `כוח אדם גלובל` (has flooring ad) · `רצפים` | `חפש דיור, הסעות, ביטוח, ציוד` | `תוצאה אחת` (single-source short form) | 1 ad card — own inventory · no corp panel · no amber | (same, no hit) | inline in conversation |
| 4 | provider `ספק שירותים נלווים` · `ביטוח` | `חפש דיור, הסעות, ביטוח, ציוד` | `4 תוצאות` (single-source short form) | **`.results-table` count = 0** — ads column not rendered at all · no corp panel · no amber | `שירותים נלווים · 4 תוצאות` — 4 insurance cards | inline in conversation |
| 5 | provider · `zzz_no_such_query_xyz` (empty-everywhere fallback) | `חפש דיור, הסעות, ביטוח, ציוד` | `0 תוצאות` | ads column not rendered · **provider amber fallback: `לא נמצאו תוצאות לחיפוש · נסה לנסח אחרת או לחפש שירות אחר`** | (no hit) | inline |

All five DOM reads returned exactly what the code was intended to produce.
`amberBlockPresent` was `false` on rows 1-4 (the `.bg-amber-50.border-2` big
amber block from the pre-R12 code); row 5 correctly had `1` — the new
provider fallback — and it read the copy I shipped.

### Counter calculation — worked examples

Concrete arithmetic pulled from the live DOM readings above:

| Query · caller | exact | near | market | total | populated | header text |
|---|---|---|---|---|---|---|
| `קורס עברית` · contractor | 14 | 0 | 1 | 15 | 2 | `14 תוצאות מדויקות · שירות אחד נלווה` (mixed) |
| `רצפים` · corp without flooring ad | 0 | 0 | 0 | 0 | 0 | `0 תוצאות` (+ corp slate panel) |
| `רצפים` · corp with flooring ad | 1 | 0 | 0 | 1 | 1 | `תוצאה אחת` (single-source short) |
| `ביטוח` · provider | 0 (hidden col) | 0 | 4 | 4 | 1 | `4 תוצאות` (single-source short) |
| `zzz_no_such_query_xyz` · provider | 0 | 0 | 0 | 0 | 0 | `0 תוצאות` (+ provider amber) |

### Files touched

- [services/frontend/src/app/page.tsx](services/frontend/src/app/page.tsx) — counter, empty state, provider gate, placeholder.
  - New import: `getAccessToken`, `getEntityType` from `@/lib/auth`.
  - New state: `entityType`, derived `isCorp` + `isProvider`.
- [services/frontend/src/app/layout.tsx](services/frontend/src/app/layout.tsx) — bumped `build-tag` from `2026-08-09-a` to `2026-09-19-r12s1` (verification anchor for the staging deploy poll).
- [services/user-org/app/services/visibility.py](services/user-org/app/services/visibility.py) — **not touched**. `git diff` empty. H12 stays where it was.

### Guardrails held

- **H12 not touched.** `git diff services/user-org/app/services/visibility.py` = 0 lines.
- **Search NOT hidden from corps.** Placeholder + empty state + marketplace still active.
- **Other corps' ads NOT opened.** Visibility fragment unchanged.
- **Marketplace renders for all three entities.** Only the ads column is gated by entity.
- **One counter.** The visible readout and the SR-only status region compute from the same three-source formula.
- **No accessibility widget, no fake accessibility contact.** §1 didn't touch accessibility.
- **`{' '}` spacing not needed in §1** (relevant to §3 later).
- **Branch mirror.** `git rev-list --left-right --count origin/staging...origin/pivot/v2` → `0 0`.

---

## §2 · §3 · §4 · §5 — pending

Not started in this pass. The prompt says §1 first; the rest lands in a follow-up commit.
