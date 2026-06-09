'use client';

/**
 * Pre-launch marketing landing — shown when COMING_SOON_MODE=1 is set
 * on the frontend service (production gate). Captures interested
 * leads (phone + name + role) so we can SMS them when we open the
 * platform.
 *
 * Bypass: visit `/coming-soon?key=<COMING_SOON_PREVIEW_KEY>` to set a
 * `coming_soon_bypass=1` cookie. The middleware honours it and lets
 * the rest of the app through for that browser. The key is checked
 * server-side on submit of the bypass form (NOT client-side via env)
 * so the secret isn't bundled.
 *
 * Design intent — make people WANT to enter:
 *   - Bold brand presence (large logo + brand colours)
 *   - Single clear value proposition above the fold
 *   - Three concrete value pillars, no fluff
 *   - One-field lead capture (phone) with optional name/role
 *   - "Be among the first to try it" framing — exclusivity sells
 */

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Phone, Sparkles, ShieldCheck, Zap } from 'lucide-react';
import { leadsApi } from '@/lib/api';

function ComingSoonContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const previewKey = sp.get('key');

  // ── Bypass handling ───────────────────────────────────────────
  // If a ?key= arrived, ask the server to validate it and set the
  // bypass cookie. The actual key lives server-side as
  // COMING_SOON_PREVIEW_KEY — never exposed to the client.
  const bypassRequestedRef = useRef(false);
  useEffect(() => {
    if (!previewKey || bypassRequestedRef.current) return;
    bypassRequestedRef.current = true;
    fetch('/api/coming-soon-bypass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: previewKey }),
    }).then((r) => {
      if (r.ok) router.replace('/');
    }).catch(() => { /* swallow — gate just stays */ });
  }, [previewKey, router]);

  // ── Lead capture form ────────────────────────────────────────
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    org_type: 'contractor' as 'contractor' | 'corporation',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.phone.trim()) {
      setError('יש להזין מספר טלפון');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await leadsApi.submit({
        full_name: form.full_name.trim() || '—',
        phone: form.phone.trim(),
        org_type: form.org_type,
        notes: 'הרשמה מוקדמת — coming-soon',
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשליחה. נסה שוב');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-gradient-to-b from-white via-rose-50/30 to-brand-50/40 relative overflow-hidden">
      {/* Decorative background — soft orange glow top-end + dot texture */}
      <div
        className="pointer-events-none absolute top-0 end-0 h-[640px] w-[640px] rounded-full opacity-[0.10]"
        style={{ background: 'radial-gradient(circle, #f78203 0%, transparent 70%)', transform: 'translate(30%, -30%)' }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{ backgroundImage: 'radial-gradient(circle, #0f172a 1px, transparent 1px)', backgroundSize: '32px 32px' }}
      />

      <div className="relative flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-2xl">
          {/* Coming-soon ribbon */}
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500 text-white text-xs font-bold tracking-wide shadow-md">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              השקה בקרוב
            </span>
          </div>

          {/* Logo */}
          <div className="flex justify-center mb-5">
            <Image
              src="/brand/buildup-lockup.png?v=3"
              alt="BuildUp"
              width={500}
              height={400}
              priority
              unoptimized
              className="h-24 md:h-32 w-auto object-contain"
            />
          </div>

          {/* Headline */}
          <h1 className="text-2xl md:text-4xl font-extrabold text-slate-900 text-center leading-tight tracking-tight mb-3">
            פלטפורמת השיבוץ הראשונה בישראל
            <br />
            <span className="text-brand-600">לעובדים זרים בענף הבנייה</span>
          </h1>

          <p className="text-sm md:text-base text-slate-600 text-center leading-relaxed max-w-xl mx-auto mb-8">
            מערכת מבוססת AI לחיבור בין קבלני בניין מורשים לתאגידי כוח אדם רשומים. מקצרת את תהליך השיבוץ מימים לשעות.
          </p>

          {/* Three value pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
            <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 text-center shadow-sm">
              <div className="h-10 w-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center mx-auto mb-2">
                <Zap className="h-5 w-5" aria-hidden />
              </div>
              <p className="text-sm font-bold text-slate-900">התאמה תוך שניות</p>
              <p className="text-xs text-slate-500 mt-1">AI שמוצא תאגיד מתאים לבקשה שלך</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 text-center shadow-sm">
              <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-2">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </div>
              <p className="text-sm font-bold text-slate-900">אימות אוטומטי</p>
              <p className="text-xs text-slate-500 mt-1">מול פנקס הקבלנים ורשם החברות</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 text-center shadow-sm">
              <div className="h-10 w-10 rounded-xl bg-navy-100 text-navy-700 flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 className="h-5 w-5" aria-hidden />
              </div>
              <p className="text-sm font-bold text-slate-900">תשלום מאובטח</p>
              <p className="text-xs text-slate-500 mt-1">חיוב אוטומטי עם חלון ביטול</p>
            </div>
          </div>

          {/* Lead capture form */}
          {submitted ? (
            <div className="rounded-2xl bg-white border-2 border-emerald-300 shadow-md p-6 text-center">
              <div className="h-14 w-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="h-7 w-7" aria-hidden />
              </div>
              <p className="text-lg font-bold text-slate-900 mb-1">תודה!</p>
              <p className="text-sm text-slate-600">נחזור אליך עם פרטי הכניסה לפלטפורמה ברגע שנפתח לקהל</p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl bg-white border-2 border-brand-200 shadow-lg p-5 md:p-6"
            >
              <p className="text-base md:text-lg font-bold text-slate-900 text-center mb-1">
                רוצה להיות הראשון להיכנס?
              </p>
              <p className="text-xs md:text-sm text-slate-500 text-center mb-4">
                השאר פרטים — נשלח לך הודעת SMS עם גישה מוקדמת
              </p>

              <div className="space-y-3">
                {/* Role selector — pill toggle */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, org_type: 'contractor' }))}
                    className={`py-2 rounded-lg border-2 text-sm font-bold transition-colors ${
                      form.org_type === 'contractor'
                        ? 'bg-brand-50 border-brand-500 text-brand-700'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    אני קבלן
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, org_type: 'corporation' }))}
                    className={`py-2 rounded-lg border-2 text-sm font-bold transition-colors ${
                      form.org_type === 'corporation'
                        ? 'bg-navy-50 border-navy-500 text-navy-700'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    אני תאגיד
                  </button>
                </div>

                <input
                  type="text"
                  placeholder="שם מלא (אופציונלי)"
                  value={form.full_name}
                  onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
                  className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  autoComplete="name"
                />

                <div className="relative">
                  <Phone className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                  <input
                    type="tel"
                    placeholder="מספר טלפון *"
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                    required
                    dir="ltr"
                    className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 ps-9 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    autoComplete="tel"
                  />
                </div>

                {error && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-12 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-base font-bold inline-flex items-center justify-center gap-2 shadow-md transition-colors"
                >
                  {submitting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> שולח...</>
                  ) : (
                    <>אני רוצה להצטרף<ArrowLeft className="h-4 w-4" /></>
                  )}
                </button>
              </div>

              <p className="text-[11px] text-slate-400 text-center mt-3">
                הפרטים נשמרים פנימית. לא נשתף עם צד שלישי.
              </p>
            </form>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="relative text-center text-xs text-slate-400 py-4 px-6">
        © {new Date().getFullYear()} BuildUp · השקה בקרוב
      </footer>
    </main>
  );
}

export default function ComingSoonPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-white">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>}>
      <ComingSoonContent />
    </Suspense>
  );
}
