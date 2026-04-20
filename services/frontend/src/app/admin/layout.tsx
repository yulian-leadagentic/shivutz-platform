'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ClipboardCheck, Handshake, Building2, LogOut, BadgeDollarSign, Percent, PhoneCall } from 'lucide-react';
import { clearTokens } from '@/lib/auth';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/admin/dashboard',  label: 'לוח בקרה',      icon: LayoutDashboard },
  { href: '/admin/approvals',  label: 'אישורים',        icon: ClipboardCheck, badge: true },
  { href: '/admin/deals',      label: 'עסקאות',         icon: Handshake },
  { href: '/admin/orgs',       label: 'ארגונים',        icon: Building2 },
  { href: '/admin/pricing',      label: 'תמחור תאגידים',  icon: BadgeDollarSign },
  { href: '/admin/commissions',      label: 'עמלות',         icon: Percent },
  { href: '/admin/registration-log', label: 'לוג רישומים',  icon: PhoneCall },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();

  function logout() {
    clearTokens();
    router.push('/login');
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar — start side (right in RTL) */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-slate-700">
          <span className="text-2xl font-bold text-brand-400">שיבוץ</span>
          <span className="block text-xs text-slate-400 mt-0.5">פאנל ניהול</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-3">
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

        {/* Logout */}
        <div className="p-3 border-t border-slate-700">
          <button
            onClick={logout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            יציאה
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-800">
            {NAV.find(n => pathname.startsWith(n.href))?.label ?? 'ניהול'}
          </h1>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">מנהל מערכת</span>
        </header>
        <main className="flex-1 p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
