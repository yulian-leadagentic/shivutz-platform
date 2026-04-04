'use client';

import { useState, FormEvent, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Smartphone, Mail } from 'lucide-react';
import { authApi, otpApi, type Membership } from '@/lib/api';
import { saveTokens, getRoleFromToken } from '@/lib/auth';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

// ─── helpers ─────────────────────────────────────────────────────────────────

type Tab = 'otp' | 'email';
type OtpPhase = 'phone' | 'code';

function otpError(msg: string): string {
  if (msg === 'rate_limited')               return 'יותר מדי ניסיונות. נסה שוב מאוחר יותר';
  if (msg === 'wrong_code')                 return 'קוד לא נכון. נסה שנית';
  if (msg === 'max_attempts')               return 'יותר מדי ניסיונות שגויים. בקש קוד חדש';
  if (msg === 'otp_expired_or_not_found')   return 'הקוד פג תוקף. שלח קוד חדש';
  if (msg === 'otp_expired')               return 'הקוד פג תוקף. שלח קוד חדש';
  if (msg === 'user_not_found')            return 'מספר הטלפון אינו רשום. אנא הירשם תחילה';
  if (msg === 'use_phone_login')           return 'חשבון זה מחייב כניסה עם SMS';
  return 'שגיאה בהתחברות. נסה שוב';
}

function redirectByRole(router: ReturnType<typeof useRouter>, role: string | null) {
  if (role === 'admin')       { router.push('/admin/dashboard'); return; }
  if (role === 'corporation') { router.push('/corporation/dashboard'); return; }
  router.push('/contractor/dashboard');
}

// ─── component ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const { refreshAuth } = useAuth();

  const [tab, setTab]         = useState<Tab>('otp');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // ── OTP tab state ──────────────────────────────────────────────────────────
  const [otpPhase, setOtpPhase]   = useState<OtpPhase>('phone');
  const [phone, setPhone]         = useState('');
  const [normPhone, setNormPhone] = useState(''); // normalised by server
  const [code, setCode]           = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  // ── Email tab state ────────────────────────────────────────────────────────
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  // ── After-login redirect ───────────────────────────────────────────────────
  function handlePostLogin(
    accessToken: string,
    refreshToken: string,
    role: string,
    needsEntitySelection: boolean,
    memberships?: Membership[],
  ) {
    saveTokens(accessToken, refreshToken);
    refreshAuth();

    if (needsEntitySelection && memberships) {
      sessionStorage.setItem('pending_memberships', JSON.stringify(memberships));
      router.push('/select-entity');
    } else {
      redirectByRole(router, role);
    }
  }

  // ── OTP: send code ─────────────────────────────────────────────────────────
  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!phone.trim()) { setError('יש להזין מספר טלפון'); return; }

    setLoading(true);
    try {
      const res = await otpApi.sendOtp(phone.trim(), 'login');
      setNormPhone(res.phone);
      setOtpPhase('code');
      setCode('');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(otpError(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  // ── OTP: verify code + login ───────────────────────────────────────────────
  async function handleOtpLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (code.length !== 6) { setError('קוד האימות חייב להכיל 6 ספרות'); return; }

    setLoading(true);
    try {
      const res = await otpApi.loginOtp(normPhone, code);
      handlePostLogin(
        res.access_token,
        res.refresh_token,
        res.role,
        res.needs_entity_selection,
        res.memberships,
      );
    } catch (err) {
      setError(otpError(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  }

  // ── Email: login ───────────────────────────────────────────────────────────
  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('יש להזין כתובת אימייל'); return; }
    if (!password)     { setError('יש להזין סיסמה'); return; }

    setLoading(true);
    try {
      const tokens = await authApi.login(email, password);
      saveTokens(tokens.access_token, tokens.refresh_token);
      refreshAuth();
      redirectByRole(router, getRoleFromToken(tokens.access_token));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg === 'use_phone_login' ? 'חשבון זה מחייב כניסה עם SMS' : 'אימייל או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  }

  // ── tab switch helper ──────────────────────────────────────────────────────
  function switchTab(t: Tab) {
    setTab(t);
    setError('');
    setOtpPhase('phone');
    setCode('');
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        {/* Brand strip */}
        <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />

        <Card className="rounded-t-none shadow-md">
          <CardHeader className="text-center pb-2">
            <div className="text-3xl font-bold text-brand-600 mb-1">שיבוץ</div>
            <CardTitle className="text-xl">כניסה למערכת</CardTitle>
            <CardDescription>בחרו שיטת כניסה</CardDescription>
          </CardHeader>

          <CardContent>
            {/* Tabs */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden mb-5">
              <button
                type="button"
                onClick={() => switchTab('otp')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors
                  ${tab === 'otp' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <Smartphone className="h-4 w-4" />
                כניסה בSMS
              </button>
              <button
                type="button"
                onClick={() => switchTab('email')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors border-s border-slate-200
                  ${tab === 'email' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <Mail className="h-4 w-4" />
                כניסה במייל
              </button>
            </div>

            {/* ── OTP tab ─────────────────────────────────────────────────── */}
            {tab === 'otp' && (
              <>
                {otpPhase === 'phone' && (
                  <form onSubmit={handleSendOtp} className="flex flex-col gap-4" noValidate>
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
                      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-start">
                        {error}
                      </p>
                    )}
                    <Button type="submit" size="lg" disabled={loading} className="w-full">
                      {loading
                        ? <><Loader2 className="h-4 w-4 animate-spin" /><span>שולח...</span></>
                        : 'שלח קוד'}
                    </Button>
                  </form>
                )}

                {otpPhase === 'code' && (
                  <form onSubmit={handleOtpLogin} className="flex flex-col gap-4" noValidate>
                    <p className="text-sm text-slate-600 text-center">
                      קוד אימות נשלח אל <span className="font-medium" dir="ltr">{normPhone}</span>
                    </p>
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
                      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-start">
                        {error}
                      </p>
                    )}
                    <Button type="submit" size="lg" disabled={loading} className="w-full">
                      {loading
                        ? <><Loader2 className="h-4 w-4 animate-spin" /><span>מאמת...</span></>
                        : 'כניסה'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setOtpPhase('phone'); setError(''); setCode(''); }}
                      className="text-sm text-brand-600 hover:underline text-center"
                    >
                      ← שנה מספר טלפון / שלח שוב
                    </button>
                  </form>
                )}
              </>
            )}

            {/* ── Email tab ────────────────────────────────────────────────── */}
            {tab === 'email' && (
              <form onSubmit={handleEmailLogin} className="flex flex-col gap-4" noValidate>
                <Input
                  label="כתובת אימייל"
                  type="email"
                  placeholder="example@company.co.il"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  dir="ltr"
                />
                <Input
                  label="סיסמה"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-start">
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" disabled={loading} className="w-full mt-1">
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /><span>מתחבר...</span></>
                    : 'כניסה'}
                </Button>
              </form>
            )}

            {/* Registration links */}
            <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col gap-2 text-sm text-center text-slate-600">
              <p>
                קבלן?{' '}
                <Link href="/register/contractor" className="text-brand-600 font-medium hover:underline">
                  הירשם כאן
                </Link>
              </p>
              <p>
                תאגיד?{' '}
                <Link href="/register/corporation" className="text-brand-600 font-medium hover:underline">
                  הירשמו כאן
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
