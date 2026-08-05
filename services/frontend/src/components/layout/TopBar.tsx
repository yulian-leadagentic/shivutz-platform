'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, ChevronDown, Building2, HardHat, Check, Loader2, Eye } from 'lucide-react';
import { getAccessToken, decodeJwtPayload, clearTokens, saveTokens } from '@/lib/auth';
import { otpApi, type Membership } from '@/lib/api';
import { adApi } from '@/lib/api/ads';
import { useAuth } from '@/lib/AuthContext';
import MobileNavDrawer from './MobileNavDrawer';
import { NotificationBell } from './NotificationBell';

const pageTitles: Record<string, string> = {
  '/contractor':               'לוח בקרה',
  '/contractor/dashboard':     'לוח בקרה',
  '/contractor/users':         'ניהול צוות',
  '/contractor/documents':     'מסמכים',
  '/contractor/tenders':       'בקשות ייבוא עובדים מחו״ל',
  '/corporation':              'לוח בקרה',
  '/corporation/dashboard':    'לוח בקרה',
  '/corporation/ads':          'המודעות שלי',
  '/corporation/workers':      'ניהול עובדים',
  '/corporation/workers/new':  'הוספת עובד',
  '/corporation/users':        'ניהול צוות',
  '/corporation/documents':    'מסמכים',
  '/corporation/tenders':      'בקשות ייבוא עובדים מחו״ל',
  '/billing':                  'חשבון ומנוי',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.includes('/tenders/'))     return 'בקשת ייבוא עובדים';
  if (pathname.includes('/ads/'))         return 'מודעה';
  return 'TagidAI';
}

function getInitials(label: string): string {
  if (!label) return '?';
  // Email path — use the local part
  if (label.includes('@')) {
    const local = label.split('@')[0];
    const parts = local.split(/[._-]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return local.slice(0, 2).toUpperCase();
  }
  // Phone path — last two digits
  if (/^\+?\d[\d\s-]*$/.test(label)) {
    const digits = label.replace(/\D/g, '');
    return digits.slice(-2);
  }
  // Name path (Hebrew or English) — first letter of first two words
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]);
  return label.slice(0, 2);
}

function getDisplayName(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  if (typeof payload.full_name === 'string' && payload.full_name) return payload.full_name;
  if (typeof payload.email === 'string' && payload.email) return payload.email;
  if (typeof payload.phone === 'string' && payload.phone) return payload.phone;
  return ''; // never fall back to the raw UUID — looks broken
}

interface TopBarProps {
  /**
   * Optional drawer-content for the mobile nav trigger. When provided,
   * a hamburger button appears at the start of the bar (visible only
   * below `lg:`) and opens a slide-over drawer rendering this content.
   * Layouts pass their existing <Sidebar /> here so the same nav serves
   * both desktop and mobile.
   */
  mobileNav?: React.ReactNode;
}

const ENTITY_ROLE_LABELS: Record<string, string> = {
  contractor:  'קבלן',
  corporation: 'תאגיד',
};

