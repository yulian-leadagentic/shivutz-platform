'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, ClipboardList, Handshake,
  LogOut, Plus, Users, FileText,
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
  { label: 'איתור עובדים', href: '/contractor/requests',  icon: ClipboardList,
    sub: [{ label: '+ חדש', href: '/contractor/requests/new' }] },
  { label: 'עסקאות',      href: '/contractor/deals',     icon: Handshake },
  { label: 'צוות',        href: '/contractor/users',     icon: Users },
  { label: 'מסמכים',      href: '/contractor/documents', icon: FileText },
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
    <aside className="flex flex-col w-60 min-h-screen bg-slate-900 shrink-0">

      {/* Logo */}
      <div className="flex items-center h-14 px-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">ש</span>
          </div>
          <span className="text-white text-base font-semibold tracking-tight">שיבוץ</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto sidebar-scroll">
        <ul className="space-y-0.5 px-2">
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
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  )}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <span className="absolute start-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-primary-500" />
                  )}
                  <Icon className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    isActive ? 'text-primary-400' : 'text-slate-500 group-hover:text-slate-300'
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
                          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-primary-400 hover:bg-slate-800/60 hover:text-primary-300 transition-colors"
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

      {/* Divider + Logout */}
      <div className="p-2 border-t border-slate-800">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-red-950/50 hover:text-red-400 transition-all duration-150"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>יציאה</span>
        </button>
      </div>
    </aside>
  );
}
