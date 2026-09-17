'use client';

// Pivot/v2 landing role picker.
//
// U7 · R2 · three live entry points (contractor + corporation +
// service_provider). The old "מתווכים ובעלי מקצוע (בקרוב)" tile is
// replaced with the real provider registration path now that
// /register/provider ships. Icon + description live here (visual
// concerns); role identity (title/href) is imported from ./roles so
// this component and RegistrationCTASection can't drift.

import Link from 'next/link';
import { HardHat, Building2, Wrench } from 'lucide-react';

import { ROLES, type RoleId } from './roles';

const DETAILS: Record<RoleId, {
  icon: React.ElementType;
  desc: string;
}> = {
  contractor: {
    icon: HardHat,
    desc: 'חפשו עובדים ודיור בשפה חופשית, קבלו פרטי קשר ישירים לתאגידים.',
  },
  corporation: {
    icon: Building2,
    desc: 'פרסמו את זמינות העובדים והדיור שלכם, קבלו פניות ישירות מקבלנים.',
  },
  service_provider: {
    icon: Wrench,
    desc: 'הובלות, ביטוח, ציוד, קורסים — פרסמו את השירותים שלכם לקבלנים ולתאגידים. חינם עד סוף 2026.',
  },
};

export function RoleRegisterPicker() {
  return (
    <section className="max-w-5xl mx-auto px-4 py-10">
      <div className="text-center space-y-1 mb-6">
        {/* U7 · R2 · heading rename per Yulian's 14.09 request. Kept as
            "הרשם עכשיו" (imperative) in both this component and
            RegistrationCTASection to match; grep for the old string
            catches a drift. */}
        <h2 className="text-2xl font-bold text-slate-900">הרשם עכשיו</h2>
        <p className="text-sm text-slate-500">בחרו את התפקיד המתאים ותוך דקה אתם בפנים</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ROLES.map((role) => {
          const detail = DETAILS[role.id];
          const Icon   = detail.icon;
          return (
            <Link
              key={role.id}
              href={role.href}
              className="block h-full"
            >
              <div className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-brand-400 hover:shadow-md cursor-pointer transition">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-brand-50 text-brand-700">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{role.title}</h3>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{detail.desc}</p>
                <p className="mt-3 text-sm font-semibold text-brand-700">הרשמה חינם →</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
