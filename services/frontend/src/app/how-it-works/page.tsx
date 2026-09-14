// U5 §4 · full public "how it works" page.
//
// The home page has a collapsing HowItWorksSection component that F1
// §4 locked the copy on. U5 §4 asks for a dedicated route so the nav
// links to a full explanation instead of a hash-toggled accordion
// that fights the sticky search bar for space on mobile. The three
// step lines below are the SAME strings F1 §4 signed off on — do not
// rephrase them here or in HowItWorksSection.tsx:
//
//   שואלים בעברית → המערכת מבינה ומציגה → מתחברים וחושפים קשר
//
// This page expands AROUND those three lines with separate reads for
// contractors and corporations (their needs are different) and a
// register CTA at the bottom. Content-only page — no data fetches,
// so no gateway auth is needed. Fully public.

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  MessageSquare, Sparkles, Handshake, ShieldCheck, Building2, HardHat,
  ArrowLeft, CheckCircle2,
} from 'lucide-react';

export const metadata: Metadata = {
  title:       'איך זה עובד · TagidAI',
  description: 'שלושה שלבים למציאת עובדים או פרסום מודעה. הסבר מפורט לקבלנים ולתאגידי כוח אדם.',
};

// F1 §4 · lockstep — do NOT change these strings.
const STEPS = [
  {
    n: 1,
    label: 'שואלים בעברית',
    icon: MessageSquare,
    body:
      'מקלידים או מדברים בעברית טבעית. אין טופס למלא, אין הרשמה — כל מה שצריך זו שאלה אחת.',
    detail:
      'המערכת מזהה מה חיפשת גם כשהניסוח לא סטנדרטי. אפשר לומר "אני צריך רתכים מסין באזור המרכז" או "5 בנאים לפרויקט בדרום עם ניסיון של שנתיים לפחות" — הכל מובן.',
  },
  {
    n: 2,
    label: 'המערכת מבינה ומציגה',
    icon: Sparkles,
    body:
      'המנוע מזהה את המקצוע, המוצא, האזור והכמות שביקשת, ומציג מהמלאי הזמין רק את המודעות שמתאימות — לפי סדר רלוונטיות.',
    detail:
      'המודעות שרואים בפועל הן של תאגידים מאושרים בלבד. אם אין התאמה מדויקת, המערכת מציגה מודעות קרובות ומסבירה איזה תנאי הורדנו — כדי שלא תישאר עם דף ריק בלי הבנה למה.',
  },
  {
    n: 3,
    label: 'מתחברים וחושפים קשר',
    icon: Handshake,
    body:
      'ההרשמה נדרשת רק כדי לחשוף את פרטי הקשר של התאגיד. משם, הפנייה ישירה — בלי מתווכים.',
    detail:
      'החשיפה כוללת שם התאגיד, טלפון של מוקד הזמנות ואימייל. לפי המנוי נקבע כמה חשיפות בחודש; הצפייה במודעה עצמה חינמית ולא נחשבת במכסה.',
  },
] as const;

export default function HowItWorksPage() {
  return (
    <main dir="rtl" className="max-w-5xl mx-auto px-4 py-10 md:py-14 space-y-14 text-slate-800">
      {/* Header */}
      <header className="text-center space-y-3 max-w-2xl mx-auto">
        <p className="text-xs font-semibold text-brand-600 tracking-widest uppercase">פשוט, מהיר ובטוח</p>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 leading-tight">איך זה עובד?</h1>
        <p className="text-base md:text-lg text-slate-600 leading-relaxed">
          שלושה שלבים למציאת עובדים לענף הבנייה — הסבר מפורט לקבלנים ולתאגידי כוח אדם.
        </p>
      </header>

      {/* Three steps — F1 §4 locked copy. Mobile: stacked cards.
          Desktop: 3-column grid with a subtle numbered progression. */}
      <section aria-label="שלושה שלבים" className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <article
              key={s.n}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">שלב {s.n}</p>
                  <h2 className="text-lg font-bold text-slate-900 leading-tight">{s.label}</h2>
                </div>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">{s.body}</p>
              <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
                {s.detail}
              </p>
            </article>
          );
        })}
      </section>

      {/* Contractor section */}
      <section aria-labelledby="for-contractor" className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
            <HardHat className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">לקבלן</p>
            <h2 id="for-contractor" className="text-xl md:text-2xl font-bold text-slate-900">קבלנים — מוצאים עובדים מיידית</h2>
          </div>
        </div>
        <ul className="grid gap-3 text-sm md:text-base text-slate-700 leading-relaxed">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>מחפשים לפי מקצוע, מוצא, אזור וכמות — הכל בעברית חופשית, בלי טפסים.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>רואים רק תאגידים מאושרים שיש להם עובדים זמינים בפועל.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>המנוי כולל מספר חשיפות בחודש — הגלישה במודעות עצמה תמיד חינם.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>ההרשמה מהירה דרך SMS. אם אתם רשומים בפנקס הקבלנים — האימות אוטומטי.</span>
          </li>
        </ul>
        <div className="pt-2">
          <Link
            href="/register/contractor"
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-slate-900 font-semibold px-5 py-2.5 rounded-lg min-h-11"
          >
            הרשמה כקבלן — חינם
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Corporation section */}
      <section aria-labelledby="for-corp" className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">לתאגיד</p>
            <h2 id="for-corp" className="text-xl md:text-2xl font-bold text-slate-900">תאגידי כוח אדם — מפרסמים ומתחברים</h2>
          </div>
        </div>
        <ul className="grid gap-3 text-sm md:text-base text-slate-700 leading-relaxed">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>מפרסמים מודעת עובדים עם מקצוע, מוצא, אזור וכמות — פרטים מלאים במקום מודעה גנרית.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>הקבלן מגיע כשהוא כבר יודע מה יש לכם. השיחה מתחילה מעניין אמיתי.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>אפשר להוסיף מודעות דיור וציוד לצד מודעות עובדים — ערוץ אחד לכל השירותים הנלווים.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>מנוי חודשי מרחיב את כמות המודעות והצפיות הפעילות שלכם במקביל.</span>
          </li>
        </ul>
        <div className="pt-2">
          <Link
            href="/register/corporation"
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-slate-900 font-semibold px-5 py-2.5 rounded-lg min-h-11"
          >
            הרשמה כתאגיד — חינם
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Trust footer */}
      <section aria-label="שקיפות" className="text-center max-w-2xl mx-auto space-y-3 pt-2 pb-4">
        <div className="inline-flex items-center gap-2 text-emerald-700">
          <ShieldCheck className="h-5 w-5" />
          <span className="text-sm font-semibold">הכל במקום אחד — דיגיטלי, מהיר ושקוף</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          פלטפורמה של Lead Agentic. תאגידים עוברים אימות מול מרשם החברות ומרשם היבואנים לפני שהמודעות שלהם מתפרסמות.
        </p>
        <p className="text-xs">
          <Link href="/" className="text-slate-500 hover:text-slate-800">← חזרה לדף הבית</Link>
        </p>
      </section>
    </main>
  );
}
