'use client';

import { useState, FormEvent, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, AlertCircle, Mail, Smartphone, ShieldCheck } from 'lucide-react';
import { orgApi, otpApi } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  operating_regions: string[];
}
// Step 3 — optional contact email
interface Step3 {
  contact_email: string;
}
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

export default function RegisterContractorPage() {
  const router = useRouter();
  const [step, setStep]       = useState<1 | 2 | 3 | 'verify'>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);
  const { regions } = useEnums();

  const [step1, setStep1] = useState<Step1>({
    phone: '', normPhone: '', full_name: '',
    otpPhase: 'enter', code: '', otpVerified: false,
  });
  const [step2, setStep2] = useState<Step2>({
    company_name_he: '', business_number: '', operating_regions: [],
  });
  const [step3, setStep3] = useState<Step3>({ contact_email: '' });

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
    if (step2.operating_regions.length === 0) {
      setError('יש לבחור לפחות אזור פעילות אחד'); return;
    }
    setStep(3);
  }

  // ── Step 3: final submit ──────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError('');
    setLoading(true);
    try {
      const result = await orgApi.registerContractor({
        company_name_he:    step2.company_name_he,
        business_number:    step2.business_number,
        operating_regions:  step2.operating_regions,
        contact_name:       step1.full_name,
        contact_phone:      step1.normPhone,
        contact_email:      step3.contact_email || undefined,
      });

      if (result.access_token && result.refresh_token) {
        saveTokens(result.access_token, result.refresh_token);
      }

      const channels = result.available_channels || [];
      if (channels.length > 0) {
        // Continue inline to channel-chooser → confirm.
        setVerify({
          contractor_id: result.id,
          channels,
          picked: null,
          code: '',
          sent: false,
        });
        setStep('verify');
      } else {
        router.push('/contractor/dashboard');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בהרשמה';
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

  // ── Success screen (only when no tokens were returned — fallback) ────────
  if (success) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md shadow-md text-center">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <CheckCircle2 className="h-16 w-16 text-green-500" />
          <h2 className="text-xl font-bold text-slate-900">הבקשה התקבלה!</h2>
          <p className="text-slate-600">ממתין לאישור מנהל — עד 48 שעות</p>
          <p className="text-slate-500 text-sm">נשלח אליך SMS לאחר האישור</p>
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
        <Card className="rounded-t-none shadow-md">
          <CardHeader className="pb-2">
            <div className="text-2xl font-bold text-brand-600 mb-1 text-center">שיבוץ</div>
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
                <p className="text-center text-sm text-slate-600">
                  יש לך חשבון?{' '}
                  <Link href="/login" className="text-brand-600 hover:underline">כניסה</Link>
                </p>
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
                  onChange={(e) => setStep3({ contact_email: e.target.value })}
                  autoComplete="email"
                />
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
                  <Button type="submit" disabled={loading} className="flex-1">
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
                            {c.type === 'email' ? 'אימות במייל' : 'אימות ב-SMS'}
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
