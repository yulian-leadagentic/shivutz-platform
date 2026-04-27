'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { orgApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';

type State =
  | { kind: 'loading' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

function VerifyEmailLink() {
  const params = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const contractorId = params.get('contractor_id');
  const token = params.get('token');

  useEffect(() => {
    if (!contractorId || !token) {
      setState({ kind: 'error', message: 'הקישור לא תקין — חסרים פרמטרים' });
      return;
    }
    let aborted = false;
    (async () => {
      try {
        await orgApi.verifyConfirm(contractorId, 'email', token);
        if (aborted) return;
        setState({ kind: 'success' });
        setTimeout(() => router.push('/contractor/dashboard'), 1800);
      } catch (err) {
        if (aborted) return;
        const msg = err instanceof Error ? err.message : 'verify_failed';
        setState({
          kind: 'error',
          message:
            msg === 'invalid_token' ? 'קוד אימות שגוי או נמחק' :
            msg === 'expired'       ? 'הקישור פג תוקף — חזור לרישום וקבל קישור חדש' :
            msg === 'already_used'  ? 'הקישור כבר נוצל בעבר' :
            'אימות נכשל — נסה שוב או פנה לתמיכה',
        });
      }
    })();
    return () => { aborted = true; };
  }, [contractorId, token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md shadow-md">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
          {state.kind === 'loading' && (
            <>
              <Loader2 className="h-12 w-12 text-brand-600 animate-spin" />
              <h2 className="text-lg font-semibold text-slate-800">מאמת קישור...</h2>
            </>
          )}
          {state.kind === 'success' && (
            <>
              <CheckCircle2 className="h-16 w-16 text-emerald-500" />
              <h2 className="text-xl font-bold text-slate-900">החשבון אומת בהצלחה</h2>
              <p className="text-slate-600">מעביר אותך לדשבורד...</p>
            </>
          )}
          {state.kind === 'error' && (
            <>
              <AlertCircle className="h-16 w-16 text-red-500" />
              <h2 className="text-xl font-bold text-slate-900">אימות נכשל</h2>
              <p className="text-slate-600">{state.message}</p>
              <Link href="/login" className="text-brand-600 font-medium hover:underline text-sm">
                חזור לכניסה
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyEmailLinkPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      }
    >
      <VerifyEmailLink />
    </Suspense>
  );
}
