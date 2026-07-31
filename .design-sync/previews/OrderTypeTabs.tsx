import { OrderTypeTabs } from '@breakery/ui';

const noop = () => {};

// The order-type switcher at the top of the cart panel — each selection state
// shown (gold-soft active tab with gold border).
export const SelectionStates = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-4 w-96">
    <OrderTypeTabs value="dine_in" onChange={noop} />
    <OrderTypeTabs value="take_out" onChange={noop} />
    <OrderTypeTabs value="delivery" onChange={noop} />
  </div>
);

// In context — cart panel header: order number + tabs, the composition the
// cashier sees when starting an order.
export const InCartHeader = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-3 w-96">
    <div className="flex items-center justify-between">
      <span className="font-serif text-lg text-text-primary">Current order</span>
      <span className="font-mono text-sm text-text-secondary">#A-0217</span>
    </div>
    <OrderTypeTabs value="dine_in" onChange={noop} />
    <p className="text-xs text-text-muted">Table 6 — Pak Budi, 2 guests</p>
  </div>
);
