'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, CheckCircle2, Users, User } from 'lucide-react';
import { workerApi, enumApi } from '@/lib/api';
import type { Profession } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Constants ──────────────────────────────────────────────────────────────

const EXP_RANGES = [
  { code: '1-3', label: '1–3 שנים' },
  { code: '3-5', label: '3–5 שנים' },
  { code: '5+',  label: '5+ שנים' },
] as const;

type ExpRange = '1-3' | '3-5' | '5+';

const LANGUAGE_OPTIONS = [
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

interface SharedFields {
  profession_type: string;
  experience_range: ExpRange | '';
  origin_country: string;
  languages: string[];
  visa_valid_until: string;
  available_region: string;
  available_from: string;
}

const EMPTY_SHARED: SharedFields = {
  profession_type: '', experience_range: '', origin_country: '',
  languages: [], visa_valid_until: '', available_region: '', available_from: '',
};

type Origin = { code: string; name_he: string; name_en: string };

// ── Shared fields section ──────────────────────────────────────────────────

function SharedFieldsSection({ fields, professions, origins, onChange }: {
  fields: SharedFields;
  professions: Profession[];
  origins: Origin[];
  onChange: (f: Partial<SharedFields>) => void;
}) {
  function toggleLang(code: string) {
    const next = fields.languages.includes(code)
      ? fields.languages.filter((l) => l !== code)
      : [...fields.languages, code];
    onChange({ languages: next });
  }

  return (
    <div className="space-y-4">
      {/* Profession */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700">מקצוע *</label>
        <select value={fields.profession_type}
          onChange={(e) => onChange({ profession_type: e.target.value })}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">בחר מקצוע...</option>
          {professions.filter((p) => p.is_active).map((p) => (
            <option key={p.code} value={p.code}>{p.name_he}</option>
          ))}
        </select>
      </div>

      {/* Experience range */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">טווח ניסיון *</label>
        <div className="flex gap-2">
          {EXP_RANGES.map((r) => (
            <button key={r.code} type="button"
              onClick={() => onChange({ experience_range: r.code })}
              className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                fields.experience_range === r.code
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
              }`}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Origin country */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700">מדינת מוצא *</label>
        <select value={fields.origin_country}
          onChange={(e) => onChange({ origin_country: e.target.value })}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">בחר מדינה...</option>
          {origins.map((o) => (
            <option key={o.code} value={o.code}>{o.name_he}</option>
          ))}
        </select>
      </div>

      {/* Languages */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">שפות</label>
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGE_OPTIONS.map((l) => (
            <button key={l.code} type="button" onClick={() => toggleLang(l.code)}
              className={`px-2.5 py-1 rounded-full text-xs border font-medium transition-colors ${
                fields.languages.includes(l.code)
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
              }`}>{l.name}</button>
          ))}
        </div>
      </div>

      {/* Visa */}
      <Input label="ויזה תקפה עד *" type="date" dir="ltr"
        value={fields.visa_valid_until}
        onChange={(e) => onChange({ visa_valid_until: e.target.value })} />

      {/* Availability */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">אזור זמינות</label>
          <select value={fields.available_region}
            onChange={(e) => onChange({ available_region: e.target.value })}
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="">כל הארץ</option>
            {origins.map((o) => (
              <option key={o.code} value={o.code}>{o.name_he}</option>
            ))}
          </select>
        </div>
        <Input label="זמין מתאריך" type="date" dir="ltr"
          value={fields.available_from}
          onChange={(e) => onChange({ available_from: e.target.value })} />
      </div>
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-green-700 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium">
      <CheckCircle2 className="h-5 w-5 shrink-0" />
      {msg}
      <button onClick={onClose} className="ms-2 text-green-200 hover:text-white text-base leading-none">✕</button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

type Mode = 'single' | 'bulk';

export default function NewWorkerPage() {
  const router = useRouter();
  const [mode, setMode]     = useState<Mode>('single');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState('');
  const [toast, setToast]   = useState('');

  const [professions, setProfessions] = useState<Profession[]>([]);
  const [origins, setOrigins]         = useState<Origin[]>([]);

  // single
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [shared, setShared]       = useState<SharedFields>(EMPTY_SHARED);

  // bulk
  const [quantity, setQuantity]     = useState(5);
  const [namePrefix, setNamePrefix] = useState('עובד');
  const [bulkShared, setBulkShared] = useState<SharedFields>(EMPTY_SHARED);

  useEffect(() => {
    enumApi.professions().then(setProfessions).catch(() => {});
    enumApi.origins().then(setOrigins).catch(() => {});
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4500);
  }

  // ── Single ────────────────────────────────────────────────────────────────
  function validateSingle(): string {
    if (!firstName.trim())        return 'יש להזין שם פרטי';
    if (!lastName.trim())         return 'יש להזין שם משפחה';
    if (!shared.profession_type)  return 'יש לבחור מקצוע';
    if (!shared.experience_range) return 'יש לבחור טווח ניסיון';
    if (!shared.origin_country)   return 'יש לבחור מדינת מוצא';
    if (!shared.visa_valid_until) return 'יש להזין תאריך ויזה';
    return '';
  }

  async function handleSingleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateSingle();
    if (err) { setError(err); return; }
    setError(''); setSubmitting(true);
    try {
      await workerApi.create({
        first_name:       firstName,
        last_name:        lastName,
        profession_type:  shared.profession_type,
        experience_range: shared.experience_range,
        origin_country:   shared.origin_country,
        languages:        shared.languages,
        visa_valid_until: shared.visa_valid_until,
        available_region: shared.available_region || undefined,
        available_from:   shared.available_from   || undefined,
      });
      showToast(`${firstName} ${lastName} נוסף בהצלחה`);
      // Auto-open next — keep shared fields, clear name only
      setFirstName('');
      setLastName('');
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בשמירה');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Bulk ──────────────────────────────────────────────────────────────────
  function validateBulk(): string {
    if (quantity < 1 || quantity > 50)  return 'כמות חייבת להיות בין 1 ל-50';
    if (!bulkShared.profession_type)    return 'יש לבחור מקצוע';
    if (!bulkShared.experience_range)   return 'יש לבחור טווח ניסיון';
    if (!bulkShared.origin_country)     return 'יש לבחור מדינת מוצא';
    if (!bulkShared.visa_valid_until)   return 'יש להזין תאריך ויזה';
    return '';
  }

  async function handleBulkSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateBulk();
    if (err) { setError(err); return; }
    setError(''); setSubmitting(true);
    try {
      const res = await workerApi.bulkCreate({
        quantity,
        name_prefix:      namePrefix || 'עובד',
        profession_type:  bulkShared.profession_type,
        experience_range: bulkShared.experience_range,
        origin_country:   bulkShared.origin_country,
        languages:        bulkShared.languages,
        visa_valid_until: bulkShared.visa_valid_until,
        available_region: bulkShared.available_region || undefined,
        available_from:   bulkShared.available_from   || undefined,
      });
      showToast(`${res.created} עובדים נוצרו בהצלחה`);
      setBulkShared(EMPTY_SHARED);
      setQuantity(5);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בשמירה');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {toast && <Toast msg={toast} onClose={() => setToast('')} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-900">הוספת עובדים</h2>
        <button onClick={() => router.push('/corporation/workers')}
          className="text-sm text-slate-500 hover:text-slate-700 underline">
          חזרה לרשימה
        </button>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {([['single', 'עובד בודד', User], ['bulk', 'הוספה כמותית', Users]] as const).map(([m, label, Icon]) => (
          <button key={m} onClick={() => { setMode(m as Mode); setError(''); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── Single mode ── */}
      {mode === 'single' && (
        <form onSubmit={handleSingleSubmit} className="space-y-4" noValidate>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">פרטים אישיים</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Input label="שם פרטי *" value={firstName}
                  onChange={(e) => setFirstName(e.target.value)} autoFocus />
                <Input label="שם משפחה *" value={lastName}
                  onChange={(e) => setLastName(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">פרטים מקצועיים וזמינות</CardTitle>
            </CardHeader>
            <CardContent>
              <SharedFieldsSection
                fields={shared} professions={professions} origins={origins}
                onChange={(delta) => setShared((s) => ({ ...s, ...delta }))}
              />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</>
                : <><Plus className="h-4 w-4" /> שמור והוסף עובד נוסף</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/corporation/workers')}>
              סיום
            </Button>
          </div>
        </form>
      )}

      {/* ── Bulk mode ── */}
      {mode === 'bulk' && (
        <form onSubmit={handleBulkSubmit} className="space-y-4" noValidate>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">הגדרות כמות</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-slate-500">
                יצירת מספר עובדים עם אותם מאפיינים. שמות אוטומטיים לפי קידומת + מספר סידורי.
              </p>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-slate-700">כמות עובדים *</label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="h-10 w-10 rounded-lg border border-slate-300 bg-white text-lg font-bold hover:bg-slate-50 flex items-center justify-center">−</button>
                    <input type="number" min={1} max={50} value={quantity} dir="ltr"
                      onChange={(e) => setQuantity(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="h-10 w-16 text-center rounded-md border border-slate-300 bg-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <button type="button" onClick={() => setQuantity((q) => Math.min(50, q + 1))}
                      className="h-10 w-10 rounded-lg border border-slate-300 bg-white text-lg font-bold hover:bg-slate-50 flex items-center justify-center">+</button>
                  </div>
                </div>
                <Input label="קידומת שם" value={namePrefix} placeholder="עובד"
                  onChange={(e) => setNamePrefix(e.target.value)} />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-500">
                ייצור:{' '}
                <span className="font-medium text-slate-700">
                  {namePrefix || 'עובד'} 1, {namePrefix || 'עובד'} 2
                  {quantity > 2 ? ` ... ${namePrefix || 'עובד'} ${quantity}` : ''}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">מאפיינים משותפים</CardTitle>
            </CardHeader>
            <CardContent>
              <SharedFieldsSection
                fields={bulkShared} professions={professions} origins={origins}
                onChange={(delta) => setBulkShared((s) => ({ ...s, ...delta }))}
              />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> יוצר עובדים...</>
                : <><Users className="h-4 w-4" /> צור {quantity} עובדים</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/corporation/workers')}>
              סיום
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
