'use client';

// Route-section guard. Drop one of these inside /contractor/layout
// or /corporation/layout to make sure the rendered children only
// reach a user whose CURRENT entity context matches.
//
// Why: a user with multiple memberships (e.g. owns both a contractor
// and a corporation) can land on /corporation/deals while their
// active JWT is scoped to their contractor. The corp page then
// fires API calls with `x-user-role: contractor`, gets back the
// contractor's deals, renders them through corp-specific filters,
// and surfaces a confused empty / error state. The honest fix is
// to bounce the user to their own role's page before any of that
// renders.
//
// Admins are passed through everywhere — no entity context on
// their JWT and they need access to both sections.
//
// While the redirect is in flight we render `null` rather than
// the children — keeps the wrong-section UI from briefly painting
// before navigation resolves.

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

interface Props {
  expect: 'contractor' | 'corporation';
  children: React.ReactNode;
}

export default function RoleGuard({ expect, children }: Props) {
  const router    = useRouter();
  const pathname  = usePathname();
  const { isLoggedIn, role, entityType, hasEntityContext } = useAuth();

  useEffect(() => {
    // Not logged in → let any page-level auth handler / 401 catcher
    // do its thing. RoleGuard is only about matching ROLES, not
    // bouncing unauthenticated users.
    if (!isLoggedIn) return;
    // Admins have no entity context and need to reach both sections
    // (e.g. impersonating an org for support work).
    if (role === 'admin') return;
    // Until entity context is on the JWT, don't gate — the user is
    // mid-flow (just OTP'd, hasn't picked an entity yet).
    if (!hasEntityContext) return;
    // The current entity matches the section — let the page render.
    if (entityType === expect) return;

    // Mismatch. Translate the current path 1:1 onto the matching
    // section so the user lands on the equivalent screen rather
    // than a generic dashboard. e.g. /corporation/deals while
    // acting as a contractor → /contractor/deals.
    const wrongPrefix    = expect === 'contractor' ? '/corporation' : '/contractor';
    const correctPrefix  = expect === 'contractor' ? '/contractor'  : '/corporation';
    const target = pathname?.startsWith(wrongPrefix)
      ? pathname.replace(wrongPrefix, correctPrefix)
      : `${correctPrefix}/dashboard`;
    router.replace(target);
  }, [isLoggedIn, role, entityType, hasEntityContext, expect, pathname, router]);

  // Hold rendering when we know the role mismatches — avoids
  // painting the wrong section's chrome for a frame before the
  // redirect resolves.
  if (
    isLoggedIn &&
    role !== 'admin' &&
    hasEntityContext &&
    entityType !== expect
  ) {
    return null;
  }
  return <>{children}</>;
}
