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

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2, Search as SearchIcon, Mail, Phone, Building2, Sparkles,
  Users, Home as HomeIcon, Globe2, Boxes,
} from 'lucide-react';
import LandingNav from '@/components/landing/LandingNav';
import LandingFooter from '@/components/landing/LandingFooter';
import LeadCaptureModal from '@/components/landing/LeadCaptureModal';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import { AdCarousel } from '@/features/advertising/AdCarousel';
import { AdSidebar } from '@/features/advertising/AdSidebar';
import { InlineSponsoredAd } from '@/features/advertising/InlineSponsoredAd';
import { RevealModal, type RevealBlock } from '@/features/advertising/RevealModal';
import { RoleRegisterPicker } from '@/features/advertising/RoleRegisterPicker';
import { FeaturedAdsCarousel } from '@/features/advertising/FeaturedAdsCarousel';
import { LandingTrustBar } from '@/features/advertising/LandingTrustBar';
import { searchApi, type SearchResponse, type AdSearchResult, type ContactReveal } from '@/lib/api/search';
import { apiFetch } from '@/lib/api/client';
import { isLoggedIn } from '@/lib/auth';

const EXAMPLES = [
  'מחפש 4 פועלים סינים לריצוף',
  'מחפש מקום לינה ל-4 פועלים מסין באזור המרכז',
  '2 חשמלאים אוקראינים בתל אביב',
  'רתך מיומן באזור הצפון',
];
const INLINE_AD_EVERY = 5;

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

