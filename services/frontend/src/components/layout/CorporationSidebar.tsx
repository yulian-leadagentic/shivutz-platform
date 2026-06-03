'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import { Home, LayoutDashboard, Users, Handshake, LogOut, UserCog, CreditCard, Store, Globe2 } from 'lucide-react';
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
    // Renamed from "עסקאות" — the page is fundamentally about responding
    // to contractor requests for workers available right now, so the
    // corp-facing label leads with that framing.
    label: 'עובדים בזמינות מיידית',
    href: '/corporation/deals',
    icon: Handshake,
  },
  {
    label: 'בקשות ייבוא',
    href: '/corporation/tenders',
    icon: Globe2,
  },
  {
    // Renamed from "שוק" — the marketplace surfaces ancillary services
    // (housing, equipment, logistics) and the term "שירותים נלווים"
    // reflects that more accurately to users.
    label: 'שירותים נלווים',
    href: '/corporation/marketplace',
    icon: Store,
  },
  {
    // QA-R4 #C8: the corp users page is renamed to "צוות התאגיד" to
    // mirror the page H1 (also being renamed).
    label: 'צוות התאגיד',
    href: '/corporation/users',
    icon: UserCog,
  },
  {
    label: 'חיוב ותשלום',
    href: '/corporation/settings/billing',
    icon: CreditCard,
  },
];

export default function CorporationSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    clearTokens();
    router.push('/');
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-white border-s border-slate-200 shadow-sm shrink-0">
      {/* Logo — corporation sidebar is white, use the full-colour
          lockup directly (no wrapper). */}
      <Link href="/" className="flex items-center justify-center h-20 border-b border-slate-200 px-4 hover:bg-slate-50 transition-colors">
        <Logo size="sm" variant="on-light" decorative />
      </Link>

      {/* Role label */}
      <div className="px-4 py-2 border-b border-slate-100">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">תאגיד</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-1 px-3">
          {/* Home link to public landing */}
          <li>
            <Link
              href="/"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            >
              <Home className="h-5 w-5 shrink-0" />
              <span>דף הבית</span>
            </Link>
          </li>
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
