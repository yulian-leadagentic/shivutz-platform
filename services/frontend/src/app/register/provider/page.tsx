'use client';

/**
 * U7 · service provider self-registration.
 *
 * Single-step form + OTP verify. Providers don't have a registry
 * cross-check (unlike contractor/corp) so there's nothing to look up
 * before the form — one screen, two phases:
 *
 *   Phase 1 · phone → OTP (auth service)
 *   Phase 2 · form → POST /organizations/providers/register → JWT →
 *             land on /select-entity (or /provider dashboard once that
 *             portal ships in Phase C).
 *
 * Design note: kept deliberately shorter than the corp/contractor
 * registration flows because the provider account has no verification
 * queue, no tier states, no gov-list dance. If we start tacking on
 * fields, that means product decided "provider needs verification too" —
 * at which point split into 3 steps like corp/contractor.
 */
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';

import { orgApi, otpApi } from '@/lib/api';
import { saveTokens } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { HomeLink } from '@/components/HomeLink';
import Logo from '@/components/Logo';
import { checkIsraeliPhone } from '@/lib/phone';

type Phase = 'phone' | 'otp' | 'form' | 'done';

export default function ProviderRegisterPage() {
  const router = useRouter();
  const [phase, setPhase]     = useState<Phase>('phone');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Phase 1 · phone
  const [phone, setPhone]     = useState('');
  const [normPhone, setNorm]  = useState('');
  const [code, setCode]       = useState('');

  // Phase 2 · provider fields
  const [name, setName]                 = useState('');
  const [contactName, setContactName]   = useState('');
  const [businessNumber, setBizNumber]  = useState('');
  const [email, setEmail]               = useState('');
  const [city, setCity]                 = useState('');
  const [description, setDescription]   = useState('');
  const [website, setWebsite]           = useState('');
  const [whatsappOptIn, setWaOptIn]     = useState(false);

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const check = checkIsraeliPhone(phone);
    if (!check.valid || !check.normalized) {
      setError(check.message || 'מספר טלפון לא תקין');
      return;
    }
    setBusy(true);
    try {
      await otpApi.sendOtp(check.normalized, 'register');
      setNorm(check.normalized);
      setPhase('otp');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שליחת קוד נכשלה';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError('קוד לא תקין — 6 ספרות');
      return;
    }
    setBusy(true);
    try {
      const res = await otpApi.verifyOtp(normPhone, code, 'register');
      if (!res.valid) {
        setError('קוד שגוי או שפג תוקפו');
        return;
      }
      setPhase('form');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'אימות קוד נכשל';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('שם העסק הוא שדה חובה');
    if (!contactName.trim()) return setError('שם איש קשר הוא שדה חובה');
    setBusy(true);
    try {
      const res = await orgApi.registerProvider({
        name:            name.trim(),
        contact_name:    contactName.trim(),
        contact_phone:   normPhone,
        business_number: businessNumber.trim() || undefined,
        email:           email.trim() || undefined,
        city:            city.trim() || undefined,
        website:         website.trim() || undefined,
        description:     description.trim() || undefined,
        whatsapp_opt_in: whatsappOptIn,
      });
      if (res.access_token && res.refresh_token) {
        saveTokens(res.access_token, res.refresh_token);
      }
      setPhase('done');
      // Land on the entity picker; when the provider portal lands in
      // Phase C this will redirect straight to /provider/dashboard.
      setTimeout(() => router.push('/select-entity'), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'הרישום נכשל';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="p-4"><HomeLink /></div>
      <div className="flex-1 flex items-start justify-center pt-6 pb-16 px-4">
        <div className="w-full max-w-lg space-y-6">
          <div className="flex justify-center"><Logo className="h-10 w-auto" /></div>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl">רישום ספק שירות</CardTitle>
              <CardDescription>
                שירותים נלווים, הובלות, ביטוח, ציוד, קורסים — פתחו עמוד ספק
                ופרסמו לקהל הקבלנים והתאגידים בפלטפורמה. הרישום חינם.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {phase === 'phone' && (
                <form onSubmit={sendOtp} className="space-y-4">
                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">טלפון נייד</span>
                    <Input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      placeholder="050-1234567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                  </label>
                  <Button type="submit" disabled={busy} className="w-full">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שליחת קוד אימות'}
                  </Button>
                  <p className="text-xs text-slate-500 text-center">
                    יש לך כבר חשבון?{' '}
                    <Link href="/login" className="text-primary-600 hover:underline">
                      התחבר
                    </Link>
                  </p>
                </form>
              )}

              {phase === 'otp' && (
                <form onSubmit={verifyOtp} className="space-y-4">
                  <p className="text-sm text-slate-700">
                    שלחנו קוד בן 6 ספרות ל־{' '}
                    <span dir="ltr" className="font-mono">{normPhone}</span>
                  </p>
                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">קוד אימות</span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      dir="ltr"
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      required
                    />
                  </label>
                  <Button type="submit" disabled={busy} className="w-full">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'אימות ומעבר להרשמה'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setPhase('phone'); setCode(''); }}
                    className="text-xs text-slate-500 hover:text-slate-700 w-full text-center"
                  >
                    שינוי מספר טלפון
                  </button>
                </form>
              )}

              {phase === 'form' && (
                <form onSubmit={submit} className="space-y-4">
                  <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                    <ShieldCheck className="w-4 h-4" />
                    הטלפון אומת. נותרו פרטי העסק:
                  </div>

                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">שם העסק *</span>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">שם איש קשר *</span>
                    <Input
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block text-sm">
                      <span className="text-slate-700 mb-1 block">ח.פ / ע.מ (אופציונלי)</span>
                      <Input
                        value={businessNumber}
                        onChange={(e) => setBizNumber(e.target.value)}
                        dir="ltr"
                        inputMode="numeric"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-slate-700 mb-1 block">עיר (אופציונלי)</span>
                      <Input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">אימייל עסקי (אופציונלי)</span>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      dir="ltr"
                      autoComplete="email"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">אתר (אופציונלי)</span>
                    <Input
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      dir="ltr"
                      placeholder="https://"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">תיאור השירות (אופציונלי)</span>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      maxLength={500}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-600"
                    />
                  </label>

                  <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={whatsappOptIn}
                      onChange={(e) => setWaOptIn(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>אשמח לקבל התראות ב־WhatsApp במקום SMS</span>
                  </label>

                  <Button type="submit" disabled={busy} className="w-full">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'סיום רישום'}
                  </Button>
                </form>
              )}

              {phase === 'done' && (
                <div className="text-center py-6">
                  <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
                  <p className="text-slate-800 font-medium">נרשמת בהצלחה!</p>
                  <p className="text-sm text-slate-600 mt-1">
                    מעביר אותך לפורטל ...
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
