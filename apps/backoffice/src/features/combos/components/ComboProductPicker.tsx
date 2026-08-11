// apps/backoffice/src/features/combos/components/ComboProductPicker.tsx
//
// Session 47 — inline product picker for adding options to a combo group.
// Pattern mirrors S39 features/orders/components/ProductPicker.tsx.
// Searches finished products by name/SKU; excludes variant parents + combos.

import { useMemo, useState, type JSX } from 'react';
import { Currency } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useFinishedProductsForCombo, type ComboOptionProduct } from '../hooks/useFinishedProductsForCombo.js';

interface Props {
  /** Already-picked product IDs in this group (to avoid duplicates). */
  excludeIds?: string[];
  onPick: (product: ComboOptionProduct) => void;
  onClose: () => void;
}

// Le catalogue fini compte ~375 produits. Les rendre tous, c'est ~370 boutons
// dans une boite de 192 px : 98 % hors ecran mais mis en page, et surtout 373
// arrets de tabulation entre le champ de recherche et le controle suivant —
// mesure de l'audit : les cibles focalisables de <main> passaient de 62 a 436 a
// l'ouverture d'un seul selecteur. On borne la liste et on dit ce qu'on cache.
const MAX_ROWS = 25;

export function ComboProductPicker({ excludeIds = [], onPick, onClose }: Props): JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useFinishedProductsForCombo();

  const excludeKey = excludeIds.join(',');
  const { rows, matchCount } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const excluded = new Set(excludeKey === '' ? [] : excludeKey.split(','));
    const matches = (data ?? []).filter(
      (p) =>
        !excluded.has(p.id) &&
        (p.name.toLowerCase().includes(query) || p.sku.toLowerCase().includes(query)),
    );
    return { rows: matches.slice(0, MAX_ROWS), matchCount: matches.length };
  }, [data, search, excludeKey]);

  const hiddenCount = matchCount - rows.length;

  return (
    <div
      className="rounded-lg border border-border-subtle bg-bg-elevated shadow-lg p-3 flex flex-col gap-2"
      data-testid="combo-product-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Add Product
        </span>
        <button
          type="button"
          onClick={onClose}
          className={`text-text-muted hover:text-text-primary text-lg leading-none ${FOCUS_RING}`}
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
        className={`w-full px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded placeholder:text-text-muted ${FOCUS_RING}`}
        data-testid="combo-picker-search"
        autoFocus
      />

      {isLoading && (
        <p className="text-sm text-text-muted py-2">Loading products…</p>
      )}
      {isError && (
        <p className="text-sm text-red py-2">Failed to load products.</p>
      )}
      {!isLoading && !isError && matchCount === 0 && (
        <p className="text-sm text-text-muted py-2" role="status">No products match.</p>
      )}
      {!isLoading && !isError && matchCount > 0 && (
        <ul
          className="overflow-auto max-h-48 divide-y divide-border-subtle border border-border-subtle rounded text-sm"
          role="listbox"
          aria-label="Matching products"
        >
          {rows.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => { onPick(p); }}
                className={`w-full text-left px-3 py-2 hover:bg-surface-4 flex items-center justify-between gap-2 ${FOCUS_RING}`}
                data-testid={`combo-picker-row-${p.id}`}
              >
                <span className="flex-1 min-w-0 truncate text-text-primary">
                  {p.name}
                  {p.variant_label !== null && (
                    <span className="ml-1 text-xs text-text-secondary">— {p.variant_label}</span>
                  )}
                </span>
                <span className="text-xs text-text-muted font-mono shrink-0">{p.sku}</span>
                <Currency
                  amount={p.retail_price}
                  className="text-xs text-text-secondary shrink-0"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isLoading && !isError && hiddenCount > 0 && (
        <p className="text-xs text-text-muted" role="status" data-testid="combo-picker-overflow">
          Showing {rows.length} of{' '}
          <span className="font-mono tabular-nums">{matchCount}</span> matches — refine your search.
        </p>
      )}
    </div>
  );
}
