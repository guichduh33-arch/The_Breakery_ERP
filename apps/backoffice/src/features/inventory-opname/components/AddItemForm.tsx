// apps/backoffice/src/features/inventory-opname/components/AddItemForm.tsx
// Session 13 / Phase 2.D — add a product line to an in-progress opname.

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
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
        <div>
          <label htmlFor="opname-expected" className="block text-xs text-text-secondary mb-1">Expected (optional)</label>
          <input
            id="opname-expected"
            type="number"
            step="0.001"
            min={0}
            value={expectedQty}
            onChange={(e) => { setExpectedQty(e.target.value); }}
            // Champ écrit à la main, hors primitif `Input` : il retombait sur
            // l'anneau de focus du navigateur (2,09-2,40:1, sous les 3:1 de
            // WCAG 1.4.11) et sur le `gray-400` du Preflight pour son
            // placeholder (2,21:1). Le seul de cet anti-patron qui vive dans un
            // fichier déjà édité par cette campagne ; les 35 autres sont
            // recensés dans DESIGN.md comme écart ouvert (2026-08-18).
            className={`w-32 px-2 py-1 text-right font-mono text-sm bg-bg-base border border-border-strong rounded placeholder:text-text-muted ${FOCUS_RING}`}
            placeholder="auto"
          />
        </div>
        <Button variant="ink" onClick={handleAdd} disabled={addItem.isPending}>
          {addItem.isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error !== null && (
        <div className="text-sm text-danger mt-2">{error}</div>
      )}
    </div>
  );
}
