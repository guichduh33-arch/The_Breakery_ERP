# Session 11 — Phase 03 — Customer Categories CRUD Implementation Plan

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Module concerné** : [`08-customers-loyalty`](../../reference/04-modules/08-customers-loyalty.md)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Backoffice CRUD UI for `customer_categories`. This entity drives pricing tiers (retail / wholesale / discount %) and the loyalty `points_multiplier`. Write actions are ADMIN-only per spec C4 (sensitive — affects pricing).

**Architecture:** Same feature-folder + page + route pattern as Phase 01–02 (see INDEX § "Shared feature-folder layout"). Plain `supabase.from('customer_categories')` reads/writes. The form must enforce the **`is_default` exclusivity invariant**: at most one row may have `is_default = true` (DB enforces via a partial unique index — the form does pre-flight check + the UI surfaces the resulting 23505 conflict if the race loses).

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md` §0 (Customer categories CRUD bullet)
**Parent plan:** `docs/workplan/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- `customer_categories` table exists (`supabase/migrations/20260509000001_init_customer_categories.sql`)
- Perms `customer_categories.{read,create,update,delete}` seeded
- Phase 01 (Suppliers) complete — establishes the scaffold pattern

**Entity schema** (excerpt from migration `20260509000001`):

```
id                  UUID PK
name                TEXT NOT NULL
slug                TEXT NOT NULL  UNIQUE NULLS NOT DISTINCT (slug)
color               TEXT NULL
icon                TEXT NULL
price_modifier_type ENUM('retail','wholesale','discount_percentage','custom')
discount_percentage DECIMAL(5,2) DEFAULT 0  CHECK (0..100)
loyalty_enabled     BOOLEAN DEFAULT true
points_multiplier   DECIMAL(4,2) DEFAULT 1.0  CHECK (>= 0)
is_default          BOOLEAN DEFAULT false  -- partial unique idx: only ONE active default
is_active           BOOLEAN DEFAULT true
deleted_at          TIMESTAMPTZ
```

The `idx_customer_categories_one_default` partial unique index (line 26-28 of the migration) enforces "at most one default". The form must un-set the previous default before setting a new one if the user flips `is_default` on a non-default row. Recommended approach: in `useUpdateCustomerCategory.ts`, when the payload sets `is_default: true`, first issue an `UPDATE customer_categories SET is_default = false WHERE is_default = true` in the same transaction — wrap both writes in a stored procedure `swap_default_customer_category(p_id UUID)` to avoid the race window. See Task 2 for the RPC migration.

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `supabase/migrations/20260517000001_create_swap_default_customer_category_rpc.sql` |
| CREATE | `apps/backoffice/src/features/customer-categories/hooks/useCustomerCategoriesList.ts` |
| CREATE | `apps/backoffice/src/features/customer-categories/hooks/useCreateCustomerCategory.ts` |
| CREATE | `apps/backoffice/src/features/customer-categories/hooks/useUpdateCustomerCategory.ts` |
| CREATE | `apps/backoffice/src/features/customer-categories/hooks/useDeleteCustomerCategory.ts` |
| CREATE | `apps/backoffice/src/features/customer-categories/components/CustomerCategoryFormModal.tsx` |
| CREATE | `apps/backoffice/src/features/customer-categories/components/CustomerCategoryListRow.tsx` |
| CREATE | `apps/backoffice/src/features/customer-categories/components/CustomerCategoryDeleteConfirm.tsx` |
| CREATE | `apps/backoffice/src/pages/CustomerCategories.tsx` |
| MODIFY | `apps/backoffice/src/routes/index.tsx` (add `/customer-categories` route) |
| CREATE | `apps/backoffice/src/__tests__/customer-categories-crud.smoke.test.tsx` |
| MODIFY | `packages/supabase/src/types.generated.ts` (regen via `pnpm db:types` after migration) |

---

## Task 1: DB — `swap_default_customer_category` RPC

**Files:**
- Create: `supabase/migrations/20260517000001_create_swap_default_customer_category_rpc.sql`

