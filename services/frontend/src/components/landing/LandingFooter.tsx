import Link from 'next/link';

export default function LandingFooter() {
  return (
    <footer className="bg-white text-slate-600 py-12 border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {/* Brand — the large "BuildUp" wordmark was removed per user
              request; the description below now stands alone as the
              brand block. The wordmark stays in the LandingNav at the
              top of the page so the brand mark isn't disappearing
              entirely from the experience. */}
          <div className="md:col-span-2">
            <p className="text-sm leading-relaxed max-w-xs">
              הפלטפורמה המובילה בישראל לשיבוץ עובדים זרים בענף הבנייה — מאמתת, מתאימה ומקלה.
            </p>
          </div>

          {/* Platform links */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">פלטפורמה</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/marketplace" className="hover:text-brand-600 transition-colors">שירותים נלווים</Link></li>
              <li><Link href="/register/contractor" className="hover:text-brand-600 transition-colors">הצטרף כקבלן</Link></li>
              <li><Link href="/register/corporation" className="hover:text-brand-600 transition-colors">הצטרף כתאגיד</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">מידע</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#how-it-works" className="hover:text-brand-600 transition-colors">איך זה עובד</a></li>
              <li><span className="text-slate-400">תנאי שימוש</span></li>
              <li><span className="text-slate-400">מדיניות פרטיות</span></li>
              <li><span className="text-slate-400">יצירת קשר</span></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} TagidAI פלטפורמה בע"מ — כל הזכויות שמורות</span>
          <span>מורשה ופועל לפי חוקי הגנת העובד הזר בישראל</span>
        </div>
      </div>
    </footer>
  );
}
