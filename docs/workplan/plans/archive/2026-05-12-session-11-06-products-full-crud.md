# Session 11 — Phase 06 — Products full CRUD Implementation Plan

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Module concerné** : [`05-products-categories`](../../../reference/04-modules/05-products-categories.md)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing read-only `apps/backoffice/src/pages/Products.tsx` into a full CRUD page (create + edit + soft-delete + inline `is_active` / `is_favorite` toggles). Reuse the existing `useProducts` hook for the list query. The product form references categories — Phase 04 (Categories CRUD) MUST be done first.

**Architecture:** Adds the missing pieces to `apps/backoffice/src/features/products/` (currently only `hooks/useProducts.ts`). New: `ProductFormModal`, `ProductListRow`, `ProductDeleteConfirm`, `useCreateProduct`, `useUpdateProduct`, `useDeleteProduct`, and a `useCategoriesForProductForm` reference-data hook. Products of `product_type='combo'` are filtered OUT of this page — combos live in Phase 07.

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md` §0 (Products full CRUD)
**Parent plan:** `docs/workplan/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- Phase 04 (Categories CRUD) complete — `useCategoriesList` exists
- `products` table: `id, sku, name, category_id, retail_price, wholesale_price, product_type, tax_inclusive, image_url, current_stock, is_active, is_favorite, deleted_at` (verified against `20260503000002_init_catalog.sql` + `20260509000004_add_products_wholesale_and_type.sql`)
- Perms `products.{read,create,update,delete}` seeded
- Existing `apps/backoffice/src/features/products/hooks/useProducts.ts` is a list query — re-export from new list hook, or reuse directly

---

## File Structure

| Action | Path |
|---|---|
| MODIFY | `apps/backoffice/src/features/products/hooks/useProducts.ts` (extend filters + export query key) |
| CREATE | `apps/backoffice/src/features/products/hooks/useCreateProduct.ts` |
| CREATE | `apps/backoffice/src/features/products/hooks/useUpdateProduct.ts` |
| CREATE | `apps/backoffice/src/features/products/hooks/useDeleteProduct.ts` |
| CREATE | `apps/backoffice/src/features/products/hooks/useCategoriesForProductForm.ts` |
| CREATE | `apps/backoffice/src/features/products/components/ProductFormModal.tsx` |
| CREATE | `apps/backoffice/src/features/products/components/ProductListRow.tsx` |
| CREATE | `apps/backoffice/src/features/products/components/ProductDeleteConfirm.tsx` |
| REWRITE | `apps/backoffice/src/pages/Products.tsx` (full CRUD shell) |
| CREATE | `apps/backoffice/src/__tests__/products-crud.smoke.test.tsx` |

---

## Task 1: Extend `useProducts` list hook

**Files:**
- Modify: `apps/backoffice/src/features/products/hooks/useProducts.ts`

- [ ] **Step 1: Read the current file**

```bash
cat apps/backoffice/src/features/products/hooks/useProducts.ts
```

- [ ] **Step 2: Replace the file** with the extended version

```ts
// apps/backoffice/src/features/products/hooks/useProducts.ts
//
// BO products list. Now accepts filters (category / active / favorite /
// search). Combos (product_type='combo') are filtered out — they have
// their own page in Phase 07.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type ProductRow    = Database['public']['Tables']['products']['Row'];
export type ProductInsert = Database['public']['Tables']['products']['Insert'];
export type ProductUpdate = Database['public']['Tables']['products']['Update'];

export type ActiveFilter   = 'all' | 'active' | 'inactive';
export type FavoriteFilter = 'all' | 'favorite' | 'not-favorite';

export interface ProductsListFilters {
  categoryId?: string | null;
  active?: ActiveFilter;
  favorite?: FavoriteFilter;
  search?: string;
}

export const PRODUCTS_QUERY_KEY = ['products-bo'] as const;

export function useProducts(filters: ProductsListFilters = {}) {
  return useQuery<ProductRow[]>({
    queryKey: [...PRODUCTS_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select('*')
        .is('deleted_at', null)
        .neq('product_type', 'combo')   // combos handled in /backoffice/combos
        .order('is_favorite', { ascending: false })
        .order('name', { ascending: true });

      if (filters.categoryId !== undefined && filters.categoryId !== null && filters.categoryId !== '') {
        q = q.eq('category_id', filters.categoryId);
      }
      if (filters.active === 'active')   q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);
      if (filters.favorite === 'favorite')     q = q.eq('is_favorite', true);
      if (filters.favorite === 'not-favorite') q = q.eq('is_favorite', false);
      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = filters.search.trim().replace(/[%_]/g, '\\$&');
        q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

> **Backwards-compat check:** the existing call sites (e.g. POS `useProducts`) pass no args → the new optional filters default to `{}` → behaviour unchanged.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter backoffice typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/features/products/hooks/useProducts.ts
git commit -m "feat(backoffice): session 11 — extend useProducts with filters (category/active/favorite/search)"
```

