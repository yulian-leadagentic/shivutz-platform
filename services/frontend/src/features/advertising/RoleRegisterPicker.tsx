'use client';

// Pivot/v2 — role picker on the public landing.
// Two live entry points (contractor + corporation) plus a "coming soon"
// tile so brokers / other pros can see they're on the roadmap.

import Link from 'next/link';
import { HardHat, Building2, Sparkles } from 'lucide-react';

interface RoleTile {
  icon:  React.ElementType;
  title: string;
  desc:  string;
  href?: string;
  soon?: boolean;
}

const ROLES: RoleTile[] = [
  {
    icon:  HardHat,
    title: 'קבלן',
    desc:  'חפשו עובדים ודיור בשפה חופשית, קבלו פרטי קשר ישירים לתאגידים.',
    href:  '/register/contractor',
  },
  {
    icon:  Building2,
    title: 'תאגיד כוח אדם',
    desc:  'פרסמו את זמינות העובדים והדיור שלכם, קבלו פניות ישירות מקבלנים.',
    href:  '/register/corporation',
  },
  {
    icon:  Sparkles,
    title: 'מתווכים ובעלי מקצוע',
    desc:  'בקרוב — פרסום פניות לתחומים משיקים: ציוד, ביטוח, הובלה ועוד.',
    soon:  true,
  },
];

export function RoleRegisterPicker() {
  return (
    <section className="max-w-4xl mx-auto px-4 py-10">
      <div className="text-center space-y-1 mb-6">
        <h2 className="text-2xl font-bold text-slate-900">הצטרפו לפלטפורמה</h2>
        <p className="text-sm text-slate-500">בחרו את הכובע שלכם והתחילו</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {ROLES.map((r) => {
          const Icon    = r.icon;
          const content = (
            <div
              className={`h-full rounded-2xl border p-5 shadow-sm bg-white transition ${
                r.soon
                  ? 'border-slate-200 opacity-70'
                  : 'border-slate-200 hover:border-brand-400 hover:shadow-md cursor-pointer'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  r.soon ? 'bg-slate-100 text-slate-500' : 'bg-brand-50 text-brand-700'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">{r.title}</h3>
                {r.soon && (
                  <span className="ms-auto text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                    בקרוב
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">{r.desc}</p>
              {!r.soon && (
                <p className="mt-3 text-sm font-semibold text-brand-700">הרשמה חינם →</p>
              )}
            </div>
          );
          return r.href ? (
            <Link key={r.title} href={r.href} className="block h-full">{content}</Link>
          ) : (
            <div key={r.title} className="h-full">{content}</div>
          );
        })}
      </div>
    </section>
  );
}
