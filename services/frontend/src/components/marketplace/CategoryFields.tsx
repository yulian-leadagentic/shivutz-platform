'use client';

// R34 4c · the questions a category asks, drawn from its field_schema
// (marketplace_categories, served with the catalog).
//
// The schema is data: adding a question, renaming a label or changing an
// option list is a row update, and this component draws whatever it is
// given. It knows the seven field types and nothing about any category.
//
// Values are kept the way the inputs hold them (numbers as the typed
// string) and turned into what the server expects by `toAttributes`.
// The server is the judge of what is valid; its message per field comes
// back in `errors` and is shown under that field.

import { useId } from 'react';
import type { CategoryField, CategoryFieldSchema } from '@/lib/api/marketplaceSubscriptions';
import { Input } from '@/components/ui/input';

export type FieldValues = Record<string, string | boolean | string[]>;

const CONTROL = 'w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 hover:border-slate-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30';
const LABEL   = 'text-start text-sm font-medium text-slate-700';
const PILL    = 'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium focus-visible:rounded-full';

/** The answers as the server stores them: numbers as numbers, nothing
 *  for a question left empty or a box left unticked. */
export function toAttributes(schema: CategoryFieldSchema | null | undefined, values: FieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema?.fields ?? []) {
    if (field.show_if && !values[field.show_if]) continue;
    const v = values[field.key];
    if (v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)) continue;
    if (field.type === 'int' || field.type === 'money') {
      const n = Number(v);
      // Left as typed when it is not a number, so the server's message
      // lands on the field instead of the answer silently vanishing.
      out[field.key] = Number.isFinite(n) && String(v).trim() !== '' ? n : v;
    } else {
      out[field.key] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return out;
}

export default function CategoryFields({
  schema, values, errors, onChange,
}: {
  schema: CategoryFieldSchema;
  values: FieldValues;
  errors: Record<string, string>;
  onChange: (key: string, value: string | boolean | string[]) => void;
}) {
  const fields = schema.fields.filter((f) => !f.show_if || !!values[f.show_if]);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={values[field.key]}
          error={errors[field.key]}
          onChange={(v) => onChange(field.key, v)}
        />
      ))}
      {schema.price?.note && (
        <p className="text-sm text-slate-500 sm:col-span-2">
          מחיר: {schema.price.note}
        </p>
      )}
    </div>
  );
}

function Field({
  field, value, error, onChange,
}: {
  field: CategoryField;
  value: string | boolean | string[] | undefined;
  error?: string;
  onChange: (value: string | boolean | string[]) => void;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;
  const errorLine = error && (
    <p id={errorId} role="alert" className="text-xs text-red-700">{error}</p>
  );

  if (field.type === 'bool') {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            aria-describedby={describedBy}
            className="h-4 w-4 rounded border-slate-300 accent-brand-600"
          />
          {field.label}
        </label>
        {errorLine}
      </div>
    );
  }

  if (field.type === 'multi') {
    const picked = Array.isArray(value) ? value : [];
    return (
      <fieldset className="min-w-0 space-y-2 sm:col-span-2" aria-describedby={describedBy}>
        <legend className={LABEL}>{field.label}</legend>
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((option) => {
            const on = picked.includes(option);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? picked.filter((o) => o !== option) : [...picked, option])}
                className={`${PILL} ${
                  on
                    ? 'border-brand-600 bg-brand-600 text-slate-900'
                    : 'border-slate-200 text-slate-600 hover:border-brand-300'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
        {errorLine}
      </fieldset>
    );
  }

  if (field.type === 'select') {
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className={LABEL}>{field.label}</label>
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${CONTROL} h-9`}
        >
          <option value="">בחירה</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {errorLine}
      </div>
    );
  }

  const numeric = field.type === 'int' || field.type === 'money';
  return (
    <Input
      label={field.type === 'money' ? `${field.label} (₪)` : field.label}
      type={numeric ? 'number' : field.type === 'date' ? 'date' : 'text'}
      inputMode={field.type === 'int' ? 'numeric' : field.type === 'money' ? 'decimal' : undefined}
      min={numeric ? 0 : undefined}
      step={field.type === 'int' ? 1 : field.type === 'money' ? '0.01' : undefined}
      dir={numeric ? 'ltr' : undefined}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      error={error}
    />
  );
}
