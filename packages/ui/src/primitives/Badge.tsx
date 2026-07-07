import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-gold text-gold-fg',
        // Neutral pills use surface-4 (a visible step in BOTH themes) — NOT
        // bg-overlay, which collapses to #fff on the ivoire card and renders
        // an invisible white-on-white pill (design audit 2026-07-08, BO F1).
        secondary: 'border-transparent bg-surface-4 text-text-secondary',
        // Destructive is tonal like the other semantic chips — white on the
        // saturated red-base fails AA on the POS (~3.8:1); soft bg + red-fg
        // passes under both themes (design audit 2026-07-08, DS B1/T1).
        destructive: 'border-transparent bg-red-soft text-red-fg',
        outline: 'text-text-primary border-border-subtle',
        // Semantic tonal variants (design audit 2026-07-07, DS I-3) — the
        // canonical status chips. Soft token bg + full-strength token text
        // renders correctly under BOTH themes (luxe-dark and ivoire), so
        // screens stop re-inventing pills from raw Tailwind palette.
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        info: 'border-transparent bg-info-soft text-info',
        neutral: 'border-transparent bg-surface-4 text-text-secondary',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
