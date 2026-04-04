'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ClipboardList, Handshake, LogOut, Plus, Users, FileText } from 'lucide-react';
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
  { label: 'לוח בקרה',     href: '/contractor/dashboard', icon: LayoutDashboard },
  { label: 'בקשות עבודה',  href: '/contractor/requests',  icon: ClipboardList,
    sub: [{ label: '+ חדש', href: '/contractor/requests/new' }] },
  { label: 'עסקאות',       href: '/contractor/deals',     icon: Handshake },
  { label: 'צוות',         href: '/contractor/users',     icon: Users },
  { label: 'מסמכים',       href: '/contractor/documents', icon: FileText },
];

const CORPORATION_NAV: NavItem[] = [
  { label: 'לוח בקרה',   href: '/corporation/dashboard', icon: LayoutDashboard },
  { label: 'עסקאות',     href: '/corporation/deals',     icon: Handshake },
  { label: 'עובדים',     href: '/corporation/workers',   icon: ClipboardList },
  { label: 'צוות',       href: '/corporation/users',     icon: Users },
  { label: 'מסמכים',     href: '/corporation/documents', icon: FileText },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const entityType = getEntityType();
  const navItems = entityType === 'corporation' ? CORPORATION_NAV : CONTRACTOR_NAV;

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

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="space-y-1 px-3">
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
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
                {item.sub && isActive && (
                  <ul className="ms-8 mt-1 space-y-1">
                    {item.sub.map((s) => (
                      <li key={s.href}>
                        <Link
                          href={s.href}
                          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 transition-colors"
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
