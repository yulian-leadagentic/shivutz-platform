content = """\
'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { orgApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const TOTAL_STEPS = 3;
const ORIGIN_COUNTRIES = [
  { value: 'PH', label: '\u05e4\u05d9\u05dc\u05d9\u05e4\u05d9\u05e0\u05d9\u05dd' },
  { value: 'TH', label: '\u05ea\u05d0\u05d9\u05dc\u05e0\u05d3' },
  { value: 'MD', label: '\u05de\u05d5\u05dc\u05d3\u05d5\u05d1\u05d4' },
  { value: 'RO', label: '\u05e8\u05d5\u05de\u05e0\u05d9\u05d4' },
  { value: 'IN', label: '\u05d4\u05d5\u05d3\u05d5' },
  { value: 'NP', label: '\u05e0\u05e4\u05d0\u05dc' },
  { value: 'LK', label: '\u05e1\u05e8\u05d9 \u05dc\u05e0\u05e7\u05d4' },
  { value: 'VN', label: '\u05d5\u05d9\u05d9\u05d8\u05e0\u05d0\u05dd' },
];

interface Step1 { email: string; password: string; confirmPassword: string; }
interface Step2 { company_name_he: string; business_number: string; countries_of_origin: string[]; minimum_contract_months: number; }
interface Step3 { contact_name: string; contact_email: string; contact_phone: string; }

export default function RegisterCorporationPage() {
  const [step, setStep]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);
  const [step1, setStep1] = useState<Step1>({ email: '', password: '', confirmPassword: '' });
  const [step2, setStep2] = useState<Step2>({ company_name_he: '', business_number: '', countries_of_origin: [], minimum_contract_months: 3 });
  const [step3, setStep3] = useState<Step3>({ contact_name: '', contact_email: '', contact_phone: '' });

  const toggleCountry = (v: string) => setStep2((p) => ({
    ...p,
    countries_of_origin: p.countries_of_origin.includes(v)
      ? p.countries_of_origin.filter((c) => c !== v)
      : [...p.countries_of_origin, v],
  }));

  const v1 = (): string => {
    if (!step1.email.trim()) return '\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05db\u05ea\u05d5\u05d1\u05ea \u05d0\u05d9\u05de\u05d9\u05d9\u05dc';
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(step1.email)) return '\u05db\u05ea\u05d5\u05d1\u05ea \u05d4\u05d0\u05d9\u05de\u05d9\u05d9\u05dc \u05d0\u05d9\u05e0\u05d4 \u05ea\u05e7\u05d9\u05e0\u05d4';
    if (step1.password.length < 8) return '\u05d4\u05e1\u05d9\u05e1\u05de\u05d0 \u05d7\u05d9\u05d9\u05d1\u05ea \u05dc\u05d4\u05db\u05d9\u05dc \u05dc\u05e4\u05d7\u05d5\u05ea 8 \u05ea\u05d5\u05d5\u05d9\u05dd';
    if (step1.password !== step1.confirmPassword) return '\u05d4\u05e1\u05d9\u05e1\u05de\u05d0\u05d5\u05ea \u05d0\u05d9\u05e0\u05df \u05ea\u05d5\u05d0\u05de\u05d5\u05ea';
    return '';
  };
  const v2 = (): string => {
    if (!step2.company_name_he.trim()) return '\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05e9\u05dd \u05ea\u05d0\u05d2\u05d9\u05d3';
    if (!/^\\d{9}$/.test(step2.business_number)) return '\u05de\u05e1\u05e4\u05e8 \u05e2\u05d5\u05e1\u05e7 \u05de\u05d5\u05e8\u05e9\u05d0 \u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05db\u05d9\u05dc 9 \u05e1\u05e4\u05e8\u05d5\u05ea';
    if (step2.countries_of_origin.length === 0) return '\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05dc\u05e4\u05d7\u05d5\u05ea \u05de\u05d3\u05d9\u05e0\u05ea \u05de\u05d5\u05e6\u05d0 \u05d0\u05d7\u05ea';
    return '';
  };
  const v3 = (): string => {
    if (!step3.contact_name.trim()) return '\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05e9\u05dd \u05d0\u05d9\u05e9 \u05e7\u05e9\u05e8';
    if (!step3.contact_email.trim()) return '\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05d0\u05d9\u05de\u05d9\u05d9\u05dc \u05d0\u05d9\u05e9 \u05e7\u05e9\u05e8';
    if (!step3.contact_phone.trim()) return '\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05d8\u05dc\u05e4\u05d5\u05df';
    return '';
  };

  function handleNext(e: FormEvent) {
    e.preventDefault(); setError('');
    const err = step === 1 ? v1() : v2();
    if (err) { setError(err); return; }
    setStep((s) => s + 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError('');
    const err = v3(); if (err) { setError(err); return; }
    setLoading(true);
    try {
      await orgApi.registerCorporation({
        company_name_he: step2.company_name_he,
        business_number: step2.business_number,
        countries_of_origin: step2.countries_of_origin,
        minimum_contract_months: step2.minimum_contract_months,
        contact_name: step3.contact_name,
        contact_email: step3.contact_email,
        contact_phone: step3.contact_phone,
        password: step1.password,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05e8\u05e9\u05de\u05d4');
    } finally { setLoading(false); }
  }

  if (success) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md shadow-md text-center">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <CheckCircle2 className="h-16 w-16 text-green-500" />
          <h2 className="text-xl font-bold text-slate-900">\u05d4\u05d1\u05e7\u05e9\u05d4 \u05d4\u05ea\u05e7\u05d1\u05dc\u05d4!</h2>
          <p className="text-slate-600">\u05de\u05de\u05ea\u05d9\u05df \u05dc\u05d0\u05d9\u05e9\u05d5\u05e8 \u05de\u05e0\u05d4\u05dc \u2014 \u05e2\u05d3 48 \u05e9\u05e2\u05d5\u05ea</p>
          <Link href="/login" className="text-brand-600 font-medium hover:underline text-sm">\u05d7\u05d6\u05e8\u05d4 \u05dc\u05db\u05e0\u05d9\u05e1\u05d4</Link>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
        <Card className="rounded-t-none shadow-md">
          <CardHeader className="pb-2">
            <div className="text-2xl font-bold text-brand-600 mb-1 text-center">\u05e9\u05d9\u05d1\u05d5\u05e5</div>
            <CardTitle className="text-center">\u05d4\u05e8\u05e9\u05de\u05ea \u05ea\u05d0\u05d2\u05d9\u05d3</CardTitle>
            <CardDescription className="text-center">\u05e9\u05dc\u05d1 {step} \u05de\u05ea\u05d5\u05da {TOTAL_STEPS}</CardDescription>
            <div className="mt-3 flex gap-1.5">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${i + 1 <= step ? 'bg-brand-600' : 'bg-slate-200'}`} />
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {step === 1 && (
              <form onSubmit={handleNext} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">\u05e4\u05e8\u05d8\u05d9 \u05d7\u05e9\u05d1\u05d5\u05df</h3>
                <Input label="\u05db\u05ea\u05d5\u05d1\u05ea \u05d0\u05d9\u05de\u05d9\u05d9\u05dc" type="email" placeholder="you@corp.com" dir="ltr"
                  value={step1.email} onChange={(e) => setStep1((p) => ({ ...p, email: e.target.value }))} />
                <Input label="\u05e1\u05d9\u05e1\u05de\u05d0" type="password" placeholder="\u05dc\u05e4\u05d7\u05d5\u05ea 8 \u05ea\u05d5\u05d5\u05d9\u05dd" dir="ltr"
                  value={step1.password} onChange={(e) => setStep1((p) => ({ ...p, password: e.target.value }))} />
                <Input label="\u05d0\u05d9\u05de\u05d5\u05ea \u05e1\u05d9\u05e1\u05de\u05d0" type="password" placeholder="\u05d4\u05d6\u05df \u05e9\u05d5\u05d1 \u05d0\u05ea \u05d4\u05e1\u05d9\u05e1\u05de\u05d0" dir="ltr"
                  value={step1.confirmPassword} onChange={(e) => setStep1((p) => ({ ...p, confirmPassword: e.target.value }))} />
                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full">\u05d4\u05d1\u05d0</Button>
                <p className="text-center text-sm text-slate-600">\u05d9\u05e9 \u05dc\u05da \u05d7\u05e9\u05d1\u05d5\u05df?{' '}
                  <Link href="/login" className="text-brand-600 hover:underline">\u05db\u05e0\u05d9\u05e1\u05d4</Link></p>
              </form>
            )}
            {step === 2 && (
              <form onSubmit={handleNext} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">\u05e4\u05e8\u05d8\u05d9 \u05ea\u05d0\u05d2\u05d9\u05d3</h3>
                <Input label="\u05e9\u05dd \u05d4\u05ea\u05d0\u05d2\u05d9\u05d3" placeholder="\u05d7\u05d1\u05e8\u05ea \u05db\u05d5\u05d7 \u05d0\u05d3\u05dd \u05d1\u05e2\u05e8\u05de"
                  value={step2.company_name_he} onChange={(e) => setStep2((p) => ({ ...p, company_name_he: e.target.value }))} />
                <Input label="\u05de\u05e1\u05e4\u05e8 \u05e2\u05d5\u05e1\u05e7 \u05de\u05d5\u05e8\u05e9\u05d0 (9 \u05e1\u05e4\u05e8\u05d5\u05ea)" placeholder="123456789" maxLength={9} dir="ltr"
                  value={step2.business_number} onChange={(e) => setStep2((p) => ({ ...p, business_number: e.target.value }))} />
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-700">\u05de\u05d3\u05d9\u05e0\u05d5\u05ea \u05de\u05d5\u05e6\u05d0 \u05e2\u05d5\u05d1\u05d3\u05d9\u05dd</label>
                  <div className="grid grid-cols-2 gap-2 border border-slate-200 rounded-md p-3">
                    {ORIGIN_COUNTRIES.map((c) => (
                      <label key={c.value} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={step2.countries_of_origin.includes(c.value)}
                          onChange={() => toggleCountry(c.value)} className="rounded" />{c.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">\u05de\u05d9\u05e0\u05d9\u05de\u05d5\u05dd \u05d7\u05d5\u05d6\u05d4 (\u05d7\u05d5\u05d3\u05e9\u05d9\u05dd)</label>
                  <input type="number" min={1} max={24} dir="ltr" value={step2.minimum_contract_months}
                    onChange={(e) => setStep2((p) => ({ ...p, minimum_contract_months: parseInt(e.target.value) || 1 }))}
                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => { setError(''); setStep(1); }} className="flex-1">\u05d7\u05d6\u05d5\u05e8</Button>
                  <Button type="submit" className="flex-1">\u05d4\u05d1\u05d0</Button>
                </div>
              </form>
            )}
            {step === 3 && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <h3 className="font-semibold text-slate-800">\u05e4\u05e8\u05d8\u05d9 \u05e7\u05e9\u05e8</h3>
                <Input label="\u05e9\u05dd \u05d0\u05d9\u05e9 \u05e7\u05e9\u05e8" placeholder="\u05e9\u05dd \u05de\u05dc\u05d0"
                  value={step3.contact_name} onChange={(e) => setStep3((p) => ({ ...p, contact_name: e.target.value }))} />
                <Input label="\u05d0\u05d9\u05de\u05d9\u05d9\u05dc \u05d0\u05d9\u05e9 \u05e7\u05e9\u05e8" type="email" placeholder="contact@corp.com" dir="ltr"
                  value={step3.contact_email} onChange={(e) => setStep3((p) => ({ ...p, contact_email: e.target.value }))} />
                <Input label="\u05d8\u05dc\u05e4\u05d5\u05df" type="tel" placeholder="050-0000000" dir="ltr"
                  value={step3.contact_phone} onChange={(e) => setStep3((p) => ({ ...p, contact_phone: e.target.value }))} />
                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => { setError(''); setStep(2); }} className="flex-1">\u05d7\u05d6\u05d5\u05e8</Button>
                  <Button type="submit" disabled={loading} className="flex-1">
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> \u05e9\u05d5\u05dc\u05d7...</> : '\u05d4\u05d9\u05e8\u05e9\u05de\u05d5'}
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
"""
with open(r'C:\Users\yulia\Projects\Shivutz-platform\services\frontend\src\app\register\corporation\page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("written")
