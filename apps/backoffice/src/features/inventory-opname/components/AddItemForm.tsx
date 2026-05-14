// apps/backoffice/src/features/inventory-opname/components/AddItemForm.tsx
// Session 13 / Phase 2.D — add a product line to an in-progress opname.

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { ProductTypeahead } from '@/features/inventory/components/ProductTypeahead.js';
import type { ProductTypeaheadRow } from '@/features/inventory/hooks/useProductsForInventory.js';
import { useAddOpnameItem } from '../hooks/useOpnameMutations.js';

export interface AddItemFormProps {
  countId: string;
}

export function AddItemForm({ countId }: AddItemFormProps) {
  const [product, setProduct] = useState<ProductTypeaheadRow | null>(null);
  const [expectedQty, setExpectedQty] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const addItem = useAddOpnameItem();

  function handleAdd() {
    if (product === null) {
      setError('Pick a product.');
      return;
    }
    const expected = expectedQty.trim() === ''
      ? undefined
      : Number(expectedQty);
    if (expected !== undefined && (!Number.isFinite(expected) || expected < 0)) {
      setError('Expected qty must be a non-negative number, or empty for auto-load.');
      return;
    }
    setError(null);
    addItem.mutate(
      { countId, productId: product.id, expectedQty: expected },
      {
        onSuccess: () => {
          setProduct(null);
          setExpectedQty('');
        },
        onError: (e) => { setError(e.message); },
      },
    );
  }

  return (
    <div className="border border-border-subtle rounded-md p-3 bg-bg-elevated">
      <div className="text-xs uppercase tracking-wider text-text-secondary mb-2">Add product</div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <ProductTypeahead
            value={product}
            onChange={setProduct}
            placeholder="Search by SKU or name…"
          />
        </div>
        <div>
          <label htmlFor="opname-expected" className="block text-xs text-text-secondary mb-1">Expected (optional)</label>
          <input
            id="opname-expected"
            type="number"
            step="0.001"
            min={0}
            value={expectedQty}
            onChange={(e) => { setExpectedQty(e.target.value); }}
            className="w-32 px-2 py-1 text-right font-mono text-sm bg-bg-base border border-border-subtle rounded"
            placeholder="auto"
          />
        </div>
        <Button onClick={handleAdd} disabled={addItem.isPending}>
          {addItem.isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error !== null && (
        <div className="text-sm text-rose-600 mt-2">{error}</div>
      )}
    </div>
  );
}