export default function TopBar({ mobileNav }: TopBarProps = {}) {
  const pathname = usePathname();
  const router   = useRouter();
  const { entityId, entityType, refreshAuth, isLoggedIn } = useAuth();
  const [name, setName]         = useState<string>('');
  const [secondary, setSecondary] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // R3 — reveal quota gauge visible on every logged-in page. Only
  // meaningful for contractors (they spend reveals; corps receive).
  // usage endpoint returns 402 for expired subs — swallow so a lapsed
  // trial doesn't crash the topbar.
  const [reveals, setReveals] = useState<{ used: number; limit: number | null } | null>(null);
  useEffect(() => {
    if (!isLoggedIn || entityType !== 'contractor') { setReveals(null); return; }
    adApi.usage()
      .then((u) => setReveals({ used: u.usage.reveals_this_month, limit: u.limits.reveals_per_month }))
      .catch(() => setReveals(null));
  }, [isLoggedIn, entityType, entityId]);

  // Memberships drive the in-app entity switcher. Loaded once on mount
  // (and again whenever the active entityId changes — e.g. after a
  // switch — to keep the active-row indicator honest). The endpoint is
  // cheap (~50ms) so we don't bother caching across mounts.
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const payload = decodeJwtPayload(token);
    setName(getDisplayName(payload));
    // Show phone or email as the secondary line in the dropdown header.
    if (payload && typeof payload.phone === 'string' && payload.phone) {
      setSecondary(payload.phone);
    } else if (payload && typeof payload.email === 'string' && payload.email) {
      setSecondary(payload.email);
    }
  }, [entityId]);

  // Fetch memberships for the switcher. Only when the user is logged
  // in — anonymous TopBar renders (unlikely but possible during the
  // brief logout-redirect window) shouldn't 401-fetch.
  useEffect(() => {
    if (!isLoggedIn) { setMemberships([]); return; }
    otpApi.myMemberships()
      .then((res) => setMemberships(res.memberships ?? []))
      .catch(() => setMemberships([]));
  }, [isLoggedIn, entityId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  function handleLogout() {
    clearTokens();
    // Hard navigate (not router.push) so the whole React tree
    // re-mounts against an empty cookie jar. Without this,
    // AuthContext keeps its in-memory `state` (name, entityId,
    // isLoggedIn=true) until the next full reload — which made
    // the landing page's HeroSection still render the logged-in
    // header (with the name showing on the left). The previous
    // soft-nav cleared cookies but didn't reset the React state.
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    } else {
      router.push('/');
    }
  }

  // Switch the active entity. Calls /auth/select-entity, replaces
  // both tokens in the cookie jar, then hard-navigates to the new
  // entity's role dashboard so EVERY in-flight query against the
  // old JWT gets re-issued cleanly. Soft router.replace caused
  // stale fetches to land with the old token mid-transition.
  async function handleSwitchEntity(m: Membership) {
    if (m.entity_id === entityId) { setMenuOpen(false); return; }
    setSwitchingTo(m.membership_id);
    try {
      const tokens = await otpApi.selectEntity(m.entity_id, m.entity_type);
      saveTokens(tokens.access_token, tokens.refresh_token);
      refreshAuth();
      const target = m.entity_type === 'corporation'
        ? '/corporation/dashboard'
        : '/contractor/dashboard';
      if (typeof window !== 'undefined') {
        window.location.assign(target);
      } else {
        router.replace(target);
      }
    } catch {
      // Failed switch — surface via the button's hover state.
      // The user can retry, and the active entity hasn't changed.
      setSwitchingTo(null);
    }
  }

  return (
    <header className="h-16 bg-white border-b border-slate-200/80 flex items-center justify-between gap-2 px-3 sm:px-4 lg:px-6 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {mobileNav && <MobileNavDrawer nav={mobileNav} />}
        <h1 className="text-base sm:text-lg font-bold text-slate-900 text-start tracking-tight truncate">
          {getPageTitle(pathname)}
        </h1>
      </div>

      <div className="flex items-center gap-2 min-w-0">
      {/* G5 — in-app notification bell. Only meaningful once the user
          is signed in; when there is no name (logged-out) we skip it
          entirely so the anonymous landing/marketing surfaces don't
          poll /notifications and 401. */}
      {name && <NotificationBell />}

      {/* R3 — reveal quota gauge (contractors only). Amber at ≥80%,
          rose at 100%. Click routes to /billing so the upgrade path
          is one click from anywhere in the app. */}
      {reveals && reveals.limit != null && (() => {
        const pct   = reveals.limit === 0 ? 100 : Math.min(100, Math.round((reveals.used / reveals.limit) * 100));
        const tone  = pct >= 100 ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : pct >=  80 ? 'bg-amber-50 text-amber-700 border-amber-200'
                    :              'bg-slate-50 text-slate-700 border-slate-200';
        return (
          <Link
            href="/billing"
            className={`hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold rounded-full border px-2.5 py-1 ${tone}`}
            title="חשיפות שלך החודש · לחץ לניהול מנוי"
          >
            <Eye className="h-3.5 w-3.5" />
            <span dir="ltr">{reveals.used} / {reveals.limit}</span>
            <span>חשיפות</span>
          </Link>
        );
      })()}

      {name && (() => {
        // Resolve the active entity's display name from the
        // memberships list. Per QA-R5 R1#1, the top-right of every
        // management screen should surface "which entity am I acting
        // as right now". The user's personal name still shows
        // underneath as a secondary line so we don't lose that
        // identity. Before this change the trigger button rendered
        // ONLY the user's name, which left "which corp am I logged
        // into?" answerable only by opening the dropdown.
        const active = memberships.find(
          (m) => m.entity_id === entityId && m.entity_type === entityType,
        );
        const activeEntityName = active?.entity_name
          || (entityType ? ENTITY_ROLE_LABELS[entityType] : '');
        return (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 transition-colors"
            aria-label="תפריט משתמש"
          >
            <div className="hidden sm:flex flex-col items-end leading-tight max-w-[260px]">
              <span className="text-base sm:text-lg text-slate-900 font-bold truncate w-full text-end">
                {activeEntityName || name}
              </span>
              {activeEntityName && (
                <span className="text-[11px] text-slate-500 truncate w-full text-end">{name}</span>
              )}
            </div>
            <div className="h-11 w-11 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
              <span className="text-white text-base font-bold">{getInitials(activeEntityName || name)}</span>
            </div>
            <ChevronDown className={`h-5 w-5 text-slate-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div className="absolute end-0 top-full mt-1.5 z-50 w-72 bg-white rounded-xl border border-slate-200 shadow-lg py-1">
              {/* Header — phone/email tied to the underlying user
                  (NOT the active entity); useful when switching to
                  confirm "yes, this is still my session". */}
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-sm text-slate-800 font-medium truncate">{name}</p>
                {secondary && (
                  <p className="text-xs text-slate-400 truncate" dir="ltr">{secondary}</p>
                )}
              </div>

              {/* Entity switcher. Hidden when there's nothing to switch
                  to — single-membership users would otherwise see a
                  noisy "your one and only entity" row. */}
              {memberships.length > 1 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest font-bold text-slate-400">
                    החשבונות שלי
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {memberships.map((m) => {
                      const isActive = m.entity_id === entityId
                                    && m.entity_type === entityType;
                      const isSwitching = switchingTo === m.membership_id;
                      const Icon = m.entity_type === 'corporation' ? Building2 : HardHat;
                      return (
                        <button
                          key={m.membership_id}
                          type="button"
                          onClick={() => handleSwitchEntity(m)}
                          disabled={isSwitching || switchingTo !== null}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-start transition-colors ${
                            isActive
                              ? 'bg-brand-50 text-brand-900'
                              : 'text-slate-700 hover:bg-slate-50 disabled:opacity-50'
                          }`}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-brand-600' : 'text-slate-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{m.entity_name || ENTITY_ROLE_LABELS[m.entity_type] || m.entity_type}</p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {ENTITY_ROLE_LABELS[m.entity_type] ?? m.entity_type}
                            </p>
                          </div>
                          {isSwitching
                            ? <Loader2 className="h-4 w-4 animate-spin text-brand-600 shrink-0" />
                            : isActive
                              ? <Check className="h-4 w-4 text-brand-600 shrink-0" />
                              : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-slate-100 my-1" />
                </>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                התנתקות
              </button>
            </div>
          )}
        </div>
        );
      })()}
      </div>
    </header>
  );
}
