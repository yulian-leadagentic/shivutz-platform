import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, hint, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="flex flex-col gap-1 w-full">
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
          className={cn(
            'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-start',
            'placeholder:text-slate-400',
            'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-red-500 focus:ring-red-500',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-xs text-red-600 text-start">{error}</p>}
        {hint && !error && <p className="text-xs text-slate-500 text-start">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };
