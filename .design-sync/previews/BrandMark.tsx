import { BrandMark } from '@breakery/ui';

// The four size tokens — sm (sidebar), md (POS top-left), lg (customer
// display empty state), xl (login hero). Pure SVG, crisp at any size.
export const AllSizes = () => (
  <div className="bg-bg-base p-6 rounded-lg flex items-end gap-6">
    <div className="flex flex-col items-center gap-2">
      <BrandMark size="sm" />
      <span className="text-xs text-text-muted">sm 32</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <BrandMark size="md" />
      <span className="text-xs text-text-muted">md 40</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <BrandMark size="lg" />
      <span className="text-xs text-text-muted">lg 64</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <BrandMark size="xl" />
      <span className="text-xs text-text-muted">xl 96</span>
    </div>
  </div>
);

// Glyph override — "TB" for placements that spell out The Breakery.
export const GlyphOverride = () => (
  <div className="bg-bg-base p-6 rounded-lg flex items-center gap-4">
    <BrandMark size="lg" glyph="TB" />
    <div className="flex flex-col">
      <span className="text-sm font-medium text-text-primary">The Breakery</span>
      <span className="text-xs text-text-muted">French Bakery &amp; Pastry</span>
    </div>
  </div>
);
