import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-900',
        outline:
          'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 hover:border-slate-400',
        ghost: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
        destructive: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
        secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
        link: 'text-brand-600 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 rounded-md px-3 text-xs',
        md: 'h-10 px-4 py-2',
        lg: 'h-12 rounded-md px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
