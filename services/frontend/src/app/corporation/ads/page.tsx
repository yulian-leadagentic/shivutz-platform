'use client';

// Pivot/v2 Phase 2 — corp's "my ads" list.
// Read-only listing of what this corp has published; each card has
// edit / boost / delete actions. Boost is currently free (sets
// featured_until = now+7d); paid promotion lands in Phase 5.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, Plus, Pencil, Trash2, Zap, Eye, ArrowLeft, CreditCard, CheckCircle2, X } from 'lucide-react';
import { adApi, type AdRow } from '@/lib/api/ads';
import { PromotedBadge } from '@/components/ads/PromotedBadge';

// verify(CP3) — boost is FREE during launch (intentional product
// decision). The CTA shows the eventual price so corps see the future
// commitment; no charge is taken today. When paid boost turns on
// post-launch, these constants move to config (see services/user-org/
// app/routes/ads.py for the backend equivalent + the payment-service
// wire-up plan) and the CTA switches to a real confirmation flow.
const BOOST_DAYS   = 7;
const BOOST_PER_DAY_NIS = 5;
const BOOST_TOTAL_NIS   = BOOST_DAYS * BOOST_PER_DAY_NIS;

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL');
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000))) : null;
}

export default function CorporationAdsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [ads, setAds]         = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState<string | null>(null);
  const [error, setError]     = useState('');
  const [savedToast, setSavedToast] = useState<boolean>(false);

  // Post-save toast: /corporation/ads/new/* redirects here with
  // ?created=<id> so the corp lands on their inventory + sees confirmation.
  useEffect(() => {
    if (params.get('created')) {
      setSavedToast(true);
      const t = setTimeout(() => {
        setSavedToast(false);
        const url = new URL(window.location.href);
        url.searchParams.delete('created');
        router.replace(url.pathname + (url.search || ''));
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [params, router]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setAds(await adApi.list());
    } catch (e) {
      setError((e as Error).message ?? 'שגיאה בטעינת המודעות');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const [upgradePrompt, setUpgradePrompt] = useState<string>('');

  async function onBoost(id: string) {
    setBusy(id);
    setUpgradePrompt('');
    setError('');
    try { await adApi.boost(id); await refresh(); }
    catch (e) {
      const msg = (e as Error).message ?? '';
      if (/can_boost|tier_active_ad_limit|subscription_required|402/i.test(msg)) {
        setUpgradePrompt('קידום מודעות זמין רק במסלול מתקדם ומעלה. שדרג עכשיו כדי לקדם את המודעה.');
      } else {
        setError(msg || 'שגיאה בקידום');
      }
    }
    finally { setBusy(null); }
  }

  async function onDelete(id: string) {
    if (!confirm('למחוק את המודעה?')) return;
    setBusy(id);
    try { await adApi.remove(id); await refresh(); }
    catch (e) { setError((e as Error).message ?? 'שגיאה במחיקה'); }
    finally  { setBusy(null); }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">המודעות שלי</h1>
          <p className="text-sm text-slate-500">פרסום זמינות עובדים, ובהמשך גם דיור (שלב 4)</p>
        </div>
        <Link
          href="/corporation/ads/new"
          className="inline-flex items-center gap-2 bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
        >
          <Plus className="w-4 h-4" />
          מודעה חדשה
        </Link>
      </header>

      {savedToast && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 shadow-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="flex-1 text-sm text-emerald-900 font-medium">
            המודעה נשמרה ותפורסם בקרוב. היא מופיעה כעת ברשימה למטה.
          </p>
          <button
            type="button"
            onClick={() => setSavedToast(false)}
            aria-label="סגור"
            className="text-emerald-700 hover:bg-emerald-100 rounded-full p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {upgradePrompt && (
        <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-l from-amber-50 to-white p-4 shadow-sm flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-900">שדרוג נדרש</p>
            <p className="text-sm text-amber-800 mt-0.5">{upgradePrompt}</p>
          </div>
          <Link
            href="/billing"
            className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-4 py-2 rounded-lg shrink-0"
          >
            <CreditCard className="w-4 h-4" />
            לחץ כאן לשדרוג
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-400" /></div>
      ) : ads.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500 shadow-sm">
          עוד לא פרסמת מודעות. לחץ "מודעה חדשה" כדי להתחיל.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ads.map((ad) => {
            const boosted = ad.featured_until && new Date(ad.featured_until) > new Date();
            // CP1 — ad lifecycle status derived from active flag +
            // expires_at + the paused_by grace latch (Wave 1 B3).
            // Three visible states so corps stop asking 'why did my
            // ad disappear':
            //   פעיל    — active + not expired
            //   מושהה   — paused (either manually or by grace hard-cap)
            //   פג      — expires_at in the past
            const expired = ad.expires_at && new Date(ad.expires_at) < new Date();
            const paused  = !ad.active;
            const status: 'live' | 'paused' | 'expired' =
              expired ? 'expired' : paused ? 'paused' : 'live';
            const statusChip = {
              live:    { label: 'פעיל',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
              paused:  { label: 'מושהה',  cls: 'bg-slate-100  text-slate-700  border-slate-300'   },
              expired: { label: 'פג',     cls: 'bg-rose-50    text-rose-700    border-rose-200'   },
            }[status];
            return (
              <li key={ad.id} className={`rounded-2xl border p-4 shadow-sm bg-white ${boosted ? 'border-amber-300' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900 truncate">{ad.title_he}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {ad.ad_type === 'worker' ? 'מודעת עובדים' : 'מודעת דיור'}
                      {ad.ad_type === 'worker' && ad.quantity ? ` · ${ad.quantity} עובדים` : ''}
                      {ad.ad_type === 'housing' && ad.city ? ` · ${ad.city}` : ''}
                      {ad.ad_type === 'housing' && ad.available_beds ? ` · ${ad.available_beds} מיטות פנויות` : ''}
                      {ad.region ? ` · ${ad.region}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full border px-2 py-0.5 ${statusChip.cls}`}>
                      {statusChip.label}
                    </span>
                    {boosted && <PromotedBadge />}
                  </div>
                </div>

                {ad.body_he && <p className="text-sm text-slate-700 mt-2 line-clamp-2">{ad.body_he}</p>}

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 text-xs">
                  <div><dt className="text-slate-500">פג תוקף</dt><dd className="text-slate-800">{fmt(ad.expires_at)}{daysLeft(ad.expires_at) !== null ? ` (עוד ${daysLeft(ad.expires_at)} ימים)` : ''}</dd></div>
                  <div><dt className="text-slate-500">חשיפות פרטי קשר</dt><dd className="text-slate-800 inline-flex items-center gap-1"><Eye className="w-3 h-3" />{ad.reveal_count ?? 0}</dd></div>
                </dl>

                {/* G4 — mobile tap targets ≥44px. min-h-11 forces a
                    proper touch surface on mobile without disturbing
                    desktop density (sm:min-h-9 restores the compact
                    row above the sm breakpoint). */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                  <Link
                    href={`/corporation/ads/${ad.id}/edit`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-brand-700 hover:bg-slate-100 px-3 py-2.5 sm:px-2 sm:py-1.5 min-h-11 sm:min-h-0 rounded"
                  >
                    <Pencil className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> ערוך
                  </Link>
                  {/* CP3 — price on the CTA. No surprise on click; user
                      sees the full commitment (₪35 for 7 days) before
                      confirming. Boost auto-expires at featured_until so
                      no separate 'end boost' action needed — the derived
                      `boosted` flag flips off when the timestamp passes. */}
                  <button
                    type="button"
                    onClick={() => onBoost(ad.id)}
                    disabled={busy === ad.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 px-3 py-2.5 sm:px-2.5 sm:py-1.5 min-h-11 sm:min-h-0 rounded disabled:opacity-50"
                    title={`קידום דוחף את המודעה לראש התוצאות למשך ${BOOST_DAYS} ימים. פג אוטומטית — אין חיוב מתמשך.`}
                  >
                    <Zap className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    {boosted ? `הארך ${BOOST_DAYS} ימים` : `קדם ${BOOST_DAYS} ימים`}
                    <span className="text-amber-900">· ₪{BOOST_TOTAL_NIS}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(ad.id)}
                    disabled={busy === ad.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 px-3 py-2.5 sm:px-2 sm:py-1.5 min-h-11 sm:min-h-0 rounded disabled:opacity-50 ms-auto"
                    aria-label="מחק מודעה"
                  >
                    <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> מחק
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
