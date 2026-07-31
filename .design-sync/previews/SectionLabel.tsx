import { SectionLabel } from '@breakery/ui';

// The signature uppercase tracking-widest label, xs size (sidebar groups,
// KPI tile labels) — shown above the content it introduces.
export const XsAboveContent = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80 flex flex-col gap-2">
    <SectionLabel as="h3" size="xs">Today&apos;s revenue</SectionLabel>
    <span className="font-mono tabular-nums text-2xl text-text-primary">
      Rp 4,850,000
    </span>
  </div>
);

// sm size — major section heading over a small list block.
export const SmSectionHeading = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80 flex flex-col gap-3">
    <SectionLabel as="h2" size="sm">Top products today</SectionLabel>
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">Croissant au beurre</span>
      <span className="font-mono tabular-nums text-text-primary">42</span>
    </div>
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">Pain au chocolat</span>
      <span className="font-mono tabular-nums text-text-primary">31</span>
    </div>
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">Es kopi susu</span>
      <span className="font-mono tabular-nums text-text-primary">27</span>
    </div>
  </div>
);

// Gold override — callers re-color for emphasis (className merge).
export const GoldEmphasis = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80 flex flex-col gap-2">
    <SectionLabel as="div" size="xs" className="text-gold">Active order</SectionLabel>
    <span className="text-sm text-text-primary">Table 4 — Pak Budi · 3 items</span>
  </div>
);
