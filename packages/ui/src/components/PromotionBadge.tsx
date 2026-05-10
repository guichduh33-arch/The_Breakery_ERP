// packages/ui/src/components/PromotionBadge.tsx
// Spec ref: docs/superpowers/specs/2026-05-07-session-8-promotions-engine-spec.md
import type { JSX } from 'react';

export interface PromotionBadgeProps {
  promotionName: string;
  discountAmount: number;
  isFree: boolean;
}

export function PromotionBadge({
  promotionName,
  discountAmount: _amount,
  isFree,
}: PromotionBadgeProps): JSX.Element {
  const label = isFree ? `${promotionName} FREE` : `${promotionName}`;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green/20 text-green">
      {label}
    </span>
  );
}
