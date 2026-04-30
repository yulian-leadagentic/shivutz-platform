'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2, AlertCircle, ArrowLeft, Plus, Trash2,
  ChevronDown, ChevronUp, Globe2, Languages, Save,
} from 'lucide-react';
import { jobApi } from '@/lib/api';
import type { Profession } from '@/types';
import { useEnums } from '@/features/enums/EnumsContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import {
  EXPERIENCE_RANGES as EXP_RANGES_MONTHS,
  EXPERIENCE_LOWER_MONTHS as EXP_RANGE_LOWER,
  LANGUAGE_OPTIONS as LANGUAGES,
  LANGUAGE_LEVELS as LEVELS,
  type ExperienceRange as ExpRangeMonth,
} from '@/i18n/he';

interface LanguageReq { language: string; level: string; }

interface LineItemDraft {
  id?: string; // existing id (if loaded from server)
  profession_type: string;
  quantity: number;
  start_date: string;
  end_date: string;
  min_experience_range: ExpRangeMonth | '';
  origin_preference: string[];
  required_languages: LanguageReq[];
}

/** Convert min_experience (months number) back to a range code */
function monthsToRange(m: number): ExpRangeMonth | '' {
  if (m >= 36) return '36+';
  if (m >= 24) return '24-36';
  if (m >= 12) return '12-24';
  if (m >= 6)  return '6-12';
  if (m > 0)   return '0-6';
  return '';
}

const emptyLineItem = (ps = '', pe = ''): LineItemDraft => ({
  profession_type: '', quantity: 1,
  start_date: ps, end_date: pe,
  min_experience_range: '', origin_preference: [], required_languages: [],
});

// ── OriginToggle ──────────────────────────────────────────────────────────

