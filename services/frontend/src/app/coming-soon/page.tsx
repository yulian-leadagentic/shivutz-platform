'use client';

/**
 * Pre-launch holding page, shown when COMING_SOON_MODE=1 is set on
 * the frontend service (or, by default, for the prod hostname).
 *
 * The page is intentionally minimal: brand logo + a single
 * "the launch is coming soon" line. No lead capture, no pillars, no
 * other content: the user wants a quiet placeholder while the
 * platform is being prepared.
 *
 * Bypass: visit `/coming-soon?key=<COMING_SOON_PREVIEW_KEY>` to set a
 * `coming_soon_bypass=1` cookie. The middleware honours it and lets
 * the rest of the app through for that browser. The key is checked
 * server-side via /api/coming-soon-bypass so the secret isn't bundled.
 *
 * R41 · only the bypass reads the query string, so only it sits behind
 * Suspense. The brand, the line and the operator are in the server HTML,
 * where Meta's display-name review reads them.
 */

import { Suspense, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';

function BypassFromKey() {
  const sp = useSearchParams();
  const router = useRouter();
  const previewKey = sp.get('key');

  // Bypass handling, same flow as the previous version. If a ?key=
  // arrived, ask the server to validate it and set the bypass cookie.
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
    }).catch(() => { /* swallow: the gate just stays */ });
  }, [previewKey, router]);

  return null;
}

export default function ComingSoonPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white px-6 py-10">
      <div className="flex flex-col items-center text-center">
        <Image
          src="/brand/tagidai_lockup.png"
          alt="TagidAI"
          width={500}
          height={455}
          priority
          unoptimized
          className="h-56 md:h-72 w-auto object-contain mb-4"
        />
        <p dir="ltr" className="text-2xl md:text-3xl font-bold text-slate-900 mb-8">
          TagidAI
        </p>
        <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
          ההשקה בקרוב
        </h1>
        <p className="text-xl md:text-2xl font-semibold text-slate-500 tracking-wide mt-2">
          Coming Soon
        </p>
        <p className="text-base md:text-lg text-slate-700 mt-6 max-w-md">
          פלטפורמה לקבלנים ולתאגידי כוח אדם בענף הבנייה
        </p>
      </div>
      <footer className="mt-12 text-center text-xs md:text-sm text-slate-600 space-y-1">
        <p>
          TagidAI מופעל על ידי אג&#39;נטיק טכנולוגיות והחזקות בע&quot;מ · <span className="whitespace-nowrap">ח.פ <span dir="ltr">517362620</span></span>
        </p>
        <p>
          <a href="mailto:tagid@tagidai.com" dir="ltr" className="text-slate-700 underline underline-offset-2 hover:text-slate-900">
            tagid@tagidai.com
          </a>
        </p>
      </footer>
      <Suspense fallback={null}>
        <BypassFromKey />
      </Suspense>
    </main>
  );
}
