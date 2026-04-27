import Link from 'next/link';
import { Building2 } from 'lucide-react';

export default function LandingFooter() {
  return (
    <footer className="bg-slate-950 text-slate-400 py-12 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center">
                <Building2 className="h-4 w-4 text-white" />
              </div>
              <span className="text-white text-xl font-bold">שיבוץ</span>
            </div>
            <p className="text-sm leading-relaxed max-w-xs">
              הפלטפורמה המובילה בישראל לשיבוץ עובדים זרים בענף הבנייה — מאמתת, מתאימה ומקלה.
            </p>
          </div>

          {/* Platform links */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">פלטפורמה</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/marketplace" className="hover:text-white transition-colors">שוק תאגידים</Link></li>
              <li><Link href="/register/contractor" className="hover:text-white transition-colors">הצטרף כקבלן</Link></li>
              <li><Link href="/register/corporation" className="hover:text-white transition-colors">הצטרף כתאגיד</Link></li>
              <li><Link href="/login" className="hover:text-white transition-colors">התחבר</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">מידע</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#how-it-works" className="hover:text-white transition-colors">איך זה עובד</a></li>
              <li><span className="text-slate-600">תנאי שימוש</span></li>
              <li><span className="text-slate-600">מדיניות פרטיות</span></li>
              <li><span className="text-slate-600">יצירת קשר</span></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <span>© {new Date().getFullYear()} שיבוץ פלטפורמה בע"מ — כל הזכויות שמורות</span>
          <span>מורשה ופועל לפי חוקי הגנת העובד הזר בישראל</span>
        </div>
      </div>
    </footer>
  );
}
