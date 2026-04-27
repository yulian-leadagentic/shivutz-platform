import { Check, X as XIcon } from 'lucide-react';

export function CompareCell({
  requested, found, match, label,
}: {
  requested: string;
  found: string;
  match: 'ok' | 'mismatch' | 'none';
  label?: string;
}) {
  if (match === 'none') return <span className="text-slate-700">{found}</span>;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        {match === 'ok'
          ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          : <XIcon  className="h-3.5 w-3.5 text-red-500   shrink-0" />}
        <span className={match === 'ok' ? 'text-slate-700' : 'text-slate-800 font-medium'}>
          {found}
        </span>
      </div>
      {match === 'mismatch' && (
        <div className="text-[10px] text-slate-400 ps-4">
          {label && `${label}: `}
          <span className="text-amber-600 font-medium">{requested}</span>
        </div>
      )}
    </div>
  );
}
