// apps/backoffice/src/features/inventory-opname/components/AddItemForm.tsx
// Session 13 / Phase 2.D — add a product line to an in-progress opname.

import { useEffect, useState } from 'react';
import { Button } from '@/components/BackofficeUi.js';
import { ProductTypeahead } from '@/features/inventory/components/ProductTypeahead.js';
import type { ProductTypeaheadRow } from '@/features/inventory/hooks/useProductsForInventory.js';
import { useAddOpnameItem } from '../hooks/useOpnameMutations.js';

export interface AddItemFormProps {
  countId: string;
  onPendingChange?: (pending: boolean) => void;
}

export function AddItemForm({ countId, onPendingChange }: AddItemFormProps) {
  const [product, setProduct] = useState<ProductTypeaheadRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addItem = useAddOpnameItem();
  useEffect(() => {
    onPendingChange?.(addItem.isPending);
    return () => { onPendingChange?.(false); };
  }, [addItem.isPending, onPendingChange]);

  function handleAdd() {
    if (product === null) {
      setError('Pick a product.');
      return;
    }
    setError(null);
    addItem.mutate(
      { countId, productId: product.id },
      {
        onSuccess: () => {
          setProduct(null);
        },
        onError: (e) => { setError(e.message); },
      },
    );
  }

  return (
    <div className="border border-border-subtle rounded-md p-3 bg-bg-elevated">
      <div className="font-data font-semibold text-xs uppercase tracking-wider text-text-secondary mb-2">Add product</div>
      <div className="flex gap-2 items-end">
        {/* Seul call-site de ProductTypeahead qui n'ouvrait pas d'`id` : le
            champ n'était donc nommé que par son `placeholder`, effacé à la
            première frappe (WCAG 1.3.1 / 4.1.2). Les quatre autres
            (AdjustModal, WasteModal, IncomingStockForm, POFormDraft) posent
            déjà `<label htmlFor>` — on recopie leur patron plutôt que
            d'`aria-label`er le composant, qui ÉCRASERAIT leurs libellés. */}
        <div className="flex-1">
          <label htmlFor="opname-product" className="block text-xs text-text-secondary mb-1">Product</label>
          <ProductTypeahead
            id="opname-product"
            value={product}
            onChange={setProduct}
            placeholder="Search by SKU or name…"
          />
        </div>
        {/* Critique 2026-08-31 (P1) — `secondary`, plus `ink`. L'encre de la
            page va à l'action qui TERMINE le travail (« Validate & reveal
            variances »), pas à celle qui le rallonge d'une ligne. La One Ink
            Fill Rule n'en autorise qu'un aplat par écran, et il était ici. */}
        <Button variant="secondary" onClick={handleAdd} disabled={addItem.isPending}>
          {addItem.isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error !== null && (
        <div className="text-sm text-danger mt-2">{error}</div>
      )}
    </div>
  );
}
