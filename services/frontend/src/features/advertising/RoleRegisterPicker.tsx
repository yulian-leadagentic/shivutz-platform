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

// H8 §3 — "מתווכים ובעלי מקצוע (בקרוב)" tile removed from the
// visible ROLES array. The tile object is preserved just below so
// re-enabling it is a one-line splice back into ROLES once the
// service-provider onboarding flow is live. A "בקרוב" tile is a
// PROMISE that takes real estate and teaches the visitor that the
// platform is partial — the same rule F1 applied to the "ציוד
// ושירותים (בקרוב)" hero tile.
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
];

// Kept out of ROLES so it doesn't render; keep the reference so
// re-enabling later is a splice into ROLES, not a rewrite.
// Also: docs/cc-prompts note — when the service-provider flow lands,
// consider swapping "בקרוב" for a lead-capture ("ספק שירות?
// השאירו פרטים ותהיו הראשונים") so the tile earns its space.
const _SERVICE_PROVIDER_TILE_DISABLED: RoleTile = {
  icon:  Sparkles,
  title: 'מתווכים ובעלי מקצוע',
  desc:  'בקרוב — פרסום פניות לתחומים משיקים: ציוד, ביטוח, הובלה ועוד.',
  soon:  true,
};
void _SERVICE_PROVIDER_TILE_DISABLED;

export function RoleRegisterPicker() {
  return (
    <section className="max-w-4xl mx-auto px-4 py-10">
      <div className="text-center space-y-1 mb-6">
        <h2 className="text-2xl font-bold text-slate-900">הצטרפו לפלטפורמה</h2>
        <p className="text-sm text-slate-500">בחרו את הכובע שלכם והתחילו</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <span className="ms-auto text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
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
