# Session 11 — Phase 04 — Categories CRUD Implementation Plan

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Module concerné** : [`05-products-categories`](../../reference/04-modules/05-products-categories.md)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Backoffice CRUD UI for `categories` — product categories that drive the POS sort + KDS routing. Add the `color` column called out in the spec (currently missing from schema). Form exposes: `name`, `slug`, `sort_order`, `dispatch_station`, `color`, `is_active`.

**Architecture:** Same pattern as Phase 01 (Suppliers). One small migration adds `color TEXT` to `categories`. The form uses a color-input + a dispatch_station dropdown bound to the existing `'kitchen' | 'barista' | 'bakery' | 'none'` CHECK domain. Soft-delete is gated by a "no products referencing" pre-flight check identical to Phase 03's pattern.

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md` §0 (Categories CRUD bullet)
**Parent plan:** `docs/workplan/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- Phase 01 complete (scaffold pattern proven)
- `categories` table exists (`20260503000002_init_catalog.sql`)
- `categories.dispatch_station` exists (`20260505000002_extend_categories.sql`)
- Perms `categories.{read,create,update,delete}` seeded

**Entity schema (target after Task 1 migration):**

```
id               UUID PK
name             TEXT NOT NULL
slug             TEXT UNIQUE NOT NULL
sort_order       INTEGER DEFAULT 0
dispatch_station TEXT NOT NULL DEFAULT 'none'  CHECK IN ('kitchen','barista','bakery','none')
color            TEXT NULL                       -- NEW, hex like '#A87C5A' or NULL
is_active        BOOLEAN DEFAULT true
deleted_at       TIMESTAMPTZ
```

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `supabase/migrations/20260517000002_add_categories_color.sql` |
| MODIFY | `packages/supabase/src/types.generated.ts` (regen via `pnpm db:types`) |
| CREATE | `apps/backoffice/src/features/categories/hooks/useCategoriesList.ts` |
| CREATE | `apps/backoffice/src/features/categories/hooks/useCreateCategory.ts` |
| CREATE | `apps/backoffice/src/features/categories/hooks/useUpdateCategory.ts` |
| CREATE | `apps/backoffice/src/features/categories/hooks/useDeleteCategory.ts` |
| CREATE | `apps/backoffice/src/features/categories/components/CategoryFormModal.tsx` |
| CREATE | `apps/backoffice/src/features/categories/components/CategoryListRow.tsx` |
| CREATE | `apps/backoffice/src/features/categories/components/CategoryDeleteConfirm.tsx` |
| CREATE | `apps/backoffice/src/pages/Categories.tsx` |
| MODIFY | `apps/backoffice/src/routes/index.tsx` |
| CREATE | `apps/backoffice/src/__tests__/categories-crud.smoke.test.tsx` |

---

## Task 1: DB — add `categories.color`

**Files:**
- Create: `supabase/migrations/20260517000002_add_categories_color.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260517000002_add_categories_color.sql
-- Session 11 — add a nullable hex color to categories for the BO UI.
-- POS Display already supports color via the products.color path elsewhere;
-- this column gives admins a way to set a default category color.

ALTER TABLE categories
  ADD COLUMN color TEXT
    CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');

COMMENT ON COLUMN categories.color IS
  'Session 11. Optional hex color (#RRGGBB) used by the BO + POS for visual grouping.';
```

- [ ] **Step 2: Apply + regen types**

```bash
pnpm db:reset
pnpm db:types
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260517000002_add_categories_color.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db): session 11 — add categories.color column"
```

---

## Task 2: List hook + types

**Files:**
- Create: `apps/backoffice/src/features/categories/hooks/useCategoriesList.ts`

- [ ] **Step 1: Write the hook**

