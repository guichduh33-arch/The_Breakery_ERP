// apps/backoffice/src/features/reports/components/VarianceLegend.tsx
//
// Lot B (campagne Reports 2026-08-15) — la légende qui accompagne tout barème
// de variance (`varianceScale.ts`). Un signal de couleur sans légende est un
// code privé : chaque page qui teinte une cellule pose cette légende, avec des
// libellés qui NOMMENT les seuils (« > 15 % off target »), pas des adjectifs.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import { VARIANCE_TONE_CELL, type VarianceTone } from '../utils/varianceScale.js';

export interface VarianceLegendItem {
  tone:  VarianceTone;
  label: string;
}

export function VarianceLegend({ items, className }: {
  items: VarianceLegendItem[];
  className?: string;
}): JSX.Element {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)} data-testid="variance-legend">
      {items.map((item) => (
        <li key={`${item.tone}-${item.label}`} className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span
            className={cn(
              'inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-sm border border-border-subtle px-1',
              VARIANCE_TONE_CELL[item.tone],
            )}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