---

## Task 2: Mutation hooks

**Files:**
- Create: `apps/backoffice/src/features/products/hooks/useCreateProduct.ts`
- Create: `apps/backoffice/src/features/products/hooks/useUpdateProduct.ts`
- Create: `apps/backoffice/src/features/products/hooks/useDeleteProduct.ts`

- [ ] **Step 1: `useCreateProduct`**

```ts
// apps/backoffice/src/features/products/hooks/useCreateProduct.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PRODUCTS_QUERY_KEY, type ProductInsert, type ProductRow } from './useProducts.js';

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation<ProductRow, Error, ProductInsert>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('products')
        .insert({ ...values, product_type: 'finished' })  // BO Products page never creates combos
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      // Also invalidate the POS-facing key used elsewhere
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 2: `useUpdateProduct`**

```ts
// apps/backoffice/src/features/products/hooks/useUpdateProduct.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PRODUCTS_QUERY_KEY, type ProductRow, type ProductUpdate } from './useProducts.js';

export interface UpdateProductArgs {
  id: string;
  values: ProductUpdate;
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation<ProductRow, Error, UpdateProductArgs>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('products')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 3: `useDeleteProduct`**

```ts
// apps/backoffice/src/features/products/hooks/useDeleteProduct.ts
//
// Soft-deletes a product. Open orders that reference it (via order_items.product_id)
// keep their historical snapshot — the FK is RESTRICT but soft-delete doesn't
// remove the row, just sets deleted_at. Active orders see "Product not found"
// in the POS picker, which is the expected behaviour for a deprecated product.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PRODUCTS_QUERY_KEY } from './useProducts.js';

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('products')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/products/hooks/useCreateProduct.ts apps/backoffice/src/features/products/hooks/useUpdateProduct.ts apps/backoffice/src/features/products/hooks/useDeleteProduct.ts
git commit -m "feat(backoffice): session 11 — product create/update/soft-delete hooks"
```

---

## Task 3: Categories reference-data hook (for the form's dropdown)

**Files:**
- Create: `apps/backoffice/src/features/products/hooks/useCategoriesForProductForm.ts`

- [ ] **Step 1: Write the hook**

```ts
// apps/backoffice/src/features/products/hooks/useCategoriesForProductForm.ts
//
// Lightweight categories query for the product form's category dropdown.
// Returns only id + name + slug, sorted by sort_order. Excludes soft-deleted
// AND inactive categories — admins must reactivate a category before
// reassigning a product to it.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

export function useCategoriesForProductForm() {
  return useQuery<CategoryOption[]>({
    queryKey: ['categories-for-product-form'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/products/hooks/useCategoriesForProductForm.ts
git commit -m "feat(backoffice): session 11 — useCategoriesForProductForm reference-data hook"
```

---

## Task 4: FormModal

**Files:**
- Create: `apps/backoffice/src/features/products/components/ProductFormModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
// apps/backoffice/src/features/products/components/ProductFormModal.tsx
//
// Create / edit a regular ("finished") product. Required fields:
//   sku, name, category_id, retail_price.
// Optional fields:
//   wholesale_price, tax_inclusive, image_url, current_stock (only at create),
//   is_active, is_favorite.
//
// Combos are NOT created here — Phase 07 owns the combo creation flow.

import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useCreateProduct } from '../hooks/useCreateProduct.js';
import { useUpdateProduct } from '../hooks/useUpdateProduct.js';
import { useCategoriesForProductForm } from '../hooks/useCategoriesForProductForm.js';
import type { ProductRow } from '../hooks/useProducts.js';

const SCHEMA = z.object({
  sku: z.string().trim().min(1, 'SKU required').max(32, '≤ 32 chars'),
  name: z.string().trim().min(1, 'Name required').max(120, '≤ 120 chars'),
  category_id: z.string().uuid('Pick a category'),
  retail_price: z.number().min(0, '≥ 0').max(999_999_999, '≤ 1B'),
  wholesale_price: z.number().min(0, '≥ 0').max(999_999_999, '≤ 1B').nullable(),
  tax_inclusive: z.boolean(),
  image_url: z.string().trim().url('Must be a URL').max(500).nullable().or(z.literal('')),
  current_stock: z.number().min(0, '≥ 0').max(999_999_999, 'too big'),
  is_active: z.boolean(),
  is_favorite: z.boolean(),
});

interface Draft {
  sku: string;
  name: string;
  category_id: string;
  retail_price: number;
  wholesale_price: number | null;
  tax_inclusive: boolean;
  image_url: string;
  current_stock: number;
  is_active: boolean;
  is_favorite: boolean;
}

const DEFAULT: Draft = {
  sku: '', name: '', category_id: '',
  retail_price: 0, wholesale_price: null, tax_inclusive: true,
  image_url: '', current_stock: 0, is_active: true, is_favorite: false,
};

function rowToDraft(r: ProductRow): Draft {
  return {
    sku: r.sku,
    name: r.name,
    category_id: r.category_id,
    retail_price: Number(r.retail_price),
    wholesale_price: r.wholesale_price === null ? null : Number(r.wholesale_price),
    tax_inclusive: r.tax_inclusive,
    image_url: r.image_url ?? '',
    current_stock: Number(r.current_stock),
    is_active: r.is_active,
    is_favorite: r.is_favorite,
  };
}

function draftToPayload(d: Draft, mode: 'create' | 'edit') {
  const base = {
    sku: d.sku.trim(),
    name: d.name.trim(),
    category_id: d.category_id,
    retail_price: d.retail_price,
    wholesale_price: d.wholesale_price,
    tax_inclusive: d.tax_inclusive,
    image_url: d.image_url.trim() === '' ? null : d.image_url.trim(),
    is_active: d.is_active,
    is_favorite: d.is_favorite,
  };
  // current_stock is only writable at create time. Editing stock goes through
  // the inventory module (adjust_stock_v1 RPC, session 12).
  return mode === 'create' ? { ...base, current_stock: d.current_stock } : base;
}

export interface ProductFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: ProductRow | undefined;
  onClose: () => void;
}

export function ProductFormModal({ open, mode, initial, onClose }: ProductFormModalProps) {
  const createMut = useCreateProduct();
  const updateMut = useUpdateProduct();
  const cats      = useCategoriesForProductForm();

  const [draft, setDraft] = useState<Draft>(initial ? rowToDraft(initial) : DEFAULT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial ? rowToDraft(initial) : DEFAULT);
      setErrors({});
      setServerError(null);
    }
  }, [open, initial]);

  const pending = createMut.isPending || updateMut.isPending;

  async function handleSubmit() {
    setServerError(null);
    const parsed = SCHEMA.safeParse(draft);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    try {
      const payload = draftToPayload(draft, mode);
      if (mode === 'create') {
        await createMut.mutateAsync(payload);
      } else if (initial !== undefined) {
        await updateMut.mutateAsync({ id: initial.id, values: payload });
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      setServerError(msg.includes('23505') || /duplicate/i.test(msg)
        ? `A product with SKU "${draft.sku}" already exists.` : msg);
    }
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{mode === 'create' ? 'New product' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>
          Creates a regular (non-combo) product. Stock can only be set at creation — adjust via the
          Inventory module afterwards.
        </DialogDescription>

        {cats.isLoading ? (
          <div className="text-text-secondary py-8 text-center">Loading categories…</div>
        ) : cats.error ? (
          <div className="text-red py-8 text-center">Failed to load categories: {cats.error.message}</div>
        ) : (
          <div className="grid grid-cols-3 gap-4 py-4">
            <div>
              <label htmlFor="pr-sku" className="text-xs uppercase tracking-widest text-text-secondary">SKU *</label>
              <input id="pr-sku" value={draft.sku} onChange={(e) => setField('sku', e.target.value.toUpperCase())}
                maxLength={32} disabled={mode === 'edit'}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono uppercase text-text-primary disabled:opacity-50" />
              {errors.sku && <p className="text-red text-xs mt-1">{errors.sku}</p>}
            </div>
            <div className="col-span-2">
              <label htmlFor="pr-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
              <input id="pr-name" value={draft.name} onChange={(e) => setField('name', e.target.value)} maxLength={120}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
              {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label htmlFor="pr-cat" className="text-xs uppercase tracking-widest text-text-secondary">Category *</label>
              <select id="pr-cat" value={draft.category_id} onChange={(e) => setField('category_id', e.target.value)}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
                <option value="">— Select —</option>
                {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.category_id && <p className="text-red text-xs mt-1">{errors.category_id}</p>}
            </div>
            <div>
              <label htmlFor="pr-retail" className="text-xs uppercase tracking-widest text-text-secondary">Retail price *</label>
              <input id="pr-retail" type="number" min={0} step={100} value={draft.retail_price}
                onChange={(e) => setField('retail_price', Number(e.target.value) || 0)}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
              {errors.retail_price && <p className="text-red text-xs mt-1">{errors.retail_price}</p>}
            </div>
            <div>
              <label htmlFor="pr-wholesale" className="text-xs uppercase tracking-widest text-text-secondary">Wholesale price</label>
              <input id="pr-wholesale" type="number" min={0} step={100}
                value={draft.wholesale_price ?? ''}
                onChange={(e) => setField('wholesale_price', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="optional"
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
              {errors.wholesale_price && <p className="text-red text-xs mt-1">{errors.wholesale_price}</p>}
            </div>
            <div>
              <label htmlFor="pr-stock" className="text-xs uppercase tracking-widest text-text-secondary">Initial stock</label>
              <input id="pr-stock" type="number" min={0} step={1}
                value={draft.current_stock} disabled={mode === 'edit'}
                onChange={(e) => setField('current_stock', Number(e.target.value) || 0)}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
              {mode === 'edit' && <p className="text-xs text-text-secondary mt-1">Use Inventory page to adjust.</p>}
            </div>
            <div className="col-span-3">
              <label htmlFor="pr-img" className="text-xs uppercase tracking-widest text-text-secondary">Image URL</label>
              <input id="pr-img" value={draft.image_url} onChange={(e) => setField('image_url', e.target.value)}
                placeholder="optional" maxLength={500}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
              {errors.image_url && <p className="text-red text-xs mt-1">{errors.image_url}</p>}
            </div>
            <div className="col-span-3 flex flex-wrap gap-6">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.tax_inclusive}
                  onChange={(e) => setField('tax_inclusive', e.target.checked)} />
                Tax-inclusive price
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.is_active}
                  onChange={(e) => setField('is_active', e.target.checked)} />
                Active (visible in POS)
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.is_favorite}
                  onChange={(e) => setField('is_favorite', e.target.checked)} />
                Favourite (pinned at top)
              </label>
            </div>
          </div>
        )}

        {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { void handleSubmit(); }} disabled={pending}>
            {pending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/products/components/ProductFormModal.tsx
git commit -m "feat(backoffice): session 11 — ProductFormModal (create + edit, finished only)"
```

---

## Task 5: ListRow + DeleteConfirm

**Files:**
- Create: `apps/backoffice/src/features/products/components/ProductListRow.tsx`
- Create: `apps/backoffice/src/features/products/components/ProductDeleteConfirm.tsx`

- [ ] **Step 1: `ProductListRow`**

```tsx
// apps/backoffice/src/features/products/components/ProductListRow.tsx
import { Pencil, Star, Trash2 } from 'lucide-react';
import { Button, Currency } from '@breakery/ui';
import type { ProductRow } from '../hooks/useProducts.js';

export interface ProductListRowProps {
  row: ProductRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: ProductRow) => void;
  onToggleActive: (row: ProductRow) => void;
  onToggleFavorite: (row: ProductRow) => void;
  onDelete: (row: ProductRow) => void;
}

export function ProductListRow({
  row, canUpdate, canDelete, onEdit, onToggleActive, onToggleFavorite, onDelete,
}: ProductListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3 font-mono text-text-secondary">{row.sku}</td>
      <td className="px-4 py-3 font-semibold">{row.name}</td>
      <td className="px-4 py-3 text-right"><Currency amount={Number(row.retail_price)} emphasis="gold" /></td>
      <td className="px-4 py-3 text-right font-mono">{row.current_stock}</td>
      <td className="px-4 py-3 text-center">
        <button type="button" disabled={!canUpdate}
          onClick={() => onToggleFavorite(row)}
          aria-label={`Toggle ${row.name} favorite`}
          className="inline-flex disabled:opacity-50">
          <Star className={`h-4 w-4 ${row.is_favorite ? 'fill-gold text-gold' : 'text-text-secondary'}`} aria-hidden />
        </button>
      </td>
      <td className="px-4 py-3 text-center">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={row.is_active} disabled={!canUpdate}
            onChange={() => onToggleActive(row)} aria-label={`Toggle ${row.name} active`} />
          <span className={row.is_active ? 'text-green text-xs uppercase' : 'text-text-secondary text-xs uppercase'}>
            {row.is_active ? 'Active' : 'Inactive'}
          </span>
        </label>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!canUpdate} onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </Button>
          {canDelete && (
            <Button type="button" variant="ghostDestructive" size="sm" onClick={() => onDelete(row)} aria-label={`Delete ${row.name}`}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: `ProductDeleteConfirm`**

```tsx
// apps/backoffice/src/features/products/components/ProductDeleteConfirm.tsx
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteProduct } from '../hooks/useDeleteProduct.js';
import type { ProductRow } from '../hooks/useProducts.js';

