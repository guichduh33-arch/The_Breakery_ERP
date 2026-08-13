import { formatIdr } from '@breakery/utils';
import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface CurrencyProps {
  amount: number;
  className?: string;
  emphasis?: 'normal' | 'gold' | 'large';
  /**
   * Formatteur du montant. Défaut : `formatIdr` (en-US, la convention POS).
   * Le back-office passe `formatCurrency` (@breakery/utils, id-ID) — audit
   * UX/UI 2026-08-13, lot 1. Prop additive : aucun call-site POS ne change.
   */
  format?: (amount: number) => string;
}

export function Currency({
  amount,
  className,
  emphasis = 'normal',
  format = formatIdr,
}: CurrencyProps): JSX.Element {
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        emphasis === 'gold' && 'text-gold',
        emphasis === 'large' && 'text-3xl font-semibold',
        className,
      )}
    >
      {format(amount)}
    </span>
  );
}
