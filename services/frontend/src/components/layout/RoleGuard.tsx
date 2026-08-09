'use client';

// P0-2 — Role/section access guard.
//
// One component, one behavior, four outcomes. Mounted from
// /contractor/layout.tsx, /corporation/layout.tsx, and /admin/layout.tsx.
// Every /<role>/* route runs through this before it renders.
//
//   ┌─────────────────────────┬──────────────────────────────────────┐
//   │ user state              │ what we render                       │
//   ├─────────────────────────┼──────────────────────────────────────┤
//   │ not logged in           │ redirect → /login                    │
//   │ JWT lacks entity + not  │ redirect → /select-entity            │
//   │   admin (mid-flow)      │                                      │
//   │ current entity matches  │ render children (happy path)         │
//   │ admin visiting anything │ render children (admins reach all)   │
//   │ wrong entity, path has  │ redirect → equivalent path in the    │
//   │   an equivalent in the  │   correct section                    │
//   │   right section         │                                      │
//   │ wrong entity, no        │ render <NoAccessCard/> with the      │
//   │   equivalent path       │   right CTA (add-role / go back)     │
//   └─────────────────────────┴──────────────────────────────────────┘
//
// Blank pages were happening because the previous version returned
// `null` in the "wrong entity" branch and relied on router.replace
// to redirect — but a Playwright-injected JWT (or a real JWT missing
// entity claims) hit that branch and the redirect target was another
// section-guarded route that also returned null. The user saw white.
//
// Now every non-render outcome renders SOMETHING: a redirect indicator
// or a real access card with an actionable CTA — never a blank page.

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { NoAccessCard } from './NoAccessCard';

export type RoleSection = 'contractor' | 'corporation' | 'admin';

interface Props {
  expect: RoleSection;
  children: React.ReactNode;
}

// Screens that exist in both /contractor/ and /corporation/. When a
// user hits the wrong section on one of these, we translate the URL
// 1:1 to the right section — same page, right context. Anything else
// bounces to the section's dashboard.
const SYMMETRIC_PATHS = new Set([
  'dashboard', 'documents', 'tenders', 'users',
]);

export default function RoleGuard({ expect, children }: Props) {
  const router    = useRouter();
  const pathname  = usePathname();
  const { isLoggedIn, role, entityType, hasEntityContext } = useAuth();

  // Track whether we've kicked off a redirect so we don't render the
  // wrong-section chrome for a frame while navigation resolves.
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    // ── unauthenticated → login (with returnTo so post-login lands
    // the user back where they started) ────────────────────────────
    if (!isLoggedIn) {
      setRedirecting(true);
      const returnTo = encodeURIComponent(pathname || '/');
      router.replace(`/login?returnTo=${returnTo}`);
      return;
    }

    // ── admin section ─────────────────────────────────────────────
    // Admins reach the admin section by role, not by entity claim.
    // A non-admin visiting /admin/* renders NoAccessCard below.
    if (expect === 'admin') {
      if (role === 'admin') return;
      // non-admin under /admin/* — fall through to the no-access
      // card render at the bottom.
      return;
    }

    // ── admins visiting /contractor or /corporation ────────────────
    // Admins impersonating for support work — pass through.
    if (role === 'admin') return;

    // ── JWT missing entity context (multi-membership user picked
    // nothing yet) → /select-entity ────────────────────────────────
    if (!hasEntityContext) {
      setRedirecting(true);
      router.replace('/select-entity');
      return;
    }

    // ── correct entity type — happy path ──────────────────────────
    if (entityType === expect) return;

    // ── wrong entity type. If the current path has a mirror in the
    // right section, translate 1:1; else drop the user on the right
    // section's dashboard. Both paths guarantee we don't paint the
    // wrong-section chrome and don't blank. ─────────────────────────
    const wrongPrefix   = expect === 'contractor' ? '/corporation' : '/contractor';
    const correctPrefix = expect === 'contractor' ? '/contractor'  : '/corporation';

    // Extract the tail after the wrong prefix (e.g. /corporation/workers → 'workers').
    const tail = pathname?.startsWith(wrongPrefix)
      ? pathname.slice(wrongPrefix.length).replace(/^\//, '').split('/')[0]
      : '';

    if (tail && SYMMETRIC_PATHS.has(tail)) {
      setRedirecting(true);
      router.replace(pathname!.replace(wrongPrefix, correctPrefix));
      return;
    }
    // Not symmetric → don't silently swap the URL to a page whose
    // shape differs (that was the "blank" pattern). Fall through to
    // the no-access card render, which explains the situation and
    // offers a CTA.
  }, [isLoggedIn, role, entityType, hasEntityContext, expect, pathname, router]);

  // ── render decisions ─────────────────────────────────────────────

  // Redirect in flight — show a light placeholder, not blank.
  if (redirecting) return <NoAccessCard variant="redirecting" />;

  // Not logged in yet — the effect above kicked off the redirect but
  // the first paint would otherwise flash empty children.
  if (!isLoggedIn) return <NoAccessCard variant="redirecting" />;

  // /admin section, non-admin user → no-access card.
  if (expect === 'admin' && role !== 'admin') {
    return <NoAccessCard variant="admin-only" />;
  }

  // Non-admin user on wrong section, non-symmetric path → no-access
  // card with add-role CTA.
  if (
    role !== 'admin' &&
    hasEntityContext &&
    entityType !== expect &&
    expect !== 'admin'
  ) {
    return <NoAccessCard variant={expect === 'corporation' ? 'need-corporation' : 'need-contractor'} />;
  }

  return <>{children}</>;
}