export interface ProductDeleteConfirmProps {
  open: boolean;
  row: ProductRow | undefined;
  onClose: () => void;
}

export function ProductDeleteConfirm({ open, row, onClose }: ProductDeleteConfirmProps) {
  const deleteMut = useDeleteProduct();
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (row === undefined) return;
    setError(null);
    try {
      await deleteMut.mutateAsync(row.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogTitle>Soft-delete product</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Product <span className="text-text-primary font-semibold">{row.name}</span> ({row.sku}) will
              disappear from the POS catalog. Past orders that reference it keep their snapshot intact.
            </>
          ) : null}
        </DialogDescription>
        {error !== null && <p className="text-sm text-red" role="alert">{error}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={deleteMut.isPending}>Cancel</Button>
          <Button type="button" variant="primary" className="bg-red hover:bg-red/80"
            onClick={() => { void handleConfirm(); }} disabled={deleteMut.isPending}>
            {deleteMut.isPending ? 'Deleting…' : 'Confirm delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/products/components/ProductListRow.tsx apps/backoffice/src/features/products/components/ProductDeleteConfirm.tsx
git commit -m "feat(backoffice): session 11 — ProductListRow + DeleteConfirm"
```

---

## Task 6: Rewrite the Products page

**Files:**
- Modify (full rewrite): `apps/backoffice/src/pages/Products.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// apps/backoffice/src/pages/Products.tsx
//
// BO products list — full CRUD (read + create + edit + delete + inline toggles).
// Combos are filtered out at the hook level — they live in /backoffice/combos.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { ProductDeleteConfirm } from '@/features/products/components/ProductDeleteConfirm.js';
import { ProductFormModal } from '@/features/products/components/ProductFormModal.js';
import { ProductListRow } from '@/features/products/components/ProductListRow.js';
import { useUpdateProduct } from '@/features/products/hooks/useUpdateProduct.js';
import { useCategoriesForProductForm } from '@/features/products/hooks/useCategoriesForProductForm.js';
import {
  useProducts,
  type ActiveFilter,
  type FavoriteFilter,
  type ProductRow,
  type ProductsListFilters,
} from '@/features/products/hooks/useProducts.js';

export default function ProductsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('products.read');
  const canCreate = hasPermission('products.create');
  const canUpdate = hasPermission('products.update');
  const canDelete = hasPermission('products.delete');

  const [search, setSearch]         = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [active, setActive]         = useState<ActiveFilter>('all');
  const [favorite, setFavorite]     = useState<FavoriteFilter>('all');

  const filters = useMemo<ProductsListFilters>(() => ({
    ...(search.trim() !== '' ? { search } : {}),
    ...(categoryId !== '' ? { categoryId } : {}),
    active,
    favorite,
  }), [search, categoryId, active, favorite]);

  const list = useProducts(filters);
  const cats = useCategoriesForProductForm();
  const updateMut = useUpdateProduct();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<ProductRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<ProductRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view products.</div>;
  }

  function handleToggleActive(row: ProductRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }
  function handleToggleFavorite(row: ProductRow): void {
    updateMut.mutate({ id: row.id, values: { is_favorite: !row.is_favorite } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Products</h1>
          <p className="text-text-secondary text-sm mt-1">Catalog used by the POS. Combos live in their own page.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New product
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[14rem]">
          <label htmlFor="pr-search-f" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input id="pr-search-f" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or SKU" maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="pr-cat-f" className="text-xs uppercase tracking-widest text-text-secondary">Category</label>
          <select id="pr-cat-f" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="">All categories</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="pr-active-f" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="pr-active-f" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="pr-fav-f" className="text-xs uppercase tracking-widest text-text-secondary">Favorite</label>
          <select id="pr-fav-f" value={favorite} onChange={(e) => setFavorite(e.target.value as FavoriteFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All</option>
            <option value="favorite">Favorite</option>
            <option value="not-favorite">Not favorite</option>
          </select>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="text-left px-4 py-3 w-32">SKU</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-right px-4 py-3 w-32">Price</th>
              <th className="text-right px-4 py-3 w-24">Stock</th>
              <th className="text-center px-4 py-3 w-16">Fav</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>Loading…</td></tr>}
            {list.error && <tr><td className="px-4 py-6 text-red" colSpan={7}>Failed: {list.error.message}</td></tr>}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>No products match.</td></tr>
            )}
            {list.data?.map((row) => (
              <ProductListRow key={row.id} row={row} canUpdate={canUpdate} canDelete={canDelete}
                onEdit={setEditing} onToggleActive={handleToggleActive} onToggleFavorite={handleToggleFavorite}
                onDelete={setDeleting} />
            ))}
          </tbody>
        </table>
      </div>

      <ProductFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <ProductFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <ProductDeleteConfirm open={deleting !== undefined} row={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
```

> **No route changes needed** — `/backoffice/products` is already wired (just without a `<PermissionGate>` since the original was read-only). Wrap it now while you're here:

In `apps/backoffice/src/routes/index.tsx`, change:

```tsx
<Route path="products" element={<ProductsPage />} />
```

to

```tsx
<Route
  path="products"
  element={
    <PermissionGate required="products.read">
      <ProductsPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
git add apps/backoffice/src/pages/Products.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 11 — Products full CRUD page + perm gate"
```

---

## Task 7: Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/products-crud.smoke.test.tsx`

- [ ] **Step 1: Write the smoke**

```tsx
// apps/backoffice/src/__tests__/products-crud.smoke.test.tsx
//
// MANAGER session. Asserts: list load → create → toggle favorite → edit
// price → toggle inactive → soft-delete.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductsPage from '@/pages/Products.js';
import { useAuthStore } from '@/stores/authStore.js';

vi.mock('@/lib/supabase.js', () => {
  const tables: Record<string, Record<string, unknown>[]> = {
    products: [],
    categories: [
      { id: 'cat-1', name: 'Beverages', slug: 'beverage', sort_order: 1, is_active: true, deleted_at: null },
    ],
  };
  function makeBuilder(table: string) {
    let chain: { filters: Record<string, unknown>; isDeletedNull: boolean; neqs: [string, unknown][] } =
      { filters: {}, isDeletedNull: false, neqs: [] };
    const api = {
      select: () => api,
      is:    (col: string, val: unknown) => { if (col === 'deleted_at' && val === null) chain.isDeletedNull = true; return api; },
      eq:    (col: string, val: unknown) => { chain.filters[col] = val; return api; },
      neq:   (col: string, val: unknown) => { chain.neqs.push([col, val]); return api; },
      or:    () => api,
      order: () => api,
      single: async () => ({ data: tables[table][tables[table].length - 1], error: null }),
      insert: (row: Record<string, unknown>) => {
        tables[table].push({ id: crypto.randomUUID(), current_stock: 0, ...row });
        return api;
      },
      update: (vals: Record<string, unknown>) => {
        const target = tables[table].find((r) =>
          Object.entries(chain.filters).every(([k, v]) => r[k] === v));
        if (target) Object.assign(target, vals);
        return api;
      },
      then: (cb: (v: { data: typeof tables[string]; error: null }) => void) => {
        const filtered = tables[table].filter((r) =>
          (!chain.isDeletedNull || r.deleted_at == null)
          && chain.neqs.every(([k, v]) => r[k] !== v)
          && Object.entries(chain.filters).every(([k, v]) => r[k] === v));
        cb({ data: filtered, error: null });
      },
    } as unknown as { [key: string]: unknown };
    return api;
  }
  return { supabase: { from: vi.fn().mockImplementation((t: string) => makeBuilder(t)) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProductsPage />
    </QueryClientProvider>,
  );
}

describe('ProductsPage smoke', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'MANAGER', full_name: 'Mgr', permissions: [
        'products.read', 'products.create', 'products.update', 'products.delete',
      ] },
      isAuthenticated: true,
    } as never);
  });

  it('creates a coffee product and toggles favorite then deletes it', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Products/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New product/i }));

    await user.type(screen.getByLabelText(/^SKU/i),   'COF-001');
    await user.type(screen.getByLabelText(/^Name/i),  'Espresso');
    await user.selectOptions(screen.getByLabelText(/Category/i), 'cat-1');
    const price = screen.getByLabelText(/Retail price/i) as HTMLInputElement;
    await user.clear(price); await user.type(price, '25000');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(screen.getByText('Espresso')).toBeInTheDocument());

    const row = screen.getByText('Espresso').closest('tr')!;
    await user.click(within(row).getByLabelText(/Toggle Espresso favorite/i));
    await user.click(within(row).getByRole('button', { name: /Delete Espresso/i }));
    await user.click(screen.getByRole('button', { name: /Confirm delete/i }));
    await waitFor(() => expect(screen.queryByText('Espresso')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run smoke + full BO suite**

```bash
pnpm --filter backoffice test -- products-crud.smoke
pnpm --filter backoffice test
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/__tests__/products-crud.smoke.test.tsx
git commit -m "test(backoffice): session 11 — products CRUD smoke"
```

---

## Task 8: POS reload integration check

This is a verification step, not new code. The spec §6 says: "BO product create: crée nouveau produit → apparaît dans `/backoffice/products` ET dans `/pos` après reload."

- [ ] **Step 1: Verify the POS-side product query invalidates on BO mutations**

Search for `['products']` query key usages across the POS app:

```bash
grep -RIn "['\"]products['\"]" apps/pos/src --include="*.ts" --include="*.tsx"
```

Expected: the POS reads via `apps/pos/src/features/products/hooks/useProducts.ts` (or similar) using the same `['products']` key. Our BO mutations invalidate that key on success (Task 2 hooks). Reload of the POS tab should refetch and show the new product. **No additional code change needed** unless the POS uses a different key — in which case, add it to the BO mutations' `onSuccess` invalidations.

- [ ] **Step 2: Manual smoke (dev)**

```bash
pnpm --filter pos dev          # in one terminal
pnpm --filter backoffice dev   # in another terminal
```

1. Log into BO as MANAGER, create a product.
2. Log into POS as a cashier in another tab.
3. Refresh the POS tab — the new product appears in its category.

> If it doesn't appear, file a follow-up: the POS reads aren't invalidated cross-tab. Cross-tab invalidation is out of scope this session (BroadcastChannel wire-up is a session 15 item).

---

## Phase exit criteria

- [ ] `/backoffice/products` shows the full CRUD UI (Create button, edit/delete row actions, inline toggles)
- [ ] Existing read-only consumers (e.g. POS) still receive untouched data (combos filtered out at the BO layer only)
- [ ] All 8 commits landed
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings, `pnpm test` green
- [ ] Manual cross-app smoke: BO create → POS reload shows the product

Once all checked, dispatch the subagent for Phase 07 (`combos`).