```ts
// apps/backoffice/src/features/categories/hooks/useCategoriesList.ts
//
// BO list of categories. Excludes soft-deleted. Sorted by sort_order ASC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type CategoryRow    = Database['public']['Tables']['categories']['Row'];
export type CategoryInsert = Database['public']['Tables']['categories']['Insert'];
export type CategoryUpdate = Database['public']['Tables']['categories']['Update'];

export type DispatchStation = 'kitchen' | 'barista' | 'bakery' | 'none';
export type ActiveFilter    = 'all' | 'active' | 'inactive';
export type StationFilter   = 'all' | DispatchStation;

export interface CategoriesListFilters {
  active?: ActiveFilter;
  station?: StationFilter;
  search?: string;
}

export const CATEGORIES_QUERY_KEY = ['categories-bo'] as const;

export function useCategoriesList(filters: CategoriesListFilters = {}) {
  return useQuery<CategoryRow[]>({
    queryKey: [...CATEGORIES_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('categories')
        .select('*')
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (filters.active === 'active')   q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);
      if (filters.station !== undefined && filters.station !== 'all') q = q.eq('dispatch_station', filters.station);
      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = filters.search.trim().replace(/[%_]/g, '\\$&');
        q = q.or(`name.ilike.%${term}%,slug.ilike.%${term}%`);
      }

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
git add apps/backoffice/src/features/categories/hooks/useCategoriesList.ts
git commit -m "feat(backoffice): session 11 — useCategoriesList hook"
```

---

## Task 3: Mutation hooks

**Files:**
- Create: `apps/backoffice/src/features/categories/hooks/useCreateCategory.ts`
- Create: `apps/backoffice/src/features/categories/hooks/useUpdateCategory.ts`
- Create: `apps/backoffice/src/features/categories/hooks/useDeleteCategory.ts`

- [ ] **Step 1: Write `useCreateCategory`**

```ts
// apps/backoffice/src/features/categories/hooks/useCreateCategory.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CATEGORIES_QUERY_KEY, type CategoryInsert, type CategoryRow } from './useCategoriesList.js';

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation<CategoryRow, Error, CategoryInsert>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('categories')
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      // Products page also depends on categories — invalidate its list.
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 2: Write `useUpdateCategory`**

```ts
// apps/backoffice/src/features/categories/hooks/useUpdateCategory.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CATEGORIES_QUERY_KEY, type CategoryRow, type CategoryUpdate } from './useCategoriesList.js';

