'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import Link from 'next/link';
import { Loader2, Search, Plus, AlertTriangle, Check, X, Pencil } from 'lucide-react';
import { workerApi } from '@/lib/api';
import type { Worker } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useEnums } from '@/features/enums/EnumsContext';
import { EXPERIENCE_LABEL } from '@/i18n/he';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  available:   { label: 'זמין',     color: 'bg-green-100 text-green-700' },
  assigned:    { label: 'משובץ',    color: 'bg-blue-100 text-blue-700' },
  on_leave:    { label: 'בחופשה',   color: 'bg-amber-100 text-amber-700' },
  deactivated: { label: 'לא פעיל', color: 'bg-slate-100 text-slate-500' },
};

const ROW_BG: Record<string, string> = {
  available:   'bg-green-50/50',
  assigned:    'bg-blue-50/50',
  on_leave:    'bg-amber-50/50',
  deactivated: 'bg-slate-50/30',
};

const EXP_LABELS: Record<string, string> = {
  ...EXPERIENCE_LABEL,
  // Legacy year-based fallbacks (pre-months schema).
  '1-3': '1–3 שנים',
  '3-5': '3–5 שנים',
  '5+':  '5+ שנים',
};

function visaStatus(until?: string): { label: string; urgent: boolean } {
  if (!until) return { label: '—', urgent: false };
  const days = (new Date(until).getTime() - Date.now()) / 86_400_000;
  if (days < 0)   return { label: 'פגה', urgent: true };
  if (days <= 30) return { label: `${Math.round(days)} ימים`, urgent: true };
  return { label: new Date(until).toLocaleDateString('he-IL'), urgent: false };
}

function formatDate(d?: string) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('he-IL'); } catch { return d; }
}

// ── Inline experience-range editor ────────────────────────────────────────
const EXP_RANGE_OPTIONS = [
  { code: '0-6',   label: '0–6 ח׳' },
  { code: '6-12',  label: '6–12 ח׳' },
  { code: '12-24', label: '12–24 ח׳' },
  { code: '24-36', label: '24–36 ח׳' },
  { code: '36+',   label: '36+ ח׳' },
];

