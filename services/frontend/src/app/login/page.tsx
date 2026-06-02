'use client';

import { useState, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
// Link / UserPlus / ArrowLeft were removed along with the inline
// "register here" CTA inside ErrorBlock — see ErrorBlock's docstring
// for why that CTA is no longer needed with the prospect flow.
import { authApi, otpApi, type Membership } from '@/lib/api';
import { saveTokens, getRoleFromToken } from '@/lib/auth';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { HomeLink } from '@/components/HomeLink';
import Logo from '@/components/Logo';

type Mode = 'sms' | 'email';
type OtpPhase = 'phone' | 'code';
type Intent = 'contractor' | 'corporation' | null;

function otpError(msg: string): string {
  if (msg === 'rate_limited')               return 'יותר מדי ניסיונות. נסה שוב מאוחר יותר';
  if (msg === 'wrong_code')                 return 'קוד לא נכון. נסה שנית';
  if (msg === 'max_attempts')               return 'יותר מדי ניסיונות שגויים. בקש קוד חדש';
  if (msg === 'otp_expired_or_not_found')   return 'הקוד פג תוקף. שלח קוד חדש';
  if (msg === 'otp_expired')                return 'הקוד פג תוקף. שלח קוד חדש';
  if (msg === 'invalid_phone'  || msg === 'phone_required')
                                            return 'מספר טלפון לא תקין. יש להזין מספר ישראלי בפורמט 05XXXXXXXX';
  if (msg === 'use_phone_login')            return 'חשבון זה מחייב כניסה עם SMS / WhatsApp';
  // user_not_found can't really happen any more — the backend now
  // returns `{ prospect: true }` for unregistered phones and the
  // /login flow routes those to /try/contractor before showing an
  // error. Kept for legacy clients that haven't redeployed yet.
  if (msg === 'user_not_found')             return 'מספר הטלפון לא רשום במערכת';
  // apiFetch's friendlyError already translates known codes — if the
  // message is already Hebrew, surface it as-is.
  if (/[֐-׿]/.test(msg))          return msg;
  // Generic fallback. Previously this defaulted to "phone not
  // registered" which sent prospects down a dead-end register path
  // — misleading after the new prospect flow + unhelpful for every
  // other failure mode (network, SMS gateway down, invalid format).
  return 'שגיאה בשליחת הקוד. בדוק את המספר ונסה שוב';
}

/** Error block — plain red alert. The inline "register here" CTA that
 *  used to live here was removed: with the new prospect flow, an
 *  unregistered phone now passes OTP successfully and gets routed
 *  to /try/contractor — so the "phone not registered" failure mode
 *  is effectively retired. Errors here are now real failures (bad
 *  phone format, SMS gateway down, rate limit) and a register link
 *  would only mislead. */
function ErrorBlock({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2.5 text-start">
      <p>{error}</p>
    </div>
  );
}

function redirectByRole(router: ReturnType<typeof useRouter>, role: string | null) {
  if (role === 'admin')       { router.push('/admin/dashboard'); return; }
  if (role === 'corporation') { router.push('/corporation/dashboard'); return; }
  router.push('/contractor/dashboard');
}

// Role-aware copy keyed by intent (the role the user clicked into).
const COPY = {
  contractor: {
    title:           'כניסה כקבלן',
    description:    'מצא עובדים לפרויקטים שלך — בכמה לחיצות',
    // Was "קבלן קיים — הכנס" — the role context is already conveyed by
    // the title above ("כניסה כקבלן"), so the button just needs to read
    // as the action verb.
    existingLabel:  'התחבר',
    newLabel:       'קבלן חדש — הירשם כאן',
    registerHref:   '/register/contractor',
    noAccountHint:  'מספר זה אינו רשום כקבלן. רוצה להירשם?',
  },
  corporation: {
    title:           'כניסה כתאגיד',
    description:    'פרסם עובדים זמינים והגיע ישירות לקבלנים',
    existingLabel:  'התחבר',
    newLabel:       'תאגיד חדש — הירשמו כאן',
    registerHref:   '/register/corporation',
    noAccountHint:  'מספר זה אינו רשום כתאגיד. רוצה להירשם?',
  },
  generic: {
    title:           'כניסה למערכת',
    description:    'נשלח קוד אימות ל-SMS / WhatsApp',
    existingLabel:  'שלח קוד',
    newLabel:       null,
    registerHref:   null,
    noAccountHint:  null,
  },
} as const;

// Build marker — bump this whenever something user-facing on this
// page changes so you can confirm the user's browser is on the
// expected bundle. Look for [login v=…] in their console.
const LOGIN_BUILD = 'option-a-2026-05-24';

function LoginPageInner() {
  const router        = useRouter();
  const searchParams  = useSearchParams();
  const { refreshAuth } = useAuth();

  // One-shot, on first render. Visible in DevTools → Console
  // so we can ask "does it say option-a-2026-05-24?" to confirm
  // a cached old bundle is or isn't the cause of the next bug.
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __loginBuildLogged?: boolean };
    if (!w.__loginBuildLogged) {
      // eslint-disable-next-line no-console
      console.log(`[login v=${LOGIN_BUILD}] forms have action="#", buttons type="button" + onClick`);
      w.__loginBuildLogged = true;
    }
  }

  // The `intent` param tells us which CTA the user clicked on the
  // landing page. We use it to (1) show role-specific copy on this
  // page and (2) auto-resolve membership selection after auth so the
  // intermediate /select-entity screen is skipped.
  const rawIntent = searchParams?.get('intent');
  const intent: Intent = rawIntent === 'contractor' || rawIntent === 'corporation' ? rawIntent : null;
  const copy = intent ? COPY[intent] : COPY.generic;

  const [mode, setMode]       = useState<Mode>('sms');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [otpPhase, setOtpPhase]   = useState<OtpPhase>('phone');
  const [phone, setPhone]         = useState('');
  const [normPhone, setNormPhone] = useState('');
  const [code, setCode]           = useState('');
  const codeRef = useRef<HTMLInputElement>(null);

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  /**
   * Resolve which entity the freshly-authed user should land in.
   *
   * - With `intent` set, we filter memberships to the requested role.
   *   If exactly one matches, call /auth/select-entity automatically
   *   and skip the picker entirely.
   * - Without `intent` (or when the user has multiple matching
   *   memberships of the same role), fall back to the legacy
   *   /select-entity flow.
   * - With `intent` set but no matching membership, show an inline
   *   "register instead?" prompt — that's almost always the actual
   *   user error here, not an auth bug.
   */
  async function handlePostLogin(
    accessToken: string,
    refreshToken: string,
    role: string,
    needsEntitySelection: boolean,
    memberships?: Membership[],
  ) {
    saveTokens(accessToken, refreshToken);
    refreshAuth();

    // No entity selection needed (single membership embedded in the
    // initial JWT, or admin role) — straight to the role's dashboard.
    if (!needsEntitySelection || !memberships) {
      redirectByRole(router, role);
      return;
    }

    // Intent filter behavior:
    //
    //   intent + 0 matches  → "no account for that role, register?"
    //   intent + exactly 1  → auto-pick, frictionless single-entity case
    //   intent + 2+ matches → SHOW the picker filtered to matching set
    //                         so the user explicitly chooses which of
    //                         their entities of that role they want to
    //                         enter as. Previously we silently picked
    //                         matching[0], locking users out of all
    //                         their other entities of the same role
    //                         (re-login auto-picked the same one).
    //   no intent           → render the unfiltered picker
    if (intent) {
      const matching = memberships.filter((m) => m.entity_type === intent);
      if (matching.length === 0) {
        setError(copy.noAccountHint ?? 'מספר זה אינו רשום עבור התפקיד שבחרת.');
        setLoading(false);
        return;
      }
      if (matching.length === 1) {
        try {
          const tokens = await otpApi.selectEntity(matching[0].entity_id, matching[0].entity_type);
          saveTokens(tokens.access_token, tokens.refresh_token);
          refreshAuth();
          router.push(intent === 'corporation' ? '/corporation/dashboard' : '/contractor/dashboard');
          return;
        } catch {
          // Fall through to the picker on any failure — safer than
          // surfacing a confusing error to the user.
        }
      }
      // matching.length > 1 → hand off to the picker. The select-entity
      // page reads `pending_intent` and renders the filtered list.
    }

    sessionStorage.setItem('pending_memberships', JSON.stringify(memberships));
    if (intent) sessionStorage.setItem('pending_intent', intent);
    router.push('/select-entity');
  }

  // All three of these can be triggered from either an onSubmit
  // (Enter key in an input) OR an explicit button onClick (so we can
  // use type="button" and bypass the form submission path entirely
  // — fix for a reported case where the page full-reloaded to
  // /login? on every click, i.e. preventDefault wasn't winning the
  // race against native form submission).
  async function handleSendOtp(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.(); setError('');
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
    } finally { setLoading(false); }
  }

  async function handleOtpLogin(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.(); setError('');
    if (code.length !== 6) { setError('קוד האימות חייב להכיל 6 ספרות'); return; }
    setLoading(true);
    try {
      const res = await otpApi.loginOtp(normPhone, code, intent || undefined);
      // Prospect path — phone passed OTP but has no user record yet.
      // Backend already marked the OTP as satisfying 'register' purpose,
      // so we stash the phone in sessionStorage and route into the
      // trial flow. The user never sees the "phone not registered" error
      // any more; they go straight into "try the product, then register
      // to save your work".
      if ('prospect' in res && res.prospect) {
        sessionStorage.setItem('prospect', JSON.stringify({
          phone:  res.phone,
          intent: res.intent,
          // Wall-clock expiry so the trial pages can detect a stale
          // session (e.g. the user navigated away for 20 minutes and
          // came back) and bounce back to /login if needed.
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        }));
        // Today only the contractor trial flow exists; corporation
        // prospects fall back to /login (existing CTA still works).
        router.push(res.intent === 'contractor' ? '/try/contractor' : '/login');
        return;
      }
      await handlePostLogin(
        res.access_token, res.refresh_token, res.role,
        res.needs_entity_selection, res.memberships,
      );
    } catch (err) {
      setError(otpError(err instanceof Error ? err.message : ''));
    } finally { setLoading(false); }
  }

  async function handleEmailLogin(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.(); setError('');
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
      setError(msg === 'use_phone_login' ? 'חשבון זה מחייב כניסה עם SMS / WhatsApp' : 'אימייל או סיסמה שגויים');
    } finally { setLoading(false); }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setOtpPhase('phone');
    setCode('');
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
            <CardTitle className="text-xl">{copy.title}</CardTitle>
            <CardDescription>
              {mode === 'sms' ? copy.description : 'כניסה עם אימייל וסיסמה'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {/* ── SMS (primary) ─────────────────────────────────────────── */}
            {/* action="#" + button type="button": defense in depth.
                If preventDefault loses a race against native form
                submission, the form posts to "#" instead of /login?
                — so the page doesn't full-reload and lose state
                (which is what was sending the user back to the
                phone entry on every click). */}
            {mode === 'sms' && otpPhase === 'phone' && (
              <form
                action="#"
                onSubmit={(e) => { e.preventDefault(); handleSendOtp(); }}
                className="flex flex-col gap-4"
                noValidate
              >
                <Input
                  label="מספר טלפון נייד"
                  type="tel"
                  placeholder="050-0000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  dir="ltr"
                />
                <ErrorBlock error={error} />
                <Button
                  type="button"
                  size="lg"
                  disabled={loading}
                  className="w-full"
                  onClick={() => handleSendOtp()}
                >
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /><span>שולח...</span></>
                    : copy.existingLabel}
                </Button>
              </form>
            )}

            {mode === 'sms' && otpPhase === 'code' && (
              <form
                action="#"
                onSubmit={(e) => { e.preventDefault(); handleOtpLogin(); }}
                className="flex flex-col gap-4"
                noValidate
              >
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
                <ErrorBlock error={error} />
                <Button
                  type="button"
                  size="lg"
                  disabled={loading}
                  className="w-full"
                  onClick={() => handleOtpLogin()}
                >
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

            {/* ── Email (secondary, hidden behind a small link) ─────────── */}
            {mode === 'email' && (
              <form
                action="#"
                onSubmit={(e) => { e.preventDefault(); handleEmailLogin(); }}
                className="flex flex-col gap-4"
                noValidate
              >
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
                <ErrorBlock error={error} />
                <Button
                  type="button"
                  size="lg"
                  disabled={loading}
                  className="w-full mt-1"
                  onClick={() => handleEmailLogin()}
                >
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /><span>מתחבר...</span></>
                    : 'כניסה'}
                </Button>
              </form>
            )}

            {/* Mode switch — small link, not a tab */}
            <div className="mt-4 text-center">
              {mode === 'sms' ? (
                <button
                  type="button"
                  onClick={() => switchMode('email')}
                  className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
                >
                  כניסה עם אימייל וסיסמה
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode('sms')}
                  className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
                >
                  ← חזרה לכניסה ב-SMS / WhatsApp
                </button>
              )}
            </div>

            {/* The "אין לך עדיין חשבון?" register CTA block was hidden
                per user request — both on the phone-entry and OTP-code
                screens. The new prospect flow (POST /auth/login/otp
                returns prospect=true when the phone has no user) is now
                the primary path for new visitors: enter phone → enter
                OTP → drop into /try/contractor → register only when
                they have a match they want to send. The legacy two-CTA
                block was redundant with that flow.
                Logic kept in COPY/ErrorBlock for the inline "register
                now" prompt that still appears INSIDE the error banner
                when a phone is recognised as wrong-role. */}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams must be wrapped in Suspense for static
  // optimization to work in Next 16 App Router.
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginPageInner />
    </Suspense>
  );
}