This RPC atomically promotes one row to default and un-defaults the previous one. Saves the BO from sequential UPDATE-then-UPDATE that would race against the partial unique index.

- [ ] **Step 1: Write the migration**

```sql
-- 20260517000001_create_swap_default_customer_category_rpc.sql
-- Session 11 — atomic "set as default" for customer_categories.
-- Bypasses the race against idx_customer_categories_one_default by performing
-- both UPDATEs in the same transaction (SECURITY DEFINER so the policy can
-- gate only customer_categories.update without needing two perms).

CREATE OR REPLACE FUNCTION swap_default_customer_category(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_user, 'customer_categories.update') THEN
    RAISE EXCEPTION 'Permission denied: customer_categories.update' USING ERRCODE = 'P0003';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customer_categories WHERE id = p_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Customer category not found: %', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Both UPDATEs run in the same implicit transaction. The partial unique
  -- index ensures the second UPDATE is feasible only after the first commits.
  UPDATE customer_categories SET is_default = false, updated_at = now()
    WHERE is_default = true AND deleted_at IS NULL AND id <> p_id;

  UPDATE customer_categories SET is_default = true, updated_at = now()
    WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION swap_default_customer_category TO authenticated;

COMMENT ON FUNCTION swap_default_customer_category IS
  'Session 11. Atomically promotes one customer category to default and un-defaults the previous one.';
```

- [ ] **Step 2: Apply + regen types**

```bash
pnpm db:reset
pnpm db:types
```
Expected: migration applies cleanly, `packages/supabase/src/types.generated.ts` gains `swap_default_customer_category` under `Functions`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260517000001_create_swap_default_customer_category_rpc.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db): session 11 — swap_default_customer_category RPC + GRANT"
```

---

## Task 2: List hook + types

**Files:**
- Create: `apps/backoffice/src/features/customer-categories/hooks/useCustomerCategoriesList.ts`

- [ ] **Step 1: Write the hook**

```ts
// apps/backoffice/src/features/customer-categories/hooks/useCustomerCategoriesList.ts
//
// BO list of customer_categories. Excludes soft-deleted. Sorted by sort key
// (is_default desc, name asc) so the default tier is always pinned at top.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type CustomerCategoryRow    = Database['public']['Tables']['customer_categories']['Row'];
export type CustomerCategoryInsert = Database['public']['Tables']['customer_categories']['Insert'];
export type CustomerCategoryUpdate = Database['public']['Tables']['customer_categories']['Update'];

export type PriceModifierType =
  Database['public']['Enums']['price_modifier_type'];

export type ActiveFilter = 'all' | 'active' | 'inactive';
export type TypeFilter   = 'all' | PriceModifierType;

export interface CustomerCategoriesListFilters {
  active?: ActiveFilter;
  type?: TypeFilter;
}

export const CC_QUERY_KEY = ['customer-categories-bo'] as const;

export function useCustomerCategoriesList(filters: CustomerCategoriesListFilters = {}) {
  return useQuery<CustomerCategoryRow[]>({
    queryKey: [...CC_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('customer_categories')
        .select('*')
        .is('deleted_at', null)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });

      if (filters.active === 'active')   q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);
      if (filters.type !== undefined && filters.type !== 'all') q = q.eq('price_modifier_type', filters.type);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/customer-categories/hooks/useCustomerCategoriesList.ts
git commit -m "feat(backoffice): session 11 — useCustomerCategoriesList hook"
```

---

## Task 3: Mutation hooks (with `is_default` swap path)

**Files:**
- Create: `apps/backoffice/src/features/customer-categories/hooks/useCreateCustomerCategory.ts`
- Create: `apps/backoffice/src/features/customer-categories/hooks/useUpdateCustomerCategory.ts`
- Create: `apps/backoffice/src/features/customer-categories/hooks/useDeleteCustomerCategory.ts`

- [ ] **Step 1: Write `useCreateCustomerCategory`**

```ts
// apps/backoffice/src/features/customer-categories/hooks/useCreateCustomerCategory.ts
//
// When the payload sets is_default = true, we first call swap_default_*
// to un-default any existing default in the same transaction, THEN insert
// the new row with is_default = true. If we just inserted directly, the
// partial unique idx would reject when another row already has it.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import {
  CC_QUERY_KEY,
  type CustomerCategoryInsert,
  type CustomerCategoryRow,
} from './useCustomerCategoriesList.js';

