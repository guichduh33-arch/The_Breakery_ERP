import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-fast ease-motion-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:duration-0 motion-reduce:active:scale-100 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold focus-visible:shadow-focus',
  {
    variants: {
      variant: {
        // Filled and outlined variants neutralise their colour when disabled
        // instead of only fading it: `opacity-50` over a saturated green or
        // gold still reads as a live, tappable button (design audit 2026-08-04
        // — three Backoffice forms whose primary action looked clickable while
        // it was not). The flat variants below stay on the base opacity, which
        // is legible enough on an already neutral surface.
        primary: 'bg-green hover:bg-green-hover text-green-fg uppercase tracking-wide rounded-md disabled:bg-surface-4 disabled:text-text-muted disabled:opacity-100',
        // Audit UX/UI 2026-08-13 (lot 5) — l'action primaire du Backoffice est
        // ENCRE, en casse de phrase (doctrine toolbarButton.ts) ; variant
        // additif, le POS garde `primary` vert.
        ink: 'bg-ink hover:bg-ink-hover text-ink-fg rounded-md disabled:bg-surface-4 disabled:text-text-muted disabled:opacity-100',
        gold: 'bg-gold hover:bg-gold-hover text-gold-fg uppercase tracking-wide rounded-md disabled:bg-surface-4 disabled:text-text-muted disabled:opacity-100',
        secondary: 'bg-bg-overlay border border-border-subtle text-text-primary hover:bg-bg-input rounded-md',
        outlineGold: 'bg-transparent border border-gold text-gold hover:bg-gold-soft uppercase tracking-wide rounded-md disabled:border-border-subtle disabled:text-text-muted disabled:opacity-100',
        ghost: 'bg-transparent text-text-primary hover:bg-bg-overlay rounded-md',
        ghostDestructive: 'bg-transparent text-red-as-text hover:bg-red-soft rounded-md',
        link: 'text-gold underline-offset-4 hover:underline bg-transparent',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-touch-comfy px-4 text-sm',
        lg: 'h-touch-large px-6 text-base',
        icon: 'h-touch-comfy w-touch-comfy',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
