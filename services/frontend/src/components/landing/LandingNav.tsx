'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Menu, X, LayoutDashboard, LogOut, ShieldCheck, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { clearTokens } from '@/lib/auth';

function getInitials(label: string): string {
  if (!label) return '?';
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]);
  return label.slice(0, 2);
}

interface LandingNavProps {
  onLeadCapture: () => void;
}

export default function LandingNav(_: LandingNavProps) {
  // onLeadCapture prop intentionally unused after the R2 #5 nav cleanup
  // (the lead-capture entry now lives in the RegistrationCTA section).
  // Interface kept so the call site in page.tsx doesn't need to change.
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { isLoggedIn, displayName, entityType, role } = useAuth();

  // Close user dropdown on outside click (mirrors TopBar behaviour).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  // Hard-nav logout so the AuthContext state actually resets.
  // Soft router.push leaves the in-memory `isLoggedIn=true` alive
  // until next reload and the navbar keeps rendering the
  // logged-in variant (the bug behind "logout button is hidden"
  // before this — there was just no button at all on the navbar).
  function handleLogout() {
    clearTokens();
    if (typeof window !== 'undefined') window.location.assign('/');
  }

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

  const linkCls = 'text-slate-600 hover:text-slate-900';

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-shadow duration-300 bg-white border-b border-slate-200 ${
      scrolled ? 'shadow-sm' : ''
    }`}>
      {/* Corner-logo removed per request — the full brand lockup lives
          in the hero, so the top corner sits empty. justify-end packs
          nav + buttons toward the inline-end (left in RTL), leaving the
          right corner clear. */}
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-end gap-6">

        {/* Desktop nav — "השאר פרטים" removed per QA (R2 #5): the lead-
            capture modal is already reachable from the per-role outlined
            buttons in the RegistrationCTA section; having a third nav
            entry made the top bar feel cluttered with duplicate paths. */}
        <nav className="hidden md:flex items-center gap-6">
          <a href="#how-it-works" className={`text-sm font-medium transition-colors ${linkCls}`}>
            איך זה עובד
          </a>
          <span
            className="text-sm font-medium text-slate-400 cursor-not-allowed inline-flex items-center gap-1.5"
            aria-disabled="true"
            title="לא זמין כרגע"
          >
            שירותים נלווים
            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">בקרוב</span>
          </span>
        </nav>

        {/* Desktop buttons */}
        <div className="hidden md:flex items-center gap-2">
          {isLoggedIn ? (
            // Single avatar dropdown — consolidates name + dashboard
            // + admin panel + logout into one button so the four
            // inline elements (with their Hebrew labels) don't overrun
            // the navbar width at mid-size viewports. Mirrors the
            // in-app TopBar's user menu pattern.
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg pe-2 ps-1 py-1 transition-colors hover:bg-slate-100"
                aria-label="תפריט משתמש"
              >
                <div className="h-9 w-9 rounded-full bg-brand-600 flex items-center justify-center shrink-0">
                  <span className="text-white text-xs font-bold">{getInitials(displayName || '?')}</span>
                </div>
                <span className="hidden sm:inline text-sm font-medium max-w-[180px] truncate text-slate-700">
                  {displayName || '—'}
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform text-slate-500 ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {userMenuOpen && (
                <div className="absolute end-0 top-full mt-1.5 z-50 w-56 bg-white rounded-xl border border-slate-200 shadow-lg py-1">
                  {displayName && (
                    <div className="px-3 py-2 border-b border-slate-100">
                      <p className="text-sm text-slate-800 font-medium truncate">{displayName}</p>
                      {entityType && (
                        <p className="text-xs text-slate-400 truncate">
                          {entityType === 'corporation' ? 'תאגיד' : entityType === 'contractor' ? 'קבלן' : entityType}
                        </p>
                      )}
                    </div>
                  )}
                  <Link
                    href={dashboardHref}
                    onClick={() => setUserMenuOpen(false)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition-colors"
                  >
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    לוח בקרה
                  </Link>
                  {role === 'admin' && (
                    <Link
                      href="/admin/dashboard"
                      onClick={() => setUserMenuOpen(false)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-rose-700 hover:bg-rose-50 transition-colors"
                    >
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      פאנל ניהול
                    </Link>
                  )}
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    התנתקות
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium px-4 py-2 rounded-lg transition-colors text-slate-600 hover:bg-slate-100"
              >
                משתמש רשום? לחץ כאן
              </Link>
              <Link
                href="/register/contractor"
                className="text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg transition-colors shadow-sm"
              >
                הצטרף
              </Link>
            </>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 rounded-lg transition-colors text-slate-700 hover:bg-slate-100"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t border-slate-100 px-6 py-4 space-y-1 shadow-xl">
          <a href="#how-it-works" className="block text-sm font-medium text-slate-700 py-2.5 hover:text-brand-600" onClick={() => setMenuOpen(false)}>איך זה עובד</a>
          <span className="block text-sm font-medium text-slate-400 py-2.5 cursor-not-allowed" aria-disabled="true">
            שירותים נלווים
            <span className="ms-2 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">בקרוב</span>
          </span>
          {/* "השאר פרטים" mobile entry removed — same de-dupe as desktop (R2 #5). */}
          <div className="pt-3 flex flex-col gap-2 border-t border-slate-100 mt-1">
            {isLoggedIn ? (
              <>
                {displayName && (
                  <p className="text-xs text-slate-500 text-center">מחובר: <span className="text-slate-700 font-medium">{displayName}</span></p>
                )}
                {role === 'admin' && (
                  <Link
                    href="/admin/dashboard"
                    onClick={() => setMenuOpen(false)}
                    className="w-full text-center text-sm font-semibold inline-flex items-center justify-center gap-1.5 text-rose-700 border border-rose-300 hover:bg-rose-50 py-2.5 rounded-lg"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    פאנל ניהול
                  </Link>
                )}
                <Link href={dashboardHref} className="w-full text-center text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 py-2.5 rounded-lg" onClick={() => setMenuOpen(false)}>לוח בקרה</Link>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); handleLogout(); }}
                  className="w-full text-center text-sm font-medium inline-flex items-center justify-center gap-1.5 text-slate-600 border border-slate-300 hover:bg-slate-50 py-2.5 rounded-lg"
                >
                  <LogOut className="h-4 w-4" />
                  התנתקות
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="w-full text-center text-sm font-medium text-slate-600 py-2.5 rounded-lg hover:bg-slate-50 border border-slate-200" onClick={() => setMenuOpen(false)}>משתמש רשום? לחץ כאן</Link>
                <Link href="/register/contractor" className="w-full text-center text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 py-2.5 rounded-lg" onClick={() => setMenuOpen(false)}>הצטרף</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
