import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, hint, id, onFocus, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    // QA-R3 #21 — auto-select existing content on focus so the user can
    // just type to replace. Skip for type=checkbox/radio (no text value)
    // and respect any per-input override (caller-provided onFocus runs
    // afterwards and can preventDefault by returning early).
    const handleFocus: React.FocusEventHandler<HTMLInputElement> = (e) => {
      if (type !== 'checkbox' && type !== 'radio' && type !== 'file') {
        // Defer so the value is committed when the browser moves the
        // caret on focus; selecting in the same tick can race with the
        // native focus handler in some browsers.
        const target = e.target;
        requestAnimationFrame(() => { try { target.select(); } catch {} });
      }
      onFocus?.(e);
    };
    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-slate-700 text-start"
          >
            {label}
          </label>
        )}
        <input
          id={inputId}
          type={type}
          onFocus={handleFocus}
          className={cn(
            'flex h-9 w-full rounded-lg border bg-white px-3 py-2 text-sm text-start',
            'border-slate-200 text-slate-900',
            'placeholder:text-slate-400',
            'transition-shadow duration-150',
            'focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500',
            'hover:border-slate-300',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-200',
            error && 'border-red-400 focus:ring-red-500/20 focus:border-red-500',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p className="text-xs text-red-600 text-start">{error}</p>
        )}
        {hint && !error && (
          <p className="text-xs text-slate-400 text-start">{hint}</p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };
