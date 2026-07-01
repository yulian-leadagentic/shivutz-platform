'use client';

// Pivot/v2 Phase 3 — contractor's new search-first home.
// Free-text query → backend LLM rewriter → SQL search → results.
// Contact reveal is gated on subscription (402 → modal prompts upgrade).

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Search as SearchIcon, Lock, Mail, Phone, Building2, Sparkles } from 'lucide-react';
import { searchApi, type SearchResponse, type AdSearchResult, type ContactReveal } from '@/lib/api/search';

const EXAMPLES = [
  'מחפש 4 פועלים סינים לריצוף',
  'מחפש מקום לינה ל-4 פועלים מסין באזור המרכז',
  '2 חשמלאים אוקראינים בתל אביב',
  'רתך מיומן באזור הצפון',
];

export default function ContractorSearchPage() {
  const [q, setQ]                       = useState('');
  const [resp, setResp]                 = useState<SearchResponse | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [reveals, setReveals]           = useState<Record<string, ContactReveal>>({});
  const [revealError, setRevealError]   = useState<Record<string, string>>({});
  const [revealing, setRevealing]       = useState<string | null>(null);

  async function runSearch(rawQ?: string) {
    const query = (rawQ ?? q).trim();
    if (query.length < 2) return;
    setQ(query);
    setLoading(true);
    setError('');
    try {
      setResp(await searchApi.query(query));
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בחיפוש');
    } finally {
      setLoading(false);
    }
  }

  async function reveal(ad: AdSearchResult) {
    if (revealing) return;
    setRevealing(ad.id);
    setRevealError((s) => ({ ...s, [ad.id]: '' }));
    try {
      const r = await searchApi.revealContact(ad.id);
      setReveals((s) => ({ ...s, [ad.id]: r }));
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // Backend returns 402 for "subscription_required". apiFetch surfaces the
      // detail.code in the message; we check both.
      if (/402|subscription_required/i.test(msg)) {
        setRevealError((s) => ({ ...s, [ad.id]: 'נדרש מנוי פעיל לחשיפת פרטי קשר' }));
      } else {
        setRevealError((s) => ({ ...s, [ad.id]: msg || 'שגיאה בחשיפה' }));
      }
    } finally {
      setRevealing(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900">חיפוש פועלים ודיור</h1>
        <p className="text-sm text-slate-500">תקליד מה אתה צריך בשפה חופשית — המנוע יבין</p>
      </header>

      {/* Big search bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); runSearch(); }}
        className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <SearchIcon className="w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="לדוגמה: מחפש 4 פועלים סינים לריצוף"
            autoFocus
            className="flex-1 text-base outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={loading || q.trim().length < 2}
            className="bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 rounded-lg disabled:bg-slate-300 inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
            חפש
          </button>
        </div>
      </form>

      {/* Example chips */}
      {!resp && !loading && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">דוגמאות</p>
          <div className="flex flex-wrap gap-2">
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
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Filter readback — what the engine understood */}
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

      {/* Results */}
      {resp && resp.results.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500 shadow-sm">
          לא נמצאו מודעות התואמות לחיפוש. נסה לנסח אחרת.
        </div>
      )}

      {resp && resp.results.length > 0 && (
        <ul className="space-y-3">
          {resp.results.map((ad) => {
            const revealed = reveals[ad.id];
            const rErr     = revealError[ad.id];
            const boosted  = ad.featured_until && new Date(ad.featured_until) > new Date();
            return (
              <li
                key={ad.id}
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
                    <>
                      <button
                        type="button"
                        onClick={() => reveal(ad)}
                        disabled={revealing === ad.id}
                        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:bg-slate-300"
                      >
                        {revealing === ad.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                        הצג פרטי קשר
                      </button>
                      {rErr && (
                        <div className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                          <Lock className="w-4 h-4 shrink-0" />
                          <span className="flex-1">{rErr}</span>
                          <Link href="/billing" className="font-semibold text-brand-700 hover:underline shrink-0">שדרג מנוי</Link>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
