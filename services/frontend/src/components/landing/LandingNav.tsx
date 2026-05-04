'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building2, Menu, X, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

interface LandingNavProps {
  onLeadCapture: () => void;
}

export default function LandingNav({ onLeadCapture }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { isLoggedIn, displayName, entityType } = useAuth();

  // Logged-in visitors should never be asked to "log in" again from
  // the home page (that was triggering an OTP loop because they'd
  // bounce through /login while still holding a valid token).
  const dashboardHref =
    entityType === 'corporation' ? '/corporation/dashboard' :
    entityType === 'contractor'  ? '/contractor/dashboard'  :
    '/select-entity';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const linkCls = scrolled ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400 hover:text-white';

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
      scrolled ? 'bg-white shadow-sm border-b border-slate-200' : 'bg-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-6">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0 me-auto">
          <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <Building2 className="h-4 w-4 text-white" />
          </div>
          <span className={`text-lg font-bold transition-colors ${scrolled ? 'text-slate-900' : 'text-white'}`}>
            שיבוץ
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          <a href="#how-it-works" className={`text-sm font-medium transition-colors ${linkCls}`}>
            איך זה עובד
          </a>
          <Link href="/marketplace" className={`text-sm font-medium transition-colors ${linkCls}`}>
            שוק תאגידים
          </Link>
          <button onClick={onLeadCapture} className={`text-sm font-medium transition-colors ${linkCls}`}>
            השאר פרטים
          </button>
        </nav>

        {/* Desktop buttons */}
        <div className="hidden md:flex items-center gap-2">
          {isLoggedIn ? (
            <>
              {displayName && (
                <span className={`text-xs font-medium ${scrolled ? 'text-slate-500' : 'text-slate-400'}`}>
                  מחובר: <span className={scrolled ? 'text-slate-700' : 'text-slate-200'}>{displayName}</span>
                </span>
              )}
              <Link
                href={dashboardHref}
                className="inline-flex items-center gap-1.5 text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg transition-colors shadow-sm"
              >
                <LayoutDashboard className="h-4 w-4" />
                לוח בקרה
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                  scrolled ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                משתמש רשום? לחץ כאן
              </Link>
              <Link
                href="/register/contractor"
                className="text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg transition-colors shadow-sm"
              >
                הצטרף בחינם
              </Link>
            </>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          className={`md:hidden p-2 rounded-lg transition-colors ${scrolled ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-400 hover:text-white'}`}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t border-slate-100 px-6 py-4 space-y-1 shadow-xl">
          <a href="#how-it-works" className="block text-sm font-medium text-slate-700 py-2.5 hover:text-brand-600" onClick={() => setMenuOpen(false)}>איך זה עובד</a>
          <Link href="/marketplace" className="block text-sm font-medium text-slate-700 py-2.5 hover:text-brand-600" onClick={() => setMenuOpen(false)}>שוק תאגידים</Link>
          <button className="block text-sm font-medium text-slate-700 py-2.5 hover:text-brand-600 w-full text-start" onClick={() => { setMenuOpen(false); onLeadCapture(); }}>השאר פרטים</button>
          <div className="pt-3 flex flex-col gap-2 border-t border-slate-100 mt-1">
            {isLoggedIn ? (
              <>
                {displayName && (
                  <p className="text-xs text-slate-500 text-center">מחובר: <span className="text-slate-700 font-medium">{displayName}</span></p>
                )}
                <Link href={dashboardHref} className="w-full text-center text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 py-2.5 rounded-lg" onClick={() => setMenuOpen(false)}>לוח בקרה</Link>
              </>
            ) : (
              <>
                <Link href="/login" className="w-full text-center text-sm font-medium text-slate-600 py-2.5 rounded-lg hover:bg-slate-50 border border-slate-200" onClick={() => setMenuOpen(false)}>משתמש רשום? לחץ כאן</Link>
                <Link href="/register/contractor" className="w-full text-center text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 py-2.5 rounded-lg" onClick={() => setMenuOpen(false)}>הצטרף בחינם</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