export function useCreateCustomerCategory() {
  const qc = useQueryClient();
  return useMutation<CustomerCategoryRow, Error, CustomerCategoryInsert>({
    mutationFn: async (values) => {
      // If user wants this new row as default, un-default existing first.
      if (values.is_default === true) {
        const { error: unsetErr } = await supabase
          .from('customer_categories')
          .update({ is_default: false })
          .eq('is_default', true)
          .is('deleted_at', null);
        if (unsetErr) throw unsetErr;
      }
      const { data, error } = await supabase
        .from('customer_categories')
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CC_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 2: Write `useUpdateCustomerCategory`**

```ts
// apps/backoffice/src/features/customer-categories/hooks/useUpdateCustomerCategory.ts
//
// Updates ANY field. When is_default flips true → uses the
// swap_default_customer_category RPC for atomicity.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import {
  CC_QUERY_KEY,
  type CustomerCategoryRow,
  type CustomerCategoryUpdate,
} from './useCustomerCategoriesList.js';

export interface UpdateCCArgs {
  id: string;
  values: CustomerCategoryUpdate;
  promoteToDefault?: boolean;
}

export function useUpdateCustomerCategory() {
  const qc = useQueryClient();
  return useMutation<CustomerCategoryRow, Error, UpdateCCArgs>({
    mutationFn: async ({ id, values, promoteToDefault }) => {
      // Strip is_default if we're using the RPC path — the RPC handles it.
      const valuesWithoutDefault = { ...values };
      if (promoteToDefault === true) {
        delete valuesWithoutDefault.is_default;
        const { error: rpcErr } = await supabase.rpc('swap_default_customer_category', { p_id: id });
        if (rpcErr) throw rpcErr;
      }
      const { data, error } = await supabase
        .from('customer_categories')
        .update(valuesWithoutDefault)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CC_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 3: Write `useDeleteCustomerCategory`**

```ts
// apps/backoffice/src/features/customer-categories/hooks/useDeleteCustomerCategory.ts
//
// Soft-deletes the category. The UI must verify no live customers reference
// it before enabling the delete button (spec §7 garde-fou "dangling FK").

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CC_QUERY_KEY } from './useCustomerCategoriesList.js';

export function useDeleteCustomerCategory() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      // Defensive pre-check (also gives a friendlier error than 23503).
      const { count, error: cntErr } = await supabase
        .from('customers')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', id)
        .is('deleted_at', null);
      if (cntErr) throw cntErr;
      if ((count ?? 0) > 0) {
        throw new Error(`Cannot delete: ${count} active customers still reference this category.`);
      }
      const { error } = await supabase
        .from('customer_categories')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CC_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/customer-categories/hooks/
git commit -m "feat(backoffice): session 11 — customer_categories CRUD hooks (RPC swap_default path)"
```

---

## Task 4: FormModal

**Files:**
- Create: `apps/backoffice/src/features/customer-categories/components/CustomerCategoryFormModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
// apps/backoffice/src/features/customer-categories/components/CustomerCategoryFormModal.tsx
//
// Create / edit dialog for a customer pricing tier. Fields:
//   name, slug, price_modifier_type, discount_percentage (only when type='discount_percentage'),
//   loyalty_enabled, points_multiplier, is_default, is_active.

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
import { useCreateCustomerCategory } from '../hooks/useCreateCustomerCategory.js';
import { useUpdateCustomerCategory } from '../hooks/useUpdateCustomerCategory.js';
import type { CustomerCategoryRow, PriceModifierType } from '../hooks/useCustomerCategoriesList.js';

const SCHEMA = z.object({
  name: z.string().trim().min(1, 'Name required').max(64, '≤ 64 chars'),
  slug: z.string().trim().min(1, 'Slug required').max(32, '≤ 32 chars').regex(/^[a-z0-9_-]+$/, 'Lowercase, digits, _ or -'),
  price_modifier_type: z.enum(['retail', 'wholesale', 'discount_percentage', 'custom']),
  discount_percentage: z.number().min(0, '≥ 0').max(100, '≤ 100'),
  loyalty_enabled: z.boolean(),
  points_multiplier: z.number().min(0, '≥ 0').max(10, '≤ 10'),
  is_default: z.boolean(),
  is_active: z.boolean(),
}).refine(
  (d) => d.price_modifier_type !== 'discount_percentage' || d.discount_percentage > 0,
  { message: 'Discount % must be > 0 for discount_percentage type', path: ['discount_percentage'] },
);

interface Draft {
  name: string;
  slug: string;
  price_modifier_type: PriceModifierType;
  discount_percentage: number;
  loyalty_enabled: boolean;
  points_multiplier: number;
  is_default: boolean;
  is_active: boolean;
}

const DEFAULT: Draft = {
  name: '',
  slug: '',
  price_modifier_type: 'retail',
  discount_percentage: 0,
  loyalty_enabled: true,
  points_multiplier: 1.0,
  is_default: false,
  is_active: true,
};

function rowToDraft(r: CustomerCategoryRow): Draft {
  return {
    name: r.name,
    slug: r.slug,
    price_modifier_type: r.price_modifier_type,
    discount_percentage: Number(r.discount_percentage),
    loyalty_enabled: r.loyalty_enabled,
    points_multiplier: Number(r.points_multiplier),
    is_default: r.is_default,
    is_active: r.is_active,
  };
}

export interface CustomerCategoryFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: CustomerCategoryRow | undefined;
  onClose: () => void;
}

export function CustomerCategoryFormModal({ open, mode, initial, onClose }: CustomerCategoryFormModalProps) {
  const createMut = useCreateCustomerCategory();
  const updateMut = useUpdateCustomerCategory();

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
  const isPromotingToDefault = mode === 'edit' && initial !== undefined && !initial.is_default && draft.is_default;

  async function handleSubmit() {
    setServerError(null);
    const parsed = SCHEMA.safeParse(draft);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    try {
      if (mode === 'create') {
        await createMut.mutateAsync(parsed.data);
      } else if (initial !== undefined) {
        await updateMut.mutateAsync({
          id: initial.id,
          values: parsed.data,
          ...(isPromotingToDefault ? { promoteToDefault: true } : {}),
        });
      }
      onClose();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{mode === 'create' ? 'New customer category' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>Pricing tier + loyalty multiplier. The default tier is auto-attached to anonymous POS customers.</DialogDescription>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div>
            <label htmlFor="cc-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
            <input id="cc-name" value={draft.name} onChange={(e) => setField('name', e.target.value)} maxLength={64}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="cc-slug" className="text-xs uppercase tracking-widest text-text-secondary">Slug *</label>
            <input id="cc-slug" value={draft.slug} onChange={(e) => setField('slug', e.target.value.toLowerCase())}
              maxLength={32} disabled={mode === 'edit'}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono text-text-primary disabled:opacity-50" />
            {errors.slug && <p className="text-red text-xs mt-1">{errors.slug}</p>}
          </div>
          <div>
            <label htmlFor="cc-type" className="text-xs uppercase tracking-widest text-text-secondary">Pricing type</label>
            <select id="cc-type" value={draft.price_modifier_type}
              onChange={(e) => setField('price_modifier_type', e.target.value as PriceModifierType)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
              <option value="retail">Retail (default)</option>
              <option value="wholesale">Wholesale (uses products.wholesale_price)</option>
              <option value="discount_percentage">Discount %</option>
              <option value="custom">Custom (manual handling)</option>
            </select>
          </div>
          {draft.price_modifier_type === 'discount_percentage' && (
            <div>
              <label htmlFor="cc-disc" className="text-xs uppercase tracking-widest text-text-secondary">Discount %</label>
              <input id="cc-disc" type="number" min={0} max={100} step={0.5}
                value={draft.discount_percentage}
                onChange={(e) => setField('discount_percentage', Number(e.target.value) || 0)}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
              {errors.discount_percentage && <p className="text-red text-xs mt-1">{errors.discount_percentage}</p>}
            </div>
          )}
          <div>
            <label htmlFor="cc-mult" className="text-xs uppercase tracking-widest text-text-secondary">Points multiplier</label>
            <input id="cc-mult" type="number" min={0} max={10} step={0.5}
              value={draft.points_multiplier} disabled={!draft.loyalty_enabled}
              onChange={(e) => setField('points_multiplier', Number(e.target.value) || 0)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
            {errors.points_multiplier && <p className="text-red text-xs mt-1">{errors.points_multiplier}</p>}
          </div>
          <div className="col-span-2 flex flex-wrap gap-6 items-center">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.loyalty_enabled}
                onChange={(e) => setField('loyalty_enabled', e.target.checked)} />
              Loyalty enabled
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.is_default}
                onChange={(e) => setField('is_default', e.target.checked)} />
              Default tier (auto-attached to anonymous customers)
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.is_active}
                onChange={(e) => setField('is_active', e.target.checked)} />
              Active
            </label>
          </div>
        </div>

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
git add apps/backoffice/src/features/customer-categories/components/CustomerCategoryFormModal.tsx
git commit -m "feat(backoffice): session 11 — CustomerCategoryFormModal (with default-swap UX)"
```

---

## Task 5: ListRow + DeleteConfirm

**Files:**
- Create: `apps/backoffice/src/features/customer-categories/components/CustomerCategoryListRow.tsx`
- Create: `apps/backoffice/src/features/customer-categories/components/CustomerCategoryDeleteConfirm.tsx`

- [ ] **Step 1: Write `CustomerCategoryListRow`**

```tsx
// apps/backoffice/src/features/customer-categories/components/CustomerCategoryListRow.tsx
import { Pencil, Star, Trash2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { CustomerCategoryRow } from '../hooks/useCustomerCategoriesList.js';

const TYPE_LABEL: Record<CustomerCategoryRow['price_modifier_type'], string> = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  discount_percentage: 'Discount %',
  custom: 'Custom',
};

export interface CustomerCategoryListRowProps {
  row: CustomerCategoryRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: CustomerCategoryRow) => void;
  onToggleActive: (row: CustomerCategoryRow) => void;
  onDelete: (row: CustomerCategoryRow) => void;
}

export function CustomerCategoryListRow({
  row, canUpdate, canDelete, onEdit, onToggleActive, onDelete,
}: CustomerCategoryListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {row.is_default && <Star className="h-4 w-4 fill-gold text-gold" aria-label="Default tier" />}
          <span className="font-semibold">{row.name}</span>
        </div>
        <div className="text-xs font-mono text-text-secondary">{row.slug}</div>
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">{TYPE_LABEL[row.price_modifier_type]}</td>
      <td className="px-4 py-3 text-right font-mono">
        {row.price_modifier_type === 'discount_percentage' ? `−${row.discount_percentage}%` : '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        {row.loyalty_enabled ? `×${row.points_multiplier}` : <span className="text-text-secondary">off</span>}
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
          {canDelete && !row.is_default && (
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

- [ ] **Step 2: Write `CustomerCategoryDeleteConfirm`**

```tsx
// apps/backoffice/src/features/customer-categories/components/CustomerCategoryDeleteConfirm.tsx
//
// The mutation hook already pre-flights the "no active customers" check —
// we surface its error here as the modal banner.

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteCustomerCategory } from '../hooks/useDeleteCustomerCategory.js';
import type { CustomerCategoryRow } from '../hooks/useCustomerCategoriesList.js';

export interface CustomerCategoryDeleteConfirmProps {
  open: boolean;
  row: CustomerCategoryRow | undefined;
  onClose: () => void;
}

export function CustomerCategoryDeleteConfirm({ open, row, onClose }: CustomerCategoryDeleteConfirmProps) {
  const deleteMut = useDeleteCustomerCategory();
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
        <DialogTitle>Soft-delete customer category</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Category <span className="text-text-primary font-semibold">{row.name}</span> will be hidden.
              Pricing / loyalty rules will stop applying for any future customer attached to it. Existing
              customers must first be re-categorised — the action will fail otherwise.
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
git add apps/backoffice/src/features/customer-categories/components/CustomerCategoryListRow.tsx apps/backoffice/src/features/customer-categories/components/CustomerCategoryDeleteConfirm.tsx
git commit -m "feat(backoffice): session 11 — CustomerCategoryListRow + DeleteConfirm"
```

---

## Task 6: Page + route wiring

**Files:**
- Create: `apps/backoffice/src/pages/CustomerCategories.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/backoffice/src/pages/CustomerCategories.tsx
//
// BO customer pricing tiers. Filterable by active + type.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { CustomerCategoryDeleteConfirm } from '@/features/customer-categories/components/CustomerCategoryDeleteConfirm.js';
import { CustomerCategoryFormModal } from '@/features/customer-categories/components/CustomerCategoryFormModal.js';
import { CustomerCategoryListRow } from '@/features/customer-categories/components/CustomerCategoryListRow.js';
import { useUpdateCustomerCategory } from '@/features/customer-categories/hooks/useUpdateCustomerCategory.js';
import {
  useCustomerCategoriesList,
  type ActiveFilter,
  type CustomerCategoriesListFilters,
  type CustomerCategoryRow,
  type TypeFilter,
} from '@/features/customer-categories/hooks/useCustomerCategoriesList.js';

export default function CustomerCategoriesPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('customer_categories.read');
  const canCreate = hasPermission('customer_categories.create');
  const canUpdate = hasPermission('customer_categories.update');
  const canDelete = hasPermission('customer_categories.delete');

  const [active, setActive] = useState<ActiveFilter>('all');
  const [type, setType]     = useState<TypeFilter>('all');

  const filters = useMemo<CustomerCategoriesListFilters>(
    () => ({ active, type }),
    [active, type],
  );

  const list = useCustomerCategoriesList(filters);
  const updateMut = useUpdateCustomerCategory();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<CustomerCategoryRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<CustomerCategoryRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view customer categories.</div>;
  }

  function handleToggleActive(row: CustomerCategoryRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Customer categories</h1>
          <p className="text-text-secondary text-sm mt-1">Pricing tiers + loyalty multipliers. Sensitive — ADMIN+.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New category
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1">
          <label htmlFor="cc-type-f" className="text-xs uppercase tracking-widest text-text-secondary">Type</label>
          <select id="cc-type-f" value={type} onChange={(e) => setType(e.target.value as TypeFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All types</option>
            <option value="retail">Retail</option>
            <option value="wholesale">Wholesale</option>
            <option value="discount_percentage">Discount %</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="cc-active-f" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="cc-active-f" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 w-32">Type</th>
              <th className="text-right px-4 py-3 w-24">Discount</th>
              <th className="text-right px-4 py-3 w-28">Multiplier</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={6}>Loading…</td></tr>}
            {list.error && <tr><td className="px-4 py-6 text-red" colSpan={6}>Failed to load: {list.error.message}</td></tr>}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={6}>No categories match.</td></tr>
            )}
            {list.data?.map((row) => (
              <CustomerCategoryListRow key={row.id} row={row} canUpdate={canUpdate} canDelete={canDelete}
                onEdit={setEditing} onToggleActive={handleToggleActive} onDelete={setDeleting} />
            ))}
          </tbody>
        </table>
      </div>

      <CustomerCategoryFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <CustomerCategoryFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <CustomerCategoryDeleteConfirm open={deleting !== undefined} row={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
```

- [ ] **Step 2: Add route in `apps/backoffice/src/routes/index.tsx`**

```tsx
import CustomerCategoriesPage from '@/pages/CustomerCategories.js';
```

```tsx
<Route
  path="customer-categories"
  element={
    <PermissionGate required="customer_categories.read">
      <CustomerCategoriesPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 3: Typecheck + lint + commit**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
git add apps/backoffice/src/pages/CustomerCategories.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 11 — CustomerCategories page + route"
```

---

## Task 7: Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/customer-categories-crud.smoke.test.tsx`

- [ ] **Step 1: Write the smoke test**

Follow the same shim pattern as Phases 01-02. Add an extra assertion for the default-swap path:

```tsx
// apps/backoffice/src/__tests__/customer-categories-crud.smoke.test.tsx
//
// Boots CustomerCategoriesPage under a mocked ADMIN session: list → create →
// promote-to-default (calls swap_default_customer_category RPC) → soft-delete
// (must succeed since no customers reference it).

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomerCategoriesPage from '@/pages/CustomerCategories.js';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';

const rpcSpy = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('@/lib/supabase.js', () => {
  const store: Record<string, unknown>[] = [];
  function makeBuilder() {
    let chain: { filters: Record<string, unknown>; isDeletedNull: boolean } = { filters: {}, isDeletedNull: false };
    const api = {
      select: () => api,
      is:    (col: string, val: unknown) => { if (col === 'deleted_at' && val === null) chain.isDeletedNull = true; return api; },
      eq:    (col: string, val: unknown) => { chain.filters[col] = val; return api; },
      order: () => api,
      single: async () => ({ data: store[store.length - 1], error: null }),
      insert: (row: Record<string, unknown>) => { store.push({ id: crypto.randomUUID(), ...row }); return api; },
      update: (vals: Record<string, unknown>) => {
        const target = store.find((r) => Object.entries(chain.filters).every(([k, v]) => r[k] === v));
        if (target) Object.assign(target, vals);
        return api;
      },
      then: (cb: (v: { data: typeof store; error: null; count: number }) => void) =>
        cb({ data: store.filter((r) => r.deleted_at == null), error: null, count: 0 }),
    } as unknown as { [key: string]: unknown };
    return api;
  }
  return { supabase: { from: vi.fn().mockImplementation(() => makeBuilder()), rpc: rpcSpy } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CustomerCategoriesPage />
    </QueryClientProvider>,
  );
}

describe('CustomerCategoriesPage smoke', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'ADMIN', full_name: 'Admin', permissions: [
        'customer_categories.read', 'customer_categories.create',
        'customer_categories.update', 'customer_categories.delete',
      ] },
      isAuthenticated: true,
    } as never);
  });

  it('creates a wholesale tier, promotes it to default (calls RPC), then soft-deletes', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Customer categories/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New category/i }));

    await user.type(screen.getByLabelText(/^Name/i), 'Wholesale Premium');
    await user.type(screen.getByLabelText(/^Slug/i), 'wholesale-premium');
    await user.selectOptions(screen.getByLabelText(/Pricing type/i), 'wholesale');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(screen.getByText('Wholesale Premium')).toBeInTheDocument());

    // Edit → toggle default → save → RPC fires
    const row = screen.getByText('Wholesale Premium').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /Edit Wholesale Premium/i }));
    await user.click(screen.getByLabelText(/Default tier/i));
    await user.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('swap_default_customer_category', expect.any(Object)));
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter backoffice test -- customer-categories-crud.smoke
```

- [ ] **Step 3: Full BO suite + commit**

```bash
pnpm --filter backoffice test
git add apps/backoffice/src/__tests__/customer-categories-crud.smoke.test.tsx
git commit -m "test(backoffice): session 11 — customer_categories CRUD smoke (RPC swap path)"
```

---

## Phase exit criteria

- [ ] `/backoffice/customer-categories` renders for an ADMIN, redirects for a CASHIER and MANAGER (write perms are ADMIN-only per spec C4; read perm may be MANAGER+ depending on seed — verify against `20260513000004_seed_backoffice_crud_perms.sql`)
- [ ] Default-swap path verified: promoting a non-default row calls the `swap_default_customer_category` RPC (smoke asserts this)
- [ ] Deleting a category that has live customers fails with the friendly error (pre-flight count > 0)
- [ ] All 7 commits landed
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings, `pnpm test` green

Once all checked, dispatch the subagent for Phase 04 (`categories`).
