// apps/backoffice/src/features/inventory/components/ProductTypeahead.tsx
//
// Minimal product typeahead used by the Receive/Waste modals. Renders an
// input + a results list that only appears once the user has typed at
// least 2 characters and the query has resolved. Selecting a row collapses
// the list and forwards the chosen product to the caller.

import { useState, type JSX } from 'react';
import { Input } from '@breakery/ui';
import {
  useProductsForInventory,
  type ProductTypeaheadRow,
} from '../hooks/useProductsForInventory.js';

export interface ProductTypeaheadProps {
  value:       ProductTypeaheadRow | null;
  onChange:    (p: ProductTypeaheadRow | null) => void;
  disabled?:   boolean;
  placeholder?: string;
  id?:         string;
}

export function ProductTypeahead({
  value, onChange, disabled, placeholder, id,
}: ProductTypeaheadProps): JSX.Element {
  const [search, setSearch] = useState<string>(value !== null ? value.name : '');
  const [open,   setOpen  ] = useState<boolean>(false);
  const q = useProductsForInventory(search);

  function handleSelect(p: ProductTypeaheadRow): void {
    onChange(p);
    setSearch(p.name);
    setOpen(false);
  }

  function handleClear(): void {
    onChange(null);
    setSearch('');
    setOpen(true);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        value={search}
        autoComplete="off"
        placeholder={placeholder ?? 'Search by name (min 2 chars)…'}
        disabled={disabled === true}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          if (value !== null && e.target.value !== value.name) onChange(null);
          setOpen(true);
        }}
        onBlur={() => {
          // Allow click to register on a list item before closing.
          window.setTimeout(() => setOpen(false), 120);
        }}
      />
      {value !== null && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear selected product"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary text-xs"
        >
          Clear
        </button>
      )}
      {open && search.trim().length >= 2 && (
        <div
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border-subtle bg-bg-elevated shadow-lg"
        >
          {q.isLoading && (
            <div className="px-3 py-2 text-xs text-text-secondary">Searching…</div>
          )}
          {q.error && (
            <div className="px-3 py-2 text-xs text-red">Search failed: {q.error.message}</div>
          )}
          {q.data?.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-secondary">No products match.</div>
          )}
          {q.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={value?.id === p.id}
              onMouseDown={(e) => {
                // Prevent the input blur from closing the list before click fires.
                e.preventDefault();
                handleSelect(p);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-bg-overlay focus:bg-bg-overlay focus:outline-none"
            >
              <div className="flex items-center justify-between gap-3">
                <span>{p.name}</span>
                <span className="font-mono text-xs text-text-secondary">
                  {p.sku} · {p.current_stock.toLocaleString()}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
