// U5 §4 · full public "how it works" page. U6 §7 later removed the
// home-page collapsing section — this route is now the ONE source
// of truth for the F1 §4 three-step copy. Do not rephrase the three
// step strings anywhere:
//
//   שואלים בעברית → המערכת מבינה ומציגה → מתחברים וחושפים קשר
//
// Content-only page — no data fetches, so no gateway auth is
// needed. Fully public.

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  MessageSquare, Sparkles, Handshake, ShieldCheck, Building2, HardHat,
  ArrowLeft, CheckCircle2, Wrench,
} from 'lucide-react';
import Logo from '@/components/Logo';

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
      // R26 §3 variant D · Yulian 22.09.2026 — the broken promise
      // was 'אין הרשמה' alone; step 3 in this page already says
      // registration is only needed to reveal contact details, so
      // loading the pitch with a caveat is redundant. Two-word delete.
      'מקלידים או מדברים בעברית טבעית. אין טופס למלא — כל מה שצריך זו שאלה אחת.',
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
      // U9 §3a · was "טלפון של מוקד הזמנות" — a manpower corp has an
      // account contact, not a call centre. Also reordered: what you
      // get → what's free → what's metered, so the reader isn't hit
      // with "there's a quota" before they know the platform is free
      // to browse. Reveal count is deliberately not quoted here —
      // it lives on the pricing plans page (max_reveals_per_month per
      // tier) and would go stale the moment an admin edits a plan.
      'מה שנחשף: שם התאגיד, טלפון ישיר של איש הקשר וכתובת אימייל — כדי שתוכל לפנות בעצמך, בלי מתווך. הצפייה במודעות היא תמיד חופשית ובלתי מוגבלת; רק חשיפת פרטי הקשר נספרת במכסה החודשית של המנוי.',
  },
] as const;

