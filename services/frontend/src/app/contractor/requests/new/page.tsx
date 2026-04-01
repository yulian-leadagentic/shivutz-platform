'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Trash2, Plus, CheckCircle2, AlertCircle,
  ChevronDown, ChevronUp, Languages, Globe2,
} from 'lucide-react';
import { jobApi, enumApi } from '@/lib/api';
import type { Profession } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const TOTAL_STEPS = 3;

const LANGUAGES = [
  { code: 'he', name: 'עברית' },
  { code: 'en', name: 'אנגלית' },
  { code: 'ro', name: 'רומנית' },
  { code: 'uk', name: 'אוקראינית' },
  { code: 'ru', name: 'רוסית' },
  { code: 'th', name: 'תאילנדית' },
  { code: 'zh', name: 'סינית' },
  { code: 'tl', name: 'פיליפינית' },
  { code: 'hi', name: 'הינדית' },
  { code: 'ar', name: 'ערבית' },
  { code: 'md', name: 'מולדובית' },
];

const LEVELS = [
  { code: 'basic',          name: 'בסיסי' },
  { code: 'conversational', name: 'שיחות' },
  { code: 'fluent',         name: 'שוטף' },
];

interface LanguageReq { language: string; level: string; }

interface LineItemDraft {
  profession_type: string;
  quantity: number;
  useProjectDates: boolean;
  start_date: string;
  end_date: string;
  min_experience: number;
  origin_preference: string[];
  required_languages: LanguageReq[];
}

interface Step1Data {
  project_name_he: string; project_name: string;
  region: string; address: string;
  project_start_date: string; project_end_date: string;
}

const emptyLineItem = (ps = '', pe = ''): LineItemDraft => ({
  profession_type: '', quantity: 1,
  useProjectDates: !!(ps && pe), start_date: ps, end_date: pe,
  min_experience: 0, origin_preference: [], required_languages: [],
});

