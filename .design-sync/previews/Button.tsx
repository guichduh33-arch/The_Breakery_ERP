import { Button } from '@breakery/ui';

// The 7 CVA variants — primary (green) and gold are the two money actions,
// the rest are chrome/secondary affordances.
export const AllVariants = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-wrap items-center gap-3">
    <Button variant="primary">Charge Rp 86.000</Button>
    <Button variant="gold">Open shift</Button>
    <Button variant="secondary">Hold order</Button>
    <Button variant="outlineGold">Apply discount</Button>
    <Button variant="ghost">Clear cart</Button>
    <Button variant="ghostDestructive">Void item</Button>
    <Button variant="link">View receipt</Button>
  </div>
);

// Size ramp — sm / md (touch-comfy default) / lg (touch-large) / icon.
export const Sizes = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-wrap items-end gap-3">
    <Button size="sm" variant="secondary">
      Edit
    </Button>
    <Button size="md">Add to cart</Button>
    <Button size="lg" variant="gold">
      Pay Rp 124.000
    </Button>
    <Button size="icon" variant="secondary" aria-label="Increase quantity">
      +
    </Button>
  </div>
);

// Disabled — opacity-50 + pointer-events-none across the two main variants.
export const Disabled = () => (
  <div className="bg-bg-base p-6 rounded-lg flex flex-wrap items-center gap-3">
    <Button disabled>Charge Rp 0</Button>
    <Button disabled variant="gold">
      Close shift
    </Button>
    <Button disabled variant="secondary">
      Print ticket
    </Button>
  </div>
);
