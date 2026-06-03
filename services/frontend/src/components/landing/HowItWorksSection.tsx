'use client';

import { useState } from 'react';
import { UserCheck, Search, Handshake, ShieldCheck, type LucideIcon } from 'lucide-react';

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

const STEPS: Step[] = [
  { num: 1, label: 'הרשמה ואימות',  icon: UserCheck },
  { num: 2, label: 'חיפוש והתאמה',  icon: Search    },
  { num: 3, label: 'סגירת עסקה',    icon: Handshake },
];

// Long-form explanation for each step. Surfaced inside the expanding
// panel that opens when a card is clicked. Text comes from the
// product-owner brief (verbatim, with light typography polish so the
// punctuation reads cleanly).
const EXPLANATIONS: Record<StepNum, string> = {
  1: 'המערכת בודקת ומאמתת את הקבלנים והתאגידים הפעילים. לשם כך — רק מי שנרשם ואומת יוכל לצפות, לחפש ולהגיש הצעות.',
  2: 'המערכת פותחה כך שבמקום שתבזבז זמן בחיפושים עבור ההתאמה שביקשת — אנו נעשה זאת בשבילך מתוך מאגר עצום של מידע, ונציג לך את ההתאמה הטובה ביותר.',
  3: 'לאחר בדיקת רישיון קבלן ורישיון תאגיד כחוק — אנו נקשר בין הצדדים לצורך סגירת העסקה.',
};

// Accent colour key for the panel border. Step 2 uses navy; 1 and 3
// share the orange accent (matching the badge colour rule in the
// spec).
const STEP_ACCENT: Record<StepNum, 'orange' | 'navy'> = {
  1: 'orange',
  2: 'navy',
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
            <linearGradient id="buGradH" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#F7941D" />
              <stop offset="100%" stopColor="#1A2B4A" />
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

        {/* Expansion panel — one shared region below the grid. Slides
            down via grid-template-rows 0fr → 1fr (no JS measurement).
            The inner content keeps the previously-open text rendered
            during the close animation so the slide-up isn't blank;
            we only swap when openStep changes to a new step. */}
        <div
          id="bu-explain-panel"
          className={`bu-explain ${openStep ? 'is-open' : ''}`}
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
