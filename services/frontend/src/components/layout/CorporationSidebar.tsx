'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, Handshake, LogOut, UserCog } from 'lucide-react';
import { clearTokens } from '@/lib/auth';
import { cn } from '@/lib/utils';

const navItems = [
  {
    label: 'לוח בקרה',
    href: '/corporation/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'עובדים',
    href: '/corporation/workers',
    icon: Users,
  },
  {
    label: 'עסקאות',
    href: '/corporation/deals',
    icon: Handshake,
  },
  {
    label: 'ניהול משתמשים',
    href: '/corporation/users',
    icon: UserCog,
  },
];

export default function CorporationSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    clearTokens();
    router.push('/login');
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-white border-s border-slate-200 shadow-sm shrink-0">
      {/* Logo */}
      <div className="flex items-center justify-center h-16 border-b border-slate-200 px-4">
        <span className="text-2xl font-bold text-brand-600 tracking-tight">שיבוץ</span>
      </div>

      {/* Role label */}
      <div className="px-4 py-2 border-b border-slate-100">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">תאגיד</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-slate-200">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span>יציאה</span>
        </button>
      </div>
    </aside>
  );
}
