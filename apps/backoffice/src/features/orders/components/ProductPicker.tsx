// apps/backoffice/src/features/orders/components/ProductPicker.tsx
// Session 39 / Wave C1 — compact product picker for EditOrderItemsModal.
// Client-side search filter over name + SKU. Parent products excluded via
// useProductsForOrderEdit (same S27c rule as POS).

import { useState } from 'react';
import {
  useProductsForOrderEdit,
  type OrderEditProduct,
} from '@/features/orders/hooks/useProductsForOrderEdit.js';

interface Props {
  onPick: (p: OrderEditProduct) => void;
}

export function ProductPicker({ onPick }: Props) {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useProductsForOrderEdit();

  const query = search.toLowerCase();
  const filtered = (data ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      p.sku.toLowerCase().includes(query),
  );

  return (
    <div className="flex flex-col h-full gap-2">
      <input
        type="text"
        placeholder="Search by name or SKU…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="border rounded px-2 py-1 text-sm w-full"
        data-testid="picker-search"
      />

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading products…</p>
      )}

      {isError && (
        <p className="text-sm text-danger">Failed to load products.</p>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No products match.</p>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <ul className="overflow-auto flex-1 divide-y border rounded">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-bg-overlay flex items-center justify-between gap-2"
                data-testid={`picker-row-${p.id}`}
              >
                <span className="flex-1 min-w-0 truncate">
                  {p.name}
                  {p.variant_label && (
                    <span className="ml-1 text-xs text-text-secondary">
                      — {p.variant_label}
                    </span>
                  )}
                </span>
                <span className="text-xs text-text-muted font-mono shrink-0">
                  {p.sku}
                </span>
                <span className="text-xs text-text-secondary shrink-0">
                  {p.retail_price.toLocaleString('id-ID')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
