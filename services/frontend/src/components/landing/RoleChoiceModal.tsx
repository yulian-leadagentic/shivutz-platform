'use client';

import { useRouter } from 'next/navigation';
import { Users, Building2, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Two-button role-choice modal. Used by surfaces that need the
 * visitor's role before they can be sent to the right login path —
 * specifically the LiveShowcase card, which has one click target (the
 * card itself) but two possible destinations (contractor vs
 * corporation).
 *
 * Logged-in users never see this — callers should route them straight
 * to their dashboard instead.
 */
export function RoleChoiceModal({ open, onClose }: Props) {
  const router = useRouter();
  if (!open) return null;

  function pick(role: 'contractor' | 'corporation') {
    onClose();
    router.push(`/login?intent=${role}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 pb-3 border-b border-slate-100">
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-900 leading-tight">
              באיזה תפקיד תרצה להמשיך?
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">ניקח אותך למסך המתאים</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="h-8 w-8 inline-flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Two role tiles */}
        <div className="p-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => pick('contractor')}
            className="group flex flex-col items-center justify-center text-center bg-white hover:bg-brand-50/40 border-2 border-slate-200 hover:border-brand-400 rounded-2xl p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="h-10 w-10 rounded-xl bg-brand-100 flex items-center justify-center mb-2">
              <Users className="h-5 w-5 text-brand-600" />
            </div>
            <div className="text-base font-extrabold text-brand-600 leading-none mb-0.5">
              אני קבלן
            </div>
            <div className="text-[11px] text-slate-500 leading-snug">
              מחפש עובדים
            </div>
          </button>

          <button
            type="button"
            onClick={() => pick('corporation')}
            className="group flex flex-col items-center justify-center text-center bg-white hover:bg-navy-50/40 border-2 border-slate-200 hover:border-navy-400 rounded-2xl p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="h-10 w-10 rounded-xl bg-navy-100 flex items-center justify-center mb-2">
              <Building2 className="h-5 w-5 text-navy-600" />
            </div>
            <div className="text-base font-extrabold text-navy-600 leading-none mb-0.5">
              אני תאגיד
            </div>
            <div className="text-[11px] text-slate-500 leading-snug">
              מציע עובדים
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
