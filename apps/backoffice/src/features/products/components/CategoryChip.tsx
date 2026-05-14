// apps/backoffice/src/features/products/components/CategoryChip.tsx
//
// Session 14 / Phase 4.B — Tinted category chip (e.g. "Coffee", "SFG",
// "HASIL BOHEMI"). The colour rotates over a small palette so visually
// adjacent categories are distinguishable. Uses semantic tokens only.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';

interface Props {
  name: string;
  className?: string;
}

const PALETTE = [
  'bg-gold-soft text-gold',
  'bg-red-soft text-red',
  'bg-green-soft text-green',
  'bg-bg-overlay text-text-primary',
] as const;

export function CategoryChip({ name, className }: Props): JSX.Element {
  // Stable hash so a given name always lands on the same color.
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  const tone = PALETTE[h % PALETTE.length] ?? PALETTE[0];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        tone,
        className,
      )}
    >
      {name}
    </span>
  );
}
