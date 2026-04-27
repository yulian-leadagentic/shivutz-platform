const THRESHOLD_LABELS: Record<string, string> = {
  minimum_contract_months: 'מינימום חוזה',
  housing_provided:        'דיור',
  insurance_included:      'ביטוח',
  employment_conditions:   'תנאי העסקה',
  other_notes:             'הערות',
  transportation:          'הסעות',
  meals_provided:          'ארוחות',
};

const BOOLEAN_KEYS = new Set(['housing_provided', 'insurance_included', 'transportation', 'meals_provided']);

function formatThresholdValue(key: string, val: unknown): string {
  if (typeof val === 'boolean') return val ? 'כן ✓' : 'לא ✗';
  if (key === 'minimum_contract_months' && typeof val === 'number') {
    return `${val} חודשים`;
  }
  return String(val);
}

export function ThresholdRequirements({ req }: { req: Record<string, unknown> }) {
  const entries = Object.entries(req).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs bg-slate-100/80 border border-slate-200 rounded-lg px-3 py-2">
      <span className="font-semibold text-slate-600 shrink-0">תנאי סף:</span>
      {entries.map(([key, val]) => (
        <span key={key} className="text-slate-700">
          <span className="font-medium">{THRESHOLD_LABELS[key] ?? key}:</span>{' '}
          <span className={
            BOOLEAN_KEYS.has(key)
              ? (val ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold')
              : ''
          }>
            {formatThresholdValue(key, val)}
          </span>
        </span>
      ))}
    </div>
  );
}
