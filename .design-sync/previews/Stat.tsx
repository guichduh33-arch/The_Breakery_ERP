import { Stat } from '@breakery/ui';

// Horizontal (default) — the "status bar" inline metric stack.
export const StatusBar = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80 flex flex-col gap-3">
    <Stat label="Active orders" value="12" />
    <Stat label="Held" value="3" />
    <Stat label="Cash in drawer" value="Rp 2,150,000" emphasis="gold" />
  </div>
);

// Vertical — stat row under a product card / sidebar facts.
export const VerticalRow = () => (
  <div className="bg-bg-base p-6 rounded-lg flex items-start gap-8">
    <Stat direction="vertical" label="Sold today" value="42" />
    <Stat direction="vertical" label="In stock" value="18" />
    <Stat direction="vertical" label="Revenue" value="Rp 1,176,000" emphasis="gold" />
  </div>
);
