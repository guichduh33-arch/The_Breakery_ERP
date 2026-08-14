import { formatIdr } from '@breakery/utils';
import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface CurrencyProps {
  amount: number;
  className?: string;
  emphasis?: 'normal' | 'gold' | 'large';
  /**
   * Formatteur du montant. Défaut : `formatIdr` — id-ID (« Rp 35.000 ») depuis
   * l'arbitrage du 2026-08-13 (packages/utils/src/idr.ts) ; la mention en-US
   * qui vivait ici était antérieure à la bascule. Le back-office passe
   * `formatCurrency` (@breakery/utils). Prop additive : aucun call-site POS ne
   * change.
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
