'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ChevronDown } from 'lucide-react';
import { getAccessToken, decodeJwtPayload, clearTokens } from '@/lib/auth';

const pageTitles: Record<string, string> = {
  '/contractor/dashboard':     'לוח בקרה',
  '/contractor/requests':      'בקשות עבודה',
  '/contractor/requests/new':  'בקשת עבודה חדשה',
  '/contractor/deals':         'עסקאות',
  '/contractor/users':         'ניהול צוות',
  '/contractor/documents':     'מסמכים',
  '/corporation/dashboard':    'לוח בקרה',
  '/corporation/workers':      'ניהול עובדים',
  '/corporation/workers/new':  'הוספת עובד',
  '/corporation/deals':        'עסקאות',
  '/corporation/users':        'ניהול צוות',
  '/corporation/documents':    'מסמכים',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.includes('/match'))        return 'חיפוש התאמת עובדים';
  if (pathname.includes('/edit'))         return 'עריכת בקשה';
  if (pathname.includes('/deals/'))       return 'פרטי עסקה';
  if (pathname.includes('/requests/'))    return 'בקשת עבודה';
  return 'שיבוץ';
}

function getInitials(email: string): string {
  const name = email.split('@')[0];
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function TopBar() {
  const pathname = usePathname();
  const router   = useRouter();
  const [email, setEmail]       = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      const payload = decodeJwtPayload(token);
      if (payload && typeof payload.email === 'string') setEmail(payload.email);
      else if (payload && typeof payload.sub === 'string') setEmail(payload.sub);
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  function handleLogout() {
    clearTokens();
    router.push('/login');
  }

  return (
    <header className="h-14 bg-white border-b border-slate-200/80 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-sm font-semibold text-slate-800 text-start tracking-tight">
        {getPageTitle(pathname)}
      </h1>

      {email && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 transition-colors"
            aria-label="תפריט משתמש"
          >
            <span className="text-xs text-slate-400 hidden sm:block">{email}</span>
            <div className="h-7 w-7 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-semibold">{getInitials(email)}</span>
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div className="absolute end-0 top-full mt-1.5 z-50 w-44 bg-white rounded-xl border border-slate-200 shadow-lg py-1">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-xs text-slate-400 truncate">{email}</p>
              </div>
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
      )}
    </header>
  );
}
