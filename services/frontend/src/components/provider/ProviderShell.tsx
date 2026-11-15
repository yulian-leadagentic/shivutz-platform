'use client';

// R34 §4a · the shell for /provider/*.
//
// The provider area used to be chrome-free: the dashboard drew its own
// header, and the listing form was the corporation form, whose max-w-2xl
// only looks right beside the corporation sidebar. With no sidebar the
// form hugged the start edge and left the rest of the screen empty.
//
// A top bar rather than a sidebar because the area has two pages. A
// 256px column holding two links would only move the empty space to the
// other side of the screen.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, LogOut, Megaphone, Menu, X } from 'lucide-react';
import Logo from '@/components/Logo';
import { apiFetch } from '@/lib/api/client';
import { clearTokens } from '@/lib/auth';
import { ENTITY_TYPE_HE } from '@/lib/labels';
import { cn } from '@/lib/utils';

const DASHBOARD     = '/provider/dashboard';
const LISTINGS_ID   = 'my-listings';
const MOBILE_NAV_ID = 'provider-nav-mobile';

// min-h-11 is the 44px tap target. The same element sits in the desktop
// row and in the mobile column, so it carries no width of its own.
// focus-visible:rounded-lg because the global :focus-visible rule in
// globals.css squares the corners to 2px, which clips the active pill.
const ITEM = 'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:rounded-lg';
const IDLE = 'text-slate-600 hover:bg-slate-100 hover:text-slate-900';
const CURRENT = 'bg-brand-50 font-semibold text-brand-800';

export default function ProviderShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hash, setHash] = useState('');
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [nameLoading, setNameLoading] = useState(true);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Same call the dashboard makes. A failure here must not cost the
  // provider the page under it, so the bar falls back to the role label
  // on its own.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ name: string }>('/organizations/providers/me')
      .then((me) => { if (!cancelled) setBusinessName(me.name); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setNameLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // "המודעות שלי" is a section of the dashboard, not a page, so the two
  // links share a pathname and only the hash tells them apart. The
  // router changes the hash with pushState, which fires no hashchange
  // (only back/forward does), hence the explicit setHash in go() below.
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [pathname]);

  const onListings  = pathname === DASHBOARD && hash === `#${LISTINGS_ID}`;
  const onDashboard = pathname === DASHBOARD && !onListings;

  // The dashboard shows a spinner until its data arrives, so on arrival
  // from the form (or on a hard load) the anchor does not exist yet when
  // the router tries to scroll to it, and the router does not try twice.
  useEffect(() => {
    if (!onListings || document.getElementById(LISTINGS_ID)) return;
    const observer = new MutationObserver(() => {
      const target = document.getElementById(LISTINGS_ID);
      if (!target) return;
      observer.disconnect();
      target.scrollIntoView();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [onListings]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      // Focus may have been inside the panel that just disappeared.
      toggleRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  function go(nextHash: string) {
    setHash(nextHash);
    setMenuOpen(false);
  }

  // Hard navigation, as in TopBar: AuthContext keeps isLoggedIn in
  // memory, and a soft push to / would still render the logged-in nav.
  function handleLogout() {
    clearTokens();
    window.location.assign('/');
  }

  // "מנוי ותשלום" is in the R34 spec, but its page arrives with a later
  // phase. It joins this list when the route exists.
  const items = (
    <>
      <Link
        href={DASHBOARD}
        onClick={() => go('')}
        aria-current={onDashboard ? 'page' : undefined}
        className={cn(ITEM, onDashboard ? CURRENT : IDLE)}
      >
        <LayoutDashboard className="h-5 w-5 shrink-0" aria-hidden="true" />
        לוח בקרה
      </Link>
      <Link
        href={`${DASHBOARD}#${LISTINGS_ID}`}
        onClick={() => go(`#${LISTINGS_ID}`)}
        aria-current={onListings ? 'page' : undefined}
        className={cn(ITEM, onListings ? CURRENT : IDLE)}
      >
        <Megaphone className="h-5 w-5 shrink-0" aria-hidden="true" />
        המודעות שלי
      </Link>
      <button
        type="button"
        onClick={handleLogout}
        className={cn(ITEM, 'text-slate-600 hover:bg-red-50 hover:text-red-700')}
      >
        <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
        יציאה
      </button>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/"
              aria-label="TagidAI · דף הבית"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:rounded-lg"
            >
              <Logo kind="icon" size="sm" decorative />
            </Link>
            <div className="min-w-0 leading-tight">
              {businessName ? (
                <p className="truncate text-base font-bold text-slate-900">{businessName}</p>
              ) : nameLoading ? (
                <span className="block h-4 w-28 rounded bg-slate-200 motion-safe:animate-pulse" aria-hidden="true" />
              ) : null}
              <p className="text-[11px] text-slate-500">{ENTITY_TYPE_HE.service_provider}</p>
            </div>
          </div>

          <nav aria-label="ניווט אזור הספק" className="hidden items-center gap-1 md:flex">
            {items}
          </nav>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="תפריט ניווט"
            aria-expanded={menuOpen}
            aria-controls={MOBILE_NAV_ID}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:rounded-lg md:hidden"
          >
            {menuOpen
              ? <X className="h-5 w-5" aria-hidden="true" />
              : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>

        {/* Always in the DOM so aria-controls has a target while closed.
            No display utility on this element: `flex` or `block` would
            outrank the [hidden] rule and the panel would never close. */}
        <nav
          id={MOBILE_NAV_ID}
          aria-label="ניווט אזור הספק"
          hidden={!menuOpen}
          className="border-t border-slate-100 motion-safe:animate-fade-in md:hidden"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-3">
            {items}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
