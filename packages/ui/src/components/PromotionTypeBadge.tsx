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

// Tailwind palette per spec §4.2 (+ Phase 2.C cyan/violet for new shapes):
// percentage=indigo, fixed=amber, bogo=emerald, free_product=rose,
// threshold=cyan, bundle=violet.
const TYPE_CLASSES: Record<PromotionType, string> = {
  percentage: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  fixed_amount: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  bogo: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  free_product: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  threshold: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  bundle: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
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
