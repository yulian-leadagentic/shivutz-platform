'use client';

import { useRef, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Plus, User, FileSpreadsheet } from 'lucide-react';
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

// Wave 1 (2026-05): bulk mode removed per key-user feedback —
// "הוספה כמותית להוריד אופציה". Excel import handles batch use cases.
type Mode = 'single' | 'excel';

export default function NewWorkerPage() {
  const router = useRouter();
  const [mode, setMode]             = useState<Mode>('single');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [toast, setToast]           = useState('');
  // After a successful save the form goes "locked" — same data still on
  // screen so the corp can verify what was saved, with an explicit
  // "+ הוסף עובד נוסף" button to clear the per-worker fields (name +
  // employee number) and unlock for the next entry. QA-R3 #15.
  const [justSaved, setJustSaved]   = useState(false);
  const firstNameRef                = useRef<HTMLInputElement>(null);

  const { professions, origins } = useEnums();

  // single mode
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  // Carry-over fields (profession, languages, origin, visa, available_from)
  // intentionally PERSIST across worker entries — when a corp imports a
  // squad they share most attributes. Per QA-R3 #13/#14 we never clear
  // them on save; only the per-worker fields (name, employee_number) are
  // reset by addAnother() below.
  const [shared, setShared]       = useState<SharedFields>(EMPTY_SHARED);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4500);
  }

  // ── Single ────────────────────────────────────────────────────────────────
  // Wave 2: only first/last/profession are required. The other fields
  // (experience / origin / visa) submit as null when blank.
  function validateSingle(): string {
    if (!firstName.trim())        return 'יש להזין שם פרטי';
    if (!lastName.trim())         return 'יש להזין שם משפחה';
    if (!shared.profession_type)  return 'יש לבחור מקצוע';
    return '';
  }

  async function handleSingleSubmit(e: FormEvent) {
    e.preventDefault();
    if (justSaved) { addAnother(); return; }
    const err = validateSingle();
    if (err) { setError(err); return; }
    setError(''); setSubmitting(true);
    try {
      await workerApi.create({
        first_name:       firstName,
        last_name:        lastName,
        profession_type:  shared.profession_type,
        experience_range: shared.experience_range || null,
        origin_country:   shared.origin_country   || null,
        languages:        shared.languages,
        visa_valid_until: shared.visa_valid_until || null,
        available_from:   shared.available_from   || null,
        employee_number:  shared.employee_number  || null,
      });
      showToast(`${firstName} ${lastName} נוסף בהצלחה`);
      setJustSaved(true);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'שגיאה בשמירה');
    } finally { setSubmitting(false); }
  }

  function addAnother() {
    // Clear ONLY the per-worker identity fields. Shared attributes
    // (profession, languages, origin, visa, available_from) stay so the
    // corp can rip through a squad of similar workers without re-picking
    // the same options every time.
    setFirstName(''); setLastName('');
    setShared((s) => ({ ...s, employee_number: '' }));
    setJustSaved(false);
    setError('');
    requestAnimationFrame(() => firstNameRef.current?.focus());
  }

  // (Bulk-add mode and its handlers were removed in Wave 1 — Excel
  // import handles batch use cases now.)

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {toast && <Toast msg={toast} onClose={() => setToast('')} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-900">הוספת עובדים</h2>
        <button onClick={() => router.push('/corporation/workers')}
          className="text-sm text-slate-500 hover:text-slate-700 underline">חזרה לרשימה</button>
      </div>

      {/* Mode tabs — single vs Excel. QA-R4 R8: the inactive tab used to
          render as muted text on a grey panel which read as "disabled".
          Both states are now clearly buttons; the active tab carries
          brand accent + shadow, the inactive carries a white surface +
          slate border so it reads as "tap me too". */}
      <div className="inline-flex gap-2 p-1 bg-slate-100 rounded-lg">
        {([['single', 'עובד בודד', User], ['excel', 'ייבוא מאקסל', FileSpreadsheet]] as const).map(([m, label, Icon]) => {
          const isActive = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m as Mode); setError(''); }}
              aria-pressed={isActive}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${
                isActive
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-white text-slate-800 border border-slate-300 hover:border-brand-400 hover:bg-brand-50/40'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          );
        })}
      </div>

      {/* ── Single mode ── */}
      {mode === 'single' && (
        <form onSubmit={handleSingleSubmit} className="space-y-4" noValidate>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">פרטים אישיים</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input ref={firstNameRef} label="שם פרטי *" value={firstName}
                  onChange={(e) => setFirstName(e.target.value)} autoFocus
                  disabled={justSaved} />
                <Input label="שם משפחה *" value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={justSaved} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                פרטים מקצועיים וזמינות
                <span className="ms-2 text-xs font-normal text-slate-400">השדות נשמרים לעובד הבא</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SharedFieldsSection
                fields={shared}
                professions={professions}
                origins={origins}
                showEmployeeNumber={true}
                onChange={(delta) => setShared((s) => ({ ...s, ...delta }))}
              />
            </CardContent>
          </Card>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          {justSaved && (
            <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-md px-3 py-2.5 text-sm text-green-900">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
              <div>
                <p className="font-semibold">העובד נשמר.</p>
                <p className="text-xs text-green-700 mt-0.5">מקצוע, שפות, מוצא, ויזה וזמינות נשארים פתוחים — לחץ &quot;הוסף עובד נוסף&quot; כדי להזין שם חדש.</p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            {justSaved ? (
              <Button type="button" onClick={addAnother} className="flex-1">
                <Plus className="h-4 w-4" /> הוסף עובד נוסף
              </Button>
            ) : (
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> שומר...</> : <><Plus className="h-4 w-4" /> שמור עובד</>}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => router.push('/corporation/workers')}>סיום</Button>
          </div>
        </form>
      )}

      {/* ── Excel mode ── */}
      {mode === 'excel' && (
        <ExcelUploadSection
          professions={professions}
          origins={origins}
          onDone={() => router.push('/corporation/workers')}
          onToast={showToast}
        />
      )}
    </div>
  );
}
