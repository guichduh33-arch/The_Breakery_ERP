// apps/backoffice/src/features/combos/components/ComboProductPicker.tsx
//
// Session 47 — inline product picker for adding options to a combo group.
// Pattern mirrors S39 features/orders/components/ProductPicker.tsx.
// Searches finished products by name/SKU; excludes variant parents + combos.

import { useState, type JSX } from 'react';
import { useFinishedProductsForCombo, type ComboOptionProduct } from '../hooks/useFinishedProductsForCombo.js';

interface Props {
  /** Already-picked product IDs in this group (to avoid duplicates). */
  excludeIds?: string[];
  onPick: (product: ComboOptionProduct) => void;
  onClose: () => void;
}

export function ComboProductPicker({ excludeIds = [], onPick, onClose }: Props): JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useFinishedProductsForCombo();

  const query = search.toLowerCase();
  const filtered = (data ?? []).filter(
    (p) =>
      !excludeIds.includes(p.id) &&
      (p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query)),
  );

  return (
    <div
      className="rounded-lg border border-border-subtle bg-bg-elevated shadow-lg p-3 flex flex-col gap-2"
      data-testid="combo-product-picker"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Add Product
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary text-lg leading-none"
          aria-label="Close picker"
        >
          ×
        </button>
      </div>
      <input
        type="text"
        placeholder="Search by name or SKU…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); }}
        className="w-full px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded"
        data-testid="combo-picker-search"
        autoFocus
      />

      {isLoading && (
        <p className="text-sm text-text-muted py-2">Loading products…</p>
      )}
      {isError && (
        <p className="text-sm text-red py-2">Failed to load products.</p>
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-sm text-text-muted py-2">No products match.</p>
      )}
      {!isLoading && !isError && filtered.length > 0 && (
        <ul className="overflow-auto max-h-48 divide-y divide-border-subtle border border-border-subtle rounded text-sm">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { onPick(p); }}
                className="w-full text-left px-3 py-2 hover:bg-bg-overlay flex items-center justify-between gap-2"
                data-testid={`combo-picker-row-${p.id}`}
              >
                <span className="flex-1 min-w-0 truncate text-text-primary">
                  {p.name}
                  {p.variant_label !== null && (
                    <span className="ml-1 text-xs text-text-secondary">— {p.variant_label}</span>
                  )}
                </span>
                <span className="text-xs text-text-muted font-mono shrink-0">{p.sku}</span>
                <span className="text-xs text-text-secondary shrink-0">
                  Rp {p.retail_price.toLocaleString('id-ID')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
