'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { jobApi, enumApi } from '@/lib/api';
import type { Profession, Region } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const TOTAL_STEPS = 3;

interface LineItemDraft {
  profession_type: string;
  quantity: number;
  start_date: string;
  end_date: string;
  min_experience: number;
}

interface Step1Data {
  project_name_he: string;
  project_name: string;
  region: string;
  address: string;
  project_start_date: string;
  project_end_date: string;
}

const emptyLineItem = (): LineItemDraft => ({
  profession_type: '',
  quantity: 1,
  start_date: '',
  end_date: '',
  min_experience: 0,
});

export default function NewRequestPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  const [professions, setProfessions] = useState<Profession[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);

  const [step1, setStep1] = useState<Step1Data>({
    project_name_he: '',
    project_name: '',
    region: '',
    address: '',
    project_start_date: '',
    project_end_date: '',
  });

  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyLineItem()]);

  useEffect(() => {
    enumApi.professions().then(setProfessions).catch(() => {});
    enumApi.regions().then(setRegions).catch(() => {});
  }, []);

  function validateStep1(): string {
    if (!step1.project_name_he.trim()) return 'יש להזין שם פרויקט בעברית';
    if (!step1.region) return 'יש לבחור אזור';
    return '';
  }

  function validateStep2(): string {
    if (lineItems.length === 0) return 'יש להוסיף לפחות מקצוע אחד';
    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i];
      if (!li.profession_type) return `שורה ${i + 1}: יש לבחור מקצוע`;
      if (li.quantity < 1 || li.quantity > 50) return `שורה ${i + 1}: כמות חייבת להיות בין 1 ל-50`;
      if (!li.start_date) return `שורה ${i + 1}: יש להזין תאריך התחלה`;
      if (!li.end_date) return `שורה ${i + 1}: יש להזין תאריך סיום`;
      if (li.end_date <= li.start_date) return `שורה ${i + 1}: תאריך הסיום חייב להיות אחרי תאריך ההתחלה`;
    }
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
    setLoading(true);
    try {
      const result = await jobApi.create({
        project_name_he: step1.project_name_he,
        project_name: step1.project_name,
        region: step1.region,
        address: step1.address,
        project_start_date: step1.project_start_date || undefined,
        project_end_date: step1.project_end_date || undefined,
        line_items: lineItems.map((li) => ({
          profession_type: li.profession_type,
          quantity: li.quantity,
          start_date: li.start_date,
          end_date: li.end_date,
          min_experience: li.min_experience,
          required_languages: [],
          origin_preference: [],
        })),
      });
      setCreatedId(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשליחת הבקשה — נסה שוב');
    } finally {
      setLoading(false);
    }
  }

  function updateLineItem(index: number, field: keyof LineItemDraft, value: string | number) {
    setLineItems((prev) =>
      prev.map((li, i) => (i === index ? { ...li, [field]: value } : li))
    );
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  if (createdId) {
    return (
      <div className="max-w-lg mx-auto">
        <Card className="shadow-md">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <h2 className="text-xl font-bold text-slate-900">הבקשה נשלחה בהצלחה!</h2>
            <p className="text-slate-600">הבקשה שלך נוצרה ומוכנה לחיפוש התאמות</p>
            <div className="flex flex-col gap-2 w-full mt-2">
              <Button asChild className="w-full">
                <Link href={`/contractor/requests/${createdId}/match`}>
                  חפש התאמות
                </Link>
              </Button>
              <Button variant="outline" asChild className="w-full">
                <Link href="/contractor/dashboard">חזרה ללוח הבקרה</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
      <Card className="rounded-t-none shadow-md">
        <CardHeader className="pb-2">
          <CardTitle>בקשת עבודה חדשה</CardTitle>
          <CardDescription>שלב {step} מתוך {TOTAL_STEPS}</CardDescription>
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
              <h3 className="font-semibold text-slate-800">פרטי הפרויקט</h3>
              <Input
                label="שם הפרויקט בעברית *"
                placeholder="פרויקט בנייה ברמת גן"
                value={step1.project_name_he}
                onChange={(e) => setStep1((p) => ({ ...p, project_name_he: e.target.value }))}
              />
              <Input
                label="שם הפרויקט באנגלית"
                placeholder="Ramat Gan Construction Project"
                value={step1.project_name}
                onChange={(e) => setStep1((p) => ({ ...p, project_name: e.target.value }))}
                dir="ltr"
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700">אזור *</label>
                <select
                  value={step1.region}
                  onChange={(e) => setStep1((p) => ({ ...p, region: e.target.value }))}
                  className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">בחר אזור...</option>
                  {regions.map((r) => (
                    <option key={r.code} value={r.code}>{r.name_he}</option>
                  ))}
                </select>
              </div>
              <Input
                label="כתובת האתר"
                placeholder="רחוב הבנייה 1, עיר"
                value={step1.address}
                onChange={(e) => setStep1((p) => ({ ...p, address: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="תאריך תחילת הפרויקט"
                  type="date"
                  value={step1.project_start_date}
                  onChange={(e) => setStep1((p) => ({ ...p, project_start_date: e.target.value }))}
                  dir="ltr"
                />
                <Input
                  label="תאריך סיום הפרויקט"
                  type="date"
                  value={step1.project_end_date}
                  onChange={(e) => setStep1((p) => ({ ...p, project_end_date: e.target.value }))}
                  dir="ltr"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
              )}
              <Button type="submit" className="w-full">הבא</Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleNext} className="flex flex-col gap-4" noValidate>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">דרישות כוח אדם</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLineItems((prev) => [...prev, emptyLineItem()])}
                >
                  <Plus className="h-4 w-4" />
                  הוסף מקצוע נוסף +
                </Button>
              </div>

              <div className="space-y-4">
                {lineItems.map((li, index) => (
                  <div
                    key={index}
                    className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">מקצוע {index + 1}</span>
                      {lineItems.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLineItem(index)}
                          className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium text-slate-700">מקצוע *</label>
                        <select
                          value={li.profession_type}
                          onChange={(e) => updateLineItem(index, 'profession_type', e.target.value)}
                          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                          <option value="">בחר מקצוע...</option>
                          {professions.filter((p) => p.is_active).map((p) => (
                            <option key={p.code} value={p.code}>{p.name_he}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium text-slate-700">כמות עובדים *</label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={li.quantity}
                          onChange={(e) => updateLineItem(index, 'quantity', parseInt(e.target.value) || 1)}
                          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium text-slate-700">תאריך התחלה *</label>
                        <input
                          type="date"
                          value={li.start_date}
                          onChange={(e) => updateLineItem(index, 'start_date', e.target.value)}
                          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          dir="ltr"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium text-slate-700">תאריך סיום *</label>
                        <input
                          type="date"
                          value={li.end_date}
                          onChange={(e) => updateLineItem(index, 'end_date', e.target.value)}
                          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-slate-700">
                        ניסיון מינימלי (שנים, 0-20)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={li.min_experience}
                        onChange={(e) => updateLineItem(index, 'min_experience', parseInt(e.target.value) || 0)}
                        className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        dir="ltr"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
              )}
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={() => { setError(''); setStep(1); }} className="flex-1">חזור</Button>
                <Button type="submit" className="flex-1">הבא — סקירה</Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <h3 className="font-semibold text-slate-800">סקירה ואישור</h3>

              {/* Summary */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">שם הפרויקט:</span>
                  <span className="font-medium">{step1.project_name_he}</span>
                </div>
                {step1.project_name && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">שם באנגלית:</span>
                    <span dir="ltr">{step1.project_name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">אזור:</span>
                  <span>
                    {regions.find((r) => r.code === step1.region)?.name_he ?? step1.region}
                  </span>
                </div>
                {step1.address && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">כתובת:</span>
                    <span>{step1.address}</span>
                  </div>
                )}
                {step1.project_start_date && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">תאריכים:</span>
                    <span dir="ltr">{step1.project_start_date} — {step1.project_end_date}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">דרישות כוח אדם ({lineItems.length} מקצועות):</p>
                {lineItems.map((li, i) => (
                  <div key={i} className="bg-white border border-slate-200 rounded-md px-4 py-2 text-sm flex justify-between">
                    <span>
                      {professions.find((p) => p.code === li.profession_type)?.name_he ?? li.profession_type}
                    </span>
                    <span className="text-slate-500">
                      {li.quantity} עובדים | ניסיון: {li.min_experience}+ שנים
                    </span>
                  </div>
                ))}
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={() => { setError(''); setStep(2); }} className="flex-1" disabled={loading}>
                  חזור
                </Button>
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /><span>שולח...</span></>
                  ) : 'שלח בקשה'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
