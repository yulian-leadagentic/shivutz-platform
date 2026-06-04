'use client';

import React from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, LayoutDashboard, ClipboardList, Handshake,
  LogOut, Plus, Users, FileText, Globe2, MessageCircle,
} from 'lucide-react';
import { clearTokens, getAccessToken, decodeJwtPayload } from '@/lib/auth';
import { cn } from '@/lib/utils';

function getEntityType(): 'contractor' | 'corporation' | null {
  if (typeof window === 'undefined') return null;
  const token = getAccessToken();
  if (!token) return null;
  const p = decodeJwtPayload(token);
  return (p?.entity_type as 'contractor' | 'corporation') ?? null;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  sub?: { label: string; href: string }[];
}

const CONTRACTOR_NAV: NavItem[] = [
  { label: 'לוח בקרה',    href: '/contractor/dashboard', icon: LayoutDashboard },
  // Wave 4 polish — חיפוש חדש standalone (no parent), goes straight
  // to the recruitment-category page.
  { label: 'חיפוש חדש',   href: '/contractor/find',      icon: Plus },
  // Wave 5: /contractor/searches dropped — /contractor/deals is now
  // the unified view that includes both past requests (empty groups)
  // and the proposals/deals on each. Sidebar label renamed to "בקשות
  // ועסקאות" so the merge is obvious.
  { label: 'בקשות ועסקאות', href: '/contractor/deals',     icon: Handshake },
  { label: 'בקשות ייבוא מחו״ל', href: '/contractor/tenders', icon: Globe2 },
  // Promoted "צוות" to a top-level entry so contractors get a direct
  // path to the team-management page (matches the corp sidebar). The
  // "ניהול והעלאת מסמכים" parent stays as the home for documents +
  // other future admin surfaces — its sub-menu just shed the team
  // item to avoid duplication.
  { label: 'צוות',      href: '/contractor/users',     icon: Users },
  { label: 'ניהול והעלאת מסמכים', href: '/contractor/manage', icon: FileText,
    sub: [
      { label: 'מסמכים',   href: '/contractor/documents' },
    ] },
];

const CORPORATION_NAV: NavItem[] = [
  { label: 'לוח בקרה',  href: '/corporation/dashboard', icon: LayoutDashboard },
  { label: 'עסקאות',    href: '/corporation/deals',     icon: Handshake },
  { label: 'עובדים',    href: '/corporation/workers',   icon: ClipboardList },
  { label: 'צוות',      href: '/corporation/users',     icon: Users },
  { label: 'מסמכים',    href: '/corporation/documents', icon: FileText },
];

export default function Sidebar() {
  const pathname    = usePathname();
  const router      = useRouter();
  const entityType  = getEntityType();
  const navItems    = entityType === 'corporation' ? CORPORATION_NAV : CONTRACTOR_NAV;

  function handleLogout() {
    clearTokens();
    router.push('/');
  }

  return (
    // Switched from bg-slate-900 (dark) to bg-white per user request —
    // the mobile hamburger drawer opens on top of the page using this
    // same component, and the dark navy background read as too heavy
    // on phone. Light theme also matches the corporation sidebar so
    // the contractor + corp shells look like the same product.
    <aside className="flex flex-col w-60 min-h-screen bg-white border-s border-slate-200 shadow-sm shrink-0">

      {/* Logo — sidebar is now light, use the on-light variant. */}
      <Link href="/" className="flex items-center justify-center h-16 px-4 border-b border-slate-200 hover:bg-slate-50 transition-colors">
        <Logo size="sm" variant="on-light" decorative />
      </Link>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        <ul className="space-y-0.5 px-2">
          {/* Home link to public landing — first item in every shell */}
          <li>
            <Link
              href="/"
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            >
              <Home className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-700" />
              <span>דף הבית</span>
            </Link>
          </li>
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href + '/'));
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  )}
                >
                  {isActive && (
                    <span className="absolute start-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-brand-500" />
                  )}
                  <Icon className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-700'
                  )} />
                  <span>{item.label}</span>
                </Link>

                {/* Sub items */}
                {item.sub && isActive && (
                  <ul className="ms-9 mt-0.5 space-y-0.5">
                    {item.sub.map((s) => (
                      <li key={s.href}>
                        <Link
                          href={s.href}
                          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-slate-50 hover:text-brand-700 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          {s.label.replace('+ ', '')}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Divider + Support entry + Logout */}
      <div className="p-2 border-t border-slate-200 space-y-0.5">
        <Link
          href="/support"
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
            pathname.startsWith('/support')
              ? 'bg-brand-50 text-brand-700'
              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
          )}
        >
          <MessageCircle className="h-4 w-4 shrink-0" />
          <span>פנייה לשירות לקוחות</span>
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-150"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>יציאה</span>
        </button>
      </div>
    </aside>
  );
}
