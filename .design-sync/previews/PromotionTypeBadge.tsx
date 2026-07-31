import { PromotionTypeBadge } from '@breakery/ui';

// The six promotion shapes on the categorical ramp (indigo/amber/emerald/
// rose/cyan/violet) — the full backoffice promotions-list legend.
export const AllTypes = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-wrap items-center gap-2 w-96">
    <PromotionTypeBadge type="percentage" />
    <PromotionTypeBadge type="fixed_amount" />
    <PromotionTypeBadge type="bogo" />
    <PromotionTypeBadge type="free_product" />
    <PromotionTypeBadge type="threshold" />
    <PromotionTypeBadge type="bundle" />
  </div>
);

// In context — promotions list rows pairing name + type chip.
export const InPromotionList = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-col gap-3 w-96">
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-text-primary">Morning Set — croissant + kopi</span>
        <span className="text-xs text-text-muted">Weekdays 07:00–10:00</span>
      </div>
      <PromotionTypeBadge type="bundle" />
    </div>
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-text-primary">Buy 2 baguettes, get 1 free</span>
        <span className="text-xs text-text-muted">Ends after closing bake</span>
      </div>
      <PromotionTypeBadge type="bogo" />
    </div>
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-text-primary">Spend Rp 150,000 → Rp 15,000 off</span>
        <span className="text-xs text-text-muted">Cart subtotal threshold</span>
      </div>
      <PromotionTypeBadge type="threshold" />
    </div>
  </div>
);
