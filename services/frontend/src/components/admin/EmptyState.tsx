import { type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  /** Lucide icon (or any svg/element). Renders inside a soft
   *  rounded square. */
  icon: LucideIcon;
  /** Big headline — what the empty list IS. */
  title: string;
  /** Optional sub-line. Explains WHY it's empty, or what to do
   *  next. Keep one sentence. */
  description?: string;
  /** Optional CTA — pass any element (typically a <Button> or
   *  <Link>). Rendered below the description. */
  cta?: React.ReactNode;
  /** "subtle" (default) — used inline inside a card. "card" — used
   *  when there's no surrounding card and the empty state IS the
   *  whole region. */
  variant?: 'subtle' | 'card';
}

// QA-R5 — single empty-state primitive for admin lists. Previously
// every page rendered its own empty:
//   /admin/leads      → custom Inbox + headline + body
//   /admin/deals      → bare "אין עסקאות תואמות לסינון"
//   /admin/dashboard  → bare "אין נתונים"
//   /admin/orgs       → bare "לא נמצאו ארגונים"
// Now everything routes through one component so empty states read
// the same across the surface.
export function EmptyState({
  icon: Icon,
  title,
  description,
  cta,
  variant = 'subtle',
}: EmptyStateProps) {
  const containerCls = variant === 'card'
    ? 'rounded-2xl border border-slate-200 bg-white shadow-sm py-12 px-6'
    : 'py-10 px-4';
  return (
    <div className={`${containerCls} flex flex-col items-center text-center text-slate-500`}>
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
        <Icon className="h-7 w-7 text-slate-400" aria-hidden />
      </div>
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {description && (
        <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">{description}</p>
      )}
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
