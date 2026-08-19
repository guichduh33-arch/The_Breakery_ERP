import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // `border-strong`, pas `border-subtle` : la bordure d'un champ est la
          // limite d'un contrôle, soumise aux 3:1 de WCAG 1.4.11 — le même
          // arbitrage que le bouton secondaire (2026-08-18). `border-subtle`
          // valait 1,31:1 sur la feuille blanche : le champ n'avait pas de
          // limite visible. Arbitré par Mamat le 2026-08-19, les deux apps.
          'flex h-touch-min w-full rounded-md border border-border-strong bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
