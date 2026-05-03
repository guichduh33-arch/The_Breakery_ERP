import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-gold text-bg-base',
        secondary: 'border-transparent bg-bg-overlay text-text-secondary',
        destructive: 'border-transparent bg-red text-white',
        outline: 'text-text-primary border-border-subtle',
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