export default function LandingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  const [q, setQ]           = useState('');
  const [resp, setResp]     = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [reveals, setReveals]     = useState<Record<string, ContactReveal>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [block, setBlock]         = useState<RevealBlock | null>(null);

  const [recent, setRecent] = useState<PublicAd[]>([]);

  useEffect(() => {
    apiFetch<{ results: PublicAd[] }>('/ads/public/recent?limit=12')
      .then((r) => setRecent(r.results))
      .catch(() => setRecent([]));
  }, []);

  async function runSearch(rawQ?: string) {
    const query = (rawQ ?? q).trim();
    if (query.length < 2) return;
    setQ(query);
    setLoading(true);
    setError('');
    try { setResp(await searchApi.query(query)); }
    catch (e) { setError((e as Error).message ?? 'שגיאה בחיפוש'); }
    finally { setLoading(false); }
  }

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
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/401|Unauthorized/i.test(msg))                      setBlock({ kind: 'unauth', adId });
      else if (/tier_reveal_limit/i.test(msg))                setBlock({ kind: 'quota', tier: 'הנוכחי', used: 0, limit: 0, adId });
      else if (/subscription_required|402|expired/i.test(msg)) setBlock({ kind: 'expired', tier: 'הנוכחי', adId });
      else                                                    setBlock({ kind: 'error', message: msg || 'שגיאה בחשיפה' });
    } finally { setRevealing(null); }
  }, [revealing]);

  useEffect(() => {
    const target = params.get('reveal');
    if (!target || !resp) return;
    if (reveals[target] || block) return;
    const ad = resp.results.find((a) => a.id === target);
    if (ad) revealFor(ad.id);
    const url = new URL(window.location.href);
    url.searchParams.delete('reveal');
    router.replace(url.pathname + url.search + url.hash);
  }, [params, resp, reveals, block, revealFor, router]);

  return (
    <>
      <LandingNav onLeadCapture={() => setLeadModalOpen(true)} />
      <RevealModal block={block} onClose={() => setBlock(null)} />

      <div className="min-h-screen flex flex-col">
        <main className="flex-1 pb-8">
          {/* Category tiles + search — the commercial hero */}
          <section id="search-hero" className="bg-gradient-to-b from-slate-50 to-white pt-24 pb-6">
            <div className="max-w-5xl mx-auto px-4 space-y-6">
              <div className="text-center space-y-2">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                  שוק העובדים והדיור לענף הבנייה
                </h1>
                <p className="text-sm sm:text-base text-slate-600">
                  חפשו בשפה חופשית · תאגידים מפרסמים · חיבור ישיר
                </p>
              </div>

              {/* Category tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                          ? 'border-slate-200 bg-white opacity-60 cursor-not-allowed'
                          : 'border-slate-200 bg-white hover:border-brand-400 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cat.soon ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-700'}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        {cat.soon && (
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">בקרוב</span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{cat.label}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{cat.desc}</p>
                    </button>
                  );
                })}
              </div>

              {/* Fat search bar */}
              <form
                onSubmit={(e) => { e.preventDefault(); runSearch(); }}
                className="bg-white border border-slate-200 rounded-2xl p-3 shadow-md"
              >
                <div className="flex items-center gap-2">
                  <SearchIcon className="w-5 h-5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="לדוגמה: מחפש 4 פועלים סינים לריצוף"
                    className="flex-1 text-base outline-none placeholder:text-slate-400 py-1"
                  />
                  <button
                    type="submit"
                    disabled={loading || q.trim().length < 2}
                    className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2.5 rounded-lg disabled:bg-slate-300 inline-flex items-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
                    חפש
                  </button>
                </div>
              </form>

              {!resp && !loading && (
                <div className="flex flex-wrap gap-2 justify-center">
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
            </div>
          </section>

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

          {/* Search results (when query is active) */}
          {(resp || error) && (
            <section className="max-w-6xl mx-auto px-4 py-2">
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 space-y-4 min-w-0">
                  {error && (
                    <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
                  )}
                  {resp && (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 mt-0.5 text-brand-600 shrink-0" />
                      <span>
                        המנוע הבין: <b>{resp.filters.ad_type === 'housing' ? 'דיור' : 'עובדים'}</b>
                        {resp.filters.profession_code && <> · מקצוע: <b>{resp.filters.profession_code}</b></>}
                        {resp.filters.origin_country  && <> · מוצא: <b>{resp.filters.origin_country}</b></>}
                        {resp.filters.region          && <> · אזור: <b>{resp.filters.region}</b></>}
                        {resp.filters.quantity        && <> · כמות: <b>{resp.filters.quantity}</b></>}
                        <span className="text-slate-400"> ({resp.total} תוצאות)</span>
                      </span>
                    </div>
                  )}

                  {resp && resp.results.length === 0 && (
                    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-8 text-center shadow-sm">
                      <p className="text-lg font-bold text-amber-900 mb-2">לא נמצאו מודעות התואמות</p>
                      <p className="text-sm text-amber-800 mb-4">
                        נסה לנסח אחרת, להסיר סינון (למשל ללא ציון מוצא), או לחפש מקצוע אחר.
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
                  )}

                  {resp && resp.results.length > 0 && (
                    <ul className="space-y-3">
                      {resp.results.map((ad, i) => {
                        const revealed = reveals[ad.id];
                        const boosted  = ad.featured_until && new Date(ad.featured_until) > new Date();
                        const items: JSX.Element[] = [];
                        items.push(<AdCard key={ad.id} ad={ad} revealed={revealed} revealing={revealing === ad.id} boosted={!!boosted} onReveal={() => revealFor(ad.id)} />);
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
    </>
  );
}

function AdCard({
  ad, revealed, revealing, boosted, onReveal,
}: {
  ad: AdSearchResult;
  revealed?: ContactReveal;
  revealing: boolean;
  boosted: boolean;
  onReveal: () => void;
}) {
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
                {ad.profession_code && <span>{ad.profession_code}</span>}
                {ad.origin_country  && <span>· מוצא: {ad.origin_country}</span>}
                {ad.region          && <span>· אזור: {ad.region}</span>}
                {ad.quantity        && <span>· {ad.quantity} עובדים</span>}
              </>
            ) : (
              <>
                {ad.city              && <span>{ad.city}</span>}
                {ad.region            && <span>· אזור: {ad.region}</span>}
                {ad.available_beds    && <span>· {ad.available_beds} מיטות פנויות</span>}
                {ad.price_per_bed_nis && <span>· ₪{ad.price_per_bed_nis}/מיטה</span>}
              </>
            )}
          </p>
        </div>
        {boosted && (
          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            מקודם
          </span>
        )}
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
            <img key={url} src={url} alt="" className="w-24 h-24 rounded-lg object-cover shrink-0 border border-slate-200" />
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
                <Phone className="w-4 h-4" /> {revealed.phone}
              </a>
            )}
            {revealed.email && (
              <a href={`mailto:${revealed.email}`} className="text-brand-700 hover:underline flex items-center gap-1.5">
                <Mail className="w-4 h-4" /> {revealed.email}
              </a>
            )}
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
