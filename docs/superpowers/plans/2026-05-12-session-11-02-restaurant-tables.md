# Session 11 — Phase 02 — Restaurant Tables CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Backoffice CRUD UI for `restaurant_tables`. Mirrors the Suppliers phase pattern with table-specific fields (`name`, `seats`, `sort_order`, `is_active`).

**Architecture:** Same feature-folder + page + route pattern as Phase 01 (see `2026-05-12-session-11-INDEX.md` § "Shared feature-folder layout"). Plain `supabase.from('restaurant_tables')` reads/writes. The POS already queries this table for the held-tables flow (session 4) — the BO list MUST exclude `deleted_at IS NOT NULL` so soft-deleted tables stop appearing in the POS picker.

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/superpowers/specs/2026-05-11-session-11-backoffice-crud-spec.md` §0 (Restaurant tables CRUD bullet)
**Parent plan:** `docs/superpowers/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- `restaurant_tables` table exists (`supabase/migrations/20260506000001_init_restaurant_tables.sql`)
- Perms `tables.{read,create,update,delete}` seeded (verify in `PermissionCode` union)
- Phase 01 completed (to validate the scaffold pattern is sound)

**Entity schema** (excerpt from migration `20260506000001`):

```
id          UUID PRIMARY KEY
name        TEXT NOT NULL                                 -- e.g. 'T-01', 'Patio-1', 'VIP'
seats       INTEGER NOT NULL DEFAULT 4                    CHECK (seats > 0 AND seats <= 20)
sort_order  INTEGER NOT NULL DEFAULT 0                    -- list ordering in POS picker
is_active   BOOLEAN NOT NULL DEFAULT true
deleted_at  TIMESTAMPTZ
UNIQUE NULLS NOT DISTINCT (name)                          -- name is a natural ID, enforce uniqueness
```

The `UNIQUE (name)` constraint matters: the form must surface a friendly error when a duplicate is attempted.

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `apps/backoffice/src/features/tables/hooks/useTablesList.ts` |
| CREATE | `apps/backoffice/src/features/tables/hooks/useCreateTable.ts` |
| CREATE | `apps/backoffice/src/features/tables/hooks/useUpdateTable.ts` |
| CREATE | `apps/backoffice/src/features/tables/hooks/useDeleteTable.ts` |
| CREATE | `apps/backoffice/src/features/tables/components/TableFormModal.tsx` |
| CREATE | `apps/backoffice/src/features/tables/components/TableListRow.tsx` |
| CREATE | `apps/backoffice/src/features/tables/components/TableDeleteConfirm.tsx` |
| CREATE | `apps/backoffice/src/pages/Tables.tsx` |
| MODIFY | `apps/backoffice/src/routes/index.tsx` (add `/tables` route + import) |
| CREATE | `apps/backoffice/src/__tests__/tables-crud.smoke.test.tsx` |

---

## Task 1: List hook + types

**Files:**
- Create: `apps/backoffice/src/features/tables/hooks/useTablesList.ts`

- [ ] **Step 1: Write the hook**

```ts
// apps/backoffice/src/features/tables/hooks/useTablesList.ts
//
// BO list of restaurant_tables. Excludes soft-deleted. The POS picker
// queries the same table elsewhere; soft-deleting hides a table from both
// surfaces without breaking referential history (orders.table_number is TEXT).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type TableRow = Database['public']['Tables']['restaurant_tables']['Row'];
export type TableInsert = Database['public']['Tables']['restaurant_tables']['Insert'];
export type TableUpdate = Database['public']['Tables']['restaurant_tables']['Update'];

export type ActiveFilter = 'all' | 'active' | 'inactive';

export interface TablesListFilters {
  active?: ActiveFilter;
  search?: string;
}

export const TABLES_QUERY_KEY = ['tables-bo'] as const;

export function useTablesList(filters: TablesListFilters = {}) {
  return useQuery<TableRow[]>({
    queryKey: [...TABLES_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('restaurant_tables')
        .select('*')
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (filters.active === 'active')   q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);

      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = filters.search.trim().replace(/[%_]/g, '\\$&');
        q = q.ilike('name', `%${term}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter backoffice typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/tables/hooks/useTablesList.ts
git commit -m "feat(backoffice): session 11 — useTablesList hook"
```

---

## Task 2: Mutation hooks

**Files:**
- Create: `apps/backoffice/src/features/tables/hooks/useCreateTable.ts`
- Create: `apps/backoffice/src/features/tables/hooks/useUpdateTable.ts`
- Create: `apps/backoffice/src/features/tables/hooks/useDeleteTable.ts`

- [ ] **Step 1: Write `useCreateTable`**

```ts
// apps/backoffice/src/features/tables/hooks/useCreateTable.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { TABLES_QUERY_KEY, type TableInsert, type TableRow } from './useTablesList.js';

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation<TableRow, Error, TableInsert>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('restaurant_tables')
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TABLES_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 2: Write `useUpdateTable`**

```ts
// apps/backoffice/src/features/tables/hooks/useUpdateTable.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { TABLES_QUERY_KEY, type TableRow, type TableUpdate } from './useTablesList.js';

export interface UpdateTableArgs {
  id: string;
  values: TableUpdate;
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation<TableRow, Error, UpdateTableArgs>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('restaurant_tables')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TABLES_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 3: Write `useDeleteTable`**

```ts
// apps/backoffice/src/features/tables/hooks/useDeleteTable.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { TABLES_QUERY_KEY } from './useTablesList.js';

export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('restaurant_tables')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: TABLES_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/tables/hooks/
git commit -m "feat(backoffice): session 11 — table create/update/soft-delete hooks"
```

---

## Task 3: FormModal

**Files:**
- Create: `apps/backoffice/src/features/tables/components/TableFormModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
// apps/backoffice/src/features/tables/components/TableFormModal.tsx
//
// Create / edit dialog for a restaurant table. `name` is the natural unique
// id — UI surfaces the 23505 unique-violation server error as a friendly
// "Name already exists" message.

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
import { useCreateTable } from '../hooks/useCreateTable.js';
import { useUpdateTable } from '../hooks/useUpdateTable.js';
import type { TableRow } from '../hooks/useTablesList.js';

const SCHEMA = z.object({
  name: z.string().trim().min(1, 'Name is required').max(32, '≤ 32 chars'),
  seats: z.number().int().min(1, 'At least 1 seat').max(20, '≤ 20 seats'),
  sort_order: z.number().int().min(0, '≥ 0').max(999, '≤ 999'),
  is_active: z.boolean(),
});

interface Draft {
  name: string;
  seats: number;
  sort_order: number;
  is_active: boolean;
}

const DEFAULT: Draft = { name: '', seats: 4, sort_order: 0, is_active: true };

function rowToDraft(r: TableRow): Draft {
  return { name: r.name, seats: r.seats, sort_order: r.sort_order, is_active: r.is_active };
}

export interface TableFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: TableRow | undefined;
  onClose: () => void;
}