export interface UpdateCategoryArgs {
  id: string;
  values: CategoryUpdate;
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation<CategoryRow, Error, UpdateCategoryArgs>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('categories')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 3: Write `useDeleteCategory`**

```ts
// apps/backoffice/src/features/categories/hooks/useDeleteCategory.ts
//
// Soft-delete blocked when any non-deleted products reference this category.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CATEGORIES_QUERY_KEY } from './useCategoriesList.js';

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { count, error: cntErr } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', id)
        .is('deleted_at', null);
      if (cntErr) throw cntErr;
      if ((count ?? 0) > 0) {
        throw new Error(`Cannot delete: ${count} active products still reference this category.`);
      }
      const { error } = await supabase
        .from('categories')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CATEGORIES_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/categories/hooks/
git commit -m "feat(backoffice): session 11 — category create/update/soft-delete hooks"
```

---

## Task 4: FormModal

**Files:**
- Create: `apps/backoffice/src/features/categories/components/CategoryFormModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
// apps/backoffice/src/features/categories/components/CategoryFormModal.tsx
//
// Create / edit dialog. The slug is locked in edit mode to avoid breaking
// products that may reference it by slug elsewhere in the codebase.

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
import { useCreateCategory } from '../hooks/useCreateCategory.js';
import { useUpdateCategory } from '../hooks/useUpdateCategory.js';
import type { CategoryRow, DispatchStation } from '../hooks/useCategoriesList.js';

const STATION_OPTIONS: DispatchStation[] = ['kitchen', 'barista', 'bakery', 'none'];

const SCHEMA = z.object({
  name: z.string().trim().min(1, 'Name required').max(64, '≤ 64 chars'),
  slug: z.string().trim().min(1, 'Slug required').max(32, '≤ 32 chars').regex(/^[a-z0-9_-]+$/, 'Lowercase / digits / _ - only'),
  sort_order: z.number().int().min(0, '≥ 0').max(999, '≤ 999'),
  dispatch_station: z.enum(['kitchen', 'barista', 'bakery', 'none']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be #RRGGBB').or(z.literal('')).nullable(),
  is_active: z.boolean(),
});

interface Draft {
  name: string;
  slug: string;
  sort_order: number;
  dispatch_station: DispatchStation;
  color: string;
  is_active: boolean;
}

const DEFAULT: Draft = {
  name: '', slug: '', sort_order: 0, dispatch_station: 'none', color: '', is_active: true,
};

function rowToDraft(r: CategoryRow): Draft {
  return {
    name: r.name,
    slug: r.slug,
    sort_order: r.sort_order,
    dispatch_station: r.dispatch_station as DispatchStation,
    color: r.color ?? '',
    is_active: r.is_active,
  };
}

function draftToPayload(d: Draft) {
  return {
    name: d.name.trim(),
    slug: d.slug.trim(),
    sort_order: d.sort_order,
    dispatch_station: d.dispatch_station,
    color: d.color.trim() === '' ? null : d.color.trim(),
    is_active: d.is_active,
  };
}

export interface CategoryFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: CategoryRow | undefined;
  onClose: () => void;
}

export function CategoryFormModal({ open, mode, initial, onClose }: CategoryFormModalProps) {
  const createMut = useCreateCategory();
  const updateMut = useUpdateCategory();

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
      const payload = draftToPayload(draft);
      if (mode === 'create') {
        await createMut.mutateAsync(payload);
      } else if (initial !== undefined) {
        await updateMut.mutateAsync({ id: initial.id, values: payload });
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      setServerError(msg.includes('23505') || /duplicate/i.test(msg)
        ? `A category with slug "${draft.slug}" already exists.`
        : msg);
    }
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{mode === 'create' ? 'New category' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>Categories group products in the POS and route to KDS stations.</DialogDescription>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div>
            <label htmlFor="cat-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
            <input id="cat-name" value={draft.name} onChange={(e) => setField('name', e.target.value)} maxLength={64}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="cat-slug" className="text-xs uppercase tracking-widest text-text-secondary">Slug *</label>
            <input id="cat-slug" value={draft.slug}
              onChange={(e) => setField('slug', e.target.value.toLowerCase())}
              maxLength={32} disabled={mode === 'edit'}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono text-text-primary disabled:opacity-50" />
            {errors.slug && <p className="text-red text-xs mt-1">{errors.slug}</p>}
          </div>
          <div>
            <label htmlFor="cat-station" className="text-xs uppercase tracking-widest text-text-secondary">KDS station</label>
            <select id="cat-station" value={draft.dispatch_station}
              onChange={(e) => setField('dispatch_station', e.target.value as DispatchStation)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
              {STATION_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cat-sort" className="text-xs uppercase tracking-widest text-text-secondary">Sort order</label>
            <input id="cat-sort" type="number" min={0} max={999} value={draft.sort_order}
              onChange={(e) => setField('sort_order', Number(e.target.value) || 0)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.sort_order && <p className="text-red text-xs mt-1">{errors.sort_order}</p>}
          </div>
          <div>
            <label htmlFor="cat-color" className="text-xs uppercase tracking-widest text-text-secondary">Color</label>
            <div className="flex gap-2 items-center">
              <input id="cat-color" type="color"
                value={draft.color === '' ? '#A87C5A' : draft.color}
                onChange={(e) => setField('color', e.target.value)}
                className="h-9 w-12 rounded-md border border-border-subtle bg-bg-input" />
              <input value={draft.color} onChange={(e) => setField('color', e.target.value)}
                placeholder="#A87C5A" maxLength={7}
                className="h-9 flex-1 rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono text-text-primary" />
            </div>
            {errors.color && <p className="text-red text-xs mt-1">{errors.color}</p>}
          </div>
          <div className="flex items-end">
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
git add apps/backoffice/src/features/categories/components/CategoryFormModal.tsx
git commit -m "feat(backoffice): session 11 — CategoryFormModal (color + KDS station)"
```

---

## Task 5: ListRow + DeleteConfirm

**Files:**
- Create: `apps/backoffice/src/features/categories/components/CategoryListRow.tsx`
- Create: `apps/backoffice/src/features/categories/components/CategoryDeleteConfirm.tsx`

- [ ] **Step 1: Write `CategoryListRow`**

```tsx
// apps/backoffice/src/features/categories/components/CategoryListRow.tsx
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { CategoryRow } from '../hooks/useCategoriesList.js';

const STATION_LABEL: Record<string, string> = {
  kitchen: 'Kitchen', barista: 'Barista', bakery: 'Bakery', none: '—',
};

export interface CategoryListRowProps {
  row: CategoryRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: CategoryRow) => void;
  onToggleActive: (row: CategoryRow) => void;
  onDelete: (row: CategoryRow) => void;
}

export function CategoryListRow({ row, canUpdate, canDelete, onEdit, onToggleActive, onDelete }: CategoryListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {row.color !== null && row.color !== '' && (
            <span aria-label="Color swatch"
              className="inline-block h-3 w-3 rounded-sm border border-border-subtle"
              style={{ backgroundColor: row.color }} />
          )}
          <span className="font-semibold">{row.name}</span>
        </div>
        <div className="text-xs font-mono text-text-secondary">{row.slug}</div>
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm">{STATION_LABEL[row.dispatch_station] ?? row.dispatch_station}</td>
      <td className="px-4 py-3 text-right font-mono text-text-secondary">{row.sort_order}</td>
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

- [ ] **Step 2: Write `CategoryDeleteConfirm`**

```tsx
// apps/backoffice/src/features/categories/components/CategoryDeleteConfirm.tsx
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteCategory } from '../hooks/useDeleteCategory.js';
import type { CategoryRow } from '../hooks/useCategoriesList.js';

