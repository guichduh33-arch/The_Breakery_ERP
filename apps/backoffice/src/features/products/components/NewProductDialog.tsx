// apps/backoffice/src/features/products/components/NewProductDialog.tsx
// Session 27b — Modal form to create a new product via create_product_v2 RPC.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useCreateProduct } from '../hooks/useCreateProduct.js';
import type { CategoryOption } from '../types.js';
import { FOCUS_RING } from '@/components/focusRing.js';

export interface NewProductDialogProps {
  onClose:    () => void;
  onCreated?: (newId: string) => void;
  categories: readonly CategoryOption[];
}

const UNITS = ['pcs', 'kg', 'g', 'L', 'ml', 'box', 'pack'] as const;

export function NewProductDialog({ onClose, onCreated, categories }: NewProductDialogProps): JSX.Element {
  const activeCategories = categories.filter((c) => c.is_active);
  const [name,        setName]        = useState('');
  const [sku,         setSku]         = useState('');
  // Démarre VIDE — pas de préremplissage sur la première catégorie active :
  // un choix silencieux enregistrait des produits dans la mauvaise catégorie.
  const [categoryId,  setCategoryId]  = useState('');
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
      setError('Choose a category.');
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
            <label htmlFor="np-name" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Name
            </label>
            <input
              id="np-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded placeholder:text-text-muted ${FOCUS_RING}`}
              placeholder="Affogato"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="np-sku" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
                SKU
              </label>
              <input
                id="np-sku"
                value={sku}
                onChange={(e) => { setSku(e.target.value.toUpperCase()); }}
                className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded font-mono placeholder:text-text-muted ${FOCUS_RING}`}
                placeholder="COF-002"
                maxLength={32}
              />
            </div>
            <div>
              <label htmlFor="np-unit" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Unit
              </label>
              <select
                id="np-unit"
                value={unit}
                onChange={(e) => { setUnit(e.target.value); }}
                className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
              >
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="np-cat" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Category
            </label>
            <select
              id="np-cat"
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
            >
              {/* Placeholder non sélectionnable : force un choix explicite. */}
              <option value="" disabled>
                {activeCategories.length === 0 ? '— No active category —' : 'Choose a category'}
              </option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="np-retail" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Retail price (IDR)
            </label>
            <input
              id="np-retail"
              type="number"
              inputMode="numeric"
              min={0}
              value={retailPrice}
              onChange={(e) => { setRetailPrice(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded font-mono ${FOCUS_RING}`}
            />
          </div>

          <div>
            <label htmlFor="np-desc" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Description (optional)
            </label>
            <textarea
              id="np-desc"
              rows={2}
              value={description}
              onChange={(e) => { setDescription(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded resize-y ${FOCUS_RING}`}
              maxLength={500}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={isDisplayItem}
              onChange={(e) => { setIsDisplayItem(e.target.checked); }}
              data-testid="new-product-display-item"
              className={`h-4 w-4 rounded border-border-strong bg-bg-base ${FOCUS_RING}`}
            />
            <span>
              Display-case item (POS) — separate display-case counter, independent of global inventory
            </span>
          </label>

          {isDisplayItem && (
            /* L'encart n'a PAS de surface, et c'est la règle : The Ink-Not-Gold
               Rule veut que l'or souligne sans remplir. Le liseré plein
               (`border-gold`, 6,22:1 sur la feuille) porte seul l'encart — il
               n'est pas `border-border-gold`, qui ne vaut que 1,64:1 et ne
               serait donc pas une limite visible (WCAG 1.4.11).
               Historique utile : l'encart a d'abord porté un modificateur
               d'opacité sur l'or, qui ne produisait AUCUN fond — Tailwind ne
               sait pas appliquer un alpha à une couleur déclarée
               `var(--gold-base)` et supprime la règle en silence. L'aplat a
               ensuite été porté par le cran doux ; il est aujourd'hui retiré,
               pas remplacé. */
            <p
              data-testid="new-product-display-item-note"
              className="rounded border border-gold px-2 py-1.5 text-xs text-text-secondary"
            >
              <span className="font-semibold text-gold">Display-case counter starts at 0.</span>{' '}
              Stock it from the POS Display Stock screen (Cafe Stock in the side menu)
              before selling — until then the POS blocks checkout for this product.
            </p>
          )}

          {error !== null && (
            <div className="text-xs text-red bg-red-soft px-2 py-1.5 rounded" data-testid="new-product-error">
              {error}
            </div>
          )}
        </div>

        {/* Pied collant — le contenu de la modale défile (DialogContent est
            `overflow-y-auto`), les boutons restaient noyés sous le pli. Les
            marges négatives annulent le `p-6` du DialogContent pour que le fond
            couvre toute la largeur ; `bg-bg-elevated` reprend la surface de la
            modale afin que les champs disparaissent proprement derrière le pied.
            Correctif LOCAL : le primitif Dialog n'est pas touché. */}
        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t border-border-subtle bg-bg-elevated px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={createProduct.isPending}>
            Cancel
          </Button>
          <Button
            variant="ink"
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
