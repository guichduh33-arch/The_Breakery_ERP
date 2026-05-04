import { formatIdr } from '@breakery/utils';
import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface CurrencyProps {
  amount: number;
  className?: string;
  emphasis?: 'normal' | 'gold' | 'large';
}

export function Currency({ amount, className, emphasis = 'normal' }: CurrencyProps): JSX.Element {
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        emphasis === 'gold' && 'text-gold',
        emphasis === 'large' && 'text-3xl font-semibold',
        className,
      )}
    >
      {formatIdr(amount)}
    </span>
  );
}
