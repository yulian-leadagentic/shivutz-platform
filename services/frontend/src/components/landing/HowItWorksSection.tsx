import { UserCheck, Search, Handshake, ChevronLeft, ShieldCheck, Sparkles, FileCheck2 } from 'lucide-react';

// Three-step infographic for the marketing landing. Each step has a
// bold numbered marker + a primary lucide illustration + 3 "what
// happens here" bullets. A horizontal connector line on desktop and a
// vertical one on mobile threads the steps together so the page reads
// as a journey, not three independent cards. QA-R3 #33.
const STEPS = [
  {
    num: 1,
    icon: UserCheck,
    secondaryIcon: FileCheck2,
    title: 'הרשמה ואימות עסק',
    summary: 'מילוי פרטי חברה והעלאת מסמכים — אנחנו מאשרים תוך 48 שעות.',
    bullets: ['פרטי חברה + רישיון', 'העלאת מסמכים', 'תג "מאומת" אחרי האישור'],
    accent: 'brand',
  },
  {
    num: 2,
    icon: Search,
    secondaryIcon: Sparkles,
    title: 'חיפוש והתאמה חכמה',
    summary: 'הקבלן מגדיר דרישות, מנוע ההתאמה מציג חבילות עובדים מתאימות בשניות.',
    bullets: ['הגדרת דרישות מקצוע', 'התאמה אוטומטית', 'תוצאות מדורגות'],
    accent: 'emerald',
  },
  {
    num: 3,
    icon: Handshake,
    secondaryIcon: ShieldCheck,
    title: 'סגירת עסקה בשקיפות',
    summary: 'בחירת חבילה, ניהול ההצעה והעסקה — הכל מתועד בפלטפורמה.',
    bullets: ['בחירת חבילת עובדים', 'ניהול וצ׳אט מתועד', 'סגירה בין הצדדים'],
    accent: 'navy',
  },
] as const;

// Per-accent Tailwind class triple — kept inline so a designer can
// re-tint a step without hunting through utility soup. Order: card
// surface · marker ring · icon backplate.
const ACCENT: Record<'brand' | 'emerald' | 'navy', {
  ring: string; markerBg: string; markerText: string;
  iconBg: string; iconText: string; bulletDot: string; chip: string;
}> = {
  brand: {
    ring: 'group-hover:border-brand-300',
    markerBg: 'bg-brand-600', markerText: 'text-white',
    iconBg: 'bg-brand-50', iconText: 'text-brand-600',
    bulletDot: 'bg-brand-500', chip: 'bg-brand-50 text-brand-700 border-brand-200',
  },
  emerald: {
    ring: 'group-hover:border-emerald-300',
    markerBg: 'bg-emerald-600', markerText: 'text-white',
    iconBg: 'bg-emerald-50', iconText: 'text-emerald-600',
    bulletDot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  navy: {
    ring: 'group-hover:border-navy-300',
    markerBg: 'bg-navy-600', markerText: 'text-white',
    iconBg: 'bg-navy-50', iconText: 'text-navy-600',
    bulletDot: 'bg-navy-500', chip: 'bg-navy-50 text-navy-700 border-navy-200',
  },
};

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-white py-24 border-t border-slate-100">
      <div className="max-w-6xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">
            פשוט, מהיר ובטוח
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-4">
            איך זה עובד?
          </h2>
          <p className="text-slate-500 max-w-xl mx-auto leading-relaxed">
            שלושה שלבים פשוטים מהרשמה ועד עסקה מושלמת — כל ניירת בדיגיטל, כל תהליך שקוף
          </p>
        </div>

        {/* Infographic — 3 steps with a horizontal connector line on
            desktop. The connector is positioned ABSOLUTELY behind the
            number markers so it threads through them like a timeline. */}
        <div className="relative">

          {/* Desktop-only timeline rail — dashed line aligned with the
              centre of each marker circle (top-7 = h-14 marker centre). */}
          <div
            aria-hidden="true"
            className="hidden md:block absolute top-7 start-[14%] end-[14%] h-px border-t-2 border-dashed border-slate-200"
          />

          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {STEPS.map((step, idx) => {
              const Icon  = step.icon;
              const Mark2 = step.secondaryIcon;
              const tone  = ACCENT[step.accent];
              return (
                <div key={step.num} className="relative group flex flex-col items-center text-center">

                  {/* Big numbered marker — sits on the timeline rail */}
                  <div className={`relative h-14 w-14 rounded-full ${tone.markerBg} ${tone.markerText} flex items-center justify-center shadow-lg ring-4 ring-white`}>
                    <span className="text-2xl font-black leading-none">{step.num}</span>
                    {/* Secondary mini-icon perched on the marker's
                        bottom edge — tells the eye what this step is
                        about before reading the title. */}
                    <span className="absolute -bottom-1.5 -end-1.5 h-7 w-7 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                      <Mark2 className={`h-3.5 w-3.5 ${tone.iconText}`} />
                    </span>
                  </div>

                  {/* Card body */}
                  <div className={`mt-5 w-full rounded-2xl border border-slate-200 bg-white shadow-sm p-5 transition-colors ${tone.ring}`}>
                    {/* Hero illustration — large lucide glyph backplated
                        in the step's accent so the section reads as
                        coloured panels even before you focus on text. */}
                    <div className={`mx-auto h-16 w-16 rounded-2xl ${tone.iconBg} flex items-center justify-center mb-4`}>
                      <Icon className={`h-8 w-8 ${tone.iconText}`} strokeWidth={2} />
                    </div>
                    <h3 className="text-base md:text-lg font-bold text-slate-900 mb-2">
                      {step.title}
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed mb-4">
                      {step.summary}
                    </p>

                    {/* Bullet checklist — what specifically happens at
                        this step. Coloured dots tie back to the marker
                        + icon so the eye keeps the colour-step pair. */}
                    <ul className="space-y-1.5 text-start">
                      {step.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2 text-sm text-slate-700">
                          <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${tone.bulletDot} shrink-0`} />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Inter-step chevron — visible on mobile (vertical
                      flow under each card). On desktop the dashed rail
                      above already conveys progression. */}
                  {idx < STEPS.length - 1 && (
                    <div className="md:hidden flex justify-center pt-4">
                      <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
                        <ChevronLeft className="h-4 w-4 text-slate-400 rotate-90" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </section>
  );
}
