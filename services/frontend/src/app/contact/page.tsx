// L6 · LEG-2 · /contact — company details. Separate from /support
// (which is the form for user issues). This page is where "who are
// you" questions live — required for Meta business verification (old
// Y2) and every "פרטי החברה" link on the web.

import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title:       'יצירת קשר · TagidAI',
  description: 'פרטי החברה, כתובת המשרד ודרכי התקשרות',
};

export default function ContactPage() {
  return (
    <main dir="rtl" className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">יצירת קשר</h1>
        <p className="text-sm text-slate-500 mt-1">
          עודכן לאחרונה: <time dateTime="2026-09-12">12 בספטמבר 2026</time>
        </p>
      </header>

      <section className="space-y-2 text-slate-800">
        <h2 className="text-lg font-semibold text-slate-900">בית העסק</h2>
        <p><b>Lead Agentic</b> · עוסק מורשה <span dir="ltr">032340283</span></p>
        <p>רבי יוסף בוכריץ 6, ראשון לציון 7511404</p>
      </section>

      <section className="space-y-2 text-slate-800">
        <h2 className="text-lg font-semibold text-slate-900">איש קשר</h2>
        <p>יוליאן אברמוביץ</p>
        <p>טלפון: <a className="text-brand-700 hover:underline" href="tel:+972525278625" dir="ltr">052-527-8625</a></p>
        <p>דוא&quot;ל: <a className="text-brand-700 hover:underline" href="mailto:yulian@leadagentic.net">yulian@leadagentic.net</a></p>
      </section>

      <section className="space-y-2 text-slate-800">
        <h2 className="text-lg font-semibold text-slate-900">תמיכה טכנית ופניות משתמשים</h2>
        <p>
          פתחתם דיווח על תקלה או שאלה על החשבון?{' '}
          <Link href="/support" className="text-brand-700 hover:underline font-medium">
            פנייה לתמיכה טכנית
          </Link>
        </p>
      </section>

      <section className="space-y-2 text-slate-800">
        <h2 className="text-lg font-semibold text-slate-900">פרטיות ונגישות</h2>
        <p>
          פניות בנושא פרטיות ומידע אישי — לאותה כתובת דוא&quot;ל למעלה, בציון &quot;פנייה בנושא פרטיות&quot; בכותרת.
        </p>
        <p>
          פניות בנושא נגישות מטופלות על ידי רכז הנגישות — פרטים ב-
          <Link href="/accessibility" className="text-brand-700 hover:underline">הצהרת הנגישות</Link>.
        </p>
      </section>

      <div className="pt-4">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← חזרה לדף הבית</Link>
      </div>
    </main>
  );
}
