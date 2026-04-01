'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight, ChevronLeft, CheckCircle2 } from 'lucide-react';
import { workerApi, enumApi } from '@/lib/api';
import type { Profession } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const COUNTRIES = [
  { code: 'CN', name_he: 'סין' },
  { code: 'PH', name_he: 'פיליפינים' },
  { code: 'IN', name_he: 'הודו' },
  { code: 'TH', name_he: 'תאילנד' },
  { code: 'UA', name_he: 'אוקראינה' },
  { code: 'MK', name_he: 'מקדוניה' },
  { code: 'RO', name_he: 'רומניה' },
  { code: 'BG', name_he: 'בולגריה' },
  { code: 'MD', name_he: 'מולדובה' },
  { code: 'RS', name_he: 'סרביה' },
];

const LANGUAGES = ['עברית', 'אנגלית', 'רוסית', 'ערבית', 'פיליפינית', 'הינדי', 'ספרדית', 'סינית'];

interface FormData {
  first_name: string;
  last_name: string;
  profession_type: string;
  experience_years: string;
  origin_country: string;
  languages: string[];
  visa_valid_until: string;
}

const INITIAL: FormData = {
  first_name: '',
  last_name: '',
  profession_type: '',
  experience_years: '0',
  origin_country: '',
  languages: [],
  visa_valid_until: '',
};

export default function NewWorkerPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    enumApi.professions().then(setProfessions).catch(console.error);
  }, []);

  function set(field: keyof FormData, value: string | string[]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleLang(lang: string) {
    setForm((f) => ({
      ...f,
      languages: f.languages.includes(lang)
        ? f.languages.filter((l) => l !== lang)
        : [...f.languages, lang],
    }));
  }

  function canProceed() {
    if (step === 1) return form.first_name.trim() && form.last_name.trim();
    if (step === 2) return form.profession_type && form.origin_country;
    if (step === 3) return form.visa_valid_until;
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      await workerApi.create({
        ...form,
        experience_years: Number(form.experience_years),
      });
      setDone(true);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בשמירת העובד');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-4">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
        <h2 className="text-2xl font-bold text-slate-900">העובד נוסף בהצלחה</h2>
        <p className="text-slate-500 text-sm">
          {form.first_name} {form.last_name} נוסף לרשימת העובדים שלך.
        </p>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => { setForm(INITIAL); setStep(1); setDone(false); }}>
            הוסף עובד נוסף
          </Button>
          <Button variant="outline" onClick={() => router.push('/corporation/workers')}>
            חזור לרשימה
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">הוספת עובד חדש</h2>
        <p className="text-sm text-slate-500 mt-1">שלב {step} מתוך 3</p>
      </div>

      {/* Progress */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-2 flex-1 rounded-full transition-colors ${
              s <= step ? 'bg-brand-600' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Step 1 — personal details */}
          {step === 1 && (
            <>
              <h3 className="font-semibold text-slate-800">פרטים אישיים</h3>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="שם פרטי"
                  value={form.first_name}
                  onChange={(e) => set('first_name', e.target.value)}
                  required
                />
                <Input
                  label="שם משפחה"
                  value={form.last_name}
                  onChange={(e) => set('last_name', e.target.value)}
                  required
                />
              </div>
            </>
          )}

          {/* Step 2 — professional details */}
          {step === 2 && (
            <>
              <h3 className="font-semibold text-slate-800">פרטים מקצועיים</h3>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">מקצוע</label>
                <select
                  value={form.profession_type}
                  onChange={(e) => set('profession_type', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  required
                >
                  <option value="">בחר מקצוע...</option>
                  {professions.map((p) => (
                    <option key={p.code} value={p.code}>{p.name_he}</option>
                  ))}
                </select>
              </div>
              <Input
                label="שנות ניסיון"
                type="number"
                min={0}
                max={50}
                value={form.experience_years}
                onChange={(e) => set('experience_years', e.target.value)}
              />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">מדינת מוצא</label>
                <select
                  value={form.origin_country}
                  onChange={(e) => set('origin_country', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  required
                >
                  <option value="">בחר מדינה...</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name_he}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">שפות</label>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => toggleLang(lang)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        form.languages.includes(lang)
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Step 3 — visa */}
          {step === 3 && (
            <>
              <h3 className="font-semibold text-slate-800">פרטי ויזה</h3>
              <Input
                label="ויזה תקפה עד"
                type="date"
                value={form.visa_valid_until}
                onChange={(e) => set('visa_valid_until', e.target.value)}
                required
              />
              {/* Review summary */}
              <div className="mt-4 p-4 bg-slate-50 rounded-lg space-y-2 text-sm">
                <p className="font-semibold text-slate-800 mb-2">סיכום</p>
                <p><span className="text-slate-500">שם:</span> {form.first_name} {form.last_name}</p>
                <p><span className="text-slate-500">מקצוע:</span> {form.profession_type}</p>
                <p><span className="text-slate-500">ניסיון:</span> {form.experience_years} שנים</p>
                <p><span className="text-slate-500">מדינה:</span> {form.origin_country}</p>
                {form.languages.length > 0 && (
                  <p><span className="text-slate-500">שפות:</span> {form.languages.join(', ')}</p>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => (step > 1 ? setStep(step - 1) : router.back())}
        >
          <ChevronRight className="h-4 w-4" />
          {step === 1 ? 'ביטול' : 'הקודם'}
        </Button>

        {step < 3 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canProceed()}>
            הבא
            <ChevronLeft className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting || !canProceed()}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                שומר...
              </>
            ) : (
              'שמור עובד'
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