export default function HowItWorksPage() {
  return (
    <main dir="rtl" className="max-w-5xl mx-auto px-4 py-6 md:py-8 space-y-10 text-slate-800">
      {/* U9 §1 · top nav — LandingNav is home-page bound and holds
          landing state, so we use a minimal in-page bar. Same Logo
          component U6 §5 wired into /marketplace; never spell out
          "TagidAI" as text. Bottom "חזרה" link at the end of the
          page stays (U9 §1c). */}
      <nav aria-label="ניווט עליון" className="flex items-center justify-between mb-2">
        <Link href="/" aria-label="TagidAI · דף הבית" className="inline-flex items-center">
          <span className="sm:hidden"><Logo kind="icon"   size="sm" decorative /></span>
          <span className="hidden sm:inline-flex"><Logo kind="lockup" size="sm" decorative /></span>
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          חזרה לדף הבית
        </Link>
      </nav>

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
            {/* R26 §3 variant B · Yulian 22.09.2026 — reframes the
                price model as browse-free/pay-to-reveal instead of
                the confusing 'browsing always free' line that
                contradicted anon's login CTA on worker/housing ads. */}
            <span>אחרי ההתחברות, גלישה במודעות היא ללא עלות. המנוי נחוץ רק כדי לחשוף פרטי קשר של תאגידים ומעסיקים.</span>
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
            {/* U9 §3b · was "מודעות דיור וציוד" — conflicts with U8 §2
                (corp housing-only marketplace gate). The server
                returns 403 corp_housing_only on any category that
                isn't housing, so promising equipment here is a
                broken promise. Equipment is reserved for the
                service_provider marketplace. */}
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>אפשר להוסיף מודעות דיור לצד מודעות עובדים — פרסום הדיור כלול ברישיון התאגיד, ללא תשלום נוסף.</span>
          </li>
          <li className="flex items-start gap-2">
            {/* U9 §3c · was "כמות המודעות והצפיות הפעילות" — but
                max_reveals_per_month is NULL for all three corp tiers
                (059:35-37). What the tier actually widens is
                max_active_ads (3/15/∞) plus can_boost. */}
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>מנוי חודשי מרחיב את מספר המודעות הפעילות שאפשר להחזיק במקביל, ומאפשר קידום מודעות.</span>
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

      {/* U9 §2 · service provider section. Added after U7 shipped the
          /register/provider route + the marketplace publishes services
          alongside housing/workers. Without this, a visitor who
          searches "קורס עברית" gets results but the page describing
          the product mentions only workers + housing — a mismatch
          Yulian called out. */}
      <section aria-labelledby="for-provider" className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Wrench className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">לספקי שירות</p>
            <h2 id="for-provider" className="text-xl md:text-2xl font-bold text-slate-900">שירותים נלווים — דיור, הסעות, ביטוח וציוד</h2>
          </div>
        </div>
        <ul className="grid gap-3 text-sm md:text-base text-slate-700 leading-relaxed">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>חיפוש אחד מכסה גם עובדים וגם שירותים נלווים. אין צורך לדעת מראש איפה לחפש.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>דיור לעובדים, הסעות, ביטוח, ציוד וקורסי עברית — מספקים שנרשמו לפלטפורמה.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            {/* R26 §3 variant C · Yulian 22.09.2026 — dropped the
                'כמו שאר המודעות' tail because it was misleading
                (worker/housing DO require login). Kept in the
                services-nלווים section where free-view IS true. */}
            <span>הצפייה בשירותים נלווים חופשית לגמרי.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-1 shrink-0" />
            <span>ספק שירותים? הרשמה חופשית ופרסום ללא עלות עד סוף 2026.</span>
          </li>
        </ul>
        <div className="pt-2 flex flex-wrap gap-3">
          <Link
            href="/register/provider"
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-5 py-2.5 rounded-lg min-h-11"
          >
            הרשמה כספק שירותים — חינם
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-2 border border-slate-300 hover:border-slate-400 text-slate-700 font-semibold px-5 py-2.5 rounded-lg min-h-11"
          >
            צפייה במודעות
          </Link>
        </div>
      </section>

      {/* R30 §10 · verification section — הצעה, לאישור Yulian.
          Every paragraph MUST describe what the code actually does
          today, not aspirational copy. The service_provider paragraph
          in particular is worded to reflect the ״format-only ח.פ
          check, no registry lookup" reality documented in
          providers.py:11,98 and migration 077:181-182 — because
          promising verification we don't perform is a broken
          promise the visitor will discover the first time they hit
          a fraudulent provider. When Yulian returns copy edits, swap
          the three <p> strings; do not re-shape the structure. */}
      <section
        aria-labelledby="how-we-verify"
        className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 space-y-5"
      >
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">איך אנחנו מאמתים</p>
            <h2 id="how-we-verify" className="text-xl md:text-2xl font-bold text-slate-900">אימות המשתמשים בפלטפורמה</h2>
          </div>
        </div>
        <div className="grid gap-4 text-sm md:text-base text-slate-700 leading-relaxed">
          <div className="border-r-4 border-amber-500 pr-3">
            <p className="font-semibold text-slate-900 mb-1">קבלנים</p>
            <p>
              נבדקים מול פנקס הקבלנים של משרד הבינוי והשיכון. הרשומים בפנקס עוברים אימות אוטומטי בעת ההרשמה, וקבלני tier_2 נבדקים מחדש כל שישה חודשים.
            </p>
          </div>
          <div className="border-r-4 border-brand-500 pr-3">
            <p className="font-semibold text-slate-900 mb-1">תאגידי כוח אדם</p>
            <p>
              נבדקים מול רשם החברות (data.gov.il) וברשימת תאגידי כוח אדם המורשים של רשות האוכלוסין וההגירה, המיובאת מדי שנה מ-PDF רשמי. תאגיד שאינו ברשימה — אינו יכול לפרסם.
            </p>
          </div>
          <div className="border-r-4 border-emerald-500 pr-3">
            <p className="font-semibold text-slate-900 mb-1">ספקי שירותים נלווים</p>
            <p>
              נבדק פורמט של ח.פ / ע.מ בלבד (9 ספרות). אין הצלבה מול מרשם ממשלתי, וסימון ״ספק מאומת״ ניתן ידנית על ידי צוות TagidAI. יש לקחת זאת בחשבון בפנייה לספק.
            </p>
          </div>
        </div>
      </section>

      {/* R30 §7 · CTA row — the page had NO way to reach the
          registration picker except the trust footer's "← חזרה
          לדף הבית" text link, which many visitors miss. Add a
          prominent "הצטרף עכשיו" that navigates to /#register;
          the landing page's own scroll effect (R30 §7 in page.tsx)
          docks the visitor at the role picker. Wraps in a real
          <Link> so click / cmd-click / Enter / middle-click all
          behave. */}
      <section aria-label="הרשמה" className="text-center pt-2">
        <Link
          href="/#register"
          className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-slate-900 text-base font-bold px-6 py-3 rounded-lg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        >
          <span>הצטרף עכשיו</span>
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </Link>
        <p className="text-xs text-slate-500 mt-2">בחר את סוג המשתמש והתחל להתאים עובדים או לפרסם מודעה</p>
      </section>

      {/* Trust footer */}
      <section aria-label="שקיפות" className="text-center max-w-2xl mx-auto space-y-3 pt-2 pb-4">
        <div className="inline-flex items-center gap-2 text-emerald-700">
          <ShieldCheck className="h-5 w-5" />
          <span className="text-sm font-semibold">הכל במקום אחד — דיגיטלי, מהיר ושקוף</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          {/* U9 §3d · was "מרשם החברות ומרשם היבואנים" — but
              corporations.py:92 hits data.gov.il ica (רשם החברות) and
              cross-checks the annual רשות האוכלוסין manpower-corps
              list uploaded by admin. There is no "מרשם היבואנים"
              lookup anywhere. Rewriting to match what the code
              actually does. */}
          פלטפורמה של Lead Agentic. תאגידים עוברים אימות מול מרשם החברות וברשימת תאגידי כוח אדם מורשים של רשות האוכלוסין וההגירה לפני שהמודעות שלהם מתפרסמות.
        </p>
        <p className="text-xs">
          <Link href="/" className="text-slate-500 hover:text-slate-800">← חזרה לדף הבית</Link>
        </p>
      </section>
    </main>
  );
}
