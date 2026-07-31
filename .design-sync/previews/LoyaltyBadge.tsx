import { LoyaltyBadge } from '@breakery/ui';

// The four loyalty tiers as they appear next to a customer name at the POS —
// bronze/silver/gold/platinum tints are theme-aware semantic tokens.
export const AllTiers = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-wrap items-center gap-3 w-80">
    <LoyaltyBadge tier="bronze" points={320} />
    <LoyaltyBadge tier="silver" points={1450} />
    <LoyaltyBadge tier="gold" points={5280} />
    <LoyaltyBadge tier="platinum" points={12750} />
  </div>
);

// In context — customer header row during checkout, large balance exercises
// the thousands separator in the mono points counter.
export const CustomerRow = () => (
  <div className="bg-bg-base p-6 rounded-lg flex items-center justify-between gap-4 w-96">
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text-primary">Ibu Sari Dewi</span>
      <span className="text-xs text-text-muted">Member since 2024 · 62 visits</span>
    </div>
    <LoyaltyBadge tier="gold" points={5280} />
  </div>
);
