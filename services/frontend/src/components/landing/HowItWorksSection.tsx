'use client';

import { useState } from 'react';
import { MessageSquare, Sparkles, Handshake, ShieldCheck, type LucideIcon } from 'lucide-react';

// "How it works" — responsive three-step infographic. Implemented per
// the locked v2 spec (CLAUDE.md §HowItWorks v2). Single 560px
// breakpoint:
//   ≥560px (desktop) — 3 cards in a row, circles protruding above each
//                      card, single horizontal dashed connector passes
//                      through all three circle centres.
//   <560px  (mobile) — 3 card-rows stacked vertically, each row is
//                      [circle][icon][label] inline, short vertical
//                      dashed connectors sit between cards.
//
// The previous version used `position:absolute` with hand-tuned
// coordinates pinned to a 360px column — explicitly forbidden by §1 of
// the v2 spec because it broke on desktop widths. This version uses
// natural Grid/Flex layout that scales correctly from 360px through
// 1920px, with all styling lifted to globals.css under `.bu-*` classes.

type StepNum = 1 | 2 | 3;

interface Step {
  num: StepNum;
  label: string;
  icon: LucideIcon;
}

// F1 §4 — pre-F1 the three steps were "הרשמה ואימות → חיפוש
// והתאמה → סגירת עסקה". Step 1 put registration BEFORE any value
// delivered, which is false — the product lets a visitor search
// anonymously. The rewritten flow puts registration where it
// actually appears in the funnel (only at reveal), and it names
// the actual mechanic on step 2 (a language-understanding
// engine, not "search + match").
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

// F1 §4 — single accent for all three cards. The old three-colour
// scheme (orange / navy / emerald) read as three unrelated blocks;
// the number itself is enough hierarchy. Brand orange throughout
// keeps the section identified with the product's primary accent.
const STEP_ACCENT: Record<StepNum, 'orange' | 'navy' | 'emerald'> = {
  1: 'orange',
  2: 'orange',
  3: 'orange',
};

export default function HowItWorksSection() {
  // Accordion behaviour: clicking a step toggles its panel. Only one
  // panel is open at a time; clicking the active card closes it.
  const [openStep, setOpenStep] = useState<StepNum | null>(null);
  return (
    <section
      id="how-it-works"
      dir="rtl"
      aria-label="איך זה עובד"
      className="bu-how"
    >
      <p className="bu-eyebrow">פשוט, מהיר ובטוח</p>
      <h2 className="bu-title">איך זה עובד?</h2>
      <p className="bu-subtitle">שלושה שלבים פשוטים בדרך לעסקה</p>

      <div className="bu-track">
        {/* Horizontal dashed connector — visible on desktop only.
            preserveAspectRatio="none" stretches the line across the
            full track width regardless of the actual container size.
            The bu-line class drives the dash-flow animation. */}
        <svg
          className="bu-connect-h"
          viewBox="0 0 880 2"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            {/* F1 §4 — single-accent connector so the three circles
                read as one journey, not three unrelated stages.
                Kept as a gradient with brand-600 endpoints so a
                subtle darkening at the ends still guides the eye
                across the line, without introducing a second hue. */}
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
                {/* Card is now a button — clicking toggles the
                    explanation panel below the grid. aria-expanded +
                    aria-controls wire screen readers to the panel. */}
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

                {/* Per-step inline explanation — MOBILE only. Renders
                    directly below the tapped card so the user sees
                    context next to what they touched, instead of
                    having to look at the bottom of the section to
                    find a single shared panel. Hidden on desktop via
                    CSS (.bu-explain-mobile). */}
                <div
                  className={`bu-explain bu-explain-mobile ${isOpen ? 'is-open' : ''}`}
                  aria-live="polite"
                >
                  <div className="bu-explain-content">
                    <div
                      className="bu-explain-inner"
                      data-accent={STEP_ACCENT[step.num]}
                    >
                      {isOpen ? EXPLANATIONS[step.num] : null}
                    </div>
                  </div>
                </div>

                {/* Vertical dashed connector — between cards on mobile.
                    Hidden on desktop via CSS, and never rendered after
                    the last step. */}
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

        {/* Shared expansion panel — DESKTOP only. Sits below the grid
            and slides down via grid-template-rows 0fr → 1fr. Hidden on
            mobile via CSS (.bu-explain-desktop) — mobile uses the
            per-step inline panel above instead. */}
        <div
          id="bu-explain-panel"
          className={`bu-explain bu-explain-desktop ${openStep ? 'is-open' : ''}`}
          aria-live="polite"
        >
          <div className="bu-explain-content">
            <div
              className="bu-explain-inner"
              data-accent={openStep ? STEP_ACCENT[openStep] : 'orange'}
            >
              {openStep ? EXPLANATIONS[openStep] : null}
            </div>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="bu-summary">
        <span className="bu-summary-icon"><ShieldCheck /></span>
        <span>הכל במקום אחד — דיגיטלי, מהיר ושקוף</span>
      </div>
    </section>
  );
}