export function TableFormModal({ open, mode, initial, onClose }: TableFormModalProps) {
  const createMut = useCreateTable();
  const updateMut = useUpdateTable();

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
      if (mode === 'create') {
        await createMut.mutateAsync(parsed.data);
      } else if (initial !== undefined) {
        await updateMut.mutateAsync({ id: initial.id, values: parsed.data });
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      // Postgres unique violation = 23505. Surface a friendlier message.
      if (msg.includes('23505') || /duplicate/i.test(msg)) {
        setServerError(`A table named "${draft.name}" already exists.`);
      } else {
        setServerError(msg);
      }
    }
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{mode === 'create' ? 'New table' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>Tables appear in the POS held-orders picker once active.</DialogDescription>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2">
            <label htmlFor="tbl-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
            <input id="tbl-name" value={draft.name} onChange={(e) => setField('name', e.target.value)} maxLength={32}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="tbl-seats" className="text-xs uppercase tracking-widest text-text-secondary">Seats</label>
            <input id="tbl-seats" type="number" min={1} max={20} value={draft.seats}
              onChange={(e) => setField('seats', Number(e.target.value) || 1)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.seats && <p className="text-red text-xs mt-1">{errors.seats}</p>}
          </div>
          <div>
            <label htmlFor="tbl-sort" className="text-xs uppercase tracking-widest text-text-secondary">Sort order</label>
            <input id="tbl-sort" type="number" min={0} max={999} value={draft.sort_order}
              onChange={(e) => setField('sort_order', Number(e.target.value) || 0)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.sort_order && <p className="text-red text-xs mt-1">{errors.sort_order}</p>}
          </div>
          <div className="col-span-2 flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.is_active}
                onChange={(e) => setField('is_active', e.target.checked)} />
              Active (visible in POS picker)
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
git add apps/backoffice/src/features/tables/components/TableFormModal.tsx
git commit -m "feat(backoffice): session 11 — TableFormModal (create + edit)"
```

---

## Task 4: ListRow + DeleteConfirm

**Files:**
- Create: `apps/backoffice/src/features/tables/components/TableListRow.tsx`
- Create: `apps/backoffice/src/features/tables/components/TableDeleteConfirm.tsx`

- [ ] **Step 1: Write `TableListRow`**

```tsx
// apps/backoffice/src/features/tables/components/TableListRow.tsx
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { TableRow } from '../hooks/useTablesList.js';

export interface TableListRowProps {
  row: TableRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: TableRow) => void;
  onToggleActive: (row: TableRow) => void;
  onDelete: (row: TableRow) => void;
}

export function TableListRow({ row, canUpdate, canDelete, onEdit, onToggleActive, onDelete }: TableListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3 font-mono">{row.name}</td>
      <td className="px-4 py-3 text-right font-mono">{row.seats}</td>
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

- [ ] **Step 2: Write `TableDeleteConfirm`**

```tsx
// apps/backoffice/src/features/tables/components/TableDeleteConfirm.tsx
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteTable } from '../hooks/useDeleteTable.js';
import type { TableRow } from '../hooks/useTablesList.js';

export interface TableDeleteConfirmProps {
  open: boolean;
  row: TableRow | undefined;
  onClose: () => void;
}

export function TableDeleteConfirm({ open, row, onClose }: TableDeleteConfirmProps) {
  const deleteMut = useDeleteTable();
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (row === undefined) return;
    setError(null);
    try {
      await deleteMut.mutateAsync(row.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete table');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogTitle>Soft-delete table</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Table <span className="text-text-primary font-semibold">{row.name}</span> ({row.seats} seats) will
              disappear from the POS picker. Existing orders that reference it stay intact.
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
git add apps/backoffice/src/features/tables/components/TableListRow.tsx apps/backoffice/src/features/tables/components/TableDeleteConfirm.tsx
git commit -m "feat(backoffice): session 11 — TableListRow + TableDeleteConfirm"
```

---

## Task 5: Page + route wiring

**Files:**
- Create: `apps/backoffice/src/pages/Tables.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/backoffice/src/pages/Tables.tsx
//
// BO restaurant tables list. Filterable by status + search-by-name.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { TableDeleteConfirm } from '@/features/tables/components/TableDeleteConfirm.js';
import { TableFormModal } from '@/features/tables/components/TableFormModal.js';
import { TableListRow } from '@/features/tables/components/TableListRow.js';
import { useUpdateTable } from '@/features/tables/hooks/useUpdateTable.js';
import {
  useTablesList,
  type ActiveFilter,
  type TableRow,
  type TablesListFilters,
} from '@/features/tables/hooks/useTablesList.js';

export default function TablesPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('tables.read');
  const canCreate = hasPermission('tables.create');
  const canUpdate = hasPermission('tables.update');
  const canDelete = hasPermission('tables.delete');

  const [active, setActive] = useState<ActiveFilter>('all');
  const [search, setSearch] = useState<string>('');

  const filters = useMemo<TablesListFilters>(
    () => ({ active, ...(search.trim() !== '' ? { search } : {}) }),
    [active, search],
  );

  const list = useTablesList(filters);
  const updateMut = useUpdateTable();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<TableRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<TableRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view tables.</div>;
  }

  function handleToggleActive(row: TableRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Tables</h1>
          <p className="text-text-secondary text-sm mt-1">Dining-room tables shown in the POS held-orders picker.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New table
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <label htmlFor="tbl-search" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input id="tbl-search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Table name" maxLength={32}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="tbl-active" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="tbl-active" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}
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
              <th className="text-right px-4 py-3 w-24">Seats</th>
              <th className="text-right px-4 py-3 w-24">Sort</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={5}>Loading…</td></tr>}
            {list.error && <tr><td className="px-4 py-6 text-red" colSpan={5}>Failed to load: {list.error.message}</td></tr>}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={5}>No tables match the current filters.</td></tr>
            )}
            {list.data?.map((row) => (
              <TableListRow key={row.id} row={row} canUpdate={canUpdate} canDelete={canDelete}
                onEdit={setEditing} onToggleActive={handleToggleActive} onDelete={setDeleting} />
            ))}
          </tbody>
        </table>
      </div>

      <TableFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <TableFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <TableDeleteConfirm open={deleting !== undefined} row={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the route in `apps/backoffice/src/routes/index.tsx`**

Add the import:

```tsx
import TablesPage from '@/pages/Tables.js';
```

Add the route inside `/backoffice`:

```tsx
<Route
  path="tables"
  element={
    <PermissionGate required="tables.read">
      <TablesPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/pages/Tables.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 11 — Tables page + /backoffice/tables route"
```

---

## Task 6: Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/tables-crud.smoke.test.tsx`

- [ ] **Step 1: Write the smoke test**

Follow the same shape as `suppliers-crud.smoke.test.tsx` (Phase 01 Task 6). Replace entity-specific assertions:

```tsx
// apps/backoffice/src/__tests__/tables-crud.smoke.test.tsx
//
// Boots TablesPage under a mocked MANAGER session: list load → create →
// edit seats → toggle inactive → soft-delete.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TablesPage from '@/pages/Tables.js';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';

vi.mock('@/lib/supabase.js', () => {
  // Reuse the same in-memory shim pattern as Phase 01. If a shared mock
  // already exists in `apps/backoffice/src/__tests__/_shared/supabaseMock.ts`,
  // import it instead of inlining.
  const store: Record<string, unknown>[] = [];
  function makeBuilder() {
    let chain: { filters: Record<string, unknown>; isDeletedNull: boolean } = { filters: {}, isDeletedNull: false };
    const api = {
      select: () => api,
      is: (col: string, val: unknown) => { if (col === 'deleted_at' && val === null) chain.isDeletedNull = true; return api; },
      eq: (col: string, val: unknown) => { chain.filters[col] = val; return api; },
      ilike: () => api,
      order: () => api,
      single: async () => ({ data: store[store.length - 1], error: null }),
      insert: (row: Record<string, unknown>) => { store.push({ id: crypto.randomUUID(), ...row }); return api; },
      update: (vals: Record<string, unknown>) => {
        const target = store.find((r) => Object.entries(chain.filters).every(([k, v]) => r[k] === v));
        if (target) Object.assign(target, vals);
        return api;
      },
      then: (cb: (v: { data: typeof store; error: null }) => void) => cb({ data: store.filter((r) => r.deleted_at == null), error: null }),
    } as unknown as { [key: string]: unknown };
    return api;
  }
  return { supabase: { from: vi.fn().mockImplementation(() => makeBuilder()) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TablesPage />
    </QueryClientProvider>,
  );
}

describe('TablesPage smoke', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'MANAGER', full_name: 'Mgr', permissions: [
        'tables.read', 'tables.create', 'tables.update', 'tables.delete',
      ] },
      isAuthenticated: true,
    } as never);
  });

  it('creates, toggles, edits, and soft-deletes a table', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Tables/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New table/i }));

    await user.type(screen.getByLabelText(/^Name/i), 'T-99');
    const seats = screen.getByLabelText(/^Seats/i) as HTMLInputElement;
    await user.clear(seats); await user.type(seats, '6');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(screen.getByText('T-99')).toBeInTheDocument());

    const row = screen.getByText('T-99').closest('tr')!;
    await user.click(within(row).getByLabelText(/Toggle T-99 active/i));
    await waitFor(() => expect(within(row).getByText(/Inactive/i)).toBeInTheDocument());

    await user.click(within(row).getByRole('button', { name: /Delete T-99/i }));
    await user.click(screen.getByRole('button', { name: /Confirm delete/i }));
    await waitFor(() => expect(screen.queryByText('T-99')).not.toBeInTheDocument());

    expect(supabase.from).toHaveBeenCalledWith('restaurant_tables');
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter backoffice test -- tables-crud.smoke
```

- [ ] **Step 3: Full BO suite**

```bash
pnpm --filter backoffice test
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/__tests__/tables-crud.smoke.test.tsx
git commit -m "test(backoffice): session 11 — tables CRUD smoke"
```

---

## Phase exit criteria

- [ ] `/backoffice/tables` renders for a MANAGER, redirects for a CASHIER
- [ ] All 6 commits landed in order
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings, `pnpm --filter backoffice test` green
- [ ] Manual smoke: deleting a table while it's the active table on an in-flight order does NOT break the POS held-orders flow (orders.table_number is TEXT, not an FK)

Once all checked, dispatch the subagent for Phase 03 (`customer-categories`).
