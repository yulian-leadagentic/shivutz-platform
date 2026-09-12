import Link from 'next/link';

export default function LandingFooter() {
  return (
    <footer className="bg-white text-slate-600 py-12 border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {/* Brand — the large "TagidAI" wordmark was removed per user
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
              <li><span className="text-slate-400 cursor-not-allowed" aria-disabled="true" title="לא זמין כרגע">שירותים נלווים <span className="text-[10px] bg-slate-100 text-slate-500 px-1 rounded">בקרוב</span></span></li>
              <li><Link href="/register/contractor" className="hover:text-brand-600 transition-colors">הצטרף כקבלן</Link></li>
              <li><Link href="/register/corporation" className="hover:text-brand-600 transition-colors">הצטרף כתאגיד</Link></li>
            </ul>
          </div>

          {/* Legal — L6 landed the four pages, so these are real Links
              now. The pre-L6 footer had them as text spans and inline
              "#how-it-works" pointed at the landing scroll anchor. */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">מידע</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#how-it-works" className="hover:text-brand-600 transition-colors">איך זה עובד</a></li>
              <li><Link href="/terms" className="hover:text-brand-600 transition-colors">תנאי שימוש</Link></li>
              <li><Link href="/privacy" className="hover:text-brand-600 transition-colors">מדיניות פרטיות</Link></li>
              <li><Link href="/accessibility" className="hover:text-brand-600 transition-colors">הצהרת נגישות</Link></li>
              <li><Link href="/contact" className="hover:text-brand-600 transition-colors">יצירת קשר</Link></li>
              <li><Link href="/support" className="hover:text-brand-600 transition-colors">תמיכה</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} <b>Lead Agentic</b> · עוסק מורשה <span dir="ltr">032340283</span> — כל הזכויות שמורות</span>
          <span>מורשה ופועל לפי חוקי הגנת העובד הזר בישראל</span>
        </div>
      </div>
    </footer>
  );
}
