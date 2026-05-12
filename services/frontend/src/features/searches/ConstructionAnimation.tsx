'use client';

// Matcher waiting-state animation.
//
// Brand-led loader: the BuildUp lockup spins (rotating earth) while
// the job-match service scores every corp's roster against the
// contractor's search. Used during a 5–30s wait; for sub-second
// loads use a normal spinner instead.
//
// Guardrails:
//   * autoplay + loop + muted + playsInline — required for video
//     autoplay on Chrome/Safari without a user gesture.
//   * poster — the same lockup as a static PNG so first paint isn't
//     blank while the MP4 buffers.
//   * prefers-reduced-motion → static lockup + dot pulser. Users who
//     opted out of animation get the message without the spinning
//     scene.

import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function ConstructionAnimation() {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {reduced ? (
        <div className="w-52 h-52 rounded-2xl bg-slate-50 flex items-center justify-center">
          <Logo size="lg" variant="on-light" decorative />
        </div>
      ) : (
        <video
          src="/brand/buildup-logo-spinning.mp4"
          poster="/brand/buildup-logo.png"
          autoPlay
          loop
          muted
          playsInline
          className="w-52 h-52 object-contain rounded-2xl bg-white"
          aria-hidden="true"
        />
      )}

      <div className="text-center space-y-2">
        <p className="text-slate-800 font-bold text-xl">מחפש את ההתאמות הטובות ביותר…</p>
        <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
          המערכת סורקת עובדים זמינים לפי מקצוע, אזור, ניסיון, שפות וויזה
        </p>
      </div>

      <div className="flex gap-2" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <div
            key={delay}
            className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