function ExperienceCell({ workerId, value, onSaved }: {
  workerId: string;
  value: string;
  onSaved: (newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);

  async function save(code: string) {
    if (code === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await workerApi.update(workerId, { experience_range: code });
      onSaved(code);
      setEditing(false);
    } catch { /* keep editing */ }
    finally { setSaving(false); }
  }

  const currentLabel = EXP_LABELS[value] ?? (value || '—');

  if (editing) {
    return (
      <div className="flex flex-wrap gap-1 min-w-0">
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
        ) : (
          EXP_RANGE_OPTIONS.map((r) => (
            <button
              key={r.code}
              onClick={() => save(r.code)}
              className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                r.code === value
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
              }`}
            >
              {r.label}
            </button>
          ))
        )}
        {!saving && (
          <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-red-500 ms-1">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group/exp min-w-0 whitespace-nowrap">
      <span className="text-xs text-slate-600">{currentLabel}</span>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 group-hover/exp:opacity-100 transition-opacity text-slate-400 hover:text-brand-600 shrink-0"
        title="ערוך ניסיון"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Generic inline select editor ──────────────────────────────────────────
function SelectCell({ workerId, value, displayValue, options, updateKey, onSaved }: {
  workerId: string;
  value: string;
  displayValue: string;
  options: { value: string; label: string }[];
  updateKey: string;
  onSaved: (newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);

  async function save(val: string) {
    if (val === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await workerApi.update(workerId, { [updateKey]: val });
      onSaved(val);
      setEditing(false);
    } catch { /* keep editing */ }
    finally { setSaving(false); }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
        ) : (
          <select
            autoFocus
            defaultValue={value}
            onChange={(e) => save(e.target.value)}
            onBlur={() => setEditing(false)}
            className="h-7 rounded border border-brand-400 bg-white px-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group/sel min-w-0">
      <span className="text-xs text-slate-600">{displayValue}</span>
      <button onClick={() => setEditing(true)}
        className="opacity-0 group-hover/sel:opacity-100 transition-opacity text-slate-400 hover:text-brand-600 shrink-0"
        title="ערוך">
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Generic inline date editor ─────────────────────────────────────────────
function DateCell({ workerId, value, updateKey, onSaved }: {
  workerId: string;
  value: string;
  updateKey: string;
  onSaved: (newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function save() {
    if (!draft || draft === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await workerApi.update(workerId, { [updateKey]: draft });
      onSaved(draft);
      setEditing(false);
    } catch { /* keep editing */ }
    finally { setSaving(false); }
  }

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const displayDate = value
    ? (() => { try { return new Date(value).toLocaleDateString('he-IL'); } catch { return value; } })()
    : '—';

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <input ref={inputRef} type="date" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="h-7 w-32 rounded border border-brand-400 bg-white px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
          dir="ltr"
        />
        {saving
          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />
          : <>
              <button onClick={save} className="text-green-600 hover:text-green-700 shrink-0"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-red-500 shrink-0"><X className="h-3.5 w-3.5" /></button>
            </>
        }
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group/date min-w-0 whitespace-nowrap">
      <span className="text-xs text-slate-600">{displayDate}</span>
      <button onClick={() => { setDraft(value); setEditing(true); }}
        className="opacity-0 group-hover/date:opacity-100 transition-opacity text-slate-400 hover:text-brand-600 shrink-0"
        title="ערוך">
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Inline employee-number editor ─────────────────────────────────────────
function EmpNumCell({ workerId, value, onSaved }: {
  workerId: string;
  value: string;
  onSaved: (newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() { setDraft(value); setEditing(true); }

  async function save() {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await workerApi.update(workerId, { employee_number: draft });
      onSaved(draft);
      setEditing(false);
    } catch { /* keep editing */ }
    finally { setSaving(false); }
  }

  function cancel() { setEditing(false); setDraft(value); }

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          className="h-7 w-24 rounded border border-brand-400 bg-white px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
          dir="ltr"
        />
        {saving
          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />
          : <>
              <button onClick={save} className="text-green-600 hover:text-green-700 shrink-0"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={cancel} className="text-slate-400 hover:text-red-500 shrink-0"><X className="h-3.5 w-3.5" /></button>
            </>
        }
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group/emp min-w-0">
      <span className="text-xs font-mono text-slate-600 dir-ltr" dir="ltr">{value || '—'}</span>
      <button
        onClick={startEdit}
        className="opacity-0 group-hover/emp:opacity-100 transition-opacity text-slate-400 hover:text-brand-600 shrink-0"
        title="ערוך מספר עובד"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function WorkersPage() {
  const [workers, setWorkers]             = useState<Worker[]>([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [statusFilter, setStatusFilter]   = useState<'all' | 'available' | 'assigned' | 'deactivated'>('all');

  const { professions, origins, regions, professionMap, originMap, regionMap } = useEnums();

  const professionOptions = useMemo(
    () => professions.filter((p) => p.is_active).map((p) => ({ value: p.code, label: p.name_he })),
    [professions],
  );
  const originOptions = useMemo(
    () => origins.map((o) => ({ value: o.code, label: o.name_he })),
    [origins],
  );
  const regionOptions = useMemo(
    () => [{ value: '', label: 'כל הארץ' }, ...regions.map((r) => ({ value: r.code, label: r.name_he }))],
    [regions],
  );

  useEffect(() => {
    workerApi.list().then(setWorkers).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Update employee_number in local state after inline save
  function handleEmpNumSaved(workerId: string, newVal: string) {
    setWorkers((prev) => prev.map((w) => {
      if (w.id !== workerId) return w;
      const extra = { ...(w.extra_fields as Record<string, unknown> || {}), employee_number: newVal };
      return { ...w, extra_fields: extra };
    }));
  }

  // Update experience_range in local state after inline save
  function handleExpSaved(workerId: string, newCode: string) {
    setWorkers((prev) => prev.map((w) =>
      w.id !== workerId ? w : { ...w, experience_range: newCode }
    ));
  }

  // Generic field updater for top-level worker fields
  function handleFieldSaved(workerId: string, field: keyof Worker, value: string) {
    setWorkers((prev) => prev.map((w) =>
      w.id !== workerId ? w : { ...w, [field]: value }
    ));
  }

  // Generic extra_field updater (region, available_from)
  function handleExtraSaved(workerId: string, key: string, value: string) {
    setWorkers((prev) => prev.map((w) => {
      if (w.id !== workerId) return w;
      const extra = { ...(w.extra_fields as Record<string, unknown> || {}), [key]: value };
      return { ...w, extra_fields: extra };
    }));
  }

  const filtered = workers.filter((w) => {
    const matchStatus = statusFilter === 'all' || w.status === statusFilter;
    const profLabel = professionMap[w.profession_type] ?? w.profession_type;
    const originLabel = originMap[w.origin_country] ?? w.origin_country;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      `${w.first_name} ${w.last_name}`.toLowerCase().includes(q) ||
      profLabel.toLowerCase().includes(q) ||
      originLabel.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const expiringSoon = workers.filter((w) => {
    const days = (new Date(w.visa_valid_until).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 30;
  });

  return (
    <div className="space-y-4 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-900">ניהול עובדים</h2>
        <Button asChild>
          <Link href="/corporation/workers/new">
            <Plus className="h-4 w-4" />
            הוסף עובד
          </Link>
        </Button>
      </div>

      {/* Expiring visa warning */}
      {expiringSoon.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{expiringSoon.length} עובדים</span> עם ויזה הפוגת תוך 30 יום.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'available', 'assigned', 'deactivated'] as const).map((f) => (
          <button key={f} onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === f
                ? 'bg-brand-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}>
            {f === 'all' ? 'הכל' : STATUS_LABELS[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input type="text" placeholder="חפש לפי שם, מקצוע, מדינה..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full ps-9 pe-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">
            {loading ? '...' : `${filtered.length} עובדים`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 py-8">לא נמצאו עובדים</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="px-3 py-3 text-start font-medium">מס׳ עובד</th>
                    <th className="px-3 py-3 text-start font-medium">שם</th>
                    <th className="px-3 py-3 text-start font-medium">מקצוע</th>
                    <th className="px-3 py-3 text-start font-medium">ניסיון</th>
                    <th className="px-3 py-3 text-start font-medium">מדינה</th>
                    <th className="px-3 py-3 text-start font-medium">אזור זמינות</th>
                    <th className="px-3 py-3 text-start font-medium">זמין מ-</th>
                    <th className="px-3 py-3 text-start font-medium">ויזה</th>
                    <th className="px-3 py-3 text-start font-medium">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((w) => {
                    const vr = visaStatus(w.visa_valid_until);
                    const sr = STATUS_LABELS[w.status] ?? { label: w.status, color: 'bg-slate-100 text-slate-600' };
                    const extra = w.extra_fields as Record<string, string> | undefined;
                    const availRegion = extra?.available_region;
                    const availFrom   = extra?.available_from;
                    const empNum      = extra?.employee_number ?? '';
                    const expCode     = w.experience_range ?? '';
                    const expLabel    = EXP_LABELS[expCode] ?? (expCode || '—');
                    const profLabel   = professionMap[w.profession_type] ?? w.profession_type;
                    const originLabel = originMap[w.origin_country] ?? w.origin_country;
                    const regionLabel = availRegion ? (regionMap[availRegion] ?? availRegion) : '—';
                    return (
                      <tr key={w.id} className={`border-b border-slate-50 last:border-0 hover:brightness-95 transition-colors ${ROW_BG[w.status] ?? ''}`}>
                        <td className="px-3 py-3">
                          <EmpNumCell
                            workerId={w.id}
                            value={empNum}
                            onSaved={(v) => handleEmpNumSaved(w.id, v)}
                          />
                        </td>
                        <td className="px-3 py-3 font-medium text-slate-900 whitespace-nowrap">
                          {w.first_name} {w.last_name}
                        </td>
                        {/* Profession — select */}
                        <td className="px-3 py-3">
                          <SelectCell workerId={w.id} value={w.profession_type}
                            displayValue={profLabel} options={professionOptions}
                            updateKey="profession_type"
                            onSaved={(v) => handleFieldSaved(w.id, 'profession_type', v)} />
                        </td>
                        {/* Experience range */}
                        <td className="px-3 py-3">
                          <ExperienceCell workerId={w.id} value={expCode}
                            onSaved={(v) => handleExpSaved(w.id, v)} />
                        </td>
                        {/* Origin country — select */}
                        <td className="px-3 py-3">
                          <SelectCell workerId={w.id} value={w.origin_country}
                            displayValue={originLabel} options={originOptions}
                            updateKey="origin_country"
                            onSaved={(v) => handleFieldSaved(w.id, 'origin_country', v)} />
                        </td>
                        {/* Available region — select */}
                        <td className="px-3 py-3">
                          <SelectCell workerId={w.id} value={availRegion ?? ''}
                            displayValue={regionLabel} options={regionOptions}
                            updateKey="available_region"
                            onSaved={(v) => handleExtraSaved(w.id, 'available_region', v)} />
                        </td>
                        {/* Available from — date */}
                        <td className="px-3 py-3">
                          <DateCell workerId={w.id} value={availFrom ?? ''}
                            updateKey="available_from"
                            onSaved={(v) => handleExtraSaved(w.id, 'available_from', v)} />
                        </td>
                        {/* Visa — date with urgency indicator */}
                        <td className={`px-3 py-3 ${vr.urgent ? 'text-red-600' : ''}`}>
                          <div className="flex items-center gap-1">
                            {vr.urgent && <AlertTriangle className="h-3 w-3 shrink-0" />}
                            <DateCell workerId={w.id} value={w.visa_valid_until ?? ''}
                              updateKey="visa_valid_until"
                              onSaved={(v) => handleFieldSaved(w.id, 'visa_valid_until', v)} />
                          </div>
                        </td>
                        {/* Status — select */}
                        <td className="px-3 py-3">
                          <SelectCell workerId={w.id} value={w.status}
                            displayValue={sr.label}
                            options={[
                              { value: 'available',   label: 'זמין' },
                              { value: 'assigned',    label: 'משובץ' },
                              { value: 'on_leave',    label: 'בחופשה' },
                              { value: 'deactivated', label: 'לא פעיל' },
                            ]}
                            updateKey="status"
                            onSaved={(v) => handleFieldSaved(w.id, 'status', v)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
