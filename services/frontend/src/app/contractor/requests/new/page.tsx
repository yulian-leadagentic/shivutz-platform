'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, Trash2, Plus,
  ChevronDown, ChevronUp, Languages, Globe2, FolderOpen, FolderPlus,
} from 'lucide-react';
import { jobApi, enumApi } from '@/lib/api';
import type { Profession, JobRequest } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  EXPERIENCE_RANGES as EXP_RANGES_MONTHS,
  EXPERIENCE_LOWER_MONTHS as EXP_RANGE_LOWER,
  LANGUAGE_OPTIONS as LANGUAGES,
  LANGUAGE_LEVELS as LEVELS,
  ORIGIN_PRIMARY_LANGUAGE as ORIGIN_TO_LANG,
  type ExperienceRange as ExpRangeMonth,
} from '@/i18n/he';

type ProjectMode = 'new' | 'existing';
const TOTAL_STEPS = 2;

interface LanguageReq { language: string; level: string; }

interface LineItemDraft {
  profession_type: string;
  quantity: number;
  useProjectDates: boolean;
  start_date: string;
  end_date: string;
  min_experience_ranges: ExpRangeMonth[];
  origin_preference: string[];
  required_languages: LanguageReq[];
}

interface Step1Data {
  project_name_he: string;
  region: string;
  project_start_date: string;
  project_end_date: string;
}

const emptyLineItem = (ps = '', pe = ''): LineItemDraft => ({
  profession_type: '', quantity: 1,
  useProjectDates: !!(ps && pe), start_date: ps, end_date: pe,
  min_experience_ranges: [], origin_preference: [], required_languages: [],
});

// ── Origin toggle ──────────────────────────────────────────────────────────
function OriginToggle({ options, value, onChange }: {
  options: { code: string; name_he: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (code: string) =>
    onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {options.map(o => (
        <button key={o.code} type="button" onClick={() => toggle(o.code)}
          className={`px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
            value.includes(o.code)
              ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400 hover:bg-brand-50'
          }`}>{o.name_he}</button>
      ))}
    </div>
  );
}

// ── Additional languages editor ────────────────────────────────────────────
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
          <select value={req.language} onChange={e => updateLang(i, 'language', e.target.value)}
            className="flex-1 h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {LANGUAGES.filter(l => l.code === req.language || !usedCodes.includes(l.code)).map(l => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          <select value={req.level} onChange={e => updateLang(i, 'level', e.target.value)}
            className="w-28 h-11 rounded-xl border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {LEVELS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          <button type="button" onClick={() => removeLang(i)}
            className="p-2.5 text-slate-400 hover:text-red-500 transition-colors rounded-xl hover:bg-red-50">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      {available.length > 0 && (
        <button type="button" onClick={addLang}
          className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium py-1">
          <Plus className="h-4 w-4" /> הוסף שפה
        </button>
      )}
    </div>
  );
}

