'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Sparkles, Handshake, ShieldCheck, X, type LucideIcon } from 'lucide-react';

// "How it works" — H8 §4 disclosure.
//
// Was rendered open by default and permanently occupying real estate
// on the landing (three big-circle step cards + connector). The
// content is fine (fixed in F1 §4) but three sentences don't justify
// hero-slot geometry.
//
// Now:
//   • Collapsed by default. Renders NOTHING to the visitor at scroll=0.
//   • The nav's "איך זה עובד" link is the trigger. State is shared via
//     the URL hash `#how-it-works` — reading `location.hash` gives
//     both components (nav + this section) the same source of truth
//     without a Context. Clicking the nav toggles the hash; the
//     section listens to `hashchange`.
//   • Standard disclosure pattern: `hidden` attribute (not
//     `height:0`), focus moves to the heading on open, Esc closes
//     and returns focus to the trigger, `prefers-reduced-motion`
//     honoured.
//
// Interior visuals kept from F1 §4 (single amber accent, no
// three-colour cards). The infographic runs once the user opts in,
// so its visual weight is no longer occupying the page uninvited.

type StepNum = 1 | 2 | 3;

interface Step {
  num: StepNum;
  label: string;
  icon: LucideIcon;
}

const STEPS: Step[] = [
  { num: 1, label: 'שואלים בעברית',      icon: MessageSquare },
  { num: 2, label: 'המערכת מבינה ומציגה', icon: Sparkles      },
  { num: 3, label: 'מתחברים וחושפים קשר', icon: Handshake     },
];

const EXPLANATIONS: Record<StepNum, string> = {
  1: 'מקלידים או מדברים בעברית טבעית. אין טופס למלא, אין הרשמה — כל מה שצריך זו שאלה אחת.',
  2: 'המנוע מזהה את המקצוע, המוצא, האזור והכמות שביקשת, ומציג מהמלאי הזמין רק את המודעות שמתאימות — לפי סדר רלוונטיות.',
  3: 'ההרשמה נדרשת רק כדי לחשוף את פרטי הקשר של התאגיד. משם, הפנייה ישירה — בלי מתווכים.',
};

const HASH = '#how-it-works';

function closeHash() {
  // Strip the hash without adding a history entry the user has to
  // Back out of. pushState with ' ' (single space) collapses to no
  // hash on modern Chromium/Firefox/Safari — needed because a bare
  // '' is ignored. Then dispatch hashchange manually because
  // pushState doesn't fire it.
  history.pushState(null, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export default function HowItWorksSection() {
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState<StepNum | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Sync open state to the URL hash — nav writes the hash, this
  // effect reads it. `hashchange` fires when either party updates it.
  useEffect(() => {
    const sync = () => setOpen(window.location.hash === HASH);
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  // When the section opens: scroll to it and move focus to the
  // heading (tabindex=-1 makes the h2 focusable but keeps it out of
  // the normal tab order). Instant scroll on prefers-reduced-motion.
  useEffect(() => {
    if (!open) return;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const raf = requestAnimationFrame(() => {
      headingRef.current?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'start',
      });
      headingRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Esc closes and returns focus to the nav trigger (found by its
  // aria-controls attribute so we don't hard-code a selector on a
  // specific instance — both desktop nav and mobile drawer buttons
  // share the same aria-controls value).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeHash();
        const trigger = document.querySelector<HTMLElement>('[aria-controls="how-it-works"]');
        trigger?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <section
      id="how-it-works"
      dir="rtl"
      aria-label="איך זה עובד"
      className="bu-how"
      hidden={!open}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="bu-eyebrow">פשוט, מהיר ובטוח</p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="bu-title outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded"
          >
            איך זה עובד?
          </h2>
          <p className="bu-subtitle">שלושה שלבים פשוטים בדרך לעסקה</p>
        </div>
        <button
          type="button"
          onClick={closeHash}
          aria-label="סגור"
          className="shrink-0 mt-2 -me-2 p-2 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="bu-track">
        <svg
          className="bu-connect-h"
          viewBox="0 0 880 2"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="buGradH" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#F7941D" />
              <stop offset="50%"  stopColor="#F7941D" />
              <stop offset="100%" stopColor="#F7941D" />
            </linearGradient>
          </defs>
          <line
            className="bu-line"
            x1="120" y1="1" x2="760" y2="1"
            stroke="url(#buGradH)"
            strokeWidth={2.5}
            strokeDasharray="2 12"
            strokeLinecap="round"
          />
        </svg>

        <div className="bu-grid">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isLast = idx === STEPS.length - 1;
            const isOpen = openStep === step.num;
            return (
              <div key={step.num} className="bu-step" data-step={step.num}>
                <button
                  type="button"
                  className="bu-card"
                  data-active={isOpen ? 'true' : undefined}
                  aria-expanded={isOpen}
                  aria-controls="bu-explain-panel"
                  onClick={() => setOpenStep(isOpen ? null : step.num)}
                >
                  <div className="bu-circle">{step.num}</div>
                  <span className="bu-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="bu-label">{step.label}</span>
                </button>

                <div
                  className={`bu-explain bu-explain-mobile ${isOpen ? 'is-open' : ''}`}
                  aria-live="polite"
                >
                  <div className="bu-explain-content">
                    <div
                      className="bu-explain-inner"
                      data-accent="orange"
                    >
                      {isOpen ? EXPLANATIONS[step.num] : null}
                    </div>
                  </div>
                </div>

                {!isLast && (
                  <svg
                    className="bu-connect-v"
                    viewBox="0 0 6 26"
                    aria-hidden="true"
                  >
                    <line
                      className="bu-line"
                      x1="3" y1="0" x2="3" y2="26"
                      strokeWidth={3}
                      strokeDasharray="2 7"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </div>
            );
          })}
        </div>

        <div
          id="bu-explain-panel"
          className={`bu-explain bu-explain-desktop ${openStep ? 'is-open' : ''}`}
          aria-live="polite"
        >
          <div className="bu-explain-content">
            <div
              className="bu-explain-inner"
              data-accent="orange"
            >
              {openStep ? EXPLANATIONS[openStep] : null}
            </div>
          </div>
        </div>
      </div>

      <div className="bu-summary">
        <span className="bu-summary-icon"><ShieldCheck /></span>
        <span>הכל במקום אחד — דיגיטלי, מהיר ושקוף</span>
      </div>
    </section>
  );
}
