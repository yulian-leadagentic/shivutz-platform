'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ClipboardCheck, Handshake, Building2, LogOut, Percent, PhoneCall, Users, Inbox, Store } from 'lucide-react';
import { clearTokens } from '@/lib/auth';
import { cn } from '@/lib/utils';
import MobileNavDrawer from '@/components/layout/MobileNavDrawer';

const NAV = [
  { href: '/admin/dashboard',  label: 'לוח בקרה',      icon: LayoutDashboard },
  { href: '/admin/approvals',  label: 'אישורים',        icon: ClipboardCheck, badge: true },
  { href: '/admin/deals',      label: 'עסקאות',         icon: Handshake },
  { href: '/admin/orgs',       label: 'ארגונים',        icon: Building2 },
  { href: '/admin/users',      label: 'משתמשים',        icon: Users },
  { href: '/admin/leads',      label: 'פניות ובקשות',   icon: Inbox },
  { href: '/admin/marketplace', label: 'שוק — קטגוריות', icon: Store },
  { href: '/admin/commissions',      label: 'עמלות ומע״מ',  icon: Percent },
  { href: '/admin/registration-log', label: 'לוג רישומים',  icon: PhoneCall },
];

/**
 * The admin sidebar's actual content. Used twice in this file: as the
 * persistent left/right aside on desktop, and as the body of the mobile
 * slide-over drawer.
 */
function AdminSidebarBody({ pathname, onLogout }: { pathname: string; onLogout: () => void }) {
  return (
    <div className="w-64 max-w-full bg-slate-900 text-white flex flex-col h-full">
      <div className="px-6 py-5 border-b border-slate-700">
        <span className="text-2xl font-bold text-brand-400">שיבוץ</span>
        <span className="block text-xs text-slate-400 mt-0.5">פאנל ניהול</span>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-3 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-brand-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-700">
        <button
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          יציאה
        </button>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();

  function logout() {
    clearTokens();
    router.push('/');
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar — hidden below lg; the hamburger in the admin
          header below exposes the same nav inside a slide-over drawer. */}
      <aside className="hidden lg:block shrink-0">
        <AdminSidebarBody pathname={pathname} onLogout={logout} />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MobileNavDrawer
              nav={<AdminSidebarBody pathname={pathname} onLogout={logout} />}
            />
            <h1 className="text-base sm:text-lg font-semibold text-slate-800 truncate">
              {NAV.find(n => pathname.startsWith(n.href))?.label ?? 'ניהול'}
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="hidden sm:inline-block text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">מנהל מערכת</span>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-red-600 hover:bg-red-50 px-2 sm:px-3 py-1.5 rounded-md transition-colors"
              aria-label="התנתקות"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">התנתקות</span>
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
