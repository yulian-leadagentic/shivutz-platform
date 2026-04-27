import { ShieldCheck, Award, Zap, Users } from 'lucide-react';

const ITEMS = [
  {
    icon: ShieldCheck,
    value: '100%',
    label: 'תאגידים ברי-רישיון',
    desc: 'כל תאגיד עובר אימות רשיון לפני אישור',
    color: 'text-brand-600',
    bg: 'bg-brand-50',
  },
  {
    icon: Award,
    value: '48 ש׳',
    label: 'זמן אישור ממוצע',
    desc: 'בדיקת מסמכים ואישור עסק תוך יומיים',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
  {
    icon: Users,
    value: '1,200+',
    label: 'עובדים זרים פעילים',
    desc: 'פרופילים עדכניים עם ויזות תקפות',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    icon: Zap,
    value: '< 3 ש׳',
    label: 'זמן חיפוש התאמה',
    desc: 'מנוע ההתאמה שלנו פועל בשניות',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
  },
];

export default function TrustBar() {
  return (
    <section id="trust-bar" className="bg-white border-y border-slate-100 py-14">
      <div className="max-w-7xl mx-auto px-6">
        {/* Label */}
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
            למה בוחרים בשיבוץ
          </p>
          <h2 className="text-2xl font-bold text-slate-900">
            הפלטפורמה שתאגידים וקבלנים סומכים עליה
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="flex flex-col items-center text-center p-6 rounded-2xl bg-slate-50/70 hover:bg-slate-50 border border-slate-100 hover:border-slate-200 hover:shadow-card transition-all duration-200"
              >
                <div className={`h-12 w-12 rounded-2xl ${item.bg} flex items-center justify-center mb-4`}>
                  <Icon className={`h-6 w-6 ${item.color}`} />
                </div>
                <div className={`text-3xl font-extrabold ${item.color} mb-1`}>{item.value}</div>
                <div className="text-sm font-semibold text-slate-900 mb-1.5">{item.label}</div>
                <div className="text-xs text-slate-500 leading-relaxed">{item.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