// ── Line item card ─────────────────────────────────────────────────────────
function LineItemCard({ li, index, total, expanded, professions, origins,
  projectStart, projectEnd, onToggle, onChange, onRemove }: {
  li: LineItemDraft; index: number; total: number; expanded: boolean;
  professions: Profession[];
  origins: { code: string; name_he: string; name_en: string }[];
  projectStart: string; projectEnd: string;
  onToggle: () => void;
  onChange: (field: keyof LineItemDraft, value: unknown) => void;
  onRemove: () => void;
}) {
  const profName = professions.find(p => p.code === li.profession_type)?.name_he;

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
  function toggleExp(code: ExpRangeMonth) {
    const arr = li.min_experience_ranges;
    onChange('min_experience_ranges',
      arr.includes(code) ? arr.filter(c => c !== code) : [...arr, code]);
  }

  return (
    <div className="border-2 border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
      {/* Accordion header */}
      <div
        className="flex items-center justify-between px-4 py-3.5 cursor-pointer select-none hover:bg-slate-50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-sm font-bold flex items-center justify-center">
            {index + 1}
          </span>
          {profName
            ? <span className="text-sm font-semibold text-slate-800 truncate">{profName}</span>
            : <span className="text-sm text-slate-400 italic">בחר מקצוע...</span>}
          {!expanded && li.quantity > 0 && (
            <span className="shrink-0 text-xs text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">{li.quantity} עובדים</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {total > 1 && (
            <button type="button" onClick={e => { e.stopPropagation(); onRemove(); }}
              className="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-5 space-y-4 border-t-2 border-slate-100 pt-4 bg-slate-50/30">
          {/* Profession + Quantity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">מקצוע *</label>
              <select value={li.profession_type}
                onChange={e => onChange('profession_type', e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">בחר מקצוע...</option>
                {professions.filter(p => p.is_active).map(p => (
                  <option key={p.code} value={p.code}>{p.name_he}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">כמות עובדים *</label>
              <input type="number" min={1} max={50} value={li.quantity} dir="ltr"
                onChange={e => onChange('quantity', parseInt(e.target.value) || 1)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Use project dates checkbox */}
          {projectStart && projectEnd && (
            <label className="flex items-center gap-2.5 cursor-pointer bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
              <input type="checkbox" checked={li.useProjectDates}
                onChange={e => handleUseProjectDates(e.target.checked)}
                className="accent-brand-600 h-4 w-4 rounded" />
              <span className="text-sm text-brand-800 font-medium">
                לפי תאריכי הפרויקט{' '}
                <span className="text-brand-600 font-normal" dir="ltr">({projectStart} — {projectEnd})</span>
              </span>
            </label>
          )}

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">תאריך התחלה *</label>
              <input type="date" value={li.start_date} dir="ltr"
                min={projectStart || undefined}
                max={li.end_date || projectEnd || undefined}
                disabled={li.useProjectDates}
                onChange={e => handleDateChange('start_date', e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">תאריך סיום *</label>
              <input type="date" value={li.end_date} dir="ltr"
                min={li.start_date || projectStart || undefined}
                max={projectEnd || undefined}
                disabled={li.useProjectDates}
                onChange={e => handleDateChange('end_date', e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
          </div>

          {/* Experience — multi-select pills */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ניסיון מינימלי (ריבוי, אופציונלי)</label>
            <div className="flex flex-wrap gap-2">
              {EXP_RANGES_MONTHS.map(r => (
                <button key={r.code} type="button" onClick={() => toggleExp(r.code)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                    li.min_experience_ranges.includes(r.code)
                      ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400'
                  }`}>{r.label}</button>
              ))}
            </div>
          </div>

          {/* Origin preference */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <Globe2 className="h-3.5 w-3.5" /> מוצא מועדף (ריבוי, אופציונלי)
            </label>
            <OriginToggle options={origins} value={li.origin_preference}
              onChange={v => onChange('origin_preference', v)} />
          </div>

          {/* Additional languages */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <Languages className="h-3.5 w-3.5" /> שפות נוספות (אופציונלי)
            </label>
            {li.required_languages.length > 0 && (
              <p className="text-xs text-slate-400">שפות ממדינות המוצא שנבחרו מסומנות אוטומטית</p>
            )}
            <LanguagesEditor value={li.required_languages}
              onChange={v => onChange('required_languages', v)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function NewRequestPage() {
  const router = useRouter();

  const [projectMode, setProjectMode] = useState<ProjectMode>('new');
  const [existingRequests, setExistingRequests] = useState<JobRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string>('');
  const [loadingExisting, setLoadingExisting] = useState(false);

  const [step, setStep]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const [professions, setProfessions] = useState<Profession[]>([]);
  const [regions, setRegions]         = useState<{ code: string; name_he: string; name_en: string }[]>([]);
  const [origins, setOrigins]         = useState<{ code: string; name_he: string; name_en: string }[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number>(0);

  const [step1, setStep1] = useState<Step1Data>({
    project_name_he: '', region: '',
    project_start_date: '', project_end_date: '',
  });
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyLineItem()]);

  useEffect(() => {
    enumApi.professions().then(setProfessions).catch(() => {});
    enumApi.regions().then(setRegions).catch(() => {});
    enumApi.origins().then(setOrigins).catch(() => {});
  }, []);

  // Load existing open requests when switching to 'existing' mode
  useEffect(() => {
    if (projectMode !== 'existing') return;
    setLoadingExisting(true);
    jobApi.list()
      .then(list => {
        const open = list.filter(r => ['draft', 'open', 'matched'].includes(r.status));
        setExistingRequests(open);
        if (open.length > 0 && !selectedRequestId) setSelectedRequestId(open[0].id);
      })
      .catch(() => {})
      .finally(() => setLoadingExisting(false));
  }, [projectMode]);

  // Sync "use project dates" line items when project dates change
  useEffect(() => {
    setLineItems(prev =>
      prev.map(li =>
        li.useProjectDates
          ? { ...li, start_date: step1.project_start_date, end_date: step1.project_end_date }
          : li
      )
    );
  }, [step1.project_start_date, step1.project_end_date]);

  function updateLineItem(index: number, field: keyof LineItemDraft, value: unknown) {
    setLineItems(prev => {
      const updated = prev.map((li, i) => i === index ? { ...li, [field]: value } : li);
      // Auto-add country language when origin_preference changes
      if (field === 'origin_preference') {
        const codes = value as string[];
        const cur = updated[index];
        const langs = [...cur.required_languages];
        let changed = false;
        for (const code of codes) {
          const lang = ORIGIN_TO_LANG[code];
          if (lang && !langs.some(l => l.language === lang)) {
            langs.push({ language: lang, level: 'basic' });
            changed = true;
          }
        }
        if (changed) updated[index] = { ...cur, required_languages: langs };
      }
      return updated;
    });
  }

  function addLineItem() {
    const ps = step1.project_start_date;
    const pe = step1.project_end_date;
    setLineItems(prev => {
      const next = [...prev, emptyLineItem(ps, pe)];
      setExpandedIdx(next.length - 1);
      return next;
    });
  }

  function removeLineItem(index: number) {
    setLineItems(prev => prev.filter((_, i) => i !== index));
    setExpandedIdx(prev => Math.max(0, prev > index ? prev - 1 : prev));
  }

  function validateStep1(): string {
    if (projectMode === 'existing') {
      if (!selectedRequestId) return 'יש לבחור פרויקט קיים';
      return '';
    }
    if (!step1.project_name_he.trim()) return 'יש להזין שם פרויקט';
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
      if (ps && li.start_date < ps)             return `מקצוע ${n}: תאריך ההתחלה לפני תחילת הפרויקט`;
      if (pe && li.end_date > pe)               return `מקצוע ${n}: תאריך הסיום אחרי סיום הפרויקט`;
    }
    return '';
  }

  async function handleStep1Next(e: FormEvent) {
    e.preventDefault(); setError('');

    if (projectMode === 'existing') {
      const err = validateStep1();
      if (err) { setError(err); return; }
      const sel = existingRequests.find(r => r.id === selectedRequestId);
      if (sel) {
        setStep1({
          project_name_he: sel.project_name_he || sel.project_name || '',
          region: sel.region || '',
          project_start_date: sel.project_start_date || '',
          project_end_date: sel.project_end_date || '',
        });
        setLineItems([emptyLineItem(sel.project_start_date, sel.project_end_date)]);
      }
      setStep(2);
      return;
    }

    const basicErr = validateStep1();
    if (basicErr) { setError(basicErr); return; }

    // Check for duplicate open region (new projects only)
    setLoading(true);
    try {
      const existing = await jobApi.list();
      const OPEN_STATUSES = ['draft', 'open', 'matched', 'in_negotiation'];
      const conflict = existing.find(r => r.region === step1.region && OPEN_STATUSES.includes(r.status));
      if (conflict) {
        const regionName = regions.find(r => r.code === step1.region)?.name_he ?? step1.region;
        setError(`יש לך כבר בקשה פתוחה באזור ${regionName}. ניתן לפתוח בקשה אחת בלבד לכל אזור.`);
        return;
      }
    } catch {
      // Allow proceeding on network error
    } finally {
      setLoading(false);
    }

    setStep(2);
  }

  async function handleSubmit() {
    setError(''); setLoading(true);
    try {
      let resultId: string;

      if (projectMode === 'existing' && selectedRequestId) {
        for (const li of lineItems) {
          await jobApi.addLineItem(selectedRequestId, {
            profession_type: li.profession_type,
            quantity: li.quantity,
            start_date: li.start_date,
            end_date: li.end_date,
            min_experience: li.min_experience_ranges.length
              ? Math.min(...li.min_experience_ranges.map(r => EXP_RANGE_LOWER[r] ?? 0))
              : 0,
            origin_preference: li.origin_preference,
            required_languages: li.required_languages.map(l => l.language),
          });
        }
        resultId = selectedRequestId;
      } else {
        const result = await jobApi.create({
          project_name_he: step1.project_name_he,
          region: step1.region,
          project_start_date: step1.project_start_date || undefined,
          project_end_date: step1.project_end_date || undefined,
          line_items: lineItems.map(li => ({
            profession_type: li.profession_type,
            quantity: li.quantity,
            start_date: li.start_date,
            end_date: li.end_date,
            min_experience: li.min_experience_ranges.length
              ? Math.min(...li.min_experience_ranges.map(r => EXP_RANGE_LOWER[r] ?? 0))
              : 0,
            min_experience_ranges: li.min_experience_ranges,
            origin_preference: li.origin_preference,
            required_languages: li.required_languages.map(l => l.language),
          })),
        });
        resultId = result.id;
      }

      router.push(`/contractor/requests/${resultId}/match`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשליחת הבקשה — נסה שוב');
    } finally {
      setLoading(false);
    }
  }

  // ── Wizard ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 pb-10">
      <div className="h-2 rounded-t-xl bg-gradient-to-e from-brand-600 to-brand-400" />
      <Card className="rounded-t-none shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">יצירת בקשה לעובדים</CardTitle>
          <CardDescription>שלב {step} מתוך {TOTAL_STEPS}</CardDescription>
          <div className="mt-3 flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${i + 1 <= step ? 'bg-brand-600' : 'bg-slate-200'}`} />
            ))}
          </div>
        </CardHeader>

        <CardContent>

          {/* ── Step 1: Project ── */}
          {step === 1 && (
            <form onSubmit={handleStep1Next} className="flex flex-col gap-5" noValidate>

              {/* Mode toggle */}
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                <button type="button" onClick={() => setProjectMode('new')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    projectMode === 'new'
                      ? 'bg-white shadow text-brand-700'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  <FolderPlus className="h-4 w-4" /> פרויקט חדש
                </button>
                <button type="button" onClick={() => setProjectMode('existing')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    projectMode === 'existing'
                      ? 'bg-white shadow text-amber-700'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  <FolderOpen className="h-4 w-4" /> פרויקט קיים
                </button>
              </div>

              {/* New project */}
              {projectMode === 'new' && (
                <>
                  <Input label="שם הפרויקט *" placeholder="פרויקט בנייה ברמת גן"
                    value={step1.project_name_he}
                    onChange={e => setStep1(p => ({ ...p, project_name_he: e.target.value }))} />

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-slate-700">אזור הפרויקט *</label>
                    {regions.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> טוען אזורים...
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {regions.map(r => (
                          <button key={r.code} type="button"
                            onClick={() => setStep1(p => ({ ...p, region: r.code }))}
                            className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                              step1.region === r.code
                                ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                                : 'bg-white text-slate-700 border-slate-200 hover:border-brand-400 hover:bg-brand-50'
                            }`}>
                            {r.name_he}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input label="תאריך תחילת הפרויקט" type="date" dir="ltr"
                      value={step1.project_start_date}
                      onChange={e => setStep1(p => ({ ...p, project_start_date: e.target.value }))} />
                    <Input label="תאריך סיום הפרויקט" type="date" dir="ltr"
                      value={step1.project_end_date}
                      min={step1.project_start_date || undefined}
                      onChange={e => setStep1(p => ({ ...p, project_end_date: e.target.value }))} />
                  </div>
                </>
              )}

              {/* Existing project selector */}
              {projectMode === 'existing' && (
                <>
                  {loadingExisting ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                  ) : existingRequests.length === 0 ? (
                    <div className="text-center py-10 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                      <FolderOpen className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm text-slate-500 font-medium">אין פרויקטים פתוחים</p>
                      <button type="button" className="text-sm text-brand-600 mt-2 hover:underline font-semibold"
                        onClick={() => setProjectMode('new')}>
                        + צור פרויקט חדש
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {existingRequests.map(r => (
                        <label key={r.id}
                          className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                            selectedRequestId === r.id
                              ? 'border-amber-400 bg-amber-50'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}>
                          <input type="radio" name="existing_project" value={r.id}
                            checked={selectedRequestId === r.id}
                            onChange={() => setSelectedRequestId(r.id)}
                            className="mt-0.5 accent-amber-500" />
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{r.project_name_he || r.project_name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {regions.find(rg => rg.code === r.region)?.name_he ?? r.region}
                              {r.project_start_date && ` · ${r.project_start_date}`}
                              {r.project_end_date && ` – ${r.project_end_date}`}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
              )}

              <Button type="submit" disabled={loading || (projectMode === 'existing' && loadingExisting)}
                className="w-full h-12 text-base">
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin ml-2" /> בודק...</>
                  : 'הבא — הוספת מקצועות ←'
                }
              </Button>
            </form>
          )}

          {/* ── Step 2: Worker types ── */}
          {step === 2 && (
            <form onSubmit={e => {
              e.preventDefault();
              const err = validateStep2();
              if (err) { setError(err); return; }
              setError('');
              void handleSubmit();
            }} className="flex flex-col gap-3" noValidate>

              <div className="space-y-3">
                {lineItems.map((li, index) => (
                  <LineItemCard key={index} li={li} index={index} total={lineItems.length}
                    expanded={expandedIdx === index}
                    professions={professions} origins={origins}
                    projectStart={step1.project_start_date} projectEnd={step1.project_end_date}
                    onToggle={() => setExpandedIdx(expandedIdx === index ? -1 : index)}
                    onChange={(field, value) => updateLineItem(index, field, value)}
                    onRemove={() => removeLineItem(index)}
                  />
                ))}
              </div>

              {/* Prominent "Add profession" button */}
              <button type="button" onClick={addLineItem}
                className="w-full flex items-center justify-center gap-2.5 py-4 rounded-xl border-2 border-dashed border-brand-300 text-brand-700 font-bold bg-brand-50 hover:bg-brand-100 hover:border-brand-500 transition-all text-base mt-1 active:scale-98">
                <Plus className="h-5 w-5" />
                הוסף מקצוע נוסף לבקשה
              </button>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>
              )}

              <div className="flex gap-3 mt-1">
                <Button type="button" variant="outline" className="flex-1 h-12"
                  onClick={() => { setError(''); setStep(1); }} disabled={loading}>← חזור</Button>
                <Button type="submit" disabled={loading} className="flex-1 h-12 text-base">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin ml-2" /> שולח...</> : 'שלח בקשה ✓'}
                </Button>
              </div>
            </form>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
