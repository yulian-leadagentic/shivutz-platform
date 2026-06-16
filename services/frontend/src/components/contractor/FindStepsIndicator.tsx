import { Check, Hammer, FileText, Sparkles } from 'lucide-react';

interface Props {
  /** 1 = profession, 2 = details, 3 = AI matching. */
  active: 1 | 2 | 3;
}

const STEPS = [
  { num: 1, label: 'בחירת מקצוע',           icon: Hammer },
  { num: 2, label: 'פרטים נוספים',          icon: FileText },
  { num: 3, label: 'סוכן AI עובד בשבילך',  icon: Sparkles },
] as const;

export function FindStepsIndicator({ active }: Props) {
  return (
    <ol className="flex items-center justify-between gap-2 mb-6 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
      {STEPS.map((s, idx) => {
        const Icon = s.icon;
        const isDone   = s.num < active;
        const isActive = s.num === active;
        return (
          <li key={s.num} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : isActive
                      ? 'bg-brand-500 text-white shadow-md ring-4 ring-brand-100'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {isDone ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </div>
              <span
                className={`text-[11px] sm:text-xs font-medium text-center leading-tight ${
                  isActive ? 'text-brand-700' : isDone ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                <span className="hidden sm:inline">שלב {s.num} — </span>
                {s.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 sm:mx-2 -mt-5 ${
                  s.num < active ? 'bg-emerald-400' : 'bg-slate-200'
                }`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
