'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Building2, HardHat } from 'lucide-react';
import { otpApi, type Membership } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { HomeLink } from '@/components/HomeLink';

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

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading]         = useState<string | null>(null); // membership_id being selected
  const [error, setError]             = useState('');

  useEffect(() => {
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

    // If the user came from a role-specific landing CTA we already
    // know which entity_type they want — auto-pick the first
    // matching membership and never render the picker. With multiple
    // memberships of the same role, picking the first is good enough
    // for now; an in-app entity-switcher can handle multi-org users
    // later if that case actually shows up in the wild.
    const intent = sessionStorage.getItem('pending_intent');
    if (intent === 'contractor' || intent === 'corporation') {
      const matching = list.filter((m) => m.entity_type === intent);
      if (matching.length >= 1) {
        sessionStorage.removeItem('pending_intent');
        select(matching[0]);
        return;
      }
      // matching.length === 0 — fall back to showing all memberships;
      // the user does have other valid roles, so the picker is the
      // honest UI here.
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
            <div className="text-3xl font-bold text-brand-600 mb-1">שיבוץ</div>
            <CardTitle className="text-xl">בחר חשבון</CardTitle>
            <CardDescription>הנך משויך למספר ישויות. אנא בחר בה תרצה להמשיך</CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
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
