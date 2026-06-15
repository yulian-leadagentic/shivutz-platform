'use client';

import { useEffect, useState, FormEvent, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, AlertCircle, Mail, Smartphone, ShieldCheck } from 'lucide-react';
import { orgApi, otpApi } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { HomeLink } from '@/components/HomeLink';
import Logo from '@/components/Logo';
import { readProspect, readPendingSearch, clearProspect, clearPendingSearch } from '@/features/prospect/state';
import type { RegistryChannel, RegistryLookupResult } from '@/types';

const TOTAL_STEPS = 3;

// ── Israeli ID checksum (mod 10, mirrors backend israeli_id.py) ──────────────
function isValidIsraeliId(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const digits = value.padStart(9, '0');
  if (digits.length !== 9) return false;
  let total = 0;
  for (let i = 0; i < 9; i++) {
    let n = parseInt(digits[i], 10) * (i % 2 === 0 ? 1 : 2);
    if (n > 9) n -= 9;
    total += n;
  }
  return total % 10 === 0;
}

// Step 1 — phone identity + OTP verification
interface Step1 {
  phone: string;
  normPhone: string;
  full_name: string;
  otpPhase: 'enter' | 'verify';
  code: string;
  otpVerified: boolean;
}
// Step 2 — company details + live registry lookup
interface Step2 {
  company_name_he: string;
  business_number: string;
  /** מספר רישיון קבלן — required. Backend cross-checks against
   *  פנקס הקבלנים for the same business_number. Mismatch → admin
   *  approval queue; the registration still completes. */
  kablan_number: string;
  operating_regions: string[];
}
// Step 3 — optional contact email + T&C accept
interface Step3 {
  contact_email: string;
  tc_accepted: boolean;
}

const CONTRACTOR_TC_VERSION = '2026-06-04.v1';
const CONTRACTOR_TC_TEXT = `
תנאי שימוש בפלטפורמת TagidAI לקבלנים — גרסה ${CONTRACTOR_TC_VERSION}

1. אישור והפעלה
המערכת פתוחה לקבלן מיד עם הרישום. הגשת בקשות לעובדים וקבלת הצעות מתאגידים מותנית באימות הקבלן (מספר רישיון קבלן מול פנקס הקבלנים) או אישור ידני של מנהל המערכת.

2. עמלות פלטפורמה
הקבלן אינו משלם עמלת פלטפורמה לפי עסקה. עמלות הפלטפורמה נגבות מהתאגיד שמספק את העובדים, לפי הגדרת מנהל המערכת.

3. תהליך החיוב והאישור
לאחר שהקבלן רואה את רשימת העובדים שהתאגיד הציע, יש לו חלון של 48 שעות לאשר או לבטל את העסקה. במהלך החלון הזה תיאום פרטים מתבצע ישירות מול התאגיד.

4. הסתרת פרטים עד אישור
הקבלן והתאגיד רואים זה את פרטי זה רק לאחר שהעסקה אושרה. בשלב הראשון הקבלן רואה רק מקצוע, כמות, מדינת מוצא ואזור — שם התאגיד נחשף רק עם אישור העסקה.

5. אחריות לבקשת העובדים
פרטי הבקשה שמסופקים על ידי הקבלן (מקצוע, כמות, אזור, תאריכי תחילה) נכונים למיטב ידיעתו ובאחריותו. שינויים בבקשה לאחר פרסומה מחייבים יידוע התאגידים שהציעו הצעה.

6. אימות צד נגדי והגבלת אחריות
TagidAI עושה כמיטב יכולתה לאמת תאגידים ומשתמשים בפלטפורמה (רשם החברות, רשימת תאגידי כוח אדם מורשים של רשות האוכלוסין וההגירה, אימות טלפון ועוד), אולם האחריות הסופית לבדיקת התאגיד שמולו פועל הקבלן — לרבות רישיון העסקת עובדים זרים, יכולת אספקה, ועמידה בחוקי העבודה — חלה על הקבלן עצמו. TagidAI לא תישא בכל הוצאה או נזק, ישיר או עקיף, הנובע מהתקשרות בין הקבלן לתאגיד.

7. תקשורת ויידוע
על ידי הרישום הקבלן מסכים לקבל הודעות SMS, WhatsApp ואימייל הקשורות לעסקאות, אישורים ושינויי סטטוס.
`.trim();
// Verify — post-registration channel verification
interface VerifyState {
  contractor_id: string;
  channels: RegistryChannel[];
  picked: RegistryChannel | null;
  code: string;
  sent: boolean;
}

