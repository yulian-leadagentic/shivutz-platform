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
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, RefreshCw } from 'lucide-react';

import { orgApi, otpApi } from '@/lib/api';
import { marketplaceApi } from '@/lib/api/marketplace';
import type { PublicMarketplaceCategory } from '@/lib/api/marketplace';
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

// R12 §2 · fieldErrors carries the sticky-error fix. The bug was:
// user submits, server returns "ח.פ כבר רשום…", user edits the ח.פ
// field to try a different number → old error stays visible until
// the next submit. Root cause: error lived at form-level and only
// reset inside submit(). Two fixes together:
//   · errors that belong to a field render via the Input's `error`
//     prop (input.tsx:6,86-88), so they sit next to that field
//     instead of at the top of the form.
//   · every field-level onChange clears its own key — the error
//     disappears the moment the user starts fixing the value that
//     caused it. Reset-on-submit stays as a belt-and-suspenders.
// FIELDS is the closed set of keys used in phase 2; adding a
// field-level error for something outside it should extend FIELDS
// and pipe it through Input the same way.
type FieldKey = 'business_number' | 'name' | 'contact_name' | 'email';

export default function ProviderRegisterPage() {
  const router = useRouter();
  const [phase, setPhase]     = useState<Phase>('phone');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  // Two tiny helpers, no library. `setField` writes; `clearField`
  // wipes one key. Wrapped so field onChange handlers can call
  // `clearField('business_number')` without pulling in an
  // immutability lib for a five-key object.
  const setField    = (key: FieldKey, msg: string) => setFieldErrors((s) => ({ ...s, [key]: msg }));
  const clearField  = (key: FieldKey) => setFieldErrors((s) => { const { [key]: _, ...rest } = s; return rest; });
  const resetErrors = () => { setError(null); setFieldErrors({}); };

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
  // R5 §2b · trade the provider self-selects. First field in the form
  // per Yulian's spec ("that I pick a category first"). Loaded live
  // from /marketplace/categories — admin edits it in
  // /admin/marketplace/categories so we never hard-code the list.
  const [primaryCategory, setPrimaryCategory] = useState('');
  const [categories, setCategories]           = useState<PublicMarketplaceCategory[] | null>(null);
  const [catLoading, setCatLoading]           = useState(false);
  const [catError, setCatError]               = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    setCatLoading(true);
    setCatError(null);
    try {
      const list = await marketplaceApi.listCategories();
      // R5 §2b · load failure → explanatory error + retry, never an
      // empty select and never an eternal spinner (U5 §2 rule).
      if (!list || list.length === 0) {
        setCatError('לא הוחזרו קטגוריות. נסה שוב.');
        setCategories([]);
        return;
      }
      setCategories(list);
    } catch {
      setCatError('טעינת הקטגוריות נכשלה. בדוק חיבור לרשת ונסה שוב.');
      setCategories(null);
    } finally {
      setCatLoading(false);
    }
  }, []);

  // Lazy-load when the user reaches the form phase. Not on mount:
  // that would fetch categories for someone who bounces at the OTP
  // screen and never sees the form.
  useEffect(() => {
    if (phase === 'form' && categories === null && !catLoading && !catError) {
      void loadCategories();
    }
  }, [phase, categories, catLoading, catError, loadCategories]);

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    resetErrors();
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
    resetErrors();
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

  // R12 §2 · route a server-side rejection to the field it belongs to
  // when the wording gives it away — the wording is the provider
  // service's own copy (providers.py:132-197: "ספק שירות עם ח.פ...",
  // "מספר טלפון זה כבר רשום..."). Anything we can't map falls back
  // to the top-level `error` so the visitor still sees the reason.
  function routeServerError(msg: string) {
    if (msg.includes('ח.פ') || msg.includes('ע.מ')) return setField('business_number', msg);
    if (msg.includes('טלפון')) return setError(msg);   // phase 1 anyway; no field-level surface here
    if (msg.includes('אימייל') || msg.includes('דוא'))  return setField('email', msg);
    setError(msg);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    resetErrors();
    // R5 §2b · category first. Yulian: "התהליך צריך להיות שאני בוחר
    // קודם קטגוריה" — the field sits first in the form and blocks
    // submit until picked.
    // Category picker has its own inline error surface (catError from
    // the load path) — an unpicked category stays as a top-level
    // error since it's not an Input we can pin to.
    if (!primaryCategory) { setError('יש לבחור קטגוריה'); return; }
    if (!name.trim())        { setField('name',         'שם העסק הוא שדה חובה'); return; }
    if (!contactName.trim()) { setField('contact_name', 'שם איש קשר הוא שדה חובה'); return; }
    // R5 §2a · ח.פ was optional until Yulian's 17.09 call. Format check
    // only (9 digits) — providers aren't in ראשם החברות so we
    // deliberately don't cross-check a registry; that's the whole point
    // of the service_provider entity type. Server-side validation in
    // providers.py is the source of truth; client is convenience.
    const bn = businessNumber.trim();
    if (!bn)                    { setField('business_number', 'ח.פ / ע.מ הוא שדה חובה'); return; }
    if (!/^\d{9}$/.test(bn))    { setField('business_number', 'ח.פ / ע.מ חייב להיות 9 ספרות'); return; }
    setBusy(true);
    try {
      const res = await orgApi.registerProvider({
        name:             name.trim(),
        contact_name:     contactName.trim(),
        contact_phone:    normPhone,
        business_number:  bn,
        primary_category: primaryCategory,
        email:            email.trim() || undefined,
        city:             city.trim() || undefined,
        website:          website.trim() || undefined,
        description:      description.trim() || undefined,
        whatsapp_opt_in:  whatsappOptIn,
      });
      if (res.access_token && res.refresh_token) {
        saveTokens(res.access_token, res.refresh_token);
      }
      setPhase('done');
      // R5 §1 · a fresh provider has exactly one entity (this one).
      // Sending them to /select-entity to pick from a list of one is
      // pure friction, and the old fallback into /contractor/dashboard
      // is what created the "אין לך חשבון קבלן" screen Yulian saw.
      // Land them directly on their own dashboard.
      setTimeout(() => router.push('/provider/dashboard'), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'הרישום נכשל';
      routeServerError(msg);
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
                      // R12 §2 · same reset-on-change pattern as the
                      // biz field. Phase-1 has only one input so
                      // top-level `error` IS the field-level one;
                      // clearing it on change keeps the pattern
                      // consistent — the visitor doesn't watch a
                      // stale "invalid phone" message hang there
                      // while they type digits into the field.
                      onChange={(e) => { setPhone(e.target.value); if (error) setError(null); }}
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

                  {/* R5 §2b · category picker sits FIRST — Yulian's spec
                      is "pick the category first, everything else after". */}
                  <div>
                    <label className="block text-sm">
                      <span className="text-slate-700 mb-1 block">קטגוריית השירות *</span>
                      {catLoading && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 h-10">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          טוען קטגוריות…
                        </div>
                      )}
                      {!catLoading && catError && (
                        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{catError}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => { void loadCategories(); }}
                            className="text-xs font-medium text-rose-700 hover:text-rose-900 flex items-center gap-1"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            נסה שוב
                          </button>
                        </div>
                      )}
                      {!catLoading && !catError && categories && categories.length > 0 && (
                        <select
                          value={primaryCategory}
                          onChange={(e) => setPrimaryCategory(e.target.value)}
                          required
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-600"
                        >
                          <option value="" disabled>בחר קטגוריה</option>
                          {categories.map((c) => (
                            <option key={c.code} value={c.code}>{c.name_he || c.code}</option>
                          ))}
                        </select>
                      )}
                    </label>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      הקטגוריה משמשת כברירת מחדל לפרסום מודעות. אפשר לפרסם גם בקטגוריות אחרות.
                    </p>
                  </div>

                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">שם העסק *</span>
                    <Input
                      value={name}
                      onChange={(e) => { setName(e.target.value); if (fieldErrors.name) clearField('name'); }}
                      required
                      error={fieldErrors.name}
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-slate-700 mb-1 block">שם איש קשר *</span>
                    <Input
                      value={contactName}
                      onChange={(e) => { setContactName(e.target.value); if (fieldErrors.contact_name) clearField('contact_name'); }}
                      autoComplete="name"
                      required
                      error={fieldErrors.contact_name}
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block text-sm">
                      <span className="text-slate-700 mb-1 block">ח.פ / ע.מ *</span>
                      <Input
                        value={businessNumber}
                        // R12 §2 · onChange clears the sticky "already
                        // registered" error the moment the visitor edits
                        // this field, without waiting for the next
                        // submit. The Input renders `error` beneath the
                        // input in red — no top-level banner needed.
                        onChange={(e) => {
                          setBizNumber(e.target.value.replace(/\D/g, '').slice(0, 9));
                          if (fieldErrors.business_number) clearField('business_number');
                        }}
                        dir="ltr"
                        inputMode="numeric"
                        pattern="\d{9}"
                        maxLength={9}
                        required
                        error={fieldErrors.business_number}
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
                      onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) clearField('email'); }}
                      dir="ltr"
                      autoComplete="email"
                      error={fieldErrors.email}
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

                  <Button
                    type="submit"
                    disabled={busy || catLoading || !!catError || !primaryCategory}
                    className="w-full"
                  >
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
