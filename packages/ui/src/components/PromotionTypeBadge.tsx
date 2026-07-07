// packages/ui/src/components/PromotionTypeBadge.tsx
//
// Color-coded badge showing the promotion type. Used in backoffice list and
// (eventually) POS PromotionLineRow / cart panel summaries.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §4.2

import type { JSX } from 'react';
import type { PromotionType } from '@breakery/domain';
import { cn } from '../lib/cn.js';

export type { PromotionType };

export interface PromotionTypeBadgeProps {
  type: PromotionType;
  className?: string;
}

const TYPE_LABEL: Record<PromotionType, string> = {
  percentage: '% off',
  fixed_amount: 'IDR off',
  bogo: 'BOGO',
  free_product: 'Free gift',
  // Session 13 / Phase 2.C
  threshold: 'Threshold',
  bundle: 'Bundle',
};

// Hue mapping per spec §4.2 (+ Phase 2.C cyan/violet for new shapes):
// percentage=indigo, fixed=amber, bogo=emerald, free_product=rose,
// threshold=cyan, bundle=violet. Design audit 2026-07-07 (DS I-2) — served
// by the theme-aware categorical ramp (`cat-*`) instead of dark-locked
// Tailwind shades, so the badge reads on the ivory Backoffice too.
const TYPE_CLASSES: Record<PromotionType, string> = {
  percentage: 'bg-cat-indigo/15 text-cat-indigo border-cat-indigo/30',
  fixed_amount: 'bg-cat-amber/15 text-cat-amber border-cat-amber/30',
  bogo: 'bg-cat-emerald/15 text-cat-emerald border-cat-emerald/30',
  free_product: 'bg-cat-rose/15 text-cat-rose border-cat-rose/30',
  threshold: 'bg-cat-cyan/15 text-cat-cyan border-cat-cyan/30',
  bundle: 'bg-cat-violet/15 text-cat-violet border-cat-violet/30',
};

export function PromotionTypeBadge({
  type,
  className,
}: PromotionTypeBadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        TYPE_CLASSES[type],
        className,
      )}
      data-promotion-type={type}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}
