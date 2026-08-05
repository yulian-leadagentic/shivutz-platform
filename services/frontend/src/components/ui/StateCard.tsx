'use client';

// G3 — one component for the three "no card content" states.
// Every list / table / detail-page in the app hand-rolled its own
// version of "loading spinner", "empty state", and "load error"
// (compare TenderList.emptyState vs AdsPage.error vs BillingPage
// loader — all functionally identical, styled slightly differently).
// Unifying them removes ~200 lines of ad-hoc markup and keeps the
// tone/spacing/icon size consistent across the app.
//
// Not a required import — pages that already have bespoke states
// can migrate opportunistically; new pages should reach for this
// first.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, AlertCircle, Inbox } from 'lucide-react';

type Tone = 'default' | 'error' | 'loading';

interface StateCardProps {
  tone?: Tone;
  icon?: ReactNode;           // override the tone default
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;            // if href → renders Link
    onClick?: () => void;     // otherwise button
  };
  /** compact = tighter padding for use inside a table's tbody */
  compact?: boolean;
}

const TONE_ICON = {
  default: <Inbox className="h-10 w-10 text-slate-200" />,
  error:   <AlertCircle className="h-10 w-10 text-red-400" />,
  loading: <Loader2 className="h-6 w-6 animate-spin text-slate-400" />,
};

export function StateCard({
  tone = 'default',
  icon,
  title,
  description,
  action,
  compact,
}: StateCardProps) {
  const pad = compact ? 'py-8 px-4' : 'py-12 px-4';
  return (
    <div className={`bg-white border border-slate-200 rounded-2xl flex flex-col items-center gap-3 text-center ${pad}`}>
      {icon ?? TONE_ICON[tone]}
      <p className={`font-medium ${tone === 'error' ? 'text-slate-700' : 'text-slate-600'}`}>{title}</p>
      {description && <p className="text-sm text-slate-400 max-w-md">{description}</p>}
      {action && (
        action.href ? (
          <Link
            href={action.href}
            className="mt-1 inline-flex items-center gap-1.5 bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1 inline-flex items-center gap-1.5 bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
