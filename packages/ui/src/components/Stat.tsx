// packages/ui/src/components/Stat.tsx
//
// Stat — inline label + value pair, no card chrome.
//
// Where KpiTile is the big-tile pattern, Stat is the inline "Active Orders: 12"
// snippet used in headers, status bars, and stat rows under product cards.
//
// `direction`:
//   - 'horizontal' (default): label on the left, value on the right, aligned
//     on the same baseline. Suits status bars / inline metrics.
//   - 'vertical' : label on top, value below. Suits stat rows / sidebar facts.
//
// Both directions use SectionLabel for the label so the tracking-widest
// signature is preserved.

import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { SectionLabel } from './SectionLabel.js';

export type StatDirection = 'horizontal' | 'vertical';

export interface StatProps {
  label: string;
  value: ReactNode;
  /** Layout direction. Default 'horizontal'. */
  direction?: StatDirection;
  /** Optional value emphasis (gold accent). */
  emphasis?: 'normal' | 'gold';
  className?: string;
}

export function Stat({
  label,
  value,
  direction = 'horizontal',
  emphasis = 'normal',
  className,
}: StatProps): JSX.Element {
  const isHorizontal = direction === 'horizontal';
  return (
    <div
      className={cn(
        isHorizontal ? 'flex items-baseline justify-between gap-2' : 'flex flex-col gap-1',
        className,
      )}
    >
      <SectionLabel as="div" size="xs">{label}</SectionLabel>
      <span
        className={cn(
          'font-mono tabular-nums text-text-primary text-sm',
          emphasis === 'gold' && 'text-gold',
        )}
      >
        {value}
      </span>
    </div>
  );
}
