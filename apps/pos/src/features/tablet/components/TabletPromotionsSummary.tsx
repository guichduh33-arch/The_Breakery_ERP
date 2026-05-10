// apps/pos/src/features/tablet/components/TabletPromotionsSummary.tsx
// Reads applied promotion from tabletCartStore instead of the POS cartStore.
// Layout mirrors PromotionsSummary from apps/pos/src/features/promotions/components/PromotionsSummary.tsx.
import { PromotionLineRow } from '@breakery/ui';
import { useTabletCartStore } from '@/stores/tabletCartStore';

export function TabletPromotionsSummary() {
  const applied = useTabletCartStore((s) => s.appliedPromotion);
  if (!applied) return null;
  return (
    <div className="border-t border-border-subtle pt-2">
      <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Promotions</div>
      <PromotionLineRow name={applied.name} discount_amount={applied.discount_amount} />
    </div>
  );
}
