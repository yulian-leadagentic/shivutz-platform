'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Building2, HardHat, ShieldCheck } from 'lucide-react';
import { otpApi, type Membership } from '@/lib/api';
import { saveTokens, getAccessToken, decodeJwtPayload } from '@/lib/auth';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { HomeLink } from '@/components/HomeLink';
import Logo from '@/components/Logo';

const ENTITY_LABELS: Record<string, string> = {
  contractor:  'קבלן',
  corporation: 'תאגיד',
};

const ROLE_LABELS: Record<string, string> = {
  owner:    'בעלים',
  admin:    'מנהל',
  operator: 'מפעיל',
  viewer:   'צופה',
};

export default function SelectEntityPage() {
  const router = useRouter();
  const { refreshAuth } = useAuth();

  // Read role from the partial JWT issued by /auth/login/otp. When
  // the user is an admin we offer the admin dashboard as an extra
  // tile above their entity memberships — without this, an admin
  // who also owns a contractor/corporation entity gets routed
  // through the entity picker and can never reach /admin/* via the
  // login flow.
  const [isAdmin, setIsAdmin] = useState(false);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading]         = useState<string | null>(null); // membership_id being selected
  const [error, setError]             = useState('');

  useEffect(() => {
    // One-shot role read from the JWT cookie. The login flow saves
    // tokens (incl. the partial admin/role claim) BEFORE pushing
    // us here, so the cookie is already populated by the time this
    // effect fires.
    const token = getAccessToken();
    if (token) {
      const p = decodeJwtPayload(token);
      if (p && typeof p.role === 'string' && p.role === 'admin') setIsAdmin(true);
    }

    const raw = sessionStorage.getItem('pending_memberships');
    if (!raw) {
      // No pending memberships — redirect to login
      router.replace('/login');
      return;
    }
    let list: Membership[];
    try {
      list = JSON.parse(raw) as Membership[];
    } catch {
      router.replace('/login');
      return;
    }

    // Auto-pick / picker decision based on the landing intent.
    //
    // intent absent OR no matching membership for the intent →
    //   render the full picker (the honest UI when we don't know
    //   what they want or can't honour it).
    // intent + exactly 1 matching →
    //   auto-pick, skip the screen entirely.
    // intent + >1 matching →
    //   render the picker FILTERED to those matching memberships so
    //   the user picks which specific contractor/corporation
    //   account to act as. This is the multi-org case the user
    //   asked us to support.
    //
    // The `?force=1` query param (set by the landing CTA when it
    //   discovered >1 matching) is a hint, but we always re-check
    //   here using the actual list — sessionStorage is the source
    //   of truth.
    // IMPORTANT: do NOT remove `pending_intent` here. React strict
    // mode runs the effect twice on mount; the second pass would
    // read null and fall through to the all-memberships branch
    // below, overwriting the filtered set. We let `select()` clear
    // it after a successful pick instead.
    const intent = sessionStorage.getItem('pending_intent');
    if (intent === 'contractor' || intent === 'corporation') {
      const matching = list.filter((m) => m.entity_type === intent);
      if (matching.length === 1) {
        select(matching[0]);
        return;
      }
      if (matching.length > 1) {
        // Render the picker but ONLY for matching memberships so the
        // user isn't asked to disambiguate between unrelated roles.
        setMemberships(matching);
        return;
      }
      // matching.length === 0 — fall back to showing the full
      // membership list (user does have other valid roles).
    }
    setMemberships(list);
    // Eslint disable — `select` and `router` are stable for this page
    // and re-running this effect would re-trigger the auto-select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function select(m: Membership) {
    setError('');
    setLoading(m.membership_id);
    try {
      const res = await otpApi.selectEntity(m.entity_id, m.entity_type);
      saveTokens(res.access_token, res.refresh_token);
      refreshAuth();
      sessionStorage.removeItem('pending_memberships');
      sessionStorage.removeItem('pending_intent');

      if (m.entity_type === 'corporation') {
        router.push('/corporation/dashboard');
      } else {
        router.push('/contractor/dashboard');
      }
    } catch {
      setError('שגיאה בבחירת הישות. נסה שוב');
      setLoading(null);
    }
  }

  if (memberships.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 py-6">
      <div className="w-full max-w-md mb-3 flex justify-end">
        <HomeLink />
      </div>
      <div className="w-full max-w-md">
        <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
        <Card className="rounded-t-none shadow-md">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-3">
              <Logo size="lg" variant="on-light" />
            </div>
            <CardTitle className="text-xl">בחר חשבון</CardTitle>
            <CardDescription>הנך משויך למספר ישויות. אנא בחר בה תרצה להמשיך</CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            {/* Admin tile — only for users whose JWT carries role=admin.
                The login JWT (partial, pre-select-entity) already
                carries the admin claim, so the gateway accepts it on
                /api/admin/* without any further entity scoping. We
                just route the user to the admin dashboard and let
                their existing token through. */}
            {isAdmin && (
              <button
                key="__admin__"
                onClick={() => {
                  sessionStorage.removeItem('pending_memberships');
                  sessionStorage.removeItem('pending_intent');
                  router.push('/admin/dashboard');
                }}
                disabled={loading !== null}
                className="w-full flex items-center gap-4 p-4 rounded-lg border-2 border-rose-300 bg-rose-50/40 hover:border-rose-400 hover:bg-rose-50 transition-colors text-start disabled:opacity-60"
              >
                <ShieldCheck className="h-8 w-8 text-rose-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">מנהל מערכת</p>
                  <p className="text-xs text-slate-500 mt-0.5">פאנל ניהול הפלטפורמה</p>
                </div>
              </button>
            )}

            {memberships.map((m) => (
              <button
                key={m.membership_id}
                onClick={() => select(m)}
                disabled={loading !== null}
                className="w-full flex items-center gap-4 p-4 rounded-lg border-2 border-slate-200 hover:border-brand-400 hover:bg-brand-50 transition-colors text-start disabled:opacity-60"
              >
                {m.entity_type === 'contractor'
                  ? <HardHat className="h-8 w-8 text-brand-600 shrink-0" />
                  : <Building2 className="h-8 w-8 text-brand-600 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 truncate">
                    {m.entity_name || (ENTITY_LABELS[m.entity_type] ?? m.entity_type)}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {ENTITY_LABELS[m.entity_type] ?? m.entity_type} • {ROLE_LABELS[m.role] ?? m.role}
                  </p>
                </div>
                {loading === m.membership_id && (
                  <Loader2 className="h-5 w-5 animate-spin text-brand-600 shrink-0" />
                )}
              </button>
            ))}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-center">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
