import Link from 'next/link';
import { HardHat, Building2, Check, ArrowLeft } from 'lucide-react';

interface RegistrationCTASectionProps {
  onLeadCapture: () => void;
}

const CONTRACTOR_BENEFITS = [
  'גישה לאלפי עובדים זרים מיומנים',
  'מנוע התאמה אוטומטי — תוצאות בשניות',
  'ניהול עסקאות ודיווח בפלטפורמה',
  'תשלום מאובטח ושקוף',
];

const CORP_BENEFITS = [
  'פרסום עובדים ומוצרים בשוק הפתוח',
  'קבלת בקשות מקבלנים מאומתים',
  'ניהול עובדים, ויזות וזמינות',
  'דשבורד עסקאות ועמלות',
];

export default function RegistrationCTASection({ onLeadCapture }: RegistrationCTASectionProps) {
  return (
    <section className="bg-slate-50 py-24">
      <div className="max-w-5xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">מוכנים להתחיל?</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">הצטרפו לפלטפורמה המובילה</h2>
          <p className="text-slate-500">אלפי קבלנים ותאגידים כבר פועלים בשיבוץ</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">

          {/* Contractor */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-card p-8 hover:shadow-card-md transition-shadow flex flex-col">
            <div className="h-12 w-12 rounded-2xl bg-brand-100 flex items-center justify-center mb-5">
              <HardHat className="h-6 w-6 text-brand-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-1">אני קבלן</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              מחפש עובדים זרים מיומנים לפרויקטים? מצא, בחר ושבץ — הכל דיגיטלי.
            </p>
            <ul className="space-y-2.5 mb-7 flex-1">
              {CONTRACTOR_BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <Check className="h-4 w-4 shrink-0 text-brand-500 mt-0.5" />
                  {b}
                </li>
              ))}
            </ul>
            <div className="space-y-2">
              <Link
                href="/register/contractor"
                className="flex items-center justify-between w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm px-5 py-3 rounded-xl transition-colors"
              >
                <span>הצטרף כקבלן — בחינם</span>
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <button onClick={onLeadCapture} className="w-full text-xs text-slate-400 hover:text-slate-600 transition-colors py-1">
                או השאר פרטים לחזרה
              </button>
            </div>
          </div>

          {/* Corporation */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-card p-8 hover:shadow-card-md transition-shadow flex flex-col">
            <div className="h-12 w-12 rounded-2xl bg-emerald-100 flex items-center justify-center mb-5">
              <Building2 className="h-6 w-6 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-1">אני תאגיד</h3>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed">
              תאגיד כוח אדם? פרסם עובדיך לקבלנים מאושרים ברחבי הארץ.
            </p>
            <ul className="space-y-2.5 mb-7 flex-1">
              {CORP_BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <Check className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                  {b}
                </li>
              ))}
            </ul>
            <div className="space-y-2">
              <Link
                href="/register/corporation"
                className="flex items-center justify-between w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm px-5 py-3 rounded-xl transition-colors"
              >
                <span>הצטרף כתאגיד — בחינם</span>
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <button onClick={onLeadCapture} className="w-full text-xs text-slate-400 hover:text-slate-600 transition-colors py-1">
                או השאר פרטים לחזרה
              </button>
            </div>
          </div>
        </div>

        {/* Bottom login link */}
        <p className="text-center text-sm text-slate-400 mt-8">
          כבר יש לך חשבון?{' '}
          <Link href="/login" className="text-brand-600 hover:text-brand-700 font-semibold">התחבר כאן</Link>
        </p>
      </div>
    </section>
  );
}
