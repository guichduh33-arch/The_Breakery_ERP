import type { JSX } from 'react';
import { useEffect } from 'react';
import { ShoppingBag } from 'lucide-react';
import { Currency, FreeItemRow } from '@breakery/ui';
import { calculatePreview } from '@breakery/domain';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useProducts } from '@/features/products/hooks/useProducts';
import { useTabletEvaluatePromotionsLive } from '../hooks/useTabletEvaluatePromotionsLive';
import { TabletCheckoutButton } from './TabletCheckoutButton';
import { TabletPromotionsSummary } from './TabletPromotionsSummary';

function useTabletPromotionsPreview(): void {
  const result = useTabletEvaluatePromotionsLive();
  const setApplied = useTabletCartStore((s) => s.setAppliedPromotion);
  const setPreview = useTabletCartStore((s) => s.setPreviewItems);

  useEffect(() => {
    if (!result) return;
    setApplied(result.applied_promotion);
    setPreview(result.applied_promotion?.items_to_add ?? []);
  }, [result, setApplied, setPreview]);
}

export function TabletCartPanel(): JSX.Element {
  useTabletPromotionsPreview();

  const items = useTabletCartStore((s) => s.items);
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  const orderType = useTabletCartStore((s) => s.orderType);
  const updateQuantity = useTabletCartStore((s) => s.updateQuantity);
  const removeItem = useTabletCartStore((s) => s.removeItem);
  const previewItems = useTabletCartStore((s) => s.previewItems);
  const appliedPromotion = useTabletCartStore((s) => s.appliedPromotion);
  const { data: products = [] } = useProducts();

  const preview = calculatePreview({ items, tableNumber, orderType });
  const isEmpty = items.length === 0;

  return (
    <aside className="w-[300px] bg-bg-elevated border-l border-border-subtle flex flex-col">
      <header className="p-4 border-b border-border-subtle">
        <h2 className="text-xs uppercase tracking-widest font-semibold text-text-primary">Order</h2>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="h-full grid place-items-center text-text-muted">
            <div className="text-center space-y-2">
              <ShoppingBag className="h-12 w-12 mx-auto opacity-50" aria-hidden />
              <div className="text-sm uppercase tracking-widest">Empty</div>
            </div>
          </div>
        ) : (
          <>
            <ul className="p-3 space-y-2">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary truncate">{item.name}</div>
                    {item.modifiers.length > 0 && (
                      <div className="text-xs text-text-muted">
                        {item.modifiers.map((m) => m.option_label).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="w-6 h-6 rounded bg-bg-input text-text-secondary hover:text-text-primary"
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      aria-label={`Decrease ${item.name}`}
                    >
                      −
                    </button>
                    <span className="w-5 text-center font-mono">{item.quantity}</span>
                    <button
                      className="w-6 h-6 rounded bg-bg-input text-text-secondary hover:text-text-primary"
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                      aria-label={`Increase ${item.name}`}
                    >
                      +
                    </button>
                    <button
                      className="w-6 h-6 rounded bg-bg-input text-text-secondary hover:text-red-400 ml-1"
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.name}`}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {previewItems.filter((i) => !i.split_from_existing).map((i) => {
              const productName = products.find((p) => p.id === i.product_id)?.name ?? i.product_id;
              return (
                <div key={i.product_id} className="px-3 py-2">
                  <FreeItemRow
                    productName={productName}
                    promotionName={appliedPromotion?.name ?? ''}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>

      {!isEmpty && (
        <footer className="p-4 border-t border-border-subtle space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Items total</span>
              <Currency amount={preview.items_total} />
            </div>
            <TabletPromotionsSummary />
            <div className="flex justify-between text-text-secondary">
              <span>Tax incl. (10%)</span>
              <Currency amount={preview.tax_amount} />
            </div>
            <div className="flex justify-between pt-2 border-t border-border-subtle">
              <span className="uppercase tracking-wide font-semibold">Est. Total</span>
              <Currency amount={preview.items_total} emphasis="gold" className="text-lg" />
            </div>
          </div>
          <TabletCheckoutButton />
        </footer>
      )}
    </aside>
  );
}