// ── Origin toggle ──────────────────────────────────────────────────────────
function OriginToggle({ options, value, onChange }: {
  options: { code: string; name_he: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (code: string) =>
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {options.map((o) => (
        <button key={o.code} type="button" onClick={() => toggle(o.code)}
          className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
            value.includes(o.code)
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
          }`}>{o.name_he}</button>
      ))}
    </div>
  );
}

// ── Languages editor ───────────────────────────────────────────────────────
function LanguagesEditor({ value, onChange }: {
  value: LanguageReq[]; onChange: (v: LanguageReq[]) => void;
}) {
  const usedCodes = value.map((v) => v.language);
  const available = LANGUAGES.filter((l) => !usedCodes.includes(l.code));
  const addLang = () => {
    if (!available.length) return;
    onChange([...value, { language: available[0].code, level: 'conversational' }]);
  };
  const updateLang = (i: number, field: keyof LanguageReq, val: string) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  const removeLang = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      {value.map((req, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select value={req.language} onChange={(e) => updateLang(i, 'language', e.target.value)}
            className="flex-1 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {LANGUAGES.filter((l) => l.code === req.language || !usedCodes.includes(l.code)).map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          <select value={req.level} onChange={(e) => updateLang(i, 'level', e.target.value)}
            className="w-28 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {LEVELS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          <button type="button" onClick={() => removeLang(i)}
            className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      {available.length > 0 && (
        <button type="button" onClick={addLang}
          className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800 font-medium">
          <Plus className="h-3.5 w-3.5" /> הוסף שפה
        </button>
      )}
    </div>
  );
}

// ── LineItem accordion card ────────────────────────────────────────────────
function LineItemCard({ li, index, total, expanded, professions, origins,
  projectStart, projectEnd, onToggle, onChange, onRemove }: {
  li: LineItemDraft; index: number; total: number; expanded: boolean;
  professions: Profession[]; origins: { code: string; name_he: string; name_en: string }[];
  projectStart: string; projectEnd: string;
  onToggle: () => void;
  onChange: (field: keyof LineItemDraft, value: unknown) => void;
  onRemove: () => void;
}) {
  const profName = professions.find((p) => p.code === li.profession_type)?.name_he;

  function handleUseProjectDates(checked: boolean) {
    onChange('useProjectDates', checked);
    if (checked && projectStart && projectEnd) {
      onChange('start_date', projectStart);
      onChange('end_date', projectEnd);
    }
  }
  function handleDateChange(field: 'start_date' | 'end_date', val: string) {
    onChange('useProjectDates', false);
    onChange(field, val);
  }

  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-slate-50 transition-colors" onClick={onToggle}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-slate-400 shrink-0">#{index + 1}</span>
          {profName
            ? <span className="text-sm font-semibold text-slate-800">{profName}</span>
            : <span className="text-sm text-slate-400 italic">מקצוע לא נבחר</span>}
          {!expanded && li.quantity > 0 && (
            <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">{li.quantity} עובדים</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {total > 1 && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="text-slate-400 hover:text-red-500 transition-colors p-1">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3 bg-slate-50/50">
          {/* Profession + Quantity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">מקצוע *</label>
              <select value={li.profession_type}
                onChange={(e) => onChange('profession_type', e.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">בחר מקצוע...</option>
                {professions.filter((p) => p.is_active).map((p) => (
                  <option key={p.code} value={p.code}>{p.name_he}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">כמות עובדים *</label>
              <input type="number" min={1} max={50} value={li.quantity} dir="ltr"
                onChange={(e) => onChange('quantity', parseInt(e.target.value) || 1)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Use project dates checkbox */}
          {projectStart && projectEnd && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={li.useProjectDates}
                onChange={(e) => handleUseProjectDates(e.target.checked)}
                className="accent-brand-600 h-4 w-4" />
              <span className="text-xs text-slate-600">
                לפי תאריכי הפרויקט{' '}
                <span className="text-slate-400" dir="ltr">({projectStart} — {projectEnd})</span>
              </span>
            </label>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">תאריך התחלה *</label>
              <input type="date" value={li.start_date} dir="ltr"
                min={projectStart || undefined}
                max={li.end_date || projectEnd || undefined}
                disabled={li.useProjectDates}
                onChange={(e) => handleDateChange('start_date', e.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">תאריך סיום *</label>
              <input type="date" value={li.end_date} dir="ltr"
                min={li.start_date || projectStart || undefined}
                max={projectEnd || undefined}
                disabled={li.useProjectDates}
                onChange={(e) => handleDateChange('end_date', e.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
          </div>

          {/* Experience */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">ניסיון מינימלי (שנים)</label>
            <input type="number" min={0} max={20} value={li.min_experience} dir="ltr"
              onChange={(e) => onChange('min_experience', parseInt(e.target.value) || 0)}
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Origin */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
              <Globe2 className="h-3.5 w-3.5" /> מוצא מועדף (ריבוי בחירות, אופציונלי)
            </label>
            <OriginToggle options={origins} value={li.origin_preference}
              onChange={(v) => onChange('origin_preference', v)} />
          </div>

          {/* Languages */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
              <Languages className="h-3.5 w-3.5" /> שפות נדרשות (אופציונלי)
            </label>
            <LanguagesEditor value={li.required_languages}
              onChange={(v) => onChange('required_languages', v)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function NewRequestPage() {
  const router = useRouter();
  const [step, setStep]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [regions, setRegions]         = useState<{ code: string; name_he: string; name_en: string }[]>([]);
  const [origins, setOrigins]         = useState<{ code: string; name_he: string; name_en: string }[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number>(0);
  const [step1, setStep1] = useState<Step1Data>({
    project_name_he: '', project_name: '', region: '',
    address: '', project_start_date: '', project_end_date: '',
  });
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    enumApi.professions().then(setProfessions).catch(() => {});
    enumApi.regions().then(setRegions).catch(() => {});
    enumApi.origins().then(setOrigins).catch(() => {});
    return () => { if (redirectTimer.current) clearTimeout(redirectTimer.current); };
  }, []);

  // Keep "use project dates" items in sync
  useEffect(() => {
    setLineItems((prev) =>
      prev.map((li) =>
        li.useProjectDates
          ? { ...li, start_date: step1.project_start_date, end_date: step1.project_end_date }
          : li
      )
    );
  }, [step1.project_start_date, step1.project_end_date]);

  function validateStep1(): string {
    if (!step1.project_name_he.trim()) return 'יש להזין שם פרויקט בעברית';
    if (!step1.region) return 'יש לבחור אזור';
    if (step1.project_start_date && step1.project_end_date &&
        step1.project_end_date <= step1.project_start_date)
      return 'תאריך סיום הפרויקט חייב להיות אחרי תאריך ההתחלה';
    return '';
  }

  function validateStep2(): string {
    if (lineItems.length === 0) return 'יש להוסיף לפחות מקצוע אחד';
    const { project_start_date: ps, project_end_date: pe } = step1;
    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i], n = i + 1;
      if (!li.profession_type)                 return `מקצוע ${n}: יש לבחור מקצוע`;
      if (li.quantity < 1 || li.quantity > 50) return `מקצוע ${n}: כמות חייבת להיות בין 1 ל-50`;
      if (!li.start_date)                       return `מקצוע ${n}: יש להזין תאריך התחלה`;
      if (!li.end_date)                         return `מקצוע ${n}: יש להזין תאריך סיום`;
      if (li.end_date <= li.start_date)         return `מקצוע ${n}: תאריך הסיום חייב להיות אחרי ההתחלה`;
      if (ps && li.start_date < ps)             return `מקצוע ${n}: תאריך ההתחלה לפני תחילת הפרויקט (${ps})`;
      if (pe && li.end_date > pe)               return `מקצוע ${n}: תאריך הסיום אחרי סיום הפרויקט (${pe})`;
    }
    return '';
  }

  function handleNext(e: FormEvent) {
    e.preventDefault(); setError('');
    const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : '';
    if (err) { setError(err); return; }
    setStep((s) => s + 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const result = await jobApi.create({
        project_name_he: step1.project_name_he,
        project_name: step1.project_name || undefined,
        region: step1.region,
        address: step1.address || undefined,
        project_start_date: step1.project_start_date || undefined,
        project_end_date: step1.project_end_date || undefined,
        line_items: lineItems.map((li) => ({
          profession_type: li.profession_type, quantity: li.quantity,
          start_date: li.start_date, end_date: li.end_date,
          min_experience: li.min_experience,
          origin_preference: li.origin_preference,
          required_languages: li.required_languages,
        })),
      });
      setCreatedId(result.id);
      redirectTimer.current = setTimeout(() => router.push('/contractor/dashboard'), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשליחת הבקשה — נסה שוב');
    } finally {
      setLoading(false);
    }
  }

  function updateLineItem(index: number, field: keyof LineItemDraft, value: unknown) {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, [field]: value } : li)));
  }

  function addLineItem() {
    setLineItems((prev) => [emptyLineItem(step1.project_start_date, step1.project_end_date), ...prev]);
    setExpandedIdx(0);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
    setExpandedIdx((prev) => Math.max(0, prev > index ? prev - 1 : prev));
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (createdId) {
    return (
      <div className="max-w-lg mx-auto">
        <Card className="shadow-md">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <h2 className="text-xl font-bold text-slate-900">הבקשה נשלחה בהצלחה!</h2>
            <p className="text-slate-500 text-sm">מעביר ללוח הבקרה בעוד מספר שניות...</p>
            <div className="flex flex-col gap-2 w-full mt-2">
              <Button className="w-full" onClick={() => {
                if (redirectTimer.current) clearTimeout(redirectTimer.current);
                router.push(`/contractor/requests/${createdId}/match`);
              }}>חפש התאמות עכשיו</Button>
              <Button variant="outline" className="w-full" onClick={() => {
                if (redirectTimer.current) clearTimeout(redirectTimer.current);
                router.push('/contractor/dashboard');
              }}>חזרה ללוח הבקרה</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Wizard ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
      <Card className="rounded-t-none shadow-md">
        <CardHeader className="pb-2">
          <CardTitle>בקשת עבודה חדשה</CardTitle>
          <CardDescription>שלב {step} מתוך {TOTAL_STEPS}</CardDescription>
          <div className="mt-3 flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${i + 1 <= step ? 'bg-brand-600' : 'bg-slate-200'}`} />
            ))}
          </div>
        </CardHeader>

        <CardContent>
          {/* ── Step 1 ── */}
          {step === 1 && (
            <form onSubmit={handleNext} className="flex flex-col gap-4" noValidate>
              <h3 className="font-semibold text-slate-800">פרטי הפרויקט</h3>
              <Input label="שם הפרויקט בעברית *" placeholder="פרויקט בנייה ברמת גן"
                value={step1.project_name_he}
                onChange={(e) => setStep1((p) => ({ ...p, project_name_he: e.target.value }))} />
              <Input label="שם הפרויקט באנגלית" placeholder="Ramat Gan Construction Project"
                value={step1.project_name} dir="ltr"
                onChange={(e) => setStep1((p) => ({ ...p, project_name: e.target.value }))} />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700">אזור *</label>
                <select value={step1.region} onChange={(e) => setStep1((p) => ({ ...p, region: e.target.value }))}
                  className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">בחר אזור...</option>
                  {regions.map((r) => <option key={r.code} value={r.code}>{r.name_he}</option>)}
                </select>
              </div>
              <Input label="כתובת האתר" placeholder="רחוב הבנייה 1, עיר"
                value={step1.address}
                onChange={(e) => setStep1((p) => ({ ...p, address: e.target.value }))} />
              <div className="grid grid-cols-2 gap-4">
                <Input label="תאריך תחילת הפרויקט" type="date" dir="ltr"
                  value={step1.project_start_date}
                  onChange={(e) => setStep1((p) => ({ ...p, project_start_date: e.target.value }))} />
                <Input label="תאריך סיום הפרויקט" type="date" dir="ltr"
                  value={step1.project_end_date}
                  min={step1.project_start_date || undefined}
                  onChange={(e) => setStep1((p) => ({ ...p, project_end_date: e.target.value }))} />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full">הבא</Button>
            </form>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <form onSubmit={handleNext} className="flex flex-col gap-4" noValidate>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">דרישות כוח אדם</h3>
                <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                  <Plus className="h-4 w-4" /> הוסף מקצוע
                </Button>
              </div>
              <div className="space-y-3">
                {lineItems.map((li, index) => (
                  <LineItemCard key={index} li={li} index={index} total={lineItems.length}
                    expanded={expandedIdx === index} professions={professions} origins={origins}
                    projectStart={step1.project_start_date} projectEnd={step1.project_end_date}
                    onToggle={() => setExpandedIdx(expandedIdx === index ? -1 : index)}
                    onChange={(field, value) => updateLineItem(index, field, value)}
                    onRemove={() => removeLineItem(index)}
                  />
                ))}
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1"
                  onClick={() => { setError(''); setStep(1); }}>חזור</Button>
                <Button type="submit" className="flex-1">הבא — סקירה</Button>
              </div>
            </form>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <h3 className="font-semibold text-slate-800">סקירה ואישור</h3>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">שם הפרויקט:</span>
                  <span className="font-medium">{step1.project_name_he}</span>
                </div>
                {step1.project_name && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">באנגלית:</span>
                    <span dir="ltr">{step1.project_name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">אזור:</span>
                  <span>{regions.find((r) => r.code === step1.region)?.name_he ?? step1.region}</span>
                </div>
                {step1.address && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">כתובת:</span><span>{step1.address}</span>
                  </div>
                )}
                {step1.project_start_date && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">תאריכי פרויקט:</span>
                    <span dir="ltr">{step1.project_start_date} — {step1.project_end_date}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">כוח אדם ({lineItems.length} מקצועות):</p>
                {lineItems.map((li, i) => {
                  const profLabel = professions.find((p) => p.code === li.profession_type)?.name_he ?? li.profession_type;
                  const langLabel = li.required_languages.map((l) =>
                    `${LANGUAGES.find((x) => x.code === l.language)?.name ?? l.language} (${LEVELS.find((x) => x.code === l.level)?.name ?? l.level})`
                  ).join(', ');
                  const origLabel = li.origin_preference.map((c) =>
                    origins.find((o) => o.code === c)?.name_he ?? c
                  ).join(', ');
                  return (
                    <div key={i} className="bg-white border border-slate-200 rounded-md px-4 py-2 text-sm space-y-0.5">
                      <div className="flex justify-between font-medium">
                        <span>{profLabel}</span>
                        <span className="text-slate-500">{li.quantity} עובדים</span>
                      </div>
                      <div className="text-xs text-slate-400 flex justify-between">
                        <span dir="ltr">{li.start_date} — {li.end_date}</span>
                        <span>ניסיון: {li.min_experience}+ שנים</span>
                      </div>
                      {origLabel && <p className="text-xs text-slate-500">מוצא: {origLabel}</p>}
                      {langLabel && <p className="text-xs text-slate-500">שפות: {langLabel}</p>}
                    </div>
                  );
                })}
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />{error}
                </div>
              )}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1"
                  onClick={() => { setError(''); setStep(2); }} disabled={loading}>חזור</Button>
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח...</> : 'שלח בקשה'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
