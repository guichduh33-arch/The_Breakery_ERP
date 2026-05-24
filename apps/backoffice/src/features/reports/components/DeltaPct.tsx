// apps/backoffice/src/features/reports/components/DeltaPct.tsx
//
// S29 Wave 5.1 — delta % indicator. Green if up, red if down, '—' if previous=0.

import { formatDelta } from '@breakery/domain';

export interface DeltaPctProps {
  current:  number;
  previous: number;
  /** Optional className override. */
  className?: string;
}

export function DeltaPct({ current, previous, className }: DeltaPctProps): JSX.Element {
  const { pct, sign } = formatDelta(current, previous);
  if (pct === null) {
    return <span className={`text-xs text-text-secondary ${className ?? ''}`} data-testid="delta-pct">—</span>;
  }
  const color = sign > 0 ? 'text-green-600' : sign < 0 ? 'text-red-600' : 'text-text-secondary';
  const signStr = sign > 0 ? '+' : '';
  return (
    <span className={`text-xs ${color} ${className ?? ''}`} data-testid="delta-pct">
      {signStr}{(pct * 100).toFixed(1)}%
    </span>
  );
}
