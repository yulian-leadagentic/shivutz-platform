'use client';

import { useState, FormEvent, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { orgApi, otpApi } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const TOTAL_STEPS = 3;
const ORIGIN_COUNTRIES = [
  { value: 'PH', label: 'פיליפינים' },
  { value: 'TH', label: 'תאילנד' },
  { value: 'MD', label: 'מולדובה' },
  { value: 'RO', label: 'רומניה' },
  { value: 'IN', label: 'הודו' },
  { value: 'NP', label: 'נפאל' },
  { value: 'LK', label: 'סרי לנקה' },
  { value: 'VN', label: 'וייטנאם' },
];

interface Step1 {
  phone: string;
  normPhone: string;
  full_name: string;
  otpPhase: 'enter' | 'verify';
  code: string;
  otpVerified: boolean;
}
interface Step2 {
  company_name_he: string;
  business_number: string;
  countries_of_origin: string[];
  minimum_contract_months: number;
}
interface Step3 {
  contact_email: string;
}

function otpErrorMsg(msg: string): string {
  if (msg === 'rate_limited')             return 'יותר מדי ניסיונות. נסה שוב מאוחר יותר';
  if (msg === 'wrong_code')               return 'קוד לא נכון. נסה שנית';
  if (msg === 'max_attempts')             return 'יותר מדי ניסיונות. בקש קוד חדש';
  if (msg === 'otp_expired_or_not_found') return 'הקוד פג תוקף. שלח קוד חדש';
  return 'שגיאה באימות. נסה שוב';
}

export default function RegisterCorporationPage() {
  const router = useRouter();
  const [step, setStep]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);

  const [step1, setStep1] = useState<Step1>({
    phone: '', normPhone: '', full_name: '',
    otpPhase: 'enter', code: '', otpVerified: false,
  });
  const [step2, setStep2] = useState<Step2>({
    company_name_he: '', business_number: '', countries_of_origin: [], minimum_contract_months: 3,
  });
  const [step3, setStep3] = useState<Step3>({ contact_email: '' });

  const codeRef = useRef<HTMLInputElement>(null);

  const toggleCountry = (v: string) => setStep2((p) => ({
    ...p,
    countries_of_origin: p.countries_of_origin.includes(v)
      ? p.countries_of_origin.filter((c) => c !== v)
      : [...p.countries_of_origin, v],
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

  // ── Step 2 validation ─────────────────────────────────────────────────────
  function handleNext(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!step2.company_name_he.trim())        { setError('יש להזין שם תאגיד'); return; }
    if (!/^\d{9}$/.test(step2.business_number)) { setError('מספר עוסק מורשא חייב להכיל 9 ספרות'); return; }
    if (step2.countries_of_origin.length === 0) { setError('יש לבחור לפחות מדינת מוצא אחת'); return; }
    setStep(3);
  }

  // ── Step 3: final submit ──────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError('');
    setLoading(true);
    try {
      const result = await orgApi.registerCorporation({
        company_name_he:         step2.company_name_he,
        business_number:         step2.business_number,
        countries_of_origin:     step2.countries_of_origin,
        minimum_contract_months: step2.minimum_contract_months,
        contact_name:            step1.full_name,
        contact_phone:           step1.normPhone,
        contact_email:           step3.contact_email || undefined,
      });

      if (result.access_token && result.refresh_token) {
        saveTokens(result.access_token, result.refresh_token);
        router.push('/corporation/dashboard');
      } else {
        setSuccess(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בהרשמה';
      setError(
        msg === 'phone_not_verified' ? 'אימות הטלפון פג תוקף. חזור לשלב הראשון' :
        msg === 'already_registered' ? 'מספר הטלפון כבר רשום. אנא התחבר' :
        msg
      );
    } finally { setLoading(false); }
  }

  // ── Success ───────────────────────────────────────────────────────────────
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

  const progressStep = step === 1 && step1.otpPhase === 'verify' ? 1 : step;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
        <Card className="rounded-t-none shadow-md">
          <CardHeader className="pb-2">
            <div className="text-2xl font-bold text-brand-600 mb-1 text-center">שיבוץ</div>
            <CardTitle className="text-center">הרשמת תאגיד</CardTitle>
            <CardDescription className="text-center">שלב {step} מתוך {TOTAL_STEPS}</CardDescription>
            <div className="mt-3 flex gap-1.5">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 h-1.5 rounded-full transition-colors ${i + 1 <= progressStep ? 'bg-brand-600' : 'bg-slate-200'}`}
                />
              ))}
            </div>
          </CardHeader>

          <CardContent>
            {/* ── Step 1 enter ─────────────────────────────────────────── */}
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

            {/* ── Step 1 verify ────────────────────────────────────────── */}
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
                <h3 className="font-semibold text-slate-800">פרטי תאגיד</h3>
                <Input
                  label="שם התאגיד"
                  placeholder="חברת כוח אדם בערמ"
                  value={step2.company_name_he}
                  onChange={(e) => setStep2((p) => ({ ...p, company_name_he: e.target.value }))}
                />
                <Input
                  label="מספר עוסק מורשא (9 ספרות)"
                  placeholder="123456789"
                  maxLength={9}
                  dir="ltr"
                  value={step2.business_number}
                  onChange={(e) => setStep2((p) => ({ ...p, business_number: e.target.value }))}
                />
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-700">מדינות מוצא עובדים</label>
                  <div className="grid grid-cols-2 gap-2 border border-slate-200 rounded-md p-3">
                    {ORIGIN_COUNTRIES.map((c) => (
                      <label key={c.value} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={step2.countries_of_origin.includes(c.value)}
                          onChange={() => toggleCountry(c.value)}
                          className="rounded"
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">מינימום חוזה (חודשים)</label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    dir="ltr"
                    value={step2.minimum_contract_months}
                    onChange={(e) => setStep2((p) => ({ ...p, minimum_contract_months: parseInt(e.target.value) || 1 }))}
                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
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
                  <Button type="submit" className="flex-1">הבא</Button>
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
                  placeholder="info@corp.com"
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
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח...</> : 'הירשמו'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Trouble footer */}
        <p className="text-center text-xs text-slate-400 mt-4">
          נתקלת בבעיה?{' '}
          <a
            href="https://wa.me/972500000000?text=שלום%2C%20אני%20מעוניין%20ברישום%20ידני%20כתאגיד"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:text-brand-700 font-medium underline underline-offset-2"
          >
            צור קשר לרישום ידני
          </a>
        </p>
      </div>
    </div>
  );
}
