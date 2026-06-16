'use client';

/**
 * Pre-launch holding page — shown when COMING_SOON_MODE=1 is set on
 * the frontend service (or, by default, for the prod hostname).
 *
 * The page is intentionally minimal: brand logo + a single
 * "the launch is coming soon" line. No lead capture, no pillars, no
 * other content — the user wants a quiet placeholder while the
 * platform is being prepared.
 *
 * Bypass: visit `/coming-soon?key=<COMING_SOON_PREVIEW_KEY>` to set a
 * `coming_soon_bypass=1` cookie. The middleware honours it and lets
 * the rest of the app through for that browser. The key is checked
 * server-side via /api/coming-soon-bypass so the secret isn't bundled.
 */

import { Suspense, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

function ComingSoonContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const previewKey = sp.get('key');

  // Bypass handling — same flow as the previous version. If a ?key=
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
    }).catch(() => { /* swallow — gate just stays */ });
  }, [previewKey, router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-6 py-10">
      <div className="flex flex-col items-center text-center">
        <Image
          src="/brand/buildup-lockup.png?v=4"
          alt="TagidAI"
          width={500}
          height={400}
          priority
          unoptimized
          className="h-56 md:h-72 w-auto object-contain mb-8"
        />
        <p className="text-3xl md:text-5xl font-extrabold text-slate-900 tracking-tight">
          ההשקה בקרוב
        </p>
        <p className="text-xl md:text-2xl font-semibold text-slate-500 tracking-wide mt-2">
          Coming Soon
        </p>
      </div>
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
