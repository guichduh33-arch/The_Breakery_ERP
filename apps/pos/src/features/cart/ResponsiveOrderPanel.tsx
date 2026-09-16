import { calculateTotals } from '@breakery/domain';
import { AdaptiveCartPanel } from '@/components/AdaptiveCartPanel';
import { useCartStore } from '@/stores/cartStore';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';
import { ActiveOrderPanel } from './ActiveOrderPanel';

export function ResponsiveOrderPanel({ onDetachCustomer }: { onDetachCustomer: () => void }) {
  const cart = useCartStore((s) => s.cart);
  const { taxRate, taxInclusive } = useTaxConfig();
  const totals = calculateTotals(cart, taxRate, taxInclusive);
  return <AdaptiveCartPanel count={totals.item_count} total={totals.total}>
    <ActiveOrderPanel onDetachCustomer={onDetachCustomer} />
  </AdaptiveCartPanel>;
}
