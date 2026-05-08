'use client';

// Small "back to home" link for standalone pages (login, register,
// invite-accept, select-entity, etc.) that don't render the sidebar.
//
// Wave 4 polish — users were getting stuck on these pages with no
// way back to the public landing.

import Link from 'next/link';
import { Home } from 'lucide-react';

interface Props {
  /** Optional override for the destination — defaults to "/". */
  href?: string;
  /** Optional label override — defaults to "דף הבית". */
  label?: string;
  className?: string;
}

export function HomeLink({ href = '/', label = 'דף הבית', className = '' }: Props) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors ${className}`}
    >
      <Home className="w-4 h-4" />
      <span>{label}</span>
    </Link>
  );
}
