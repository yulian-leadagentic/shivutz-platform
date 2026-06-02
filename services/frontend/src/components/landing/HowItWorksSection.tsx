'use client';

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

interface Step {
  num: 1 | 2 | 3;
  label: string;
  icon: LucideIcon;
}

const STEPS: Step[] = [
  { num: 1, label: 'הרשמה ואימות',  icon: UserCheck },
  { num: 2, label: 'חיפוש והתאמה',  icon: Search    },
  { num: 3, label: 'סגירת עסקה',    icon: Handshake },
];

export default function HowItWorksSection() {
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
            return (
              <div key={step.num} className="bu-step" data-step={step.num}>
                {/* Card contains all three children always — keeping the
                    DOM stable across breakpoints removes the need to
                    reorder elements on mobile. Per spec §6 note. */}
                <div className="bu-card">
                  <div className="bu-circle">{step.num}</div>
                  <span className="bu-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="bu-label">{step.label}</span>
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
      </div>

      {/* Summary strip */}
      <div className="bu-summary">
        <span className="bu-summary-icon"><ShieldCheck /></span>
        <span>הכל במקום אחד — דיגיטלי, מהיר ושקוף</span>
      </div>
    </section>
  );
}
