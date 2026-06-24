import type { JSX } from 'react';
import { ShoppingBag } from 'lucide-react';
import { Currency } from '@breakery/ui';
import { calculatePreview } from '@breakery/domain';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { TabletCheckoutButton } from './TabletCheckoutButton';

export function TabletCartPanel(): JSX.Element {
  const items = useTabletCartStore((s) => s.items);
  const tableNumber = useTabletCartStore((s) => s.tableNumber);
  const orderType = useTabletCartStore((s) => s.orderType);
  const updateQuantity = useTabletCartStore((s) => s.updateQuantity);
  const removeItem = useTabletCartStore((s) => s.removeItem);

  const preview = calculatePreview({ items, tableNumber, orderType });
  const isEmpty = items.length === 0;

  return (
    <aside className="w-[340px] shrink-0 bg-bg-elevated border-l border-border-subtle flex flex-col">
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
          <ul className="p-3 space-y-3">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 rounded-md bg-bg-input/40 p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-text-primary truncate">{item.name}</div>
                    {item.modifiers.length > 0 && (
                      <div className="text-xs text-text-muted">
                        {item.modifiers.map((m) => m.option_label).join(' · ')}
                      </div>
                    )}
                  </div>
                  {/* h-12/w-12 remove target — tablet-comfortable (LOT 6). */}
                  <button
                    className="h-12 w-12 shrink-0 grid place-items-center rounded-md bg-bg-input text-text-secondary hover:text-red-400 text-lg"
                    onClick={() => removeItem(item.id)}
                    aria-label={`Remove ${item.name}`}
                  >
                    ×
                  </button>
                </div>
                {/* Quantity stepper — 48px targets (LOT 6). The shared
                    @breakery/ui QuantityStepper is h-8 (desktop) and not
                    size-configurable, so this row uses h-12 buttons inline. */}
                <div className="flex items-center gap-2">
                  <button
                    className="h-12 w-12 grid place-items-center rounded-md bg-bg-input border border-border-subtle text-text-primary text-xl hover:bg-bg-overlay disabled:opacity-50"
                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    aria-label={`Decrease ${item.name}`}
                  >
                    −
                  </button>
                  <span className="min-w-10 text-center font-mono tabular-nums text-base">{item.quantity}</span>
                  <button
                    className="h-12 w-12 grid place-items-center rounded-md bg-bg-input border border-border-subtle text-text-primary text-xl hover:bg-bg-overlay"
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    aria-label={`Increase ${item.name}`}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!isEmpty && (
        <footer className="p-4 border-t border-border-subtle space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Items total</span>
              <Currency amount={preview.items_total} />
            </div>
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
