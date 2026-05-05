import type { Profession } from '@/types';
import { Input } from '@/components/ui/input';
import {
  EXPERIENCE_RANGES,
  LANGUAGE_OPTIONS,
  ORIGIN_PRIMARY_LANGUAGE,
} from '@/i18n/he';
import type { SharedFields, Origin } from '../types';

interface Props {
  fields: SharedFields;
  professions: Profession[];
  origins: Origin[];
  showEmployeeNumber?: boolean;
  onChange: (f: Partial<SharedFields>) => void;
}

// Wave 2: per key-user feedback only profession is required when corp
// fills out a worker. Everything else can be left blank ("לא צויין").
// `available_region` removed — the corp's regions cover this.
export function SharedFieldsSection({
  fields, professions, origins,
  showEmployeeNumber = true, onChange,
}: Props) {
  function toggleLang(code: string) {
    const next = fields.languages.includes(code)
      ? fields.languages.filter((l) => l !== code)
      : [...fields.languages, code];
    onChange({ languages: next });
  }

  function handleOriginChange(code: string) {
    const update: Partial<SharedFields> = { origin_country: code };
    // Auto-add primary language for this origin if not already selected
    const lang = ORIGIN_PRIMARY_LANGUAGE[code];
    if (lang && !fields.languages.includes(lang)) {
      update.languages = [...fields.languages, lang];
    }
    onChange(update);
  }

  return (
    <div className="space-y-4">
      {/* Employee number */}
      {showEmployeeNumber && (
        <Input
          label="מספר עובד בתאגיד"
          placeholder="לדוגמה: EMP-001"
          value={fields.employee_number}
          onChange={(e) => onChange({ employee_number: e.target.value })}
        />
      )}

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

      {/* Experience range — months. Optional; "לא צויין" deselects. */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">טווח ניסיון</label>
        <div className="flex flex-wrap gap-2">
          <button type="button"
            onClick={() => onChange({ experience_range: '' })}
            className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
              fields.experience_range === ''
                ? 'bg-slate-200 text-slate-700 border-slate-300'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            }`}>לא צויין</button>
          {EXPERIENCE_RANGES.map((r) => (
            <button key={r.code} type="button"
              onClick={() => onChange({ experience_range: r.code })}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                fields.experience_range === r.code
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400'
              }`}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Origin country — auto-selects language. "לא צויין" = empty. */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700">מדינת מוצא</label>
        <select value={fields.origin_country}
          onChange={(e) => handleOriginChange(e.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">לא צויין</option>
          {origins.map((o) => (
            <option key={o.code} value={o.code}>{o.name_he}</option>
          ))}
        </select>
      </div>

      {/* Languages — pills */}
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

      {/* Visa — optional; leave blank for "לא צויין". */}
      <Input label="ויזה תקפה עד" type="date" dir="ltr"
        value={fields.visa_valid_until}
        onChange={(e) => onChange({ visa_valid_until: e.target.value })} />

      {/* Availability region was removed in Wave 2 — the corporation's
          operating_regions cover where workers can be placed. The
          "available_from" date stays since it's per-worker. */}
      <Input label="זמין מתאריך" type="date" dir="ltr"
        value={fields.available_from}
        onChange={(e) => onChange({ available_from: e.target.value })} />
    </div>
  );
}
