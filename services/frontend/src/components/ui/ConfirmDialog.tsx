'use client';

// In-app replacement for the browser-native `confirm()` which prefixes
// the message with "localhost:3008 says" and can't be styled. RTL-aware,
// ESC + backdrop click close, focus lands on the confirm button.

import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Variant = 'destructive' | 'primary';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'אישור',
  cancelLabel  = 'ביטול',
  variant      = 'destructive',
  busy         = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  // ESC closes; auto-focus the confirm button when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && !busy) onConfirm();
    };
    document.addEventListener('keydown', onKey);
    confirmBtnRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;

  const confirmCls = variant === 'destructive'
    ? 'bg-rose-600 hover:bg-rose-700 text-white'
    : 'bg-slate-900 hover:bg-slate-800 text-white';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-start gap-2.5">
            {variant === 'destructive' && (
              <div className="shrink-0 w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
            )}
            {title && (
              <h2 className="text-base font-bold text-slate-900 mt-1">{title}</h2>
            )}
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

        <div className="px-5 py-4">
          <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
            className="font-bold"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            ref={confirmBtnRef}
            onClick={onConfirm}
            disabled={busy}
            className={`font-bold ${confirmCls}`}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
