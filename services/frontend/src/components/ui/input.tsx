import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

// U8 §5a — types where auto-selecting the current value on focus is
// hostile: on a phone / email a caret-tap to edit one digit shouldn't
// wipe the entire field, and the same on password managers that
// re-focus after autofill. Kept for the general text case per
// QA-R3 #21 — a single-word entry field IS easier to replace than
// to clear-then-type.
const NO_AUTOSELECT_TYPES = new Set(['tel', 'email', 'password', 'number', 'url']);

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, hint, id, onFocus, ...props }, ref) => {
    // U8 §5a defect (b) — the old `label.toLowerCase().replace(/\s+/g,'-')`
    // produced Hebrew ids (`שם-פרטי`) which collided across forms with
    // the same label and mispointed <label htmlFor>. `useId()` is
    // guaranteed unique per-mount; the label becomes a purely visual
    // concern, and the caller-supplied `id` still wins when set.
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    // QA-R3 #21 — auto-select existing content on focus so the user can
    // just type to replace. Skip for type=checkbox/radio (no text value)
    // and respect any per-input override (caller-provided onFocus runs
    // afterwards and can preventDefault by returning early).
    //
    // U8 §5a defect (c) — also skip for tel/email/password/number/url
    // (see NO_AUTOSELECT_TYPES). A caret-tap on a `tel` field to
    // correct one digit shouldn't nuke the whole number.
    const handleFocus: React.FocusEventHandler<HTMLInputElement> = (e) => {
      const shouldSelect =
        type !== 'checkbox' &&
        type !== 'radio' &&
        type !== 'file' &&
        !NO_AUTOSELECT_TYPES.has(type ?? '');
      if (shouldSelect) {
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
          // Password managers / autofill extensions (Edge, LastPass,
          // 1Password) inject attributes like `fdprocessedid` into
          // form inputs before React hydrates. The DOM no longer
          // matches what was server-rendered → hydration aborts →
          // event handlers may not re-attach cleanly, so the user's
          // first click does nothing. Tell React to tolerate this
          // specific element diverging from SSR output.
          suppressHydrationWarning
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
