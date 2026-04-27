import { UserCheck, Search, Handshake } from 'lucide-react';

const STEPS = [
  {
    num: '01',
    icon: UserCheck,
    title: 'הרשמה ואימות עסק',
    description:
      'קבלן או תאגיד — מלא פרטים, העלה מסמכים נדרשים (רישיון, תעודת רישום). הצוות שלנו מאמת ומאשר תוך 48 שעות.',
    details: ['מילוי פרטי חברה', 'העלאת מסמכים', 'אישור מנהל מערכת', 'קבלת תג "מאומת"'],
    bgGradient: 'from-brand-50 to-indigo-50',
    borderColor: 'border-brand-200',
    numColor: 'text-brand-600',
    iconBg: 'bg-brand-100',
    iconColor: 'text-brand-600',
  },
  {
    num: '02',
    icon: Search,
    title: 'חיפוש והתאמה חכמה',
    description:
      'קבלן מגדיר דרישות (מקצוע, ניסיון, שפות, אזור). מנוע ההתאמה מוצא את חבילות העובדים המתאימות תוך שניות.',
    details: ['הגדרת דרישות עבודה', 'חיפוש אוטומטי', 'תוצאות מדורגות'],
    bgGradient: 'from-emerald-50 to-teal-50',
    borderColor: 'border-emerald-200',
    numColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
  },
  {
    num: '03',
    icon: Handshake,
    title: 'עסקה מאובטחת',
    description:
      'בחירת חבילת עובדים, ניהול משא ומתן, אישור עסקה ודיווח משותף — כל התהליך בפלטפורמה אחת, בשקיפות מלאה.',
    details: ['בחירת חבילת עובדים', 'ניהול עסקה', 'דיווח כפול'],
    bgGradient: 'from-violet-50 to-purple-50',
    borderColor: 'border-violet-200',
    numColor: 'text-violet-600',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-600',
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-slate-50 py-24">
      <div className="max-w-6xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-16">
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

        {/* Steps grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div key={idx} className="flex flex-col">
                {/* Card */}
                <div className={`bg-gradient-to-br ${step.bgGradient} border ${step.borderColor} rounded-3xl p-7 flex-1 hover:shadow-card-md transition-shadow duration-300 flex flex-col`}>

                  {/* Step number + icon row */}
                  <div className="flex items-start justify-between mb-5">
                    <span className={`text-5xl font-black ${step.numColor} opacity-20 leading-none select-none`}>
                      {step.num}
                    </span>
                    <div className={`h-12 w-12 rounded-2xl ${step.iconBg} flex items-center justify-center shrink-0`}>
                      <Icon className={`h-6 w-6 ${step.iconColor}`} />
                    </div>
                  </div>

                  <h3 className="text-xl font-bold text-slate-900 mb-3">{step.title}</h3>

                  <p className="text-sm text-slate-600 leading-relaxed mb-5 flex-1">
                    {step.description}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {step.details.map((d) => (
                      <span key={d} className="text-xs bg-white/70 border border-white text-slate-600 px-2.5 py-1 rounded-full">
                        {d}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Connector dot below card (mobile) / hidden on desktop */}
                {idx < STEPS.length - 1 && (
                  <div className="flex justify-center py-3 md:hidden">
                    <div className="h-6 w-px bg-slate-300" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop step connectors — simple numbered progress bar */}
        <div className="hidden md:flex items-center justify-center gap-0 mt-8">
          {STEPS.map((step, idx) => (
            <div key={idx} className="flex items-center">
              <div className={`h-8 w-8 rounded-full border-2 ${step.borderColor} bg-white flex items-center justify-center`}>
                <span className={`text-xs font-bold ${step.numColor}`}>{idx + 1}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className="w-32 h-px bg-slate-200 mx-1" />
              )}
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
