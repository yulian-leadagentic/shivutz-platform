'use client';

import { useEffect, useState, useRef, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, HardHat, Building2, User, Phone } from 'lucide-react';
import { inviteApi, otpApi, type InviteMetadata } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { HomeLink } from '@/components/HomeLink';
import Logo from '@/components/Logo';

const ROLE_LABELS: Record<string, string> = {
  owner: 'בעלים', admin: 'מנהל', operator: 'מפעיל', viewer: 'צופה',
};

type Phase = 'loading' | 'error' | 'confirm' | 'verify' | 'done';

function otpErr(msg: string): string {
  if (msg === 'rate_limited')             return 'יותר מדי ניסיונות. נסה שוב מאוחר יותר';
  if (msg === 'wrong_code')               return 'קוד לא נכון. נסה שנית';
  if (msg === 'max_attempts')             return 'יותר מדי ניסיונות. בקש קוד חדש';
  if (msg === 'otp_expired_or_not_found') return 'הקוד פג תוקף. שלח קוד חדש';
  if (msg === 'invite_not_found_or_used') return 'ההזמנה לא נמצאה או כבר נוצלה';
  if (msg === 'invite_expired')           return 'ההזמנה פגה תוקף (תקפה 7 ימים)';
  if (msg === 'phone_mismatch')           return 'מספר הטלפון אינו תואם להזמנה. פנה למזמין כדי שיעדכן את המספר.';
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

  // OTP state
  const [normPhone, setNorm]    = useState('');
  const [code, setCode]         = useState('');
  // Legacy fallback: meta.invited_phone is NULL on pre-040 rows. Then
  // we still let the user type a phone — and full_name — like before.
  const [legacyPhone, setLegacyPhone] = useState('');
  const [legacyName, setLegacyName]   = useState('');
  const [needsLegacyName, setNeedsLegacyName] = useState(false);

  // ── Load invite metadata ──────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    inviteApi.validate(token as string)
      .then((m) => { setMeta(m); setPhase('confirm'); })
      .catch((err) => {
        setError(otpErr(err instanceof Error ? err.message : ''));
        setPhase('error');
      });
  }, [token]);

  // Combined display name from the invite. May be empty for legacy rows.
  const invitedFullName = meta
    ? [meta.invited_first_name, meta.invited_last_name].filter(Boolean).join(' ').trim() || null
    : null;
  const isLegacy = meta ? !meta.invited_phone : false;

  // ── Send OTP ──────────────────────────────────────────────────────────────
  async function handleSend(e: FormEvent) {
    e.preventDefault(); setError('');
    const target = (meta?.invited_phone || legacyPhone).trim();
    if (!target) { setError('יש להזין מספר טלפון'); return; }
    setLoading(true);
    try {
      const res = await otpApi.sendOtp(target, 'invite_accept');
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
    if (code.length !== 6) { setError('קוד האימות חייב להכיל 6 ספרות'); return; }
    if (needsLegacyName && !legacyName.trim()) { setError('יש להזין שם מלא'); return; }
    setLoading(true);
    try {
      const res = await inviteApi.accept(
        token as string,
        normPhone,
        code,
        needsLegacyName ? legacyName.trim() : undefined,
      );
      saveTokens(res.access_token, res.refresh_token);
      refreshAuth();
      setPhase('done');
      setTimeout(() => {
        router.push(res.role === 'corporation' ? '/corporation/dashboard' : '/contractor/dashboard');
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Legacy backstop: if backend says we need a name (pre-022 invite
      // with no invited_first_name persisted, AND no existing users row),
      // surface the field. Modern invites never reach this branch.
      if (msg === 'full_name required for new users') {
        setNeedsLegacyName(true);
        setError('נראה שזה הפעם הראשונה שלך — יש להזין שם מלא');
      } else {
        setError(otpErr(msg));
      }
    } finally { setLoading(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const EntityIcon = meta?.entity_type === 'corporation' ? Building2 : HardHat;

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

            {/* Confirm + Verify share the entity banner */}
            {(phase === 'confirm' || phase === 'verify') && meta && (
              <>
                {/* Invite info banner — entity + role + inviter */}
                <div className="flex items-center gap-3 p-4 rounded-lg bg-brand-50 border border-brand-100 mb-4">
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

                {/* CONFIRM: read-only summary of who the invite is for + send button */}
                {phase === 'confirm' && (
                  <form onSubmit={handleSend} className="flex flex-col gap-3" noValidate>
                    {/* Read-only summary tiles */}
                    {(invitedFullName || meta.invited_phone) && (
                      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                        {invitedFullName && (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <User className="h-4 w-4 text-slate-400 shrink-0" />
                            <div className="text-xs text-slate-500">שם</div>
                            <div className="font-medium text-slate-900 text-sm ms-auto">{invitedFullName}</div>
                          </div>
                        )}
                        {meta.invited_phone && (
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                            <div className="text-xs text-slate-500">טלפון</div>
                            <div className="font-medium text-slate-900 text-sm ms-auto" dir="ltr">
                              {meta.invited_phone}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Legacy fallback: no invited_phone → ask for it */}
                    {isLegacy && (
                      <>
                        <CardDescription className="text-center">
                          הזן את מספר הטלפון שלך לאימות ואישור ההזמנה
                        </CardDescription>
                        <Input
                          label="מספר טלפון נייד"
                          type="tel"
                          placeholder="050-0000000"
                          value={legacyPhone}
                          onChange={(e) => setLegacyPhone(e.target.value)}
                          autoComplete="tel"
                          dir="ltr"
                        />
                      </>
                    )}

                    {!isLegacy && (
                      <p className="text-xs text-slate-500 text-center">
                        קוד אימות בן 6 ספרות יישלח ב-SMS למספר זה. אם הפרטים שגויים — פנה למזמין.
                      </p>
                    )}

                    {error && (
                      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
                    )}
                    <Button type="submit" disabled={loading} className="w-full">
                      {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח...</> : 'שלח קוד אימות'}
                    </Button>
                  </form>
                )}

                {/* VERIFY: just OTP. Name + phone are already locked in. */}
                {phase === 'verify' && (
                  <form onSubmit={handleAccept} className="flex flex-col gap-4" noValidate>
                    <p className="text-sm text-slate-600 text-center">
                      קוד אימות נשלח אל <span className="font-medium" dir="ltr">{normPhone}</span>
                    </p>
                    {needsLegacyName && (
                      <Input
                        label="שם מלא"
                        placeholder="ישראל ישראלי"
                        value={legacyName}
                        onChange={(e) => setLegacyName(e.target.value)}
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
                      onClick={() => { setPhase('confirm'); setCode(''); setError(''); }}
                      className="text-sm text-brand-600 hover:underline text-center"
                    >
                      ← שלח שוב
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
