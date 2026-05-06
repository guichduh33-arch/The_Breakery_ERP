// apps/pos/src/features/promotions/components/PromotionsSummary.tsx
import { PromotionLineRow } from '@breakery/ui';
import { useCartStore } from '@/stores/cartStore';

export function PromotionsSummary() {
  const applied = useCartStore((s) => s.appliedPromotion);
  if (!applied) return null;
  return (
    <div className="border-t border-border-subtle pt-2">
      <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Promotions</div>
      <PromotionLineRow name={applied.name} discount_amount={applied.discount_amount} />
    </div>
  );
}
