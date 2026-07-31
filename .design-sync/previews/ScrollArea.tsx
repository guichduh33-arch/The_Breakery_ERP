import { ScrollArea, Separator } from '@breakery/ui';

const PRODUCTS: Array<[string, string]> = [
  ['Croissant au beurre', 'Rp 28.000'],
  ['Pain au chocolat', 'Rp 32.000'],
  ['Kouign-amann', 'Rp 35.000'],
  ['Almond croissant', 'Rp 38.000'],
  ['Sourdough loaf', 'Rp 65.000'],
  ['Baguette tradition', 'Rp 42.000'],
  ['Canelé de Bordeaux', 'Rp 25.000'],
  ['Éclair café', 'Rp 30.000'],
  ['Tarte citron', 'Rp 45.000'],
  ['Chausson aux pommes', 'Rp 33.000'],
];

// Fixed-height product list — content overflows so the styled scrollbar
// (rounded thumb on border-subtle) is actually engaged.
export const ProductList = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    {/* type="always" — the Radix scrollbar is hover-only by default and would
        never show in a static capture. */}
    <ScrollArea type="always" className="h-64 rounded-md border border-border-subtle">
      <div className="p-3">
        <p className="mb-2 text-xs uppercase tracking-widest text-text-muted">
          Viennoiserie & bakery
        </p>
        {PRODUCTS.map(([name, price], i) => (
          <div key={name}>
            {i > 0 && <Separator className="my-1" />}
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-text-secondary">{name}</span>
              <span className="font-mono text-text-primary">{price}</span>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  </div>
);

// Short content — no overflow, the area degrades gracefully to a plain panel.
export const FitsWithoutScroll = () => (
  <div className="bg-bg-base p-6 rounded-lg w-80">
    <ScrollArea className="h-40 rounded-md border border-border-subtle">
      <div className="p-3">
        <p className="mb-2 text-xs uppercase tracking-widest text-text-muted">
          Held orders
        </p>
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-text-secondary">Table 4 — Pak Budi</span>
          <span className="font-mono text-text-primary">Rp 88.000</span>
        </div>
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-text-secondary">Counter — Ibu Sari</span>
          <span className="font-mono text-text-primary">Rp 56.000</span>
        </div>
      </div>
    </ScrollArea>
  </div>
);
