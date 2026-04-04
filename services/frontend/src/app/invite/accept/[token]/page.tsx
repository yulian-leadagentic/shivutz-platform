'use client';

import { useEffect, useState, useRef, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, HardHat, Building2 } from 'lucide-react';
import { inviteApi, otpApi, type InviteMetadata } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const ROLE_LABELS: Record<string, string> = {
  owner: 'בעלים', admin: 'מנהל', operator: 'מפעיל', viewer: 'צופה',
};

type Phase = 'loading' | 'error' | 'enter' | 'verify' | 'done';

function otpErr(msg: string): string {
  if (msg === 'rate_limited')             return 'יותר מדי ניסיונות. נסה שוב מאוחר יותר';
  if (msg === 'wrong_code')               return 'קוד לא נכון. נסה שנית';
  if (msg === 'max_attempts')             return 'יותר מדי ניסיונות. בקש קוד חדש';
  if (msg === 'otp_expired_or_not_found') return 'הקוד פג תוקף. שלח קוד חדש';
  if (msg === 'invite_not_found_or_used') return 'ההזמנה לא נמצאה או כבר נוצלה';
  if (msg === 'invite_expired')           return 'ההזמנה פגה תוקף (תקפה 7 ימים)';
  return 'שגיאה. נסה שוב';
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { refreshAuth } = useAuth();
  const codeRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase]         = useState<Phase>('loading');
  const [meta, setMeta]           = useState<InviteMetadata | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // form state
  const [phone, setPhone]       = useState('');
  const [normPhone, setNorm]    = useState('');
  const [code, setCode]         = useState('');
  const [fullName, setFullName] = useState('');
  const [isNew, setIsNew]       = useState(false); // show full_name field?

  // ── Load invite metadata ──────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    inviteApi.validate(token as string)
      .then((m) => { setMeta(m); setPhase('enter'); })
      .catch((err) => {
        setError(otpErr(err instanceof Error ? err.message : ''));
        setPhase('error');
      });
  }, [token]);

  // ── Send OTP ──────────────────────────────────────────────────────────────
  async function handleSend(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!phone.trim()) { setError('יש להזין מספר טלפון'); return; }
    setLoading(true);
    try {
      const res = await otpApi.sendOtp(phone.trim(), 'invite_accept');
      setNorm(res.phone);
      setPhase('verify');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(otpErr(err instanceof Error ? err.message : ''));
    } finally { setLoading(false); }
  }

  // ── Accept invite ─────────────────────────────────────────────────────────
  async function handleAccept(e: FormEvent) {
    e.preventDefault(); setError('');
    if (code.length !== 6)       { setError('קוד האימות חייב להכיל 6 ספרות'); return; }
    if (isNew && !fullName.trim()) { setError('יש להזין שם מלא'); return; }
    setLoading(true);
    try {
      const res = await inviteApi.accept(token as string, normPhone, code, isNew ? fullName : undefined);
      saveTokens(res.access_token, res.refresh_token);
      refreshAuth();
      setPhase('done');
      setTimeout(() => {
        router.push(res.role === 'corporation' ? '/corporation/dashboard' : '/contractor/dashboard');
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // If user doesn't exist yet, show full_name field
      if (msg === 'full_name required for new users') {
        setIsNew(true);
        setError('נראה שזה הפעם הראשונה שלך — יש להזין שם מלא');
      } else {
        setError(otpErr(msg));
      }
    } finally { setLoading(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const EntityIcon = meta?.entity_type === 'corporation' ? Building2 : HardHat;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
        <Card className="rounded-t-none shadow-md">
          <CardHeader className="text-center pb-2">
            <div className="text-3xl font-bold text-brand-600 mb-1">שיבוץ</div>
            <CardTitle className="text-xl">אישור הזמנה</CardTitle>
          </CardHeader>

          <CardContent>
            {/* Loading */}
            {phase === 'loading' && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
              </div>
            )}

            {/* Error */}
            {phase === 'error' && (
              <div className="text-center py-6 flex flex-col items-center gap-3">
                <p className="text-red-600 font-medium">{error}</p>
              </div>
            )}

            {/* Enter phone */}
            {(phase === 'enter' || phase === 'verify') && meta && (
              <>
                {/* Invite info banner */}
                <div className="flex items-center gap-3 p-4 rounded-lg bg-brand-50 border border-brand-100 mb-5">
                  <EntityIcon className="h-8 w-8 text-brand-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-900">
                      {meta.entity_name || meta.entity_type}
                    </p>
                    <p className="text-sm text-slate-500">
                      תפקיד: {ROLE_LABELS[meta.role] ?? meta.role}
                      {meta.job_title ? ` — ${meta.job_title}` : ''}
                    </p>
                    {meta.inviter_name && (
                      <p className="text-xs text-slate-400">הוזמנת על ידי {meta.inviter_name}</p>
                    )}
                  </div>
                </div>

                {phase === 'enter' && (
                  <form onSubmit={handleSend} className="flex flex-col gap-4" noValidate>
                    <CardDescription className="text-center">
                      הזן את מספר הטלפון שלך לאימות ואישור ההזמנה
                    </CardDescription>
                    <Input
                      label="מספר טלפון נייד"
                      type="tel"
                      placeholder="050-0000000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                      dir="ltr"
                    />
                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
                    )}
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח...</> : 'שלח קוד אימות'}
                    </Button>
                  </form>
                )}

                {phase === 'verify' && (
                  <form onSubmit={handleAccept} className="flex flex-col gap-4" noValidate>
                    <p className="text-sm text-slate-600 text-center">
                      קוד אימות נשלח אל <span className="font-medium" dir="ltr">{normPhone}</span>
                    </p>
                    {isNew && (
                      <Input
                        label="שם מלא"
                        placeholder="ישראל ישראלי"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        autoComplete="name"
                      />
                    )}
                    <Input
                      ref={codeRef}
                      label="קוד אימות (6 ספרות)"
                      type="text"
                      inputMode="numeric"
                      pattern="\d{6}"
                      placeholder="123456"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      autoComplete="one-time-code"
                      dir="ltr"
                      className="text-center text-xl tracking-widest"
                    />
                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
                    )}
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> מאמת...</> : 'אשר הזמנה'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setPhase('enter'); setCode(''); setError(''); }}
                      className="text-sm text-brand-600 hover:underline text-center"
                    >
                      ← שנה מספר / שלח שוב
                    </button>
                  </form>
                )}
              </>
            )}

            {/* Done */}
            {phase === 'done' && (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
                <h2 className="text-xl font-bold text-slate-900">ברוך הבא!</h2>
                <p className="text-slate-600">ההזמנה אושרה. מעביר אותך לדשבורד...</p>
                <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
