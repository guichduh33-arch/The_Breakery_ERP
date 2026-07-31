import { Currency } from '@breakery/ui';

// Mono tabular amounts — zero, small, typical ticket, daily-revenue millions,
// negative (refund). All right-aligned to show tabular-nums lining up.
export const AmountRange = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80 flex flex-col gap-2 text-sm text-text-primary">
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">Open balance</span>
      <Currency amount={0} />
    </div>
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">Espresso</span>
      <Currency amount={18000} />
    </div>
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">Croissant au beurre</span>
      <Currency amount={28000} />
    </div>
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">Refund — order A-0139</span>
      <Currency amount={-56000} className="text-danger" />
    </div>
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">Revenue today</span>
      <Currency amount={4850000} />
    </div>
  </div>
);

// Emphasis variants — normal, gold accent, large (payment-screen total).
// Currency inherits its color — the envelope provides text-text-primary,
// exactly like app screens do.
export const Emphasis = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80 flex flex-col gap-4 text-text-primary">
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-text-secondary">Subtotal</span>
      <Currency amount={88000} />
    </div>
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-text-secondary">Loyalty credit</span>
      <Currency amount={10000} emphasis="gold" />
    </div>
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-text-secondary">Total due</span>
      <Currency amount={78000} emphasis="large" />
    </div>
  </div>
);
