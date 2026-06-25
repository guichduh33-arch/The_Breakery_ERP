// apps/pos/src/features/settings/components/BehaviorSettingsTab.tsx
//
// POS Settings → POS → Behavior. Per-terminal order-flow behavior, persisted in
// posSettingsStore. Today: the default order type a fresh cart starts on.
// Changing it updates the persisted default AND, when the current cart is empty,
// the live cart's order type immediately (so the change is visible without a
// reload). A cart with items is left untouched — the cashier's in-progress
// order type is never overridden.
import type { JSX } from 'react';
import { Card, SectionLabel, cn } from '@breakery/ui';
import { orderTypeLabel, type OrderType } from '@breakery/domain';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { useCartStore } from '@/stores/cartStore';

const ORDER_TYPES: readonly OrderType[] = ['dine_in', 'take_out', 'delivery'];

export function BehaviorSettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element {
  const defaultOrderType = usePosSettingsStore((s) => s.defaultOrderType);
  const setDefaultOrderType = usePosSettingsStore((s) => s.setDefaultOrderType);

  function choose(t: OrderType): void {
    setDefaultOrderType(t);
    // Apply live only when the cart is empty so we never override an
    // in-progress order. setOrderType is the cart's canonical mutator.
    const cart = useCartStore.getState().cart;
    const hasItems = cart.items.some((i) => !i.is_cancelled);
    if (!hasItems) useCartStore.getState().setOrderType(t);
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Card variant="default" padding="md" className="space-y-3">
        <div>
          <SectionLabel size="sm" as="h3" className="text-text-primary normal-case tracking-normal font-serif text-base">
            Default order type
          </SectionLabel>
          <p className="text-text-secondary text-xs mt-0.5">
            The order type a new sale starts on at this terminal. Applies to the
            next empty cart; an in-progress order is never changed.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Default order type"
          className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-base p-1"
        >
          {ORDER_TYPES.map((t) => {
            const active = defaultOrderType === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={readOnly}
                onClick={() => choose(t)}
                className={cn(
                  'px-4 h-9 rounded-md text-sm font-semibold transition-colors',
                  'disabled:opacity-50 disabled:pointer-events-none',
                  active ? 'bg-gold text-bg-base' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {orderTypeLabel(t)}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
