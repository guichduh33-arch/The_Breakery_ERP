// apps/backoffice/src/features/products/components/ProductTypeBadge.tsx
//
// Session 14 / Phase 4.B — Pill badge that mirrors the screenshot family
// (`product page.jpg`): a small colored chip with an icon for each product
// kind. Uses design tokens only — no hardcoded colors.

import { Box, Coffee, Package, Sparkles } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { cn } from '@breakery/ui';
import type { ProductTypeFilter } from '../types.js';

interface Props {
  type: ProductTypeFilter;
}

const META: Record<Exclude<ProductTypeFilter, 'all'>, { label: string; icon: ReactNode; tone: string }> = {
  finished: {
    label: 'Finished Product',
    icon: <Coffee className="h-3 w-3" aria-hidden />,
    tone: 'bg-bg-overlay text-text-primary border-border-subtle',
  },
  'semi-finished': {
    label: 'Semi-Finished',
    icon: <Box className="h-3 w-3" aria-hidden />,
    tone: 'bg-gold-soft text-gold border-transparent',
  },
  raw: {
    label: 'Raw Material',
    icon: <Package className="h-3 w-3" aria-hidden />,
    tone: 'bg-red-soft text-red border-transparent',
  },
  combo: {
    label: 'Combo',
    icon: <Sparkles className="h-3 w-3" aria-hidden />,
    tone: 'bg-bg-overlay text-text-primary border-border-subtle',
  },
};

export function ProductTypeBadge({ type }: Props): JSX.Element | null {
  if (type === 'all') return null;
  const m = META[type];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        m.tone,
      )}
    >
      {m.icon}
      {m.label}
    </span>
  );
}
