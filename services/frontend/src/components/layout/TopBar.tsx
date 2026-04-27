'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ChevronDown } from 'lucide-react';
import { getAccessToken, decodeJwtPayload, clearTokens } from '@/lib/auth';

const pageTitles: Record<string, string> = {
  '/contractor/dashboard':     'לוח בקרה',
  '/contractor/requests':      'איתור עובדים',
  '/contractor/requests/new':  'איתור עובדים חדש',
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
  if (pathname.includes('/edit'))         return 'עריכת איתור';
  if (pathname.includes('/deals/'))       return 'פרטי עסקה';
  if (pathname.includes('/requests/'))    return 'איתור עובדים';
  return 'שיבוץ';
}

function getInitials(label: string): string {
  if (!label) return '?';
  // Email path — use the local part
  if (label.includes('@')) {
    const local = label.split('@')[0];
    const parts = local.split(/[._-]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return local.slice(0, 2).toUpperCase();
  }
  // Phone path — last two digits
  if (/^\+?\d[\d\s-]*$/.test(label)) {
    const digits = label.replace(/\D/g, '');
    return digits.slice(-2);
  }
  // Name path (Hebrew or English) — first letter of first two words
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]);
  return label.slice(0, 2);
}

function getDisplayName(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  if (typeof payload.full_name === 'string' && payload.full_name) return payload.full_name;
  if (typeof payload.email === 'string' && payload.email) return payload.email;
  if (typeof payload.phone === 'string' && payload.phone) return payload.phone;
  return ''; // never fall back to the raw UUID — looks broken
}

export default function TopBar() {
  const pathname = usePathname();
  const router   = useRouter();
  const [name, setName]         = useState<string>('');
  const [secondary, setSecondary] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const payload = decodeJwtPayload(token);
    setName(getDisplayName(payload));
    // Show phone or email as the secondary line in the dropdown header.
    if (payload && typeof payload.phone === 'string' && payload.phone) {
      setSecondary(payload.phone);
    } else if (payload && typeof payload.email === 'string' && payload.email) {
      setSecondary(payload.email);
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

      {name && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 transition-colors"
            aria-label="תפריט משתמש"
          >
            <span className="text-xs text-slate-600 font-medium hidden sm:block max-w-[160px] truncate">{name}</span>
            <div className="h-7 w-7 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-semibold">{getInitials(name)}</span>
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div className="absolute end-0 top-full mt-1.5 z-50 w-56 bg-white rounded-xl border border-slate-200 shadow-lg py-1">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-sm text-slate-800 font-medium truncate">{name}</p>
                {secondary && (
                  <p className="text-xs text-slate-400 truncate" dir="ltr">{secondary}</p>
                )}
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
