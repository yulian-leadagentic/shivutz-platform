'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Plus, User, Users, FileSpreadsheet } from 'lucide-react';
import { workerApi } from '@/lib/api';
import { useEnums } from '@/features/enums/EnumsContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EMPTY_SHARED, type SharedFields } from '@/features/workers/types';
import { SharedFieldsSection } from '@/features/workers/components/SharedFieldsSection';
import { ExcelUploadSection } from '@/features/workers/components/ExcelUploadSection';

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-green-700 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium">
      <CheckCircle2 className="h-5 w-5 shrink-0" />{msg}
      <button onClick={onClose} className="ms-2 text-green-200 hover:text-white text-base leading-none">✕</button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

type Mode = 'single' | 'bulk' | 'excel';

export default function NewWorkerPage() {
  const router = useRouter();
  const [mode, setMode]             = useState<Mode>('single');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [toast, setToast]           = useState('');

  const { professions, origins, regions } = useEnums();

  // single mode
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [shared, setShared]       = useState<SharedFields>(EMPTY_SHARED);

  // bulk mode — comma-separated names
  const [bulkNames, setBulkNames] = useState('');
  const [bulkShared, setBulkShared] = useState<SharedFields>(EMPTY_SHARED);

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
        visa_valid_until: shared.visa_valid_until || null,
        available_region: shared.available_region || null,
        available_from:   shared.available_from   || null,
        employee_number:  shared.employee_number  || null,
      });
      showToast(`${firstName} ${lastName} נוסף בהצלחה`);
      setFirstName(''); setLastName('');
      setShared((s) => ({ ...s, employee_number: '' }));
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בשמירה');
    } finally { setSubmitting(false); }
  }

  // ── Bulk ──────────────────────────────────────────────────────────────────

  /** Parse "שם פרטי שם משפחה, שם פרטי שם משפחה, ..." → [{first, last}] */
  function parseNames(raw: string): Array<{ first: string; last: string }> {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((full) => {
        const parts = full.trim().split(/\s+/);
        if (parts.length === 1) return { first: parts[0], last: '' };
        return { first: parts[0], last: parts.slice(1).join(' ') };
      });
  }

  const parsedNames = parseNames(bulkNames);

  function validateBulk(): string {
    if (!bulkNames.trim())                return 'יש להזין שמות (מופרדים בפסיק)';
    if (parsedNames.length === 0)         return 'יש להזין לפחות שם אחד';
    if (!bulkShared.profession_type)      return 'יש לבחור מקצוע';
    if (!bulkShared.experience_range)     return 'יש לבחור טווח ניסיון';
    if (!bulkShared.origin_country)       return 'יש לבחור מדינת מוצא';
    if (!bulkShared.visa_valid_until)     return 'יש להזין תאריך ויזה';
    return '';
  }

  async function handleBulkSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateBulk();
    if (err) { setError(err); return; }
    setError(''); setSubmitting(true);
    try {
      // Create workers one by one so each gets their real name
      let created = 0;
      for (const { first, last } of parsedNames) {
        await workerApi.create({
          first_name:       first,
          last_name:        last,
          profession_type:  bulkShared.profession_type,
          experience_range: bulkShared.experience_range,
          origin_country:   bulkShared.origin_country,
          languages:        bulkShared.languages,
          visa_valid_until: bulkShared.visa_valid_until || null,
          available_region: bulkShared.available_region || null,
          available_from:   bulkShared.available_from   || null,
          // employee_number is intentionally omitted in bulk — assign individually after
        });
        created++;
      }
      showToast(`${created} עובדים נוצרו בהצלחה`);
      setBulkNames('');
      setBulkShared(EMPTY_SHARED);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בשמירה');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {toast && <Toast msg={toast} onClose={() => setToast('')} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-900">הוספת עובדים</h2>
        <button onClick={() => router.push('/corporation/workers')}
          className="text-sm text-slate-500 hover:text-slate-700 underline">חזרה לרשימה</button>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {([['single', 'עובד בודד', User], ['bulk', 'הוספה כמותית', Users], ['excel', 'ייבוא אקסל', FileSpreadsheet]] as const).map(([m, label, Icon]) => (
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
            <CardHeader className="pb-2"><CardTitle className="text-base">פרטים אישיים</CardTitle></CardHeader>
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
            <CardHeader className="pb-2"><CardTitle className="text-base">פרטים מקצועיים וזמינות</CardTitle></CardHeader>
            <CardContent>
              <SharedFieldsSection
                fields={shared}
                professions={professions}
                origins={origins}
                regions={regions}
                showEmployeeNumber={true}
                onChange={(delta) => setShared((s) => ({ ...s, ...delta }))}
              />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</> : <><Plus className="h-4 w-4" /> שמור והוסף עובד נוסף</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/corporation/workers')}>סיום</Button>
          </div>
        </form>
      )}

      {/* ── Bulk mode ── */}
      {mode === 'bulk' && (
        <form onSubmit={handleBulkSubmit} className="space-y-4" noValidate>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">שמות עובדים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">
                הזן שמות מלאים מופרדים בפסיק. כל עובד יקבל שם נפרד עם אותם מאפיינים. מספר עובד ניתן להקצות אחרי יצירה.
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-slate-700">שמות (מופרדים בפסיק) *</label>
                <textarea
                  value={bulkNames}
                  onChange={(e) => setBulkNames(e.target.value)}
                  placeholder="יוחנן כהן, מריה פופסקו, אנדרי בונדרנקו"
                  rows={3}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                />
              </div>
              {parsedNames.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-600 space-y-1">
                  <p className="font-medium text-slate-700">{parsedNames.length} עובדים:</p>
                  <p>{parsedNames.map((n) => `${n.first} ${n.last}`.trim()).join(' · ')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">מאפיינים משותפים</CardTitle></CardHeader>
            <CardContent>
              <SharedFieldsSection
                fields={bulkShared}
                professions={professions}
                origins={origins}
                regions={regions}
                showEmployeeNumber={false}
                onChange={(delta) => setBulkShared((s) => ({ ...s, ...delta }))}
              />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <Button type="submit" disabled={submitting || parsedNames.length === 0} className="flex-1">
              {submitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> יוצר עובדים...</>
                : <><Users className="h-4 w-4" /> צור {parsedNames.length > 0 ? parsedNames.length : ''} עובדים</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/corporation/workers')}>סיום</Button>
          </div>
        </form>
      )}

      {/* ── Excel mode ── */}
      {mode === 'excel' && (
        <ExcelUploadSection
          professions={professions}
          origins={origins}
          regions={regions}
          onDone={() => router.push('/corporation/workers')}
          onToast={showToast}
        />
      )}
    </div>
  );
}