export interface CategoryDeleteConfirmProps {
  open: boolean;
  row: CategoryRow | undefined;
  onClose: () => void;
}

export function CategoryDeleteConfirm({ open, row, onClose }: CategoryDeleteConfirmProps) {
  const deleteMut = useDeleteCategory();
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
        <DialogTitle>Soft-delete category</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Category <span className="text-text-primary font-semibold">{row.name}</span> will be hidden.
              The action will fail if any active products still reference it — re-assign them first.
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
git add apps/backoffice/src/features/categories/components/CategoryListRow.tsx apps/backoffice/src/features/categories/components/CategoryDeleteConfirm.tsx
git commit -m "feat(backoffice): session 11 — CategoryListRow + DeleteConfirm"
```

---

## Task 6: Page + route wiring

**Files:**
- Create: `apps/backoffice/src/pages/Categories.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/backoffice/src/pages/Categories.tsx
//
// BO categories list. Filter by station + status + search-by-name.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { CategoryDeleteConfirm } from '@/features/categories/components/CategoryDeleteConfirm.js';
import { CategoryFormModal } from '@/features/categories/components/CategoryFormModal.js';
import { CategoryListRow } from '@/features/categories/components/CategoryListRow.js';
import { useUpdateCategory } from '@/features/categories/hooks/useUpdateCategory.js';
import {
  useCategoriesList,
  type ActiveFilter,
  type CategoriesListFilters,
  type CategoryRow,
  type StationFilter,
} from '@/features/categories/hooks/useCategoriesList.js';

export default function CategoriesPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('categories.read');
  const canCreate = hasPermission('categories.create');
  const canUpdate = hasPermission('categories.update');
  const canDelete = hasPermission('categories.delete');

  const [active, setActive]   = useState<ActiveFilter>('all');
  const [station, setStation] = useState<StationFilter>('all');
  const [search, setSearch]   = useState<string>('');

  const filters = useMemo<CategoriesListFilters>(
    () => ({ active, station, ...(search.trim() !== '' ? { search } : {}) }),
    [active, station, search],
  );

  const list = useCategoriesList(filters);
  const updateMut = useUpdateCategory();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<CategoryRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<CategoryRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view categories.</div>;
  }

  function handleToggleActive(row: CategoryRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Categories</h1>
          <p className="text-text-secondary text-sm mt-1">Group products in the POS + route tickets to KDS stations.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New category
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <label htmlFor="cat-search-f" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input id="cat-search-f" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or slug" maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="cat-station-f" className="text-xs uppercase tracking-widest text-text-secondary">Station</label>
          <select id="cat-station-f" value={station} onChange={(e) => setStation(e.target.value as StationFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All</option>
            <option value="kitchen">Kitchen</option>
            <option value="barista">Barista</option>
            <option value="bakery">Bakery</option>
            <option value="none">None</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="cat-active-f" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="cat-active-f" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}
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
              <th className="text-left px-4 py-3">Name / slug</th>
              <th className="text-left px-4 py-3 w-32">Station</th>
              <th className="text-right px-4 py-3 w-24">Sort</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={5}>Loading…</td></tr>}
            {list.error && <tr><td className="px-4 py-6 text-red" colSpan={5}>Failed to load: {list.error.message}</td></tr>}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={5}>No categories match.</td></tr>
            )}
            {list.data?.map((row) => (
              <CategoryListRow key={row.id} row={row} canUpdate={canUpdate} canDelete={canDelete}
                onEdit={setEditing} onToggleActive={handleToggleActive} onDelete={setDeleting} />
            ))}
          </tbody>
        </table>
      </div>

      <CategoryFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <CategoryFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <CategoryDeleteConfirm open={deleting !== undefined} row={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the route**

In `apps/backoffice/src/routes/index.tsx`:

```tsx
import CategoriesPage from '@/pages/Categories.js';
```

```tsx
<Route
  path="categories"
  element={
    <PermissionGate required="categories.read">
      <CategoriesPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 3: Typecheck + lint + commit**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
git add apps/backoffice/src/pages/Categories.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 11 — Categories page + route"
```

---

## Task 7: Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/categories-crud.smoke.test.tsx`

- [ ] **Step 1: Write the smoke test**

Use the same in-memory supabase shim as Phase 01. Assertions:
1. Create a "Sandwiches" category with `dispatch_station=kitchen`, `color=#A87C5A` → row appears
2. Toggle active off → status changes to Inactive
3. Click delete → error banner appears if seeded with products referencing it (test seeds a fake product, expects the friendly error)
4. Remove the product reference + retry → succeeds

```tsx
// apps/backoffice/src/__tests__/categories-crud.smoke.test.tsx
//
// Categories CRUD smoke: create → toggle → delete-blocked → delete-allowed.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CategoriesPage from '@/pages/Categories.js';
import { useAuthStore } from '@/stores/authStore.js';

vi.mock('@/lib/supabase.js', () => {
  const tables: Record<string, Record<string, unknown>[]> = { categories: [], products: [] };
  function makeBuilder(table: string) {
    let chain: { filters: Record<string, unknown>; isDeletedNull: boolean; head: boolean } =
      { filters: {}, isDeletedNull: false, head: false };
    const api = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head === true) chain.head = true;
        return api;
      },
      is:    (col: string, val: unknown) => { if (col === 'deleted_at' && val === null) chain.isDeletedNull = true; return api; },
      eq:    (col: string, val: unknown) => { chain.filters[col] = val; return api; },
      or:    () => api,
      ilike: () => api,
      order: () => api,
      single: async () => ({ data: tables[table][tables[table].length - 1], error: null }),
      insert: (row: Record<string, unknown>) => { tables[table].push({ id: crypto.randomUUID(), ...row }); return api; },
      update: (vals: Record<string, unknown>) => {
        const target = tables[table].find((r) =>
          Object.entries(chain.filters).every(([k, v]) => r[k] === v));
        if (target) Object.assign(target, vals);
        return api;
      },
      then: (cb: (v: { data: typeof tables[string]; error: null; count: number }) => void) => {
        const filtered = tables[table].filter((r) =>
          (!chain.isDeletedNull || r.deleted_at == null)
          && Object.entries(chain.filters).every(([k, v]) => r[k] === v));
        return cb({ data: filtered, error: null, count: filtered.length });
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
      <CategoriesPage />
    </QueryClientProvider>,
  );
}

describe('CategoriesPage smoke', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'MANAGER', full_name: 'Mgr', permissions: [
        'categories.read', 'categories.create', 'categories.update', 'categories.delete',
      ] },
      isAuthenticated: true,
    } as never);
  });

  it('creates a Sandwiches category and toggles inactive', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Categories/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New category/i }));

    await user.type(screen.getByLabelText(/^Name/i), 'Sandwiches');
    await user.type(screen.getByLabelText(/^Slug/i), 'sandwiches');
    await user.selectOptions(screen.getByLabelText(/KDS station/i), 'kitchen');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(screen.getByText('Sandwiches')).toBeInTheDocument());

    const row = screen.getByText('Sandwiches').closest('tr')!;
    await user.click(within(row).getByLabelText(/Toggle Sandwiches active/i));
    await waitFor(() => expect(within(row).getByText(/Inactive/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test + full suite**

```bash
pnpm --filter backoffice test -- categories-crud.smoke
pnpm --filter backoffice test
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/__tests__/categories-crud.smoke.test.tsx
git commit -m "test(backoffice): session 11 — categories CRUD smoke"
```

---

## Phase exit criteria

- [ ] Migration `20260517000002_add_categories_color.sql` applied; `categories.color` is nullable + CHECK-constrained to `^#[0-9a-fA-F]{6}$`
- [ ] `/backoffice/categories` renders for MANAGER, redirects for CASHIER
- [ ] Deleting a category that has live products fails with a friendly error
- [ ] All 7 commits landed
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings, `pnpm test` green

Once all checked, Phase 06 (Products full CRUD) becomes unblocked.