function OriginToggle({ options, value, onChange }: {
  options: { code: string; name_he: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (code: string) =>
    onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);
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

// ── LanguagesEditor ───────────────────────────────────────────────────────

function LanguagesEditor({ value, onChange }: {
  value: LanguageReq[]; onChange: (v: LanguageReq[]) => void;
}) {
  const usedCodes = value.map(v => v.language);
  const available = LANGUAGES.filter(l => !usedCodes.includes(l.code));
  const addLang = () => {
    if (!available.length) return;
    onChange([...value, { language: available[0].code, level: 'conversational' }]);
  };
  const updateLang = (i: number, field: keyof LanguageReq, val: string) =>
    onChange(value.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  const removeLang = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      {value.map((req, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select value={req.language} onChange={(e) => updateLang(i, 'language', e.target.value)}
            className="flex-1 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {LANGUAGES.filter(l => l.code === req.language || !usedCodes.includes(l.code)).map(l => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          <select value={req.level} onChange={(e) => updateLang(i, 'level', e.target.value)}
            className="w-28 h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {LEVELS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
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

// ── LineItemCard ──────────────────────────────────────────────────────────

function LineItemCard({ li, index, total, expanded, professions, origins,
  projectStart, projectEnd, onToggle, onChange, onRemove }: {
  li: LineItemDraft; index: number; total: number; expanded: boolean;
  professions: Profession[]; origins: { code: string; name_he: string; name_en: string }[];
  projectStart: string; projectEnd: string;
  onToggle: () => void;
  onChange: (field: keyof LineItemDraft, value: unknown) => void;
  onRemove: () => void;
}) {
  const profName = professions.find(p => p.code === li.profession_type)?.name_he;
  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-slate-50 transition-colors"
        onClick={onToggle}>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">מקצוע *</label>
              <select value={li.profession_type}
                onChange={(e) => onChange('profession_type', e.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">בחר מקצוע...</option>
                {professions.filter(p => p.is_active).map(p => (
                  <option key={p.code} value={p.code}>{p.name_he}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">כמות עובדים *</label>
              <input type="number" min={1} max={50} value={li.quantity} dir="ltr"
                onChange={(e) => onChange('quantity', parseInt(e.target.value) || 1)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">תאריך התחלה *</label>
              <input type="date" value={li.start_date} dir="ltr"
                min={projectStart || undefined} max={li.end_date || projectEnd || undefined}
                onChange={(e) => onChange('start_date', e.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">תאריך סיום *</label>
              <input type="date" value={li.end_date} dir="ltr"
                min={li.start_date || projectStart || undefined} max={projectEnd || undefined}
                onChange={(e) => onChange('end_date', e.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>

          {/* Experience */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">ניסיון מינימלי (אופציונלי)</label>
            <div className="flex flex-wrap gap-1.5">
              {EXP_RANGES_MONTHS.map((r) => (
                <button key={r.code} type="button"
                  onClick={() => onChange('min_experience_range', li.min_experience_range === r.code ? '' : r.code)}
                  className={`px-2.5 py-1 rounded-full text-xs border font-medium transition-colors ${
                    li.min_experience_range === r.code
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
                  }`}>{r.label}</button>
              ))}
            </div>
          </div>

          {/* Origin */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
              <Globe2 className="h-3.5 w-3.5" /> מוצא מועדף (אופציונלי)
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

export default function EditRequestPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [notFound, setNotFound] = useState(false);

  const { professions, regions, origins } = useEnums();

  const [projectName, setProjectName]   = useState('');
  const [region, setRegion]             = useState('');
  const [projectStart, setProjectStart] = useState('');
  const [projectEnd, setProjectEnd]     = useState('');
  const [lineItems, setLineItems]       = useState<LineItemDraft[]>([emptyLineItem()]);
  const [expandedIdx, setExpandedIdx]   = useState<number>(0);

  useEffect(() => {
    jobApi.get(id)
      .then((req) => {
        const r = req as unknown as Record<string, unknown>;
        setProjectName((r.project_name_he as string) || (r.project_name as string) || '');
        setRegion((r.region as string) || '');
        setProjectStart((r.project_start_date as string) || '');
        setProjectEnd((r.project_end_date as string) || '');

        // Load existing line items
        const rawItems = (r.line_items as unknown[]) || [];
        if (rawItems.length > 0) {
          const drafts: LineItemDraft[] = rawItems.map((item) => {
            const li = item as Record<string, unknown>;
            const langs = (li.required_languages as string[] || []).map((lang) => ({
              language: lang,
              level: 'conversational',
            }));
            return {
              id: li.id as string,
              profession_type:   (li.profession_type as string) || '',
              quantity:          (li.quantity as number) || 1,
              start_date:        (li.start_date as string) || '',
              end_date:          (li.end_date as string) || '',
              min_experience_range: monthsToRange((li.min_experience as number) || 0),
              origin_preference:    (li.origin_preference as string[]) || [],
              required_languages:   langs,
            };
          });
          setLineItems(drafts);
          setExpandedIdx(0);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  function validateForm(): string {
    if (!projectName.trim()) return 'יש להזין שם פרויקט';
    if (!region)              return 'יש לבחור אזור';
    if (lineItems.length === 0) return 'יש להוסיף לפחות מקצוע אחד';
    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i], n = i + 1;
      if (!li.profession_type)                 return `מקצוע ${n}: יש לבחור מקצוע`;
      if (li.quantity < 1 || li.quantity > 50) return `מקצוע ${n}: כמות חייבת להיות 1–50`;
      if (!li.start_date)                       return `מקצוע ${n}: יש להזין תאריך התחלה`;
      if (!li.end_date)                         return `מקצוע ${n}: יש להזין תאריך סיום`;
      if (li.end_date <= li.start_date)         return `מקצוע ${n}: תאריך הסיום חייב להיות אחרי ההתחלה`;
    }
    return '';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateForm();
    if (err) { setError(err); return; }
    setError(''); setSaving(true);
    try {
      // 1. Update project metadata
      await jobApi.update(id, {
        project_name_he:    projectName,
        region,
        project_start_date: projectStart || undefined,
        project_end_date:   projectEnd   || undefined,
      });

      // 2. Replace all line items atomically
      await jobApi.replaceLineItems(id, lineItems.map((li) => ({
        profession_type:    li.profession_type,
        quantity:           li.quantity,
        start_date:         li.start_date,
        end_date:           li.end_date,
        min_experience:     li.min_experience_range
          ? EXP_RANGE_LOWER[li.min_experience_range] ?? 0
          : 0,
        min_experience_range: li.min_experience_range || undefined,
        origin_preference:  li.origin_preference,
        required_languages: li.required_languages.map(l => l.language),
      })));

      router.push('/contractor/requests');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשמירה');
    } finally { setSaving(false); }
  }

  function updateLineItem(index: number, field: keyof LineItemDraft, value: unknown) {
    setLineItems(prev => prev.map((li, i) => i === index ? { ...li, [field]: value } : li));
  }

  function addLineItem() {
    setLineItems(prev => [...prev, emptyLineItem(projectStart, projectEnd)]);
    setExpandedIdx(lineItems.length);
  }

  function removeLineItem(index: number) {
    setLineItems(prev => prev.filter((_, i) => i !== index));
    setExpandedIdx(prev => Math.max(0, prev > index ? prev - 1 : prev));
  }

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  );

  if (notFound) return (
    <div className="max-w-md mx-auto text-center py-16 space-y-3">
      <AlertCircle className="h-10 w-10 text-red-400 mx-auto" />
      <p className="text-slate-600">הבקשה לא נמצאה</p>
      <Button variant="outline" asChild><Link href="/contractor/requests">חזרה לרשימה</Link></Button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/contractor/requests"><ArrowLeft className="h-4 w-4" /> חזרה</Link>
        </Button>
        <h2 className="text-xl font-bold text-slate-900">עריכת איתור עובדים</h2>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* ── Section 1: Project details ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">פרטי הפרויקט</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input label="שם הפרויקט *" value={projectName}
              onChange={(e) => setProjectName(e.target.value)} />

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-700">אזור *</label>
              <select value={region} onChange={(e) => setRegion(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">בחר אזור...</option>
                {regions.map((r) => <option key={r.code} value={r.code}>{r.name_he}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="תאריך תחילת הפרויקט" type="date" dir="ltr"
                value={projectStart}
                onChange={(e) => setProjectStart(e.target.value)} />
              <Input label="תאריך סיום הפרויקט" type="date" dir="ltr"
                value={projectEnd} min={projectStart || undefined}
                onChange={(e) => setProjectEnd(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* ── Section 2: Line items ── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                דרישות כוח אדם
                {lineItems.length > 0 && (
                  <span className="ms-2 text-xs font-normal text-slate-500">
                    ({lineItems.length} מקצועות · {lineItems.reduce((s, li) => s + li.quantity, 0)} עובדים)
                  </span>
                )}
              </CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                <Plus className="h-4 w-4" /> הוסף מקצוע
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {lineItems.map((li, index) => (
                <LineItemCard key={index} li={li} index={index} total={lineItems.length}
                  expanded={expandedIdx === index}
                  professions={professions} origins={origins}
                  projectStart={projectStart} projectEnd={projectEnd}
                  onToggle={() => setExpandedIdx(expandedIdx === index ? -1 : index)}
                  onChange={(field, value) => updateLineItem(index, field, value)}
                  onRemove={() => removeLineItem(index)}
                />
              ))}
              {lineItems.length === 0 && (
                <div className="text-center py-6 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg">
                  אין מקצועות — לחץ "הוסף מקצוע"
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving} className="flex-1">
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</>
              : <><Save className="h-4 w-4" /> שמור שינויים</>}
          </Button>
          <Button type="button" variant="outline"
            onClick={() => router.push('/contractor/requests')}>ביטול</Button>
        </div>
      </form>
    </div>
  );
}
