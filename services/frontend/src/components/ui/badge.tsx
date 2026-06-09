import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-primary-100 text-primary-700',
        secondary:   'bg-slate-100 text-slate-600',
        success:     'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60',
        warning:     'bg-amber-50 text-amber-700 ring-1 ring-amber-200/60',
        destructive: 'bg-red-50 text-red-700 ring-1 ring-red-200/60',
        purple:      'bg-navy-50 text-navy-700 ring-1 ring-navy-200/60',
        blue:        'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60',
        outline:     'border border-slate-200 text-slate-600 bg-white',
        // QA-R5 cross-app deal status palette. Maps directly to the
        // STATE_META / DEAL_STATUS_PILL colours on /contractor/deals
        // so a status reads the same colour everywhere it appears.
        sky:         'bg-sky-50 text-sky-700 ring-1 ring-sky-200/60',
        yellow:      'bg-yellow-50 text-yellow-900 ring-1 ring-yellow-300/60',
        orange:      'bg-orange-50 text-orange-700 ring-1 ring-orange-200/60',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
