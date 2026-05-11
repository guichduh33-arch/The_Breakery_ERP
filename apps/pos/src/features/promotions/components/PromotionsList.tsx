// apps/pos/src/features/promotions/components/PromotionsList.tsx
//
// Session 9 — render the current AppliedPromotion[] in the cart panel using
// the shared `<PromotionLineRow>` primitive. Sits between modifiers and
// discount in `<ActiveOrderPanel>`. Empty list → null (no header noise).
//
// Spec ref: 2026-05-10-session-9-promotions-spec.md §4.3, §4.4
import type { JSX } from 'react';
import type { AppliedPromotion } from '@breakery/domain';
import { PromotionLineRow } from '@breakery/ui';

export interface PromotionsListProps {
  applied: AppliedPromotion[];
  className?: string;
}

export function PromotionsList({ applied, className }: PromotionsListProps): JSX.Element | null {
  if (applied.length === 0) return null;
  return (
    <div className={className} data-testid="promotions-list">
      {applied.map((ap) => (
        <PromotionLineRow key={ap.promotion_id} applied={ap} />
      ))}
    </div>
  );
}
