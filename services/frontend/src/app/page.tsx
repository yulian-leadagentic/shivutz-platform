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
  Users, Home as HomeIcon, Globe2, Boxes, ArrowLeft,
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

const EXAMPLES = [
  'מחפש 4 פועלים סינים לריצוף',
  'מחפש מקום לינה ל-4 פועלים מסין באזור המרכז',
  '2 חשמלאים אוקראינים בתל אביב',
  'רתך מיומן באזור הצפון',
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

const CATEGORIES = [
  { key: 'workers',  icon: Users,   label: 'עובדים לזמינות מיידית', desc: 'ריצוף · חשמל · ריתוך · ועוד',    scrollTo: 'search' as const },
  { key: 'housing',  icon: HomeIcon,label: 'דיור לפועלים',          desc: 'מיטות פנויות לפי עיר',            scrollTo: 'search' as const, prefill: 'מחפש מקום לינה' },
  { key: 'import',   icon: Globe2,  label: 'ייבוא עובדים מחו״ל',    desc: 'בקשה מובנית · הצעות מתאגידים',    href: '/contractor/tenders' },
  { key: 'services', icon: Boxes,   label: 'ציוד ושירותים (בקרוב)', desc: 'ביטוח · הובלה · ציוד',            soon: true },
];

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
      .catch(() => setRecent([]));
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

  function pickCategory(cat: typeof CATEGORIES[number]) {
    if (cat.soon) return;
    if (cat.href) { router.push(cat.href); return; }
    if (cat.prefill) {
      setQ(cat.prefill);
      runSearch(cat.prefill);
    }
    document.getElementById('search-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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
        setBlock({ kind: 'error', message: mapApiError(e) });
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
    // Look in search results OR the recent-ads grid — after a
    // post-register redirect the user typically lands here without a
    // query, so recent is the only surface where the target card
    // exists yet.
    const ad = resp?.results.find((a) => a.id === target)
            ?? recent.find((a) => a.id === target);
    if (!ad) return;  // ad not currently rendered; wait for search / recent to load
    revealFor(ad.id);
    const url = new URL(window.location.href);
    url.searchParams.delete('reveal');
    router.replace(url.pathname + url.search + url.hash);
  }, [params, resp, recent, reveals, block, revealFor, router]);

  return (
    <>
      <LandingNav onLeadCapture={() => setLeadModalOpen(true)} />
      <RevealModal block={block} onClose={() => setBlock(null)} />

      <div className="min-h-screen flex flex-col">
        <main className="flex-1 pb-8">
          {/* Category tiles + search — the commercial hero */}
          <section id="search-hero" className="bg-gradient-to-b from-slate-50 to-white pt-24 pb-6">
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
                  פלטפורמת השיבוץ הראשונה בישראל
                </h1>
                <p className="text-base sm:text-lg font-semibold text-slate-700">
                  לעובדים זרים בענף הבנייה
                </p>
              </div>

              {/* Category tiles — moved to `order-5` on mobile so they
                  fall below the search; `sm:order-2` restores the
                  desktop position (right under the heading). "בקרוב"
                  tiles are hidden entirely on mobile so they don't
                  compete for first-fold real estate (see per-tile
                  hidden-classes below). */}
              <div className="order-5 sm:order-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => pickCategory(cat)}
                      disabled={cat.soon}
                      className={`text-start rounded-2xl border p-4 transition ${
                        cat.soon
                          ? 'hidden sm:block border-slate-200 bg-white opacity-60 cursor-not-allowed'
                          : 'border-slate-200 bg-white hover:border-brand-400 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cat.soon ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-700'}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        {cat.soon && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">בקרוב</span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{cat.label}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{cat.desc}</p>
                    </button>
                  );
                })}
              </div>

              {/* Hero search — smart free-text is the single primary entry.
                  The three enum selects that used to sit above and compete
                  with this input are now hidden behind the "סינון מתקדם"
                  disclosure below.
                  M1 mobile — at ≤sm the input row and the button STACK
                  vertically full-width so the field doesn't get chopped by
                  the button on a 390px viewport. sm+ reverts to the
                  desktop single-row layout the earlier search rework
                  established. Button height is min-h-11 (44px) both
                  layouts so it stays a real tap target.
                  G1 button — bright brand-600 (#f78203, the logo orange,
                  closest DS token to the spec's #F5821F) with slate-900
                  text (matches #111827, AA ~6:1). hover→brand-800 the
                  spec's darkening step. disabled = opacity-60 fade, never
                  swapped to grey. */}
              <form
                onSubmit={(e) => { e.preventDefault(); runSearch(); }}
                className="order-2 sm:order-3 bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 shadow-md"
              >
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                    <SearchIcon className="w-6 h-6 text-slate-400 shrink-0" aria-hidden="true" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      // SR — focus signals to the LiveActivityFeed
                      // suspend gate. Bubble slides out on focus,
                      // waits 3s after blur before reappearing.
                      onFocus={() => setInputFocused(true)}
                      onBlur={() => setInputFocused(false)}
                      placeholder="לדוגמה: מחפש 4 פועלים סינים לריצוף"
                      aria-label="חיפוש חכם — תיאור חופשי בעברית"
                      className="flex-1 min-w-0 text-base sm:text-lg outline-none placeholder:text-slate-400 py-2 bg-transparent"
                    />
                    {/* Track V — mic button. Populates the input on
                        transcript so the user can proofread before
                        pressing חפש (STT errors on Hebrew trade jargon
                        are frequent; auto-search would surface wrong
                        results). */}
                    <VoiceInputButton
                      onTranscript={(text) => {
                        setQ(text);
                        searchInputRef.current?.focus();
                        setVoiceError('');  // clear a previous mic error on success
                        // Flash the חפש button so the user knows the
                        // next step is theirs — auto-clears after 2.5s.
                        setAwaitingSubmit(true);
                        setTimeout(() => setAwaitingSubmit(false), 2500);
                      }}
                      onError={(msg) => setVoiceError(msg)}
                      onActiveChange={setVoiceActive}
                      disabled={loading}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || (q.trim().length < 2 && !anyFilter)}
                    className={
                      // SR — post-transcript ring pulse. Draws the
                      // eye to the submit button after voice input
                      // populated the field. Kept ring-only (no
                      // colour swap) so the DS orange stays the
                      // primary signal.
                      `w-full sm:w-auto min-h-11 bg-brand-600 hover:bg-brand-800 text-slate-900 text-base font-bold px-5 sm:px-6 py-3 rounded-xl disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shrink-0 transition-shadow ` +
                      (awaitingSubmit ? 'ring-4 ring-brand-300 animate-pulse' : '')
                    }
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <SearchIcon className="w-5 h-5" />}
                    חפש
                  </button>
                </div>
              </form>

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

              {!resp && !loading && (
                <div className="order-3 sm:order-4 flex flex-wrap gap-2 justify-center">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => { setQ(ex); runSearch(ex); }}
                      className="text-xs px-3 py-1.5 rounded-full border border-slate-300 bg-white hover:border-brand-400 hover:bg-brand-50 text-slate-700 transition"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}

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
              lifecycle: loading → result count / no-match / error. */}
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {loading
              ? 'מחפש מודעות…'
              : searchError
                ? `שגיאה בחיפוש: ${searchError}`
                : resp
                  ? (resp.total === 0
                      ? 'לא נמצאו מודעות התואמות לחיפוש'
                      : `נמצאו ${resp.total} תוצאות`)
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
                  {resp && (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 mt-0.5 text-brand-600 shrink-0" />
                      <span>
                        {/* SR — map profession/origin/region codes to
                            Hebrew via the enum arrays already loaded
                            above. `labelFor` falls back to the raw
                            code if enum load is racing, so we never
                            end up rendering nothing. This is the
                            "why did I get these results" trust cue. */}
                        המנוע הבין: <b>{resp.filters.ad_type === 'housing' ? 'דיור' : 'עובדים'}</b>
                        {resp.filters.profession_code && <> · מקצוע: <b>{labelFor(professions, resp.filters.profession_code)}</b></>}
                        {resp.filters.origin_country  && <> · מוצא: <b>{labelFor(origins,     resp.filters.origin_country)}</b></>}
                        {resp.filters.region          && <> · אזור: <b>{labelFor(regions,     resp.filters.region)}</b></>}
                        {resp.filters.quantity        && <> · כמות: <b>{resp.filters.quantity}</b></>}
                        <span className="text-slate-400"> ({resp.total} תוצאות)</span>
                      </span>
                    </div>
                  )}

                  {resp && resp.results.length === 0 && (() => {
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
                      <div className="flex flex-wrap gap-2 justify-center">
                        {EXAMPLES.map((ex) => (
                          <button
                            key={ex}
                            type="button"
                            onClick={() => { setQ(ex); runSearch(ex); }}
                            className="text-xs px-3 py-1.5 rounded-full border border-amber-300 bg-white hover:border-brand-400 hover:bg-brand-50 text-slate-700 transition"
                          >
                            {ex}
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

          {!resp && !loading && (
            <>
              <RoleRegisterPicker />
              <HowItWorksSection />
            </>
          )}
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
  ad, revealed, revealing, boosted, onReveal, professions, origins, regions,
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
}) {
  const profLabel   = ad.profession_code ? (professions.find((p) => p.code === ad.profession_code)?.name_he ?? ad.profession_code) : null;
  const originLabel = ad.origin_country  ? (origins.find((o)     => o.code === ad.origin_country)?.name_he  ?? ad.origin_country)  : null;
  const regionLabel = ad.region          ? (regions.find((r)     => r.code === ad.region)?.name_he          ?? ad.region)          : null;
  return (
    <li
      className={`rounded-2xl border p-4 shadow-sm bg-white ${boosted ? 'border-amber-300' : 'border-slate-200'}`}
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
        {boosted && <PromotedBadge />}
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