function otpErrorMsg(msg: string): string {
  if (msg === 'rate_limited')             return 'יותר מדי ניסיונות. נסה שוב מאוחר יותר';
  if (msg === 'wrong_code')               return 'קוד לא נכון. נסה שנית';
  if (msg === 'max_attempts')             return 'יותר מדי ניסיונות. בקש קוד חדש';
  if (msg === 'otp_expired_or_not_found') return 'הקוד פג תוקף. שלח קוד חדש';
  return 'שגיאה באימות. נסה שוב';
}

function RegisterContractorInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromTrial = searchParams?.get('from') === 'trial';
  const [step, setStep]       = useState<1 | 2 | 3 | 'verify'>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);
  // Duplicate ח.פ outcome — see corp register for the same pattern.
  const [duplicateExistingName, setDuplicateExistingName] = useState<string | null>(null);
  const { regions } = useEnums();

  const [step1, setStep1] = useState<Step1>({
    phone: '', normPhone: '', full_name: '',
    otpPhase: 'enter', code: '', otpVerified: false,
  });

  // Trial bypass — when the user arrives here from /try/contractor/*,
  // their phone has already passed OTP at /login. The backend marked
  // that OTP as ALSO satisfying the 'register' purpose for 15 minutes,
  // so we can skip Step 1 entirely. We seed step1 with the prospect's
  // phone + `otpVerified: true` and jump straight to Step 2. The
  // full-name input that used to live on Step 1 is rendered on Step 2
  // instead (see Step 2 below). If the prospect session has expired
  // or there's no prospect at all, the user falls back into the
  // normal Step 1 flow — they'll re-OTP from there.
  useEffect(() => {
    if (!fromTrial) return;
    const p = readProspect();
    if (!p) return;          // expired / missing → fall back to normal flow
    setStep1((s) => ({
      ...s,
      phone: p.phone,
      normPhone: p.phone,
      otpPhase: 'verify',    // skip the "enter phone" sub-step
      otpVerified: true,     // skip the "enter code" sub-step too
    }));
    setStep(2);
  }, [fromTrial]);
  const [step2, setStep2] = useState<Step2>({
    company_name_he: '', business_number: '', kablan_number: '', operating_regions: [],
  });
  const [step3, setStep3] = useState<Step3>({ contact_email: '', tc_accepted: false });

  const [lookup, setLookup]           = useState<RegistryLookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [verify, setVerify]           = useState<VerifyState | null>(null);
  const [verifyError, setVerifyError] = useState('');

  const codeRef = useRef<HTMLInputElement>(null);

  const toggleRegion = (code: string) => setStep2((p) => ({
    ...p,
    operating_regions: p.operating_regions.includes(code)
      ? p.operating_regions.filter((r) => r !== code)
      : [...p.operating_regions, code],
  }));

  // ── Step 1 sub-step A: send OTP ──────────────────────────────────────────
  async function handleSendOtp(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!step1.phone.trim())     { setError('יש להזין מספר טלפון'); return; }
    if (!step1.full_name.trim()) { setError('יש להזין שם מלא'); return; }

    setLoading(true);
    try {
      const res = await otpApi.sendOtp(step1.phone.trim(), 'register');
      setStep1((p) => ({ ...p, normPhone: res.phone, otpPhase: 'verify', code: '' }));
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(otpErrorMsg(err instanceof Error ? err.message : ''));
    } finally { setLoading(false); }
  }

  // ── Step 1 sub-step B: verify OTP ────────────────────────────────────────
  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault(); setError('');
    if (step1.code.length !== 6) { setError('קוד האימות חייב להכיל 6 ספרות'); return; }

    setLoading(true);
    try {
      await otpApi.verifyOtp(step1.normPhone, step1.code, 'register');
      setStep1((p) => ({ ...p, otpVerified: true }));
      setStep(2);
    } catch (err) {
      setError(otpErrorMsg(err instanceof Error ? err.message : ''));
    } finally { setLoading(false); }
  }

  // ── Step 2: registry lookup on business_number blur ──────────────────────
  async function handleBusinessNumberBlur() {
    const bn = step2.business_number.trim();
    if (bn.length !== 9 || !isValidIsraeliId(bn)) {
      setLookup(null);
      return;
    }
    setLookupLoading(true);
    setError('');
    try {
      const result = await orgApi.lookupContractorBusiness(bn, step1.normPhone);
      setLookup(result);
      // Auto-prefill the (read-only) name when registry returned one.
      if (result.ok && result.prefill?.company_name_he) {
        setStep2((p) => ({ ...p, company_name_he: result.prefill!.company_name_he! }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // Don't block — registry can be down. Surface as a yellow info, not red.
      setLookup({ ok: false, error: msg || 'lookup_failed' });
    } finally {
      setLookupLoading(false);
    }
  }

  function classificationLabel(): string | null {
    const k = lookup?.prefill?.kvutza;
    const s = lookup?.prefill?.sivug;
    if (k && s) return `${k}-${s}`;
    return null;
  }

  // ── Step 2 → 3 ───────────────────────────────────────────────────────────
  function handleNext(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!step2.company_name_he.trim())      { setError('יש להזין שם חברה'); return; }
    if (!isValidIsraeliId(step2.business_number)) {
      setError('מספר ע.מ / ח.פ אינו תקין'); return;
    }
    if (lookup?.blocked) {
      setError(`לא ניתן לרשום חברה במצב "${lookup.block_reason}".`); return;
    }
    if (!step2.kablan_number.trim()) {
      setError('יש להזין את מספר רישיון הקבלן'); return;
    }
    if (step2.operating_regions.length === 0) {
      setError('יש לבחור לפחות אזור פעילות אחד'); return;
    }
    setStep(3);
  }

  // ── Step 3: final submit ──────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!step3.tc_accepted) {
      setError('יש לאשר את תנאי השימוש כדי להמשיך');
      return;
    }
    setLoading(true);
    try {
      const result = await orgApi.registerContractor({
        company_name_he:    step2.company_name_he,
        business_number:    step2.business_number,
        kablan_number:      step2.kablan_number.trim(),
        operating_regions:  step2.operating_regions,
        contact_name:       step1.full_name,
        contact_phone:      step1.normPhone,
        contact_email:      step3.contact_email || undefined,
      });

      if (result.access_token && result.refresh_token) {
        saveTokens(result.access_token, result.refresh_token);
      }

      // Trial loop closure — if the prospect filled a search form at
      // /try/contractor before being asked to register, replay it
      // against the real /searches endpoint now that they're auth'd.
      // We do this BEFORE any redirect so the search exists by the
      // time the user lands on /contractor/deals.
      const pending = fromTrial ? readPendingSearch() : null;
      if (pending && result.access_token) {
        try {
          // Inline import — searchApi pulls the access token via the
          // shared api client, which now sees the cookies we just
          // saveTokens'd above. Failures are non-fatal: the user lands
          // on the dashboard either way, and they can fill the form
          // again from there.
          const { searchApi } = await import('@/lib/api');
          await searchApi.create(pending);
        } catch {
          // Swallow — see comment above.
        }
      }
      // Cleanup — prospect session has served its purpose; the user
      // is now a real registered contractor.
      clearProspect();
      clearPendingSearch();

      // Branching on the kablan match result:
      //   matched  → already tier_2; straight to dashboard (or deals if
      //              they came from a trial-flow with a pending search).
      //   mismatch → row is pending admin review; show the "ממתין לאישור"
      //              screen so the user knows it's not a silent failure.
      // The legacy email/SMS verify path is only reached on the explicit
      // fallback for old kablan-less rows (not possible from this flow).
      if (result.kablan_matched) {
        if (pending) {
          router.push('/contractor/deals');
        } else {
          router.push('/contractor/dashboard');
        }
      } else {
        // Mismatch — pending admin queue. Surface the success-screen
        // copy with the "ממתין לאישור" message.
        setSuccess(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בהרשמה';
      // Duplicate ח.פ → inverted-invite flow. Backend already SMS'd
      // the existing owner; land the user on the 'we asked' screen.
      if (msg.includes('contractor_already_registered')) {
        const m = msg.match(/"existing_company_name"\s*:\s*"([^"]+)"/);
        setDuplicateExistingName(m ? m[1] : null);
        return;
      }
      setError(
        msg === 'phone_not_verified' ? 'אימות הטלפון פג תוקף. חזור לשלב הראשון' :
        msg === 'already_registered' ? 'מספר הטלפון כבר רשום. אנא התחבר' :
        msg === 'company_blocked'    ? 'החברה רשומה במצב לא פעיל ברשם החברות' :
        msg
      );
    } finally { setLoading(false); }
  }

  // ── Verify: pick a channel ───────────────────────────────────────────────
  async function handlePickChannel(channel: RegistryChannel) {
    if (!verify) return;
    setVerifyError('');
    setLoading(true);
    try {
      await orgApi.verifyStart(verify.contractor_id, channel.type, channel.target);
      setVerify({ ...verify, picked: channel, sent: true, code: '' });
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'send_failed');
    } finally { setLoading(false); }
  }

  // ── Verify: confirm SMS code (email is confirmed via the magic-link page) ─
  async function handleConfirmSms(e: FormEvent) {
    e.preventDefault();
    if (!verify || !verify.picked) return;
    setVerifyError('');
    if (verify.code.length !== 6) { setVerifyError('קוד האימות חייב להכיל 6 ספרות'); return; }
    setLoading(true);
    try {
      await orgApi.verifyConfirm(verify.contractor_id, 'sms', verify.code);
      router.push('/contractor/dashboard');
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'verify_failed');
    } finally { setLoading(false); }
  }

  function skipVerification() {
    router.push('/contractor/dashboard');
  }

  // Duplicate ח.פ → 'we asked the owner' screen
  if (duplicateExistingName !== null) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md shadow-md text-center border-2 border-emerald-300">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3">
          <CheckCircle2 className="h-16 w-16 text-emerald-500" />
          <h2 className="text-xl font-bold text-slate-900">הבקשה נשלחה</h2>
          <p className="text-slate-700 text-sm leading-relaxed">
            הקבלן <strong>{duplicateExistingName || 'עם ח.פ זה'}</strong> כבר רשום במערכת.
            <br />
            שלחנו לבעלים הקיים הודעת SMS עם קישור לאישור הוספתך כחבר צוות.
          </p>
          <p className="text-slate-500 text-xs">
            לאחר אישור, נשלח לך SMS עם פרטי הכניסה.
          </p>
          <Link href="/login" className="text-brand-600 font-medium hover:underline text-sm pt-1">
            חזרה לכניסה
          </Link>
        </CardContent>
      </Card>
    </div>
  );

  // ── Success screen (only when no tokens were returned — fallback) ────────
  if (success) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md shadow-md text-center">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <CheckCircle2 className="h-16 w-16 text-green-500" />
          <h2 className="text-xl font-bold text-slate-900">הבקשה התקבלה!</h2>
          <p className="text-slate-600">ממתין לאישור מנהל — עד 48 שעות</p>
          <p className="text-slate-500 text-sm">נשלח אליך SMS / WhatsApp לאחר האישור</p>
          <Link href="/login" className="text-brand-600 font-medium hover:underline text-sm">
            חזרה לכניסה
          </Link>
        </CardContent>
      </Card>
    </div>
  );

  const progressStep = step === 1 && step1.otpPhase === 'verify' ? 1
                     : step === 'verify'                          ? TOTAL_STEPS
                     : step;

  const namePrefilledFromRegistry = !!(lookup?.ok && lookup.prefill?.company_name_he);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-lg mb-3 flex justify-end">
        <HomeLink />
      </div>
      <div className="w-full max-w-lg relative">
        {/* Full-card loading overlay during the final registration
            submit. Same pattern as the corporation register page —
            users were double-clicking submit because the small button
            spinner wasn't obvious enough. */}
        {loading && step === 3 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center
                          bg-white/85 backdrop-blur-sm rounded-xl"
               aria-live="polite" aria-busy="true">
            <Loader2 className="h-12 w-12 animate-spin text-brand-600 mb-4" />
            <p className="text-base font-semibold text-slate-800">מבצע רישום...</p>
            <p className="text-sm text-slate-500 mt-1">אל תסגור את הדף</p>
          </div>
        )}
        <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
        <Card className="rounded-t-none shadow-md">
          <CardHeader className="pb-2">
            <div className="flex justify-center mb-3"><Logo size="md" variant="on-light" /></div>
            <CardTitle className="text-center">הרשמת קבלן</CardTitle>
            <CardDescription className="text-center">
              {step === 'verify' ? 'אימות בעלות' : `שלב ${step} מתוך ${TOTAL_STEPS}`}
            </CardDescription>
            <div className="mt-3 flex gap-1.5">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 h-1.5 rounded-full transition-colors ${i + 1 <= (typeof progressStep === 'number' ? progressStep : TOTAL_STEPS) ? 'bg-brand-600' : 'bg-slate-200'}`}
                />
              ))}
            </div>
          </CardHeader>

          <CardContent>
            {/* ── Step 1 ─────────────────────────────────────────────────── */}
            {step === 1 && step1.otpPhase === 'enter' && (
              <form onSubmit={handleSendOtp} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">פרטים אישיים</h3>
                <Input
                  label="שם מלא"
                  placeholder="ישראל ישראלי"
                  value={step1.full_name}
                  onChange={(e) => setStep1((p) => ({ ...p, full_name: e.target.value }))}
                  autoComplete="name"
                />
                <Input
                  label="מספר טלפון נייד"
                  type="tel"
                  placeholder="050-0000000"
                  value={step1.phone}
                  onChange={(e) => setStep1((p) => ({ ...p, phone: e.target.value }))}
                  autoComplete="tel"
                  dir="ltr"
                />
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
                )}
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח קוד...</> : 'שלח קוד אימות'}
                </Button>
                {/* The "יש לך חשבון? כניסה" link was removed — the user
                    is already inside the registration flow; the link
                    only created confusion for first-time prospects. If
                    a returning user lands here by mistake they'll see
                    the "already registered" error from the backend
                    after submitting, which is the natural place to
                    point them at /login. */}
              </form>
            )}

            {step === 1 && step1.otpPhase === 'verify' && (
              <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">אימות מספר טלפון</h3>
                <p className="text-sm text-slate-600">
                  קוד אימות נשלח אל <span className="font-medium" dir="ltr">{step1.normPhone}</span>
                </p>
                <Input
                  ref={codeRef}
                  label="קוד אימות (6 ספרות)"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  placeholder="123456"
                  maxLength={6}
                  value={step1.code}
                  onChange={(e) => setStep1((p) => ({ ...p, code: e.target.value.replace(/\D/g, '') }))}
                  autoComplete="one-time-code"
                  dir="ltr"
                  className="text-center text-xl tracking-widest"
                />
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
                )}
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> מאמת...</> : 'אמת מספר טלפון'}
                </Button>
                <button
                  type="button"
                  onClick={() => { setStep1((p) => ({ ...p, otpPhase: 'enter', code: '' })); setError(''); }}
                  className="text-sm text-brand-600 hover:underline text-center"
                >
                  ← שנה מספר / שלח שוב
                </button>
              </form>
            )}

            {/* ── Step 2 ─────────────────────────────────────────────────── */}
            {step === 2 && (
              <form onSubmit={handleNext} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">פרטי חברה</h3>

                {/* When the user arrived from the trial flow we skipped
                    Step 1, so the full-name input never rendered. Show
                    it here at the top of Step 2 so we still capture it
                    before the final submit. */}
                {fromTrial && (
                  <Input
                    label="שם מלא"
                    placeholder="ישראל ישראלי"
                    value={step1.full_name}
                    onChange={(e) => setStep1((p) => ({ ...p, full_name: e.target.value }))}
                    autoComplete="name"
                  />
                )}

                <Input
                  label="מספר ע.מ / ח.פ (9 ספרות)"
                  placeholder="123456789"
                  maxLength={9}
                  dir="ltr"
                  value={step2.business_number}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 9);
                    setStep2((p) => ({ ...p, business_number: v }));
                    if (lookup) setLookup(null); // invalidate prior lookup as user edits
                  }}
                  onBlur={handleBusinessNumberBlur}
                />

                {/* Registry status box */}
                {lookupLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    בודק במאגרים הציבוריים...
                  </div>
                )}
                {lookup && lookup.ok && lookup.blocked && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">החברה רשומה כ"{lookup.block_reason}" ברשם החברות.</p>
                      <p>הרישום אינו אפשרי. הודענו על כך למנהל המערכת.</p>
                    </div>
                  </div>
                )}
                {lookup && lookup.ok && !lookup.blocked && lookup.pinkash_found && (
                  <div className="flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                    <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div className="flex flex-col gap-0.5">
                      <p className="font-medium">מאומת בפנקס הקבלנים</p>
                      {lookup.prefill?.company_name_he && (
                        <p>שם: {lookup.prefill.company_name_he}</p>
                      )}
                      {classificationLabel() && (
                        <p>סיווג: {classificationLabel()}{lookup.prefill?.gov_branch ? ` · ${lookup.prefill.gov_branch}` : ''}</p>
                      )}
                    </div>
                  </div>
                )}
                {lookup && lookup.ok && !lookup.blocked && !lookup.pinkash_found && lookup.ica_found && (
                  <div className="flex items-start gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                    <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">חברה רשומה ברשם החברות</p>
                      <p>הרישום ימשיך — אישור מנהל ידני יידרש להפעלה מלאה.</p>
                    </div>
                  </div>
                )}
                {lookup && lookup.ok && !lookup.blocked && !lookup.pinkash_found && !lookup.ica_found && (
                  <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">העסק לא נמצא בפנקסים הציבוריים</p>
                      <p>תוכל להמשיך, אך הרישום ידרוש אישור מנהל ידני.</p>
                    </div>
                  </div>
                )}
                {lookup && !lookup.ok && (
                  <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    {lookup.message || 'בדיקת המאגרים נכשלה. תוכל להמשיך — אישור ידני יידרש.'}
                  </div>
                )}

                <Input
                  label="שם החברה"
                  placeholder='חברת הבנייה בע"מ'
                  value={step2.company_name_he}
                  onChange={(e) => setStep2((p) => ({ ...p, company_name_he: e.target.value }))}
                  readOnly={namePrefilledFromRegistry}
                  className={namePrefilledFromRegistry ? 'bg-slate-100 cursor-not-allowed' : ''}
                />

                {/* מספר רישיון קבלן — required. Backend verifies against
                    פנקס הקבלנים for the same business_number. We don't
                    pre-fill from the registry response (that would
                    defeat the verification — the whole point is that
                    the user proves they know their own license number). */}
                <Input
                  label="מספר רישיון קבלן"
                  placeholder="לדוגמה: 3842"
                  value={step2.kablan_number}
                  onChange={(e) => setStep2((p) => ({ ...p, kablan_number: e.target.value.replace(/\D/g, '') }))}
                  inputMode="numeric"
                  dir="ltr"
                />

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-700">אזורי פעילות</label>
                  <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto border border-slate-200 rounded-md p-3">
                    {regions.length === 0
                      ? <p className="text-sm text-slate-500 col-span-2">טוען אזורים...</p>
                      : regions.map((r) => (
                        <label key={r.code} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={step2.operating_regions.includes(r.code)}
                            onChange={() => toggleRegion(r.code)}
                            className="rounded"
                          />
                          {r.name_he}
                        </label>
                      ))}
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
                )}
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setError(''); setStep(1); }}
                    className="flex-1"
                  >
                    חזור
                  </Button>
                  <Button type="submit" className="flex-1" disabled={!!lookup?.blocked}>הבא</Button>
                </div>
              </form>
            )}

            {/* ── Step 3 ─────────────────────────────────────────────────── */}
            {step === 3 && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">פרטי קשר נוספים</h3>
                <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700 flex flex-col gap-1">
                  <p><span className="text-slate-500">שם:</span> {step1.full_name}</p>
                  <p dir="ltr" className="text-start"><span className="text-slate-500">טלפון: </span>{step1.normPhone}</p>
                </div>
                <Input
                  label="אימייל עסקי (אופציונלי)"
                  type="email"
                  placeholder="info@company.co.il"
                  dir="ltr"
                  value={step3.contact_email}
                  onChange={(e) => setStep3((p) => ({ ...p, contact_email: e.target.value }))}
                  autoComplete="email"
                />

                {/* T&C — scroll box + accept checkbox. BuildUp can't
                    accept a contractor onto the platform without
                    explicit consent to the liability + verification
                    sections. */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">תנאי שימוש</label>
                  <div
                    className="max-h-44 overflow-y-auto rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed"
                    dir="rtl"
                  >
                    {CONTRACTOR_TC_TEXT}
                  </div>
                  <label className="flex items-start gap-2 text-sm cursor-pointer mt-1">
                    <input
                      type="checkbox"
                      checked={step3.tc_accepted}
                      onChange={(e) => setStep3((p) => ({ ...p, tc_accepted: e.target.checked }))}
                      className="rounded mt-0.5"
                    />
                    <span>קראתי ואני מאשר את תנאי השימוש (גרסה {CONTRACTOR_TC_VERSION})</span>
                  </label>
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
                )}
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setError(''); setStep(2); }}
                    className="flex-1"
                  >
                    חזור
                  </Button>
                  <Button type="submit" disabled={loading || !step3.tc_accepted} className="flex-1">
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח...</> : 'הירשם'}
                  </Button>
                </div>
              </form>
            )}

            {/* ── Verify (post-registration) ──────────────────────────────── */}
            {step === 'verify' && verify && (
              <div className="flex flex-col gap-4">
                <h3 className="font-semibold text-slate-800">אימות בעלות על העסק</h3>
                <p className="text-sm text-slate-600">
                  מצאנו את העסק שלך בפנקס הקבלנים. כדי לקבל גישה מלאה (כולל הגשת בקשות לתאגידים),
                  אמת בעלות באמצעות אחד מהערוצים הרשומים בפנקס:
                </p>

                {!verify.sent && (
                  <div className="flex flex-col gap-2">
                    {verify.channels.map((c) => (
                      <button
                        key={`${c.type}:${c.target}`}
                        type="button"
                        onClick={() => handlePickChannel(c)}
                        disabled={loading}
                        className="flex items-center gap-3 px-4 py-3 rounded-md border border-slate-300 hover:border-brand-500 hover:bg-brand-50 transition-colors text-start"
                      >
                        {c.type === 'email' ? <Mail className="h-5 w-5 text-brand-600" /> : <Smartphone className="h-5 w-5 text-brand-600" />}
                        <div className="flex flex-col">
                          <span className="text-xs text-slate-500">
                            {c.type === 'email' ? 'אימות במייל' : 'אימות ב-SMS / WhatsApp'}
                          </span>
                          <span className="font-medium text-slate-800" dir="ltr">{c.target}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {verify.sent && verify.picked?.type === 'email' && (
                  <div className="flex items-start gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-3">
                    <Mail className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">קישור אימות נשלח</p>
                      <p>בדוק את תיבת הדואר של <span dir="ltr">{verify.picked.target}</span> ולחץ על הקישור.</p>
                      <p className="text-xs text-blue-600 mt-1">הקישור תקף ל-30 דקות.</p>
                    </div>
                  </div>
                )}

                {verify.sent && verify.picked?.type === 'sms' && (
                  <form onSubmit={handleConfirmSms} className="flex flex-col gap-3">
                    <p className="text-sm text-slate-600">
                      קוד נשלח ל-<span dir="ltr">{verify.picked.target}</span>
                    </p>
                    <Input
                      label="קוד אימות (6 ספרות)"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={verify.code}
                      onChange={(e) => setVerify({ ...verify, code: e.target.value.replace(/\D/g, '') })}
                      dir="ltr"
                      className="text-center text-xl tracking-widest"
                    />
                    <Button type="submit" disabled={loading}>
                      {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> מאמת...</> : 'אמת'}
                    </Button>
                  </form>
                )}

                {verifyError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    {verifyError === 'target_mismatch' ? 'הערוץ אינו תואם את הרשום בפנקס' :
                     verifyError === 'invalid_token'   ? 'קוד שגוי' :
                     verifyError === 'expired'         ? 'הקוד פג תוקף — חזור ובחר ערוץ שוב' :
                     verifyError === 'already_used'    ? 'הקוד כבר נוצל' :
                     verifyError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={skipVerification}
                  className="text-sm text-slate-500 hover:underline text-center"
                >
                  אעשה זאת מאוחר יותר →
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// useSearchParams (added for the trial-flow `?from=trial` query) must
// be wrapped in a Suspense boundary or Next 16 fails the static-render
// step for this page. Same pattern as /login.
export default function RegisterContractorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <RegisterContractorInner />
    </Suspense>
  );
}
