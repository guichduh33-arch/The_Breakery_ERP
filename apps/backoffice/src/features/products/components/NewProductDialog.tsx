// apps/backoffice/src/features/products/components/NewProductDialog.tsx
// Session 27b — Modal form to create a new product via create_product_v1 RPC.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useCreateProduct } from '../hooks/useCreateProduct.js';
import type { CategoryOption } from '../types.js';

export interface NewProductDialogProps {
  onClose:    () => void;
  onCreated?: (newId: string) => void;
  categories: ReadonlyArray<CategoryOption>;
}

const UNITS = ['pcs', 'kg', 'g', 'L', 'ml', 'box', 'pack'] as const;

export function NewProductDialog({ onClose, onCreated, categories }: NewProductDialogProps): JSX.Element {
  const activeCategories = categories.filter((c) => c.is_active);
  const [name,        setName]        = useState('');
  const [sku,         setSku]         = useState('');
  const [categoryId,  setCategoryId]  = useState(activeCategories[0]?.id ?? '');
  const [retailPrice, setRetailPrice] = useState<string>('0');
  const [unit,        setUnit]        = useState<string>('pcs');
  const [description, setDescription] = useState('');
  const [isDisplayItem, setIsDisplayItem] = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const createProduct = useCreateProduct();

  function handleSubmit() {
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    if (sku.trim().length < 2) {
      setError('SKU must be at least 2 characters.');
      return;
    }
    if (categoryId === '') {
      setError('Pick a category.');
      return;
    }
    const retail = Number(retailPrice);
    if (!Number.isFinite(retail) || retail < 0) {
      setError('Retail price must be ≥ 0.');
      return;
    }
    setError(null);
    createProduct.mutate(
      {
        name: name.trim(),
        sku: sku.trim().toUpperCase(),
        category_id: categoryId,
        retail_price: retail,
        unit,
        description: description.trim() === '' ? null : description.trim(),
        is_display_item: isDisplayItem,
      },
      {
        onSuccess: (res) => {
          if (onCreated && res.product?.id) onCreated(res.product.id);
          onClose();
        },
        onError: (e) => {
          if (e.message.includes('sku_taken')) {
            setError(`SKU "${sku.trim().toUpperCase()}" is already taken.`);
          } else if (e.message.includes('category_not_found')) {
            setError('Selected category no longer exists.');
          } else {
            setError(e.message);
          }
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="new-product-dialog">
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>
            Creates a finished product. Cost price defaults to 0 and is filled
            automatically on the next stock receipt (WAC) or via an admin
            cost-price correction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="np-name" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Name
            </label>
            <input
              id="np-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              placeholder="Affogato"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="np-sku" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
                SKU
              </label>
              <input
                id="np-sku"
                value={sku}
                onChange={(e) => { setSku(e.target.value.toUpperCase()); }}
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded font-mono"
                placeholder="COF-002"
                maxLength={32}
              />
            </div>
            <div>
              <label htmlFor="np-unit" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Unit
              </label>
              <select
                id="np-unit"
                value={unit}
                onChange={(e) => { setUnit(e.target.value); }}
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              >
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="np-cat" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Category
            </label>
            <select
              id="np-cat"
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
            >
              {activeCategories.length === 0 && <option value="">— No active category —</option>}
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="np-retail" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Retail price (IDR)
            </label>
            <input
              id="np-retail"
              type="number"
              inputMode="numeric"
              min={0}
              value={retailPrice}
              onChange={(e) => { setRetailPrice(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded font-mono"
            />
          </div>

          <div>
            <label htmlFor="np-desc" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Description (optional)
            </label>
            <textarea
              id="np-desc"
              rows={2}
              value={description}
              onChange={(e) => { setDescription(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded resize-y"
              maxLength={500}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={isDisplayItem}
              onChange={(e) => { setIsDisplayItem(e.target.checked); }}
              data-testid="new-product-display-item"
              className="h-4 w-4 rounded border-border-subtle bg-bg-base"
            />
            <span>
              Display-case item (POS vitrine) — stock vitrine séparé, indépendant de l'inventaire global
            </span>
          </label>

          {error !== null && (
            <div className="text-xs text-red bg-red-soft px-2 py-1.5 rounded" data-testid="new-product-error">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={createProduct.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createProduct.isPending}
            data-testid="new-product-submit"
          >
            {createProduct.isPending ? 'Creating…' : 'Create product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
