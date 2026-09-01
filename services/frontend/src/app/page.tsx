'use client';

// Pivot/v2 — yad2-inspired commercial landing.
// Previous search-first landing is preserved in ./_v1/page.tsx for
// rollback (Next.js ignores underscore-prefixed folders).
//
// Structure:
//   1. Category tiles row (עובדים / דיור / ייבוא / soon)
//   2. Commercial search hero
//   3. Featured ads carousel (yad2-style top slot — boosted first)
//   4. Trust bar (real numbers)
//   5. Ad-slot carousel + inline-sponsored (kept from v1)
//   6. Search results (when a query is active)
//   7. Recent ads grid (yad2 mosaic — when no query)
//   8. Role register picker + "how it works" + footer

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2, Search as SearchIcon, Mail, Phone, Building2, Sparkles,
  Users, Home as HomeIcon, Globe2, ArrowLeft, X, ArrowLeftCircle,
} from 'lucide-react';
import { PromotedBadge } from '@/components/ads/PromotedBadge';
import LandingNav from '@/components/landing/LandingNav';
import LandingFooter from '@/components/landing/LandingFooter';
import LeadCaptureModal from '@/components/landing/LeadCaptureModal';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
// Landing IA — mount the mock-driven floating bubble. Was orphan
// code; mounting it here surfaces marketplace-activity ambient
// cues on the public landing (see LiveActivityFeed for the future
// GET /api/marketplace/activity-feed swap point noted in-source).
import LiveActivityFeed from '@/components/landing/LiveActivityFeed';
import { AdCarousel } from '@/features/advertising/AdCarousel';
import { AdSidebar } from '@/features/advertising/AdSidebar';
import { InlineSponsoredAd } from '@/features/advertising/InlineSponsoredAd';
import { RevealModal, type RevealBlock } from '@/features/advertising/RevealModal';
import { RoleRegisterPicker } from '@/features/advertising/RoleRegisterPicker';
import { VoiceInputButton } from '@/features/voice/VoiceInputButton';
import { FeaturedAdsCarousel } from '@/features/advertising/FeaturedAdsCarousel';
import { LandingTrustBar } from '@/features/advertising/LandingTrustBar';
import { searchApi, type SearchResponse, type AdSearchResult, type ContactReveal } from '@/lib/api/search';
import { apiFetch, ApiError } from '@/lib/api/client';
import { mapApiError } from '@/lib/api/errors';
import { enumApi } from '@/lib/api/enums';
import { isLoggedIn } from '@/lib/auth';
import { readPendingReveal, clearPendingReveal } from '@/features/prospect/state';
import type { Profession } from '@/types';

// F1 §1 — the two chip-queries below were selected by staging
// measurement (see docs/cc-prompts/cc_prompt_f1_first_screen.md).
// Rule: chip enters only if it returns 2-6 real results AND the
// rewriter extracts the intended dimensions. Both chips today
// pass on staging.buildupai.net; the four legacy examples
// ('מחפש 4 פועלים סינים לריצוף' etc.) were REMOVED because
// three of them return 0 hits or full-catalog on the current
// inventory — a chip that lies is worse than no chip.
// The third slot (housing) was intentionally left EMPTY: no
// housing query in the candidate set returned 2-6. When housing
// inventory grows past 1 ad the empty slot can be filled — do
// not pad it with a query that returns 1 or 0.
// A first-person entry ('אני צריך…') teaches the visitor that
// the search accepts natural speech, not only tag-shaped syntax.
type Chip =
  | { key: string; label: string; query: string; href?: never }
  | { key: string; label: string; query?: never; href: string };
const CHIPS: Chip[] = [
  { key: 'chip-flooring-cn',     label: 'רצפים סינים',              query: 'רצפים סינים' },
  { key: 'chip-plastering-ctr',  label: 'אני צריך טייחים במרכז',   query: 'אני צריך טייחים במרכז' },
  { key: 'chip-import',          label: 'ייבוא עובדים מחו״ל',       href:  '/contractor/tenders' },
];
const INLINE_AD_EVERY = 5;

// Tier code → Hebrew display, mirrors the /billing plans map so the
// reveal-quota / expired-subscription modal reads naturally instead of
// showing raw enum strings.
const TIER_HE: Record<string, string> = {
  free:      'ניסיון חינם',
  basic:     'בסיסי',
  advanced:  'מתקדם',
  pro:       'פרו',
  premium:   'פרימיום',
  trial:     'ניסיון חינם',
};
function tierLabelHe(tier?: string | null): string {
  if (!tier) return 'הנוכחי';
  return TIER_HE[tier.toLowerCase()] ?? tier;
}

// 1ב׳ — classify a search failure into one of four Hebrew messages
// that tell the user WHAT happened + WHAT to try. Falls back to the
// central mapApiError for anything unusual so no English machine code
// leaks. `ApiError.cause.status` is the transport-bound classifier;
// message-text sniffing is only the fallback path for pre-ApiError
// throws (e.g. a raw TypeError from a network abort).
function mapSearchError(e: unknown): string {
  if (e instanceof ApiError) {
    const status = e.cause?.status;
    if (status === 429)                     return 'יותר מדי חיפושים כרגע. נסה שוב בעוד רגע.';
    if (typeof status === 'number' && status >= 500) return 'החיפוש אינו זמין כרגע. נסה שוב בעוד רגע.';
  }
  // Network-level: TypeError from fetch on failed connections, or
  // Error whose message names a timeout / abort. Do NOT gate on
  // ApiError here — network failures throw before apiFetch wraps.
  const msg = e instanceof Error ? e.message.toLowerCase() : '';
  if (/networkerror|failed to fetch|load failed|abort/.test(msg)) return 'בעיית תקשורת — בדוק את החיבור ונסה שוב.';
  if (/timeout|timed out/.test(msg))                              return 'החיפוש לוקח יותר מדי זמן. נסה שוב.';
  // Everything else through the central mapper so a server-supplied
  // Hebrew message wins, and known codes get their translation.
  return mapApiError(e);
}

// F1 §1 — the four category tiles ('עובדים', 'דיור', 'ייבוא',
// 'ציוד ושירותים בקרוב') were removed. The tiles taught clicking
// while the product wants speaking. Their queries — where they
// were shipping-worthy — moved into CHIPS above. 'ייבוא' stayed
// a link but as a chip; 'ציוד ושירותים' was cut entirely and
// will return when the service-vertical M-series lands.

interface PublicAd {
  id: string;
  ad_type: 'worker' | 'housing';
  title_he: string;
  body_he: string | null;
  region: string | null;
  profession_code: string | null;
  origin_country: string | null;
  quantity: number | null;
  city: string | null;
  available_beds: number | null;
  price_per_bed_nis: number | null;
  photos: string[] | null;
  featured_until: string | null;
  published_at: string;
}

function LandingPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  // QA-2: LiveActivityFeed CTAs (check_match / anon check_match) route
  // to `/?focus=search#search-hero`. When the visitor is already on
  // the landing, the browser doesn't repaint, so the click has to
  // manifest as *something visible* — focus the input + scroll to
  // the hero.
  const searchInputRef = useRef<HTMLInputElement>(null);
  // SR — scroll target for the results section. After a successful
  // search the results were sitting below the featured carousel, trust
  // bar, and leaderboard ad — 2–3 screen-heights on mobile 390. The
  // effect below smooth-scrolls to it on `resp` becoming truthy.
  const searchResultsRef = useRef<HTMLElement>(null);
  // F2 §2 — refs into the ghost overlay so the demo loop can grow the
  // ghost text via insertAdjacentText (imperatively) and toggle the
  // mark's class between is-rest / is-caret without ever re-mounting
  // the mark node (F2 §1 rule ב׳). The two spans are rendered in JSX
  // above; refs give the loop stable DOM handles without needing to
  // querySelector every tick.
  const ghostTextRef = useRef<HTMLSpanElement>(null);
  const markRef      = useRef<HTMLSpanElement>(null);

  const [q, setQ]           = useState('');
  const [resp, setResp]     = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // Two error slots so a voice-transcribe failure doesn't paint red
  // inside the search-results section (and vice versa). The banner
  // inside the results section reads `searchError`; the voice failure
  // surfaces its own toast-shaped banner near the search input.
  // Pre-1ב׳ the single `error` covered both, and a 401 from a
  // subscription page could leak into the results area on other
  // routes — separating the sources also stops that class of bug.
  const [searchError, setSearchError] = useState('');
  const [voiceError,  setVoiceError]  = useState('');
  const [reveals, setReveals]     = useState<Record<string, ContactReveal>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [block, setBlock]         = useState<RevealBlock | null>(null);
  // SR — suspend the LiveActivityFeed bubble when the visitor is
  // actively engaged with the search: input has focus, voice is
  // recording/transcribing, a search is in flight, or results are on
  // screen. Any one is enough. The four are separate states so any of
  // them clearing releases the suspend on its own tempo.
  const [inputFocused, setInputFocused] = useState(false);
  const [voiceActive,  setVoiceActive]  = useState(false);
  // SR — brief visual nudge on the חפש button right after a voice
  // transcript lands. Confirms the transcript needs review + submit
  // (design decision: no auto-search on transcript — Hebrew trade
  // jargon misfires often). Cleared after 2.5s.
  const [awaitingSubmit, setAwaitingSubmit] = useState(false);

  const [recent, setRecent] = useState<PublicAd[]>([]);
  // RT — track whether the initial recent-ads fetch has completed
  // (success OR failure). Without this, `recent === []` from a
  // pre-fetch state is indistinguishable from `recent === []` from a
  // completed-but-empty fetch, and the reveal effect can't tell if
  // it's still waiting for data or if the target ad genuinely isn't
  // in the recent list.
  const [recentLoaded, setRecentLoaded] = useState(false);

  // L2 — structured filter chips alongside free-text. Selected values
  // get prepended to the LLM query on submit; the rewriter already
  // knows how to fold "flooring, center, china" into enum filters, so
  // this is a pure client-side add — no backend contract change.
  //
  // Search-rework — the three enum selects used to sit ABOVE the
  // free-text input, competing with it. They're now hidden behind a
  // "סינון מתקדם" toggle so the smart search reads as the primary
  // entry. Filter logic (URL persistence, LLM chip-prepend, aria-live)
  // is unchanged — this is a REPOSITION.
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [regions,     setRegions]     = useState<{ code: string; name_he: string }[]>([]);
  const [origins,     setOrigins]     = useState<{ code: string; name_he: string }[]>([]);
  const [fProf,       setFProf]       = useState('');
  const [fRegion,     setFRegion]     = useState('');
  const [fOrigin,     setFOrigin]     = useState('');
  // Advanced-filters disclosure. Starts CLOSED for a first-time visit,
  // OPEN when the URL already carries a filter (a shared link with
  // ?prof=… → we don't want to hide the currently-active filter from
  // the user). Lazy initializer so we read the URL exactly once on
  // mount and don't fight the state on subsequent syncFiltersToUrl
  // rewrites.
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    return !!(sp.get('prof') || sp.get('region') || sp.get('origin'));
  });

  // QA-2 — when arriving via a LiveActivityFeed CTA that targets the
  // landing search (`?focus=search#search-hero`), focus the input so
  // the click has a visible effect even for a same-page navigation.
  // The hash-anchor already handles the scroll; `?focus=search`
  // triggers the input focus once on mount and never re-fires.
  useEffect(() => {
    if (params?.get('focus') === 'search' && searchInputRef.current) {
      // Small timeout — waits for the hash-scroll to settle so the
      // caret lands inside a stable, visible input.
      const t = setTimeout(() => searchInputRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [params]);

  useEffect(() => {
    apiFetch<{ results: PublicAd[] }>('/ads/public/recent?limit=12')
      .then((r) => setRecent(r.results))
      .catch(() => setRecent([]))
      .finally(() => setRecentLoaded(true));
    // Best-effort: filters degrade to empty selects if the endpoints
    // 500 or the anon rate limit is hit.
    enumApi.professions().then(setProfessions).catch(() => setProfessions([]));
    enumApi.regions().then(setRegions).catch(() => setRegions([]));
    enumApi.origins().then(setOrigins).catch(() => setOrigins([]));
  }, []);

  // verify(L2) — URL persistence for filter chips. A shared URL with
  // ?prof=&region=&origin= must arrive with the same filter state so
  // the results are reproducible + back/forward remembers the pick.
  // Runs once against the current searchParams; runSearch and
  // clearFilters write the reverse direction on user action.
  useEffect(() => {
    const p = params?.get('prof');
    const r = params?.get('region');
    const o = params?.get('origin');
    if (p) setFProf(p);
    if (r) setFRegion(r);
    if (o) setFOrigin(o);
    // Intentional single-shot read: don't want a subsequent
    // router.replace to loop this back into state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function labelFor<T extends { code: string; name_he: string }>(list: T[], code: string): string {
    return list.find((r) => r.code === code)?.name_he ?? code;
  }

  // verify(L2) — mirror current filter chips into the URL. Kept as a
  // helper so runSearch + clearFilters both write via the same path.
  function syncFiltersToUrl(prof: string, region: string, origin: string) {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    prof   ? url.searchParams.set('prof',   prof)   : url.searchParams.delete('prof');
    region ? url.searchParams.set('region', region) : url.searchParams.delete('region');
    origin ? url.searchParams.set('origin', origin) : url.searchParams.delete('origin');
    router.replace(url.pathname + url.search + url.hash);
  }

  async function runSearch(rawQ?: string) {
    let query = (rawQ ?? q).trim();
    // Prepend the active filter labels so the LLM sees them as intent.
    const chips: string[] = [];
    if (fProf)   chips.push(labelFor(professions, fProf));
    if (fRegion) chips.push('אזור: ' + labelFor(regions, fRegion));
    if (fOrigin) chips.push('מוצא: ' + labelFor(origins, fOrigin));
    if (chips.length) {
      const prefix = chips.join(' · ') + (query ? ' — ' : '');
      query = prefix + query;
    }
    if (query.length < 2) return;
    setQ(query);
    setAwaitingSubmit(false);   // SR — clear the post-transcript ring
    syncFiltersToUrl(fProf, fRegion, fOrigin);
    setLoading(true);
    setSearchError('');
    try { setResp(await searchApi.query(query)); }
    catch (e) { setSearchError(mapSearchError(e)); }
    finally { setLoading(false); }
  }

  // SR — scroll to the results section on TWO edges:
  //   • loading became true → user just pressed חפש; anchor to the
  //     skeleton so they see immediate feedback instead of the ads
  //     that just unmounted.
  //   • resp landed → re-anchors in case they scrolled during the
  //     ~3s LLM round-trip.
  // rAF defers a frame so the DOM (ads out, results/skeleton in)
  // has painted before we measure. Honours prefers-reduced-motion —
  // instant jump rather than smooth.
  useEffect(() => {
    if (!loading && !resp) return;
    const el = searchResultsRef.current;
    if (!el) return;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, resp]);

  function clearFilters() {
    setFProf(''); setFRegion(''); setFOrigin('');
    syncFiltersToUrl('', '', '');
  }
  const anyFilter = !!(fProf || fRegion || fOrigin);

  // F1 §2 — chip click types the chip's query into the input over
  // ~320ms and then submits. The animation is one-shot per click
  // (not a loop), tracked by animChipKey so we can render aria-pressed
  // on the source chip AND cancel-in-flight if the visitor clicks a
  // different chip or starts typing themselves. Honours
  // prefers-reduced-motion — no interval, just set-then-search.
  const typeTimerRef = useRef<number | null>(null);
  const [animChipKey, setAnimChipKey] = useState<string | null>(null);

  // Cancel any in-flight typed animation. Used before starting a new
  // one and by the keyboard/click skip-to-end handlers. Not memoized
  // — needs to always see the latest runSearch closure and no other
  // downstream component consumes it, so the useCallback overhead
  // would only introduce stale-closure risk.
  function cancelTyping() {
    if (typeTimerRef.current !== null) {
      window.clearTimeout(typeTimerRef.current);
      typeTimerRef.current = null;
    }
    setAnimChipKey(null);
  }

  function onChipClick(chip: Chip) {
    if ('href' in chip && chip.href) {
      router.push(chip.href);
      return;
    }
    if (!('query' in chip) || !chip.query) return;
    const full: string = chip.query;
    // Cancel any prior animation — no parallel typings.
    cancelTyping();
    // Scroll the input into view so the visitor SEES it get typed.
    searchInputRef.current?.focus({ preventScroll: true });
    document.getElementById('search-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setQ(full);
      runSearch(full);
      return;
    }
    // Type char-by-char. ~320ms total for a ~15-char query.
    setAnimChipKey(chip.key);
    setQ('');
    const perChar = Math.max(15, Math.min(35, Math.round(320 / full.length)));
    let i = 0;
    const tick = () => {
      // If the animation was cancelled from elsewhere (skip-to-end),
      // stop here — don't overwrite the visitor's manual input.
      if (typeTimerRef.current === null) return;
      i += 1;
      setQ(full.slice(0, i));
      if (i >= full.length) {
        typeTimerRef.current = null;
        setAnimChipKey(null);
        runSearch(full);
        return;
      }
      typeTimerRef.current = window.setTimeout(tick, perChar);
    };
    typeTimerRef.current = window.setTimeout(tick, perChar);
  }

  // ─── F2 §2 · demo loop ─────────────────────────────────────────
  // The demo queries below run through THE REAL search API — same
  // endpoint the visitor uses, same rewriter, same rerank. §2b
  // forbids mocks. Redis's 5-min server cache absorbs the cost so
  // the loop doesn't hammer Haiku for every tick.
  //
  // Queries were measured live on staging.buildupai.net (F1 §1
  // report) — both return 2 real hits and both extract the intended
  // filters (flooring+CN, plastering+center). A query that returns
  // 0 gets dropped from the rotation on the priming pass; if ALL
  // return 0, the loop never starts and the mark stays in is-rest
  // (§2b explicitly).
  //
  // WCAG 2.2.2: the loop starts automatically, so an accessible
  // stop mechanism is required. The stop mechanism is: any
  // pointerdown / keydown / focusin / wheel on the field permanently
  // kills the loop (see attachStopHandlers below). The loop never
  // resumes for the rest of the page's lifetime.
  //
  // prefers-reduced-motion: the loop doesn't run at all — not slower,
  // not fewer cycles, NONE. Mark stays is-rest, placeholder shows.
  const DEMO_QUERIES = ['רצפים סינים', 'אני צריך טייחים במרכז'];
  const [demoView, setDemoView] = useState<{
    phase:   'scanning' | 'showing' | 'fading';
    results: AdSearchResult[];
    filters: SearchResponse['filters'];
    q:       string;
  } | null>(null);
  const demoStoppedRef = useRef(false);
  const demoCleanupRef = useRef<() => void>(() => {});
  // Callable from other effects (voice-active bridge below).
  const demoStopFromOutsideRef = useRef<() => void>(() => {});

  useEffect(() => {
    // prefers-reduced-motion: full stop. Not a slower loop — none.
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    let cancelled = false;
    const timers = new Set<number>();
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const id = window.setTimeout(() => { timers.delete(id); resolve(); }, ms);
      timers.add(id);
    });

    const clearGhost = () => {
      const gt = ghostTextRef.current;
      if (gt) gt.textContent = '';
      const g = gt?.parentElement;
      if (g) g.classList.remove('demo-visible');
    };
    const setMark = (state: 'rest' | 'caret') => {
      const m = markRef.current;
      if (!m) return;
      m.className = state === 'rest' ? 'ai-mark is-rest' : 'ai-mark is-caret';
    };
    const appendChar = (ch: string) => {
      const gt = ghostTextRef.current;
      if (!gt) return;
      gt.parentElement?.classList.add('demo-visible');
      gt.textContent = (gt.textContent ?? '') + ch;
    };
    const popChar = () => {
      const gt = ghostTextRef.current;
      if (!gt) return;
      const t = gt.textContent ?? '';
      if (t.length > 0) gt.textContent = t.slice(0, -1);
    };

    // Add `demo-armed` immediately on mount so the placeholder is
    // hidden BEFORE the priming pass completes. Otherwise the
    // ~1s of API round-trip time (plus the 800ms dead-window
    // between cycles) leaks the placeholder onto the screen and
    // the visitor sees 'נסה: 20 פועלים סינים במרכז' flash in
    // the box even though they typed nothing.
    const armField = searchInputRef.current?.closest('.ai-field');
    armField?.classList.add('demo-armed');

    demoCleanupRef.current = () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      clearGhost();
      setMark('rest');
      setDemoView(null);
      armField?.classList.remove('demo-armed');
    };

    (async () => {
      // Prime — one API round per query. Drop anything that returns
      // zero right now; that's the §2b "empty query exits the loop"
      // rule enforced before any typing happens.
      const primed: Array<{ q: string; data: SearchResponse }> = [];
      for (const q of DEMO_QUERIES) {
        if (cancelled) return;
        try {
          const data = await searchApi.query(q);
          if (data && data.total > 0 && data.results.length > 0) {
            primed.push({ q, data });
          }
        } catch { /* network hiccup — drop this query from rotation */ }
      }
      // If every primed query returned 0 the loop never starts —
      // per §2b. Also remove the armed class so the placeholder
      // returns instead of staying suppressed forever behind an
      // idle mark.
      if (cancelled || primed.length === 0) {
        armField?.classList.remove('demo-armed');
        return;
      }

      let idx = 0;
      while (!cancelled) {
        const { q, data } = primed[idx];
        const shown = data.results.slice(0, 2);   // §4 mobile cap = 2; desktop tolerates too

        // Phase 1 — mark rest 500ms
        setMark('rest');
        clearGhost();
        await sleep(500);
        if (cancelled) return;

        // Phase 2 — type char-by-char. 44ms/char + light noise for
        // human cadence, but bounded so the total stays ~1s regardless
        // of query length.
        setMark('caret');
        for (const ch of q) {
          appendChar(ch);
          const noise = Math.round((Math.sin(gt_seed(q, ch)) * 12));
          await sleep(44 + noise);
          if (cancelled) return;
        }

        // Phase 3+4+5 — scan line, then tags+cards staggered in
        setDemoView({ phase: 'scanning', results: shown, filters: data.filters, q });
        await sleep(1900);
        if (cancelled) return;

        setDemoView({ phase: 'showing', results: shown, filters: data.filters, q });
        // Phase 6 — hold 3.6s
        await sleep(3600);
        if (cancelled) return;

        // Phase 7 — fade + unfade the ghost text char-by-char
        setDemoView({ phase: 'fading', results: shown, filters: data.filters, q });
        await sleep(320);   // CSS fade-out duration on demo preview
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for (const _ of q) {
          popChar();
          await sleep(18);
          if (cancelled) return;
        }
        setDemoView(null);

        idx = (idx + 1) % primed.length;
      }
    })().catch(() => { /* loop is best-effort */ });

    // §3 — permanent stop when the visitor focuses the input.
    // Previously we also stopped on pointerdown / keydown / wheel;
    // that killed the demo the moment a visitor scrolled the page
    // to read below the fold or tapped any adjacent chip, which
    // is exactly the wrong signal. Now: loop keeps running until
    // the visitor actually intends to type — i.e., focus lands on
    // the input. pointerdown on the input itself still fires
    // focus, so tapping the input naturally stops the loop.
    const stop = () => {
      if (demoStoppedRef.current) return;
      demoStoppedRef.current = true;
      demoCleanupRef.current();
    };
    const inp = searchInputRef.current;
    inp?.addEventListener('focus', stop);

    // Expose the stopper so the voice-active effect below (which
    // runs in its own render cycle) can also permanently kill the
    // loop without waiting for focus.
    demoStopFromOutsideRef.current = stop;

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      inp?.removeEventListener('focus', stop);
      armField?.classList.remove('demo-armed');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Deterministic pseudo-random seed for typing noise so the cadence
  // stays reproducible across cycles (avoids Date.now-flavoured jitter
  // which reads as "network lag" rather than "human typing").
  function gt_seed(q: string, ch: string): number {
    let h = 0;
    const s = q + ch + String(q.length);
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  // Feedback fix — mic recording also has to hide the mark AND
  // stop the demo loop. Focus alone doesn't fire when the visitor
  // taps the mic button, so we bridge from the existing voiceActive
  // state that VoiceInputButton already reports. On mic-active:
  //   * the demo loop is permanently stopped (same as focus)
  //   * the field gets `user-active` class → CSS hides the mark
  //     and removes the reserved padding-inline-start
  useEffect(() => {
    const field = searchInputRef.current?.closest('.ai-field');
    if (!field) return;
    if (voiceActive) {
      field.classList.add('user-active');
      demoStopFromOutsideRef.current();
    } else {
      field.classList.remove('user-active');
    }
  }, [voiceActive]);

  const revealFor = useCallback(async (adId: string) => {
    if (!isLoggedIn()) { setBlock({ kind: 'unauth', adId }); return; }
    if (revealing) return;
    setRevealing(adId);
    try {
      const r = await searchApi.revealContact(adId);
      setReveals((s) => ({ ...s, [adId]: r }));
      // O1 — the intent that survived login/renew is now spent.
      clearPendingReveal();
    } catch (e) {
      // apiFetch now carries the structured server payload on .cause —
      // pull tier/used/limit from there so the quota modal surfaces real
      // numbers instead of "0 מתוך 0".
      // apiFetch now carries the structured server payload on .cause —
      // pull status/code/tier from there. The old code kept a regex
      // fallback on `.message` for pre-ApiError throws, but everything
      // that reaches this catch after 111fb62 is an ApiError; the
      // regex was dead code that also tripped the "no raw .message"
      // grep. Strip it — status/code cover all real cases, and the
      // final else uses mapApiError so the modal shows Hebrew.
      const cause  = e instanceof ApiError ? e.cause : null;
      const status = cause?.status;
      const code   = cause?.error || cause?.code;
      const tierHe = tierLabelHe(cause?.tier as string | undefined);

      if (status === 401) {
        setBlock({ kind: 'unauth', adId });
      } else if (code === 'tier_reveal_limit') {
        setBlock({
          kind: 'quota',
          tier:  tierHe,
          used:  (cause?.used  as number) ?? 0,
          limit: (cause?.limit as number) ?? 0,
          adId,
        });
      } else if (code === 'subscription_required' || status === 402) {
        setBlock({ kind: 'expired', tier: tierHe, adId });
      } else {
        // Carry adId + status so the modal can offer "try again" and
        // pick friendlier copy for transient 5xx/503 failures. The
        // modal preserves pendingReveal on error blocks so a retry
        // (immediate or after a refresh) still knows which ad the
        // visitor came here to see.
        setBlock({
          kind:    'error',
          message: mapApiError(e),
          adId,
          status:  status,
        });
      }
    } finally { setRevealing(null); }
  }, [revealing]);

  // O1 — restore a reveal intent that outlived its URL. If the visitor
  // came back logged-in with no ?reveal= (returnTo lost to refresh /
  // OTP restart / tab close), promote the stashed adId to a URL param
  // so the existing reveal-on-mount effect below picks it up.
  useEffect(() => {
    if (params.get('reveal')) return;
    if (!isLoggedIn()) return;
    const pending = readPendingReveal();
    if (!pending) return;
    const url = new URL(window.location.href);
    url.searchParams.set('reveal', pending.adId);
    router.replace(url.pathname + url.search + url.hash);
  }, [params, router]);

  useEffect(() => {
    const target = params.get('reveal');
    if (!target) return;
    if (reveals[target] || block) return;
    // Look in search results OR near_matches OR the recent-ads grid.
    // After a post-register redirect the user typically lands here
    // without a query, so recent is the only surface where the target
    // card exists yet. NM: a reveal-return-target might have been a
    // near-match card the visitor clicked before bouncing to login —
    // that ad still needs to be findable when they return.
    const ad = resp?.results.find((a) => a.id === target)
            ?? resp?.near_matches?.find((a) => a.id === target)
            ?? recent.find((a) => a.id === target);
    if (ad) {
      revealFor(ad.id);
      const url = new URL(window.location.href);
      url.searchParams.delete('reveal');
      router.replace(url.pathname + url.search + url.hash);
      return;
    }
    // RT — hard stop the silent wait once both surfaces have finished
    // loading and neither carries the target. Previously the effect
    // returned early forever, leaving the user staring at a bare
    // landing without any explanation for the missed reveal. Also
    // clear the stashed intent so the next login doesn't try to
    // re-route to the same missing ad. `loading` guards against
    // firing mid-search — we still want the in-flight results to
    // have a chance to include the target before we give up.
    if (recentLoaded && !loading) {
      setBlock({ kind: 'error', message: 'המודעה כבר לא זמינה' });
      clearPendingReveal();
      const url = new URL(window.location.href);
      url.searchParams.delete('reveal');
      router.replace(url.pathname + url.search + url.hash);
    }
  }, [params, resp, recent, recentLoaded, loading, reveals, block, revealFor, router]);

  return (
    <>
      <LandingNav onLeadCapture={() => setLeadModalOpen(true)} />
      <RevealModal
        block={block}
        onClose={() => setBlock(null)}
        onRetry={(adId) => { void revealFor(adId); }}
      />

      <div className="min-h-screen flex flex-col">
        <main className="flex-1 pb-8">
          {/* SP — sticky search bar. Hoisted to be a direct child of
              <main> so its containing block spans the whole scrollable
              page and `position: sticky` survives past the hero into
              the results section. `top-16` = LandingNav's h-16, so the
              bar docks flush against the bottom of the nav; z-40 sits
              under the nav (z-50) and under RevealModal (z-50) but
              above content. bg-white/95 + backdrop-blur separates it
              from scrolled content without the aggressive full opaque
              band that would fight the hero gradient underneath.
              Same DOM element in every scroll state — no swap.
              SP2 — `mt-16` pushes the bar's NATURAL position down to
              y=64px (below the fixed nav). Without it, at scroll=0
              the bar renders at y=0-68 in the layout with only ~4px
              visible below the nav — sticky only kicks in after
              scroll >= 64. mt-16 makes the bar visible under the nav
              from first paint; sticky is a no-op visually until the
              user actually scrolls. */}
          <div className="sticky top-16 mt-16 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-sm">
            {/* Height budget (WCAG-tight): 44px row + 8px wrapper py-1
                + 8px form py-1 + 4px border = 64px on 390. Desktop
                gets 4px more wrapper padding → 68px, under the 72px
                ceiling. */}
            <div className="max-w-5xl mx-auto px-3 sm:px-4 py-1 sm:py-1.5">
              <form
                onSubmit={(e) => { e.preventDefault(); cancelTyping(); runSearch(); }}
                className="flex items-center gap-2 sm:gap-3 rounded-xl border-2 border-slate-200 bg-white px-2 sm:px-3 py-1 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-200 transition-colors motion-reduce:transition-none"
                role="search"
                aria-label="חיפוש בפורטל"
              >
                <SearchIcon className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
                {/* F2 §1 — the AI mark. Rendered inside a
                    position:relative .ai-field wrapper alongside a
                    read-only .ai-ghost overlay (aria-hidden,
                    pointer-events:none). The mark itself never
                    unmounts — the same DOM node persists across
                    the whole page lifetime; only its class changes
                    between .is-rest and .is-caret. F2 §2 will
                    later inject demo characters BEFORE the mark
                    via insertAdjacentText so the ghost text pushes
                    the mark leftward as it grows — same DOM node,
                    no FLIP, no absolute positioning of the mark.
                    The user's real input stays a plain controlled
                    React <input> — the demo/ghost is one-way
                    read-only (no IME/paste/binding to sync). */}
                <div className="ai-field">
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={q}
                    // F1 §2 — skip-to-end. Any keyboard input during a
                    // chip-typing animation cancels it so the visitor
                    // types their own text into the input immediately
                    // (no half-typed chip leftover, no race between
                    // their keystrokes and the typing timer's next
                    // tick). Enter is handled by onSubmit above, which
                    // also calls cancelTyping().
                    onChange={(e) => { cancelTyping(); setQ(e.target.value); }}
                    // SR — focus signals to the LiveActivityFeed suspend
                    // gate; bubble slides out on focus, waits 3s after
                    // blur before reappearing.
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    // SP — placeholder-as-example: teaches the smart-query
                    // syntax in-context (better than "חפש").
                    placeholder="נסה: 20 פועלים סינים במרכז"
                    aria-label="חיפוש חכם — תיאור חופשי בעברית"
                    className="ai-field-input flex-1 min-w-0 h-11 text-base sm:text-lg outline-none placeholder:text-slate-400 bg-transparent"
                  />
                  <div className="ai-ghost" aria-hidden="true">
                    {/* Ghost text — F2 §2 mutates this node's
                        textContent imperatively (append per typed
                        char, pop per unfade char). Its inner text
                        colour flips to visible only while the demo
                        is active; when idle/stopped it inherits the
                        transparent parent so nothing shows. */}
                    <span ref={ghostTextRef} className="ai-ghost-text" />
                    <span ref={markRef} dir="ltr" className="ai-mark is-rest">AI</span>
                  </div>
                </div>
                {/* Track V — mic button. Auto-focus on transcript
                    lets the user proofread before submitting. */}
                <VoiceInputButton
                  onTranscript={(text) => {
                    setQ(text);
                    searchInputRef.current?.focus();
                    setVoiceError('');
                    setAwaitingSubmit(true);
                    setTimeout(() => setAwaitingSubmit(false), 2500);
                  }}
                  onError={(msg) => setVoiceError(msg)}
                  onActiveChange={setVoiceActive}
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || (q.trim().length < 2 && !anyFilter)}
                  className={
                    // SP — brand-600 (#f78203) + slate-900 text is the
                    // AA-passing pairing (measured from DOM: 6.93:1).
                    // White text on brand-600 fails at 2.6:1. Do not
                    // "invert" for "more punch".
                    // SP2 — hover previously darkened to brand-800
                    // (#a5530b). Measured contrast of slate-900 on
                    // brand-800 = 2.59:1 — that fails AA. Hover now
                    // LIGHTENS to brand-500 (#f88b17), keeping the
                    // slate-900 text at ≈6.5:1 which passes AA.
                    // Common enough interaction pattern for high-
                    // contrast brand buttons (rest = the resting
                    // brand; hover = a brighter cue that the button
                    // is interactive) and keeps the same DS family.
                    // Focus ring uses slate-900 for max contrast on
                    // ANY background including brand-600/500.
                    // min-h-11 = 44px minimum tap target.
                    // motion-reduce:transition-none respects the user
                    // preference for the shadow transition.
                    `min-h-11 min-w-11 bg-brand-600 hover:bg-brand-500 text-slate-900 text-sm sm:text-base font-bold px-4 sm:px-5 rounded-lg disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 shrink-0 transition-shadow motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900 focus-visible:ring-offset-2 ` +
                    (awaitingSubmit ? 'ring-4 ring-brand-300 animate-pulse motion-reduce:animate-none' : '')
                  }
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" /> : <SearchIcon className="w-4 h-4 sm:w-5 sm:h-5" />}
                  <span>חפש</span>
                </button>
              </form>
            </div>
          </div>

          {/* Category tiles + search — the commercial hero */}
          <section id="search-hero" className="bg-gradient-to-b from-slate-50 to-white pt-6 pb-6">
            {/* Landing IA — search-first on mobile.
                Was `space-y-6` (block layout, DOM order = display order:
                heading → tiles → search → chips → advanced). At 390px
                the 4 category tiles took up ~50% of first fold and
                pushed the search — the actual primary action — below.
                Now `flex flex-col` with `order-N`:
                  order-1: heading (both viewports)
                  order-2: SEARCH FORM on mobile (was 3rd)
                  order-3: chips
                  order-4: advanced-filters toggle
                  order-5: category tiles on mobile (was 2nd)
                sm+ overrides restore the desktop order (tiles above
                the search) so the desktop layout doesn't regress. */}
            <div className="max-w-5xl mx-auto px-4 flex flex-col gap-6">
              <div className="order-1 text-center space-y-2">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                  הפלטפורמה לקבלנים ולתאגידי כוח אדם
                </h1>
                <p className="text-base sm:text-lg font-semibold text-slate-700">
                  לעובדים זרים בענף הבנייה
                </p>
              </div>

              {/* F1 §1 — the four category tiles were removed. See the
                  block comment at the CHIPS declaration for why.
                  The chip row below now sits directly under the h1,
                  is the ONLY affordance in the hero besides the
                  sticky bar itself, and stays visible after search
                  (F1 §1b) so a visitor who saw a demo can click a
                  second one without re-typing. */}

              {/* SP — the hero's inline search form was hoisted above
                  into a page-wide sticky bar (see main's direct child
                  at line ~420). No duplicate form here — same DOM
                  element in every scroll state. */}

              {/* Suggestion chips — directly below the input, still the
                  quickest way for a first-time visitor to learn the smart
                  syntax by clicking an example. */}
              {/* 1ב׳ — voice-transcribe error surfaces its OWN toast
                  right under the search form, NOT inside the results
                  section. That keeps mic failures visually adjacent
                  to the button that produced them, and prevents the
                  results-area red banner from being triggered by a
                  totally unrelated code path. Dismissable. */}
              {voiceError && (
                <div className="order-2 sm:order-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <span className="flex-1">{voiceError}</span>
                  <button
                    type="button"
                    onClick={() => setVoiceError('')}
                    aria-label="סגור"
                    className="text-red-800 hover:bg-red-100 rounded px-1 shrink-0"
                  >×</button>
                </div>
              )}

              {/* F1 §1b — chips stay visible AFTER a search too.
                  Previously wrapped in `!resp && !loading`, which
                  meant a first-time visitor learned the shortcut
                  exactly ONCE and then lost the pattern the moment
                  they got results. Now: always present. On 390,
                  single-row horizontal scroll (`overflow-x-auto`
                  + `whitespace-nowrap`) so a second row can't push
                  the results below the fold; on desktop, wrapping
                  centred. The active chip during its typing
                  animation gets `aria-pressed="true"` so a keyboard
                  or SR user knows what's producing the input. */}
              <div
                role="group"
                aria-label="דוגמאות לחיפוש"
                className="order-3 sm:order-4 flex gap-2 overflow-x-auto sm:flex-wrap sm:justify-center px-1 -mx-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {CHIPS.map((chip) => {
                  const isNav    = 'href' in chip && !!chip.href;
                  const isActive = animChipKey === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => onChipClick(chip)}
                      aria-pressed={isNav ? undefined : isActive}
                      className={`shrink-0 whitespace-nowrap text-xs sm:text-sm px-3 py-1.5 rounded-full border transition inline-flex items-center gap-1.5 min-h-[32px] ${
                        isActive
                          ? 'border-brand-500 bg-brand-50 text-slate-900'
                          : 'border-slate-300 bg-white hover:border-brand-400 hover:bg-brand-50 text-slate-700'
                      }`}
                    >
                      {isNav && <Globe2 className="w-3.5 h-3.5 text-brand-700 shrink-0" aria-hidden="true" />}
                      <span>{chip.label}</span>
                      {isNav && <ArrowLeftCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>

              {/* Advanced filters — collapsed by default so they don't
                  compete with the smart search. Auto-opens when the URL
                  already carries a filter (shared link case). Same three
                  enum selects as before; runSearch still folds them into
                  the LLM query and syncFiltersToUrl still mirrors to
                  ?prof=&region=&origin=. */}
              <div className="order-4 sm:order-5 text-center">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((o) => !o)}
                  aria-expanded={advancedOpen}
                  aria-controls="advanced-filters-panel"
                  className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-brand-800"
                >
                  <span aria-hidden="true">{advancedOpen ? '▴' : '▾'}</span>
                  <span className="underline underline-offset-2">
                    {advancedOpen ? 'סגור סינון מתקדם' : 'סינון מתקדם'}
                  </span>
                  {anyFilter && (
                    <span className="text-[10px] font-bold text-brand-700 bg-brand-50 border border-brand-200 rounded-full px-1.5 py-0.5">
                      פעיל
                    </span>
                  )}
                </button>

                {advancedOpen && (
                  <div
                    id="advanced-filters-panel"
                    className="mt-3 mx-auto max-w-3xl flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center sm:justify-center gap-2 text-sm bg-white border border-slate-200 rounded-xl p-3"
                  >
                    {/* M1 mobile — selects stack full-width so at 390px
                        the labels + values are readable, not squeezed
                        into a wrapping strip. min-h-11 keeps them tap-
                        friendly. */}
                    <select
                      value={fProf}
                      onChange={(e) => setFProf(e.target.value)}
                      aria-label="מקצוע"
                      className="w-full sm:w-auto min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
                    >
                      <option value="">כל המקצועות</option>
                      {professions.map((p) => (
                        <option key={p.code} value={p.code}>{p.name_he}</option>
                      ))}
                    </select>
                    <select
                      value={fRegion}
                      onChange={(e) => setFRegion(e.target.value)}
                      aria-label="אזור"
                      className="w-full sm:w-auto min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
                    >
                      <option value="">כל הארץ</option>
                      {regions.map((r) => (
                        <option key={r.code} value={r.code}>{r.name_he}</option>
                      ))}
                    </select>
                    <select
                      value={fOrigin}
                      onChange={(e) => setFOrigin(e.target.value)}
                      aria-label="ארץ מוצא"
                      className="w-full sm:w-auto min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
                    >
                      <option value="">כל הארצות</option>
                      {origins.map((o) => (
                        <option key={o.code} value={o.code}>{o.name_he}</option>
                      ))}
                    </select>
                    {anyFilter && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="text-xs text-slate-500 hover:text-brand-800 underline underline-offset-2 min-h-11"
                      >
                        נקה סינון
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* SR — commercial slots hide during an active search / while
              loading, so the results section sits directly beneath the
              hero. The mosaic below (line ~660) already uses the same
              `!resp && !loading` gate, so the whole page stays
              consistent: search inactive → ads + mosaic; search active
              → results first. Ads reappear intact once the user clears
              the query. */}
          {/* F2 §2 — the live demo preview. Only renders when the
              loop is active AND there's no user search on screen.
              A user-initiated search (resp/loading/searchError) OR
              a permanent-stop (§3) both hide this — no chance of
              collision with the visitor's own results.
              aria-hidden + pointer-events:none per §2 accessibility
              rule (no announcement, no click surface). Fixed height
              on 390 so the surrounding layout doesn't jump between
              scanning/showing/fading states. */}
          {demoView && !resp && !searchError && !loading && (
            <section
              aria-hidden="true"
              className={`demo-preview demo-phase-${demoView.phase} px-4 pt-3`}
            >
              <div className="max-w-6xl mx-auto">
                <div className="demo-scan-wrap">
                  <div className="demo-scan" />
                </div>
                {/* Tags row — mirrors the real 'הבנתי:' tags styling
                    but is inert (no ✕). Each pill fades in with a
                    105ms stagger via CSS animation-delay. */}
                <div className="demo-tags flex items-center flex-wrap gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-700 shrink-0">הבנתי:</span>
                  {(() => {
                    const f = demoView.filters;
                    const items: string[] = [];
                    items.push(f.ad_type === 'housing' ? 'דיור' : 'עובדים');
                    if (f.profession_code) items.push(labelFor(professions, f.profession_code));
                    if (f.origin_country)  items.push(labelFor(origins,     f.origin_country));
                    if (f.region)          items.push(labelFor(regions,     f.region));
                    if (f.quantity)        items.push(String(f.quantity));
                    return items.map((t, i) => (
                      <span key={i} className="demo-tag inline-flex items-center rounded-full border border-brand-200 bg-white text-brand-900 text-xs font-semibold px-2 py-0.5" style={{ animationDelay: `${i * 105}ms` }}>
                        {t}
                      </span>
                    ));
                  })()}
                </div>
                {/* Cards — max 2 (§4). Each staggers in via 120ms delay. */}
                <ul className="demo-cards space-y-2">
                  {demoView.results.map((ad, i) => (
                    <li key={ad.id} className="demo-card rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" style={{ animationDelay: `${i * 120 + 210}ms` }}>
                      <div className="text-sm font-bold text-slate-900 truncate">{ad.title_he}</div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {ad.ad_type === 'worker' ? (
                          <>
                            {ad.profession_code && <span>{labelFor(professions, ad.profession_code)}</span>}
                            {ad.origin_country  && <span> · {labelFor(origins, ad.origin_country)}</span>}
                            {ad.region          && <span> · {labelFor(regions, ad.region)}</span>}
                            {ad.quantity        && <span> · {ad.quantity} עובדים</span>}
                          </>
                        ) : (
                          <>
                            {ad.city && <span>{ad.city}</span>}
                            {ad.available_beds && <span> · {ad.available_beds} מיטות</span>}
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {!resp && !searchError && !loading && (
            <>
              {/* Featured (boosted) ads carousel — yad2 top commercial slot */}
              <section className="pb-6">
                <FeaturedAdsCarousel />
              </section>

              {/* Trust bar */}
              <section className="pb-6">
                <LandingTrustBar />
              </section>

              {/* Leaderboard ad slot (existing sponsor banner) */}
              <section className="px-4 pb-6">
                <AdCarousel />
              </section>
            </>
          )}

          {/* verify(L2) — screen-reader status region. Always in the DOM so
              aria-live triggers when text changes. Announces search
              lifecycle: loading → result count / no-match / error.
              NMC — exact + near broken out; wording matches the amber
              near-match heading so SR users hear the same story
              sighted users read. "תוצאה אחת" vs "N תוצאות" plural. */}
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {loading
              ? 'מחפש מודעות…'
              : searchError
                ? `שגיאה בחיפוש: ${searchError}`
                : resp
                  ? (() => {
                      const exact = resp.results.length;
                      const near  = resp.near_matches?.length ?? 0;
                      if (exact === 0 && near === 0) return 'לא נמצאו מודעות התואמות לחיפוש';
                      const exactPart = exact === 1 ? 'תוצאה אחת מדויקת' : `${exact} תוצאות מדויקות`;
                      if (near === 0) return `נמצאו ${exactPart}`;
                      return `${exactPart} · ${near} תוצאות קרובות`;
                    })()
                  : ''}
          </div>

          {/* Search results (when query is active) */}
          {(resp || searchError || loading) && (
            <section
              id="search-results"
              ref={searchResultsRef}
              className="max-w-6xl mx-auto px-4 py-2 scroll-mt-16"
            >
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 space-y-4 min-w-0">
                  {searchError && (
                    <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{searchError}</div>
                  )}

                  {/* SR — card-shaped skeleton while the LLM + rerank
                      round-trip runs (real mode can take ~3s). Shows
                      the shape of what's coming so the user doesn't
                      feel abandoned. Only when there's no prior resp
                      to show — a re-search over existing results
                      keeps the old cards visible until the new set
                      lands, less jarring than blanking then flashing
                      new content. */}
                  {loading && !resp && (
                    <ul className="space-y-3" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <li key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm animate-pulse">
                          <div className="h-4 w-3/5 bg-slate-100 rounded-md mb-2" />
                          <div className="h-3 w-2/5 bg-slate-100 rounded-md" />
                          <div className="mt-4 h-9 w-40 bg-slate-100 rounded-lg" />
                        </li>
                      ))}
                    </ul>
                  )}
                  {resp && (() => {
                    // F1 §3 — the pre-F1 strip was a single flat
                    // sentence ("המנוע הבין: עובדים · מקצוע: ריצוף
                    // · מוצא: סין (3 תוצאות)"). Reads like a caption,
                    // not like an interactive control. Now: each dim
                    // is a pill; ✕ removes it and re-runs the search
                    // without that dim.
                    //
                    // The re-run strategy (no backend change): drop
                    // the ✕'d dim from filters, then reconstruct a
                    // Hebrew query from the REMAINING dims via the
                    // same labelFor mapping the strip uses. The
                    // rewriter re-extracts and searches. That means
                    // the results after removal are 100% consistent
                    // with what the user sees in the remaining tags,
                    // and we don't have to string-strip Hebrew from
                    // the freeform query text (fragile).
                    //
                    // Dims not extracted DON'T render — no "כמות: —"
                    // clutter (F1 §3 rule "היעדר תג הוא המידע").
                    // Count text stays exactly as NMC left it — F1
                    // §3 explicitly forbids touching it.
                    const f = resp.filters;
                    const tags: Array<{ dim: string; label: string }> = [];
                    tags.push({ dim: 'ad_type', label: f.ad_type === 'housing' ? 'דיור' : 'עובדים' });
                    if (f.profession_code) tags.push({ dim: 'profession_code', label: labelFor(professions, f.profession_code) });
                    if (f.origin_country)  tags.push({ dim: 'origin_country',  label: labelFor(origins,     f.origin_country) });
                    if (f.region)          tags.push({ dim: 'region',          label: labelFor(regions,     f.region) });
                    if (f.quantity)        tags.push({ dim: 'quantity',        label: String(f.quantity) });

                    function rerunWithout(dim: string): void {
                      const parts: string[] = [];
                      const ad = dim === 'ad_type' ? 'worker' : f.ad_type;
                      if (ad === 'housing')                                     parts.push('דיור');
                      if (dim !== 'quantity'        && f.quantity)              parts.push(String(f.quantity));
                      if (dim !== 'profession_code' && f.profession_code)       parts.push(labelFor(professions, f.profession_code));
                      if (dim !== 'origin_country'  && f.origin_country)        parts.push(labelFor(origins,     f.origin_country));
                      if (dim !== 'region'          && f.region)                parts.push(labelFor(regions,     f.region));
                      const nextQ = parts.join(' ').trim() || 'עובדים';
                      cancelTyping();
                      setQ(nextQ);
                      runSearch(nextQ);
                    }

                    const exact = resp.results.length;
                    const near  = resp.near_matches?.length ?? 0;
                    const countText = (() => {
                      const exactPart = exact === 1 ? 'תוצאה אחת' : `${exact} תוצאות`;
                      if (near === 0) return exactPart;
                      const exactLabel = exact === 1 ? 'תוצאה אחת מדויקת' : `${exact} תוצאות מדויקות`;
                      return `${exactLabel} · ${near} קרובות`;
                    })();
                    return (
                      <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center flex-wrap gap-2">
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Sparkles className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                          <span className="font-semibold text-slate-700">הבנתי:</span>
                        </div>
                        {tags.map((t) => (
                          <button
                            key={t.dim}
                            type="button"
                            onClick={() => rerunWithout(t.dim)}
                            aria-label={`הסר תג ${t.label}`}
                            className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white text-brand-900 hover:bg-brand-50 hover:border-brand-400 transition text-xs font-semibold px-2 py-0.5 min-h-[26px]"
                          >
                            <span>{t.label}</span>
                            <X className="w-3 h-3 text-slate-500" aria-hidden="true" />
                          </button>
                        ))}
                        <span className="text-slate-400 ms-auto shrink-0">{countText}</span>
                      </div>
                    );
                  })()}

                  {/* F1 §3b — admission banner. When the rewriter
                      failed to pin down a profession BUT results
                      exist, tell the user explicitly instead of
                      pretending the full-catalog list is a filtered
                      answer. Only appears when there ARE results —
                      the empty-results path is NM territory (§3b
                      rule "אל תיגע"). aria-live matches the visible
                      copy so SR users hear the same admission. */}
                  {resp && resp.results.length > 0 && !resp.filters.profession_code && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="text-xs text-slate-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2"
                    >
                      <Sparkles className="w-3.5 h-3.5 mt-0.5 text-amber-700 shrink-0" aria-hidden="true" />
                      <span>לא זיהינו מקצוע מסוים — מציג את כל ההיצע, לפי סדר התאמה</span>
                    </div>
                  )}

                  {resp && resp.results.length === 0 && (!resp.near_matches || resp.near_matches.length === 0) && (() => {
                    // NM — when near_matches is populated the amber
                    // "no results" empty-state is suppressed; the
                    // near-match heading below IS the message. Only
                    // reach this fallback when the second pass also
                    // came up empty (or the backend didn't run one).
                    // Public-ads-empty follow-up: only suggest "remove
                    // filter" when the LLM actually extracted one. On
                    // an unfiltered no-match the previous copy said
                    // "נסה להסיר סינון" without a filter to remove —
                    // dead advice.
                    const hasFilter = !!(
                      resp.filters.profession_code ||
                      resp.filters.origin_country ||
                      resp.filters.region ||
                      resp.filters.quantity
                    );
                    return (
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-8 text-center shadow-sm">
                      <p className="text-lg font-bold text-amber-900 mb-2">לא נמצאו מודעות התואמות</p>
                      <p className="text-sm text-amber-800 mb-4">
                        {hasFilter
                          ? 'נסה לנסח אחרת, להסיר סינון (למשל ללא ציון מוצא), או לחפש מקצוע אחר.'
                          : 'נסה לנסח אחרת או לחפש מקצוע אחר.'}
                      </p>
                      {/* F1 §1 — same CHIPS as the hero. Only the
                          query-firing chips (not the nav one) are
                          useful as an "try instead" prompt on the
                          empty-state, so we filter by `query`. */}
                      <div className="flex flex-wrap gap-2 justify-center">
                        {CHIPS.filter((c): c is Chip & { query: string } => !!c.query).map((chip) => (
                          <button
                            key={chip.key}
                            type="button"
                            onClick={() => onChipClick(chip)}
                            className="text-xs px-3 py-1.5 rounded-full border border-amber-300 bg-white hover:border-brand-400 hover:bg-brand-50 text-slate-700 transition"
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    );
                  })()}

                  {resp && resp.results.length > 0 && (
                    <ul className="space-y-3">
                      {resp.results.map((ad, i) => {
                        const revealed = reveals[ad.id];
                        const boosted  = ad.featured_until && new Date(ad.featured_until) > new Date();
                        const items: JSX.Element[] = [];
                        items.push(<AdCard key={ad.id} ad={ad} revealed={revealed} revealing={revealing === ad.id} boosted={!!boosted} onReveal={() => revealFor(ad.id)} professions={professions} origins={origins} regions={regions} />);
                        if ((i + 1) % INLINE_AD_EVERY === 0 && i < resp.results.length - 1) {
                          items.push(<InlineSponsoredAd key={`sponsored-${i}`} />);
                        }
                        return items;
                      })}
                    </ul>
                  )}

                  {/* NM — near-matches. Rendered ONLY when the backend
                      returned a second-pass set with a named relaxed
                      dimension. Copy is derived from BOTH the relaxed
                      field AND the actual alternates observed (so
                      "לא נמצאו רצפים מסין. יש מרומניה, אוקראינה" —
                      not a fixed template). The tag-per-card makes the
                      per-row difference legible without relying on
                      color alone. Never runs when exact is empty
                      without near_matches — the amber empty-state
                      above stays as-is for that case. */}
                  {resp && resp.near_matches && resp.near_matches.length > 0 && resp.relaxed && (() => {
                    const relaxed  = resp.relaxed;
                    const near     = resp.near_matches;
                    const hasExact = resp.results.length > 0;
                    // NMC — grammatical wrapper. "לא נמצאו ריצוף" is
                    // agrammatical (plural verb + singular noun). The
                    // safe fix without touching enum data: "עובדי X"
                    // — plural, gender-neutral, and works cleanly with
                    // any name_he from the professions enum. Housing
                    // stays generic "דיור" (there is no "עובדי דיור").
                    const isHousing = resp.filters.ad_type === 'housing';
                    const profLabel = resp.filters.profession_code
                      ? labelFor(professions, resp.filters.profession_code)
                      : null;
                    const workersOf = isHousing
                      ? 'דיור'
                      : (profLabel ? `עובדי ${profLabel}` : 'עובדים');

                    // Alternates observed in the near set. Distinct +
                    // Hebrew-labelled so the heading names REALITY,
                    // not a template.
                    let heading: string;
                    let tagFor: (ad: AdSearchResult) => string | undefined;
                    if (relaxed === 'quantity') {
                      const qtyRequested = resp.filters.quantity ?? '';
                      // NMC — additive when exact > 0 ("יש גם היצעים
                      // נוספים…"), negating only when exact === 0.
                      heading = hasExact
                        ? `יש גם היצעים נוספים בכמויות אחרות — אפשר לשלב בין כמה תאגידים:`
                        : `אין כרגע מודעה עם ${qtyRequested} עובדים. אלה ההיצעים הגדולים ביותר — אפשר לשלב בין כמה תאגידים.`;
                      tagFor  = (ad) => ad.quantity ? `כמות: ${ad.quantity}` : undefined;
                    } else if (relaxed === 'origin_country') {
                      const originsSeen = Array.from(new Set(near.map((a) => a.origin_country).filter(Boolean) as string[]))
                        .map((code) => labelFor(origins, code));
                      const requestedOrigin = resp.filters.origin_country
                        ? labelFor(origins, resp.filters.origin_country)
                        : '';
                      const seenPart = originsSeen.length ? `מ${originsSeen.join(', מ')}` : '';
                      // NMC — additive when exact > 0: "יש עוד X שעשויים להתאים — מ{origins}:"
                      //     — negating when exact === 0: "לא נמצאו X מ{req}. יש X מ{origins}:"
                      heading = hasExact
                        ? (seenPart
                            ? `יש עוד ${workersOf} שעשויים להתאים — ${seenPart}:`
                            : `יש עוד ${workersOf} שעשויים להתאים:`)
                        : (seenPart
                            ? `לא נמצאו ${workersOf} מ${requestedOrigin}. יש ${workersOf} ${seenPart}:`
                            : `לא נמצאו ${workersOf} מ${requestedOrigin}. הנה תוצאות קרובות:`);
                      tagFor  = (ad) => ad.origin_country ? `מוצא: ${labelFor(origins, ad.origin_country)}` : undefined;
                    } else {
                      // region
                      const regionsSeen = Array.from(new Set(near.map((a) => a.region).filter(Boolean) as string[]))
                        .map((code) => labelFor(regions, code));
                      const requestedRegion = resp.filters.region
                        ? labelFor(regions, resp.filters.region)
                        : '';
                      const seenPart = regionsSeen.length ? `ב${regionsSeen.join(', ב')}` : '';
                      heading = hasExact
                        ? (seenPart
                            ? `יש עוד ${workersOf} גם באזורים אחרים — ${seenPart}:`
                            : `יש עוד ${workersOf} גם באזורים אחרים:`)
                        : (seenPart
                            ? `אין ${workersOf} ב${requestedRegion}. יש ${seenPart}:`
                            : `אין ${workersOf} ב${requestedRegion}. הנה תוצאות קרובות:`);
                      tagFor  = (ad) => ad.region ? `אזור: ${labelFor(regions, ad.region)}` : undefined;
                    }
                    return (
                      <div className="mt-4">
                        <div
                          role="status"
                          aria-live="polite"
                          className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                        >
                          {/* NMC — the "no exact match" preamble ONLY
                              when exact === 0. When exact > 0 the
                              heading itself is already additive so we
                              don't contradict the cards above. */}
                          {!hasExact
                            ? `לא נמצאו התאמות מדויקות. מוצגות ${near.length} תוצאות קרובות. ${heading}`
                            : heading}
                        </div>
                        <ul className="space-y-3">
                          {near.map((ad) => {
                            const revealed = reveals[ad.id];
                            const boosted  = ad.featured_until && new Date(ad.featured_until) > new Date();
                            return (
                              <AdCard
                                key={ad.id}
                                ad={ad}
                                revealed={revealed}
                                revealing={revealing === ad.id}
                                boosted={!!boosted}
                                onReveal={() => revealFor(ad.id)}
                                professions={professions}
                                origins={origins}
                                regions={regions}
                                nearMatchTag={tagFor(ad)}
                              />
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}
                </div>

                <div className="hidden lg:block w-[300px] shrink-0">
                  <div className="sticky top-24">
                    <AdSidebar />
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Recent-ads mosaic (yad2-style) — only when no active search */}
          {!resp && !loading && recent.length > 0 && (
            <section className="max-w-6xl mx-auto px-4 py-4">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-3">פרסום חדש בפורטל</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {recent.slice(0, 9).map((ad) => {
                  const isHousing = ad.ad_type === 'housing';
                  return (
                    <div key={ad.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isHousing ? 'bg-slate-100 text-slate-700' : 'bg-brand-50 text-brand-700'}`}>
                          {isHousing ? <HomeIcon className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                        </div>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 line-clamp-2 min-h-[2.5rem]">{ad.title_he}</h3>
                      <p className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-2">
                        {isHousing ? (
                          <>
                            {ad.city && <span>{ad.city}</span>}
                            {ad.available_beds && <span>· {ad.available_beds} מיטות</span>}
                            {ad.price_per_bed_nis && <span>· ₪{ad.price_per_bed_nis}</span>}
                          </>
                        ) : (
                          <>
                            {ad.profession_code && <span>{ad.profession_code}</span>}
                            {ad.origin_country  && <span>· {ad.origin_country}</span>}
                            {ad.quantity        && <span>· {ad.quantity} עובדים</span>}
                          </>
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* RoleRegisterPicker — pre-F1 wrapped in `!resp && !loading`
              alongside the "how-it-works" section. The picker is a
              signup CTA that only makes sense to a visitor who
              hasn't yet run a search, so it stays gated. */}
          {!resp && !loading && <RoleRegisterPicker />}

          {/* F1 §4 — "איך זה עובד" now renders ALWAYS, below the
              results area (or below the recent-ads grid when no
              search has run). It stays as reference for visitors
              who scroll to the end but doesn't compete with a
              running search demo above the fold. */}
          <HowItWorksSection />
        </main>

        <LandingFooter />
      </div>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />

      {/* Landing IA — floating activity bubble. Mock-driven Phase 1
          (see LiveActivityFeed source for the GET /api/marketplace/
          activity-feed swap point when the backend is ready). Its
          own positioning is bottom-corner + max-w so it doesn't
          overlap the search or nav; it respects prefers-reduced-
          motion and provides an accessible close.
          SR — suspended while the visitor is engaged with search:
          input focused, voice recording/transcribing, search in
          flight, or results on screen. */}
      <LiveActivityFeed suspended={inputFocused || voiceActive || loading || !!resp} />
    </>
  );
}

function AdCard({
  ad, revealed, revealing, boosted, onReveal, professions, origins, regions, nearMatchTag,
}: {
  ad: AdSearchResult;
  revealed?: ContactReveal;
  revealing: boolean;
  boosted: boolean;
  onReveal: () => void;
  // SR — enum arrays for code→Hebrew mapping. Passed from the parent
  // (which already fetches them on mount) so the card doesn't fire
  // duplicate enum requests. Falls through to the raw code if a
  // lookup misses.
  professions: Profession[];
  origins:     { code: string; name_he: string }[];
  regions:     { code: string; name_he: string }[];
  // NM — when this card came from the second-pass near-match set, the
  // parent passes the specific dimension that differs from the
  // contractor's request ("מוצא: רומניה" / "כמות: 12"). Rendered as a
  // small amber chip inside the card so the difference is legible
  // beyond just the section separator up-page. Not color-only —
  // includes the field name in text.
  nearMatchTag?: string;
}) {
  const profLabel   = ad.profession_code ? (professions.find((p) => p.code === ad.profession_code)?.name_he ?? ad.profession_code) : null;
  const originLabel = ad.origin_country  ? (origins.find((o)     => o.code === ad.origin_country)?.name_he  ?? ad.origin_country)  : null;
  const regionLabel = ad.region          ? (regions.find((r)     => r.code === ad.region)?.name_he          ?? ad.region)          : null;
  return (
    <li
      // SP — WCAG 2.4.11 Focus Not Obscured. The page has both the
      // LandingNav (fixed, h-16 = 64px) and the sticky search bar
      // (~72px on desktop, ~64px on 390) at the top. scroll-mt-36
      // (=9rem = 144px) is the sum + a small buffer, so when the
      // browser scrolls this card into view on Tab focus, the card
      // lands BELOW both bars instead of being clipped by them.
      className={`scroll-mt-36 rounded-2xl border p-4 shadow-sm bg-white ${boosted ? 'border-amber-300' : 'border-slate-200'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-900">{ad.title_he}</h3>
          <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-2">
            {ad.ad_type === 'worker' ? (
              <>
                {profLabel   && <span>{profLabel}</span>}
                {originLabel && <span>· מוצא: {originLabel}</span>}
                {regionLabel && <span>· אזור: {regionLabel}</span>}
                {ad.quantity && <span>· {ad.quantity} עובדים</span>}
              </>
            ) : (
              <>
                {ad.city              && <span>{ad.city}</span>}
                {regionLabel          && <span>· אזור: {regionLabel}</span>}
                {ad.available_beds    && <span>· {ad.available_beds} מיטות פנויות</span>}
                {ad.price_per_bed_nis && <span>· ₪{ad.price_per_bed_nis}/מיטה</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {nearMatchTag && (
            <span className="text-[10px] font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 whitespace-nowrap">
              {nearMatchTag}
            </span>
          )}
          {boosted && <PromotedBadge />}
        </div>
      </div>

      {ad.ad_type === 'housing' && Array.isArray(ad.amenities) && ad.amenities.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {ad.amenities.map((a) => (
            <span key={a} className="text-[10px] font-semibold text-slate-600 bg-slate-100 rounded-full px-2 py-0.5">{a}</span>
          ))}
        </div>
      )}
      {ad.ad_type === 'housing' && Array.isArray(ad.photos) && ad.photos.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {ad.photos.slice(0, 4).map((url) => (
            <img
              key={url}
              src={url}
              alt={ad.title_he ?? ''}
              className="w-24 h-24 rounded-lg object-cover shrink-0 border border-slate-200"
            />
          ))}
        </div>
      )}
      {ad.body_he && <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{ad.body_he}</p>}

      <div className="pt-3 mt-3 border-t border-slate-100">
        {revealed ? (
          <div className="text-sm text-slate-800 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-slate-500" />
              {revealed.company_name || '—'}
            </div>
            {revealed.phone && (
              <a href={`tel:${revealed.phone}`} className="text-brand-700 hover:underline flex items-center gap-1.5">
                <Phone className="w-4 h-4" /> <span dir="ltr">{revealed.phone}</span>
              </a>
            )}
            {revealed.email && (
              <a href={`mailto:${revealed.email}`} className="text-brand-700 hover:underline flex items-center gap-1.5">
                <Mail className="w-4 h-4" /> <span dir="ltr">{revealed.email}</span>
              </a>
            )}
            {/* R2 — reassure the user that a re-view of this ad won't
                cost a second reveal. Meets the top churn interview
                complaint on paywalled directories: 'did that click
                just charge me?' */}
            <p className="text-xs text-slate-500 pt-1">
              נשמר לך — לא ייגבו חשיפות נוספות על מודעה זו.
            </p>
            {/* R4 — cross-flow discovery on the "warm" moment after a
                successful reveal. Contractor who just got a corp's
                phone number is a warm lead for related surfaces. */}
            <Link
              href={ad.ad_type === 'worker' ? '/marketplace?category=housing' : '/'}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-900"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {ad.ad_type === 'worker'
                ? 'צריך גם דיור לפועלים? עיין בשירותים נלווים'
                : 'מחפש גם עובדים? חפש כאן'}
              <ArrowLeft className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={onReveal}
            disabled={revealing}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:bg-slate-300"
          >
            {revealing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
            הצג פרטי קשר
          </button>
        )}
      </div>
    </li>
  );
}

// Next 16 requires useSearchParams() to sit inside a Suspense boundary
// or the page bails out of static generation with a prerender error.
// Fallback keeps the layout height stable while the CSR-bail resolves.
export default function LandingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-b from-slate-50 to-white" />}>
      <LandingPageInner />
    </Suspense>
  );
}
