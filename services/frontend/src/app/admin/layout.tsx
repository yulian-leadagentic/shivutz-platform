'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import { Home, LayoutDashboard, ClipboardCheck, Building2, LogOut, PhoneCall, Users, Inbox, Flag, MessageCircle, FileCheck, Megaphone, CreditCard, Bell, Sliders } from 'lucide-react';
import { clearTokens } from '@/lib/auth';
import { cn } from '@/lib/utils';
import MobileNavDrawer from '@/components/layout/MobileNavDrawer';
// P0-2 — every /admin/* route now flows through RoleGuard first. A
// non-admin (contractor / corporation) landing here gets the admin-
// only NoAccessCard instead of the admin chrome rendering with
// broken API calls (which used to blank in some paths).
import RoleGuard from '@/components/layout/RoleGuard';

// Pivot/v2 admin nav — deal/tender/commission surfaces removed with the
// old model. New: /admin/ads (moderation) + /admin/subscriptions (tier
// mgmt). Registration approvals (kept per decision Q-a) live in
// /admin/approvals and /admin/orgs.
const NAV = [
  { href: '/admin/dashboard',          label: 'לוח בקרה',           icon: LayoutDashboard },
  { href: '/admin/approvals',          label: 'אישורים',             icon: ClipboardCheck, badge: true },
  { href: '/admin/orgs',               label: 'תאגידים וקבלנים',     icon: Building2 },
  { href: '/admin/ads',                label: 'מודעות',              icon: Megaphone },
  { href: '/admin/subscriptions',      label: 'מנויים',              icon: CreditCard },
  { href: '/admin/subscription-plans', label: 'מסלולי מנוי',         icon: Sliders },
  { href: '/admin/gov-corps-registry', label: 'רשימת תאגידים מורשים', icon: FileCheck },
  { href: '/admin/users',              label: 'משתמשים',             icon: Users },
  { href: '/admin/leads',              label: 'פניות ובקשות',         icon: Inbox },
  { href: '/admin/support',            label: 'פניות שירות לקוחות',   icon: MessageCircle },
  { href: '/admin/origins',            label: 'ארצות מוצא',           icon: Flag },
  { href: '/admin/registration-log',   label: 'לוג רישומים',          icon: PhoneCall },
  { href: '/admin/notifications-test', label: 'בדיקת הודעות',         icon: Bell },
];

/**
 * The admin sidebar's actual content. Used twice in this file: as the
 * persistent left/right aside on desktop, and as the body of the mobile
 * slide-over drawer.
 */
function AdminSidebarBody({ pathname, onLogout }: { pathname: string; onLogout: () => void }) {
  return (
    // Light theme — matches the contractor + corp sidebars. The mobile
    // hamburger drawer reuses this same component on phone, and the
    // dark navy background read as heavy + inconsistent with the rest
    // of the app on small screens.
    <div className="w-64 max-w-full bg-white text-slate-700 flex flex-col h-full border-s border-slate-200 shadow-sm">
      <Link href="/" className="block px-6 py-5 border-b border-slate-200 hover:bg-slate-50 transition-colors">
        <Logo size="md" variant="on-light" decorative />
        <span className="block text-sm font-semibold text-slate-700 mt-2">פאנל ניהול</span>
      </Link>

      <nav className="flex-1 py-4 space-y-1 px-3 overflow-y-auto">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
        >
          <Home className="h-4 w-4 shrink-0" />
          דף הבית
        </Link>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-200">
        <button
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
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
    <RoleGuard expect="admin">
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
    </RoleGuard>
  );
}
