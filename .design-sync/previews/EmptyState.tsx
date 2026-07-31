import { Button, EmptyState } from '@breakery/ui';
import { PackageOpen, Search } from 'lucide-react';

// Canonical md empty state — Lucide icon + Playfair-italic title + CTA object
// (renders the gold primary button).
export const NoOrders = () => (
  <div className="bg-bg-base rounded-lg w-96">
    <EmptyState
      icon={PackageOpen}
      title="No orders yet"
      description="Orders placed on this terminal will appear here as soon as the first sale is rung up."
      action={{ label: 'New order', onClick: () => {} }}
    />
  </div>
);

// Branded tone — no icon, BrandMark takes its place. Large size.
export const BrandedLarge = () => (
  <div className="bg-bg-base rounded-lg w-96">
    <EmptyState
      tone="branded"
      size="lg"
      title="The shelf is bare"
      description="No products match this category. Add croissants, breads or drinks from the back office to fill the display."
    />
  </div>
);

// Small — inline slot inside a panel; custom ReactNode action (ghost button).
export const SmallSearchMiss = () => (
  <div className="bg-bg-base rounded-lg w-80">
    <EmptyState
      size="sm"
      icon={Search}
      title="No results for “kouign”"
      description="Check the spelling or search by SKU."
      action={<Button variant="ghost">Clear search</Button>}
    />
  </div>
);
