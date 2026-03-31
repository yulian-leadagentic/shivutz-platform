'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { authApi, orgApi } from '@/lib/api';
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
  email: string;
  password: string;
  confirmPassword: string;
}

interface Step2 {
  company_name: string;
  company_name_he: string;
  business_number: string;
  countries_of_origin: string[];
  minimum_contract_months: number;
}

interface Step3 {
  contact_name: string;
  contact_email: string;
  contact_phone: string;
}

export default function RegisterCorporationPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [step1, setStep1] = useState<Step1>({ email: '', password: '', confirmPassword: '' });
  const [step2, setStep2] = useState<Step2>({
    company_name: '',
    company_name_he: '',
    business_number: '',
    countries_of_origin: [],
    minimum_contract_months: 3,
  });
  const [step3, setStep3] = useState<Step3>({
    contact_name: '',
    contact_email: '',
    contact_phone: '',
  });

  function toggleCountry(value: string) {
    setStep2((prev) => ({
      ...prev,
      countries_of_origin: prev.countries_of_origin.includes(value)
        ? prev.countries_of_origin.filter((c) => c !== value)
        : [...prev.countries_of_origin, value],
    }));
  }

  function validateStep1(): string {
    if (!step1.email.trim()) return 'יש להזין כתובת אימייל';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(step1.email)) return 'כתובת האימייל אינה תקינה';
    if (step1.password.length < 8) return 'הסיסמה חייבת להכיל לפחות 8 תווים';
    if (step1.password !== step1.confirmPassword) return 'הסיסמאות אינן תואמות';
    return '';
  }

  function validateStep2(): string {
    if (!step2.company_name_he.trim()) return 'יש להזין שם תאגיד בעברית';
    if (!step2.company_name.trim()) return 'יש להזין שם תאגיד באנגלית';
    if (!/^\d{9}$/.test(step2.business_number)) return 'מספר עוסק מורשה חייב להכיל 9 ספרות';
    if (step2.countries_of_origin.length === 0) return 'יש לבחור לפחות מדינת מוצא אחת';
    if (step2.minimum_contract_months < 1 || step2.minimum_contract_months > 24)
      return 'מינימום חוזה חייב להיות בין 1 ל-24 חודשים';
    return '';
  }

  function validateStep3(): string {
    if (!step3.contact_name.trim()) return 'יש להזין שם איש קשר';
    if (!step3.contact_email.trim()) return 'יש להזין אימייל איש קשר';
    if (!step3.contact_phone.trim()) return 'יש להזין טלפון';
    return '';
  }

  function handleNext(e: FormEvent) {
    e.preventDefault();
    setError('');
    const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : '';
    if (err) { setError(err); return; }
    setStep((s) => s + 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const err = validateStep3();
    if (err) { setError(err); return; }

    setLoading(true);
    try {
      const user = await authApi.register({
        email: step1.email,
        password: step1.password,
        role: 'corporation',
      });

      await orgApi.registerCorporation({
        user_id: user.id,
        company_name: step2.company_name,
        company_name_he: step2.company_name_he,
        business_number: step2.business_number,
        countries_of_origin: step2.countries_of_origin,
        minimum_contract_months: step2.minimum_contract_months,
        contact_name: step3.contact_name,
        contact_email: step3.contact_email,
        contact_phone: step3.contact_phone,
      });

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בהרשמה — נסה שוב');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md shadow-md text-center">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <h2 className="text-xl font-bold text-slate-900">הבקשה התקבלה!</h2>
            <p className="text-slate-600">הבקשה התקבלה — ממתין לאישור מנהל</p>
            <Link href="/login" className="text-brand-600 font-medium hover:underline text-sm">
              חזרה לכניסה
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

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
                  className={`flex-1 h-1.5 rounded-full transition-colors ${
                    i + 1 <= step ? 'bg-brand-600' : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          </CardHeader>

          <CardContent>
            {step === 1 && (
              <form onSubmit={handleNext} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">פרטי חשבון</h3>
                <Input
                  label="כתובת אימייל"
                  type="email"
                  placeholder="you@corp.com"
                  value={step1.email}
                  onChange={(e) => setStep1((p) => ({ ...p, email: e.target.value }))}
                  dir="ltr"
                />
                <Input
                  label="סיסמה"
                  type="password"
                  placeholder="לפחות 8 תווים"
                  value={step1.password}
                  onChange={(e) => setStep1((p) => ({ ...p, password: e.target.value }))}
                  dir="ltr"
                />
                <Input
                  label="אימות סיסמה"
                  type="password"
                  placeholder="הזן שוב את הסיסמה"
                  value={step1.confirmPassword}
                  onChange={(e) => setStep1((p) => ({ ...p, confirmPassword: e.target.value }))}
                  dir="ltr"
                />
                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full">הבא</Button>
                <p className="text-center text-sm text-slate-600">
                  יש לך חשבון?{' '}
                  <Link href="/login" className="text-brand-600 hover:underline">כניסה</Link>
                </p>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={handleNext} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">פרטי תאגיד</h3>
                <Input
                  label="שם התאגיד בעברית"
                  placeholder="חברת כוח אדם בע״מ"
                  value={step2.company_name_he}
                  onChange={(e) => setStep2((p) => ({ ...p, company_name_he: e.target.value }))}
                />
                <Input
                  label="שם התאגיד באנגלית"
                  placeholder="Corporation Name Ltd"
                  value={step2.company_name}
                  onChange={(e) => setStep2((p) => ({ ...p, company_name: e.target.value }))}
                  dir="ltr"
                />
                <Input
                  label="מספר עוסק מורשה (9 ספרות)"
                  placeholder="123456789"
                  value={step2.business_number}
                  onChange={(e) => setStep2((p) => ({ ...p, business_number: e.target.value }))}
                  maxLength={9}
                  dir="ltr"
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
                  <label className="text-sm font-medium text-slate-700">
                    מינימום חוזה (חודשים, 1-24)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={step2.minimum_contract_months}
                    onChange={(e) =>
                      setStep2((p) => ({
                        ...p,
                        minimum_contract_months: parseInt(e.target.value) || 1,
                      }))
                    }
                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    dir="ltr"
                  />
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => { setError(''); setStep(1); }} className="flex-1">חזור</Button>
                  <Button type="submit" className="flex-1">הבא</Button>
                </div>
              </form>
            )}

            {step === 3 && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">פרטי קשר</h3>
                <Input
                  label="שם איש קשר"
                  placeholder="שם מלא"
                  value={step3.contact_name}
                  onChange={(e) => setStep3((p) => ({ ...p, contact_name: e.target.value }))}
                />
                <Input
                  label="אימייל איש קשר"
                  type="email"
                  placeholder="contact@corp.com"
                  value={step3.contact_email}
                  onChange={(e) => setStep3((p) => ({ ...p, contact_email: e.target.value }))}
                  dir="ltr"
                />
                <Input
                  label="טלפון"
                  type="tel"
                  placeholder="050-0000000"
                  value={step3.contact_phone}
                  onChange={(e) => setStep3((p) => ({ ...p, contact_phone: e.target.value }))}
                  dir="ltr"
                />

                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => { setError(''); setStep(2); }} className="flex-1">חזור</Button>
                  <Button type="submit" disabled={loading} className="flex-1">
                    {loading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /><span>שולח...</span></>
                    ) : 'הירשמו'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
