// packages/ui/src/primitives/Card.tsx
//
// Card — canonical card primitive. Used across POS, BO, KDS, Tablet.
//
// Session 14 (Phase 1.A): added `variant` ('default' | 'elevated' | 'inset')
// and `padding` ('none' | 'sm' | 'md' | 'lg') props so callers compose card
// chrome without per-call className boilerplate. Backwards compatible — the
// session-13 sub-parts (CardHeader / CardTitle / CardDescription / CardContent
// / CardFooter) are preserved exactly.
//
// Theme awareness: the card uses --bg-elevated / --border-subtle /
// --text-primary which are remapped per-theme in colors.css. `.theme-pos`
// gets the dark elevated panel; `.theme-backoffice` gets the white-on-cream
// card. No per-component conditionals needed.

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const cardVariants = cva(
  'rounded-lg text-text-primary motion-safe:transition-shadow duration-base ease-motion-out',
  {
    variants: {
      variant: {
        default:  'border border-border-subtle bg-bg-elevated shadow-sm',
        elevated: 'border border-border-subtle bg-bg-elevated shadow-md hover:shadow-lg',
        inset:    'border border-border-muted bg-bg-base shadow-inset-sm',
      },
      padding: {
        none: '',
        sm:   'p-4',
        md:   'p-6',
        lg:   'p-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      padding: 'none',
    },
  },
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, padding }), className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('font-serif text-xl font-semibold leading-tight tracking-tight text-text-primary', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-text-secondary', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
};
