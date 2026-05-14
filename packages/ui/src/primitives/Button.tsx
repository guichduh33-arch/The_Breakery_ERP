import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors duration-fast motion-reduce:transition-none motion-reduce:duration-0 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
  {
    variants: {
      variant: {
        primary: 'bg-green hover:bg-green-hover text-white uppercase tracking-wide rounded-md',
        gold: 'bg-gold hover:bg-gold-hover text-bg-base uppercase tracking-wide rounded-md',
        secondary: 'bg-bg-overlay border border-border-subtle text-text-primary hover:bg-bg-input rounded-md',
        outlineGold: 'bg-transparent border border-gold text-gold hover:bg-gold-soft uppercase tracking-wide rounded-md',
        ghost: 'bg-transparent text-text-primary hover:bg-bg-overlay rounded-md',
        ghostDestructive: 'bg-transparent text-red hover:bg-red-soft rounded-md',
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
