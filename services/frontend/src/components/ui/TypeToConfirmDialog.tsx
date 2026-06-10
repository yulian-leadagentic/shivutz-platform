'use client';

// 2-step destructive-confirm dialog. The action button only enables
// once the admin types the literal `confirmPhrase` into the field —
// the strongest UX pattern for permanent deletes (tenders, deals,
// org data). Wraps ConfirmDialog's behaviour (ESC closes, focus
// management, RTL).

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TypeToConfirmDialogProps {
  open: boolean;
  /** Title of the dialog. */
  title: string;
  /** Full explanation of what's about to happen. Multi-line OK. */
  message: string;
  /** The exact string the admin must type to enable the confirm
   *  button. Echoed in the field's hint label. Match is
   *  case-INsensitive after trimming whitespace. */
  confirmPhrase: string;
  /** Action button label (e.g. "מחק לצמיתות"). */
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TypeToConfirmDialog({
  open,
  title,
  message,
  confirmPhrase,
  confirmLabel = 'מחק לצמיתות',
  cancelLabel  = 'ביטול',
  busy         = false,
  onConfirm,
  onCancel,
}: TypeToConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  // Reset the typed field whenever the dialog closes; the next
  // delete starts clean.
  useEffect(() => { if (!open) setTyped(''); }, [open]);

  // ESC closes; focus lands on cancel (the SAFE default).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    cancelBtnRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const matches = typed.trim().toLowerCase() === confirmPhrase.trim().toLowerCase();

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-start gap-2.5">
            <div className="shrink-0 w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-1">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 transition rounded p-1 -mt-0.5 -me-1"
            aria-label="סגירה"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{message}</p>
          <div>
            <label className="block text-xs text-slate-600 mb-1.5">
              כדי לאשר, הקלד <span className="font-mono font-bold text-rose-700">{confirmPhrase}</span> בשדה הבא:
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches && !busy) onConfirm(); }}
              className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm font-mono focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-200"
              dir="ltr"
              autoFocus
            />
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            ref={cancelBtnRef}
            onClick={onCancel}
            disabled={busy}
            className="font-bold"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={busy || !matches}
            className="font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:bg-rose-300"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
