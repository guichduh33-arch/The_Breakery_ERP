# Session 11 — Phase 01 — Suppliers CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full Backoffice CRUD UI for `suppliers` — the simplest of the 7 entities this session (NEW table, no FK dependants yet, plain fields) — as the template-bearing implementation that subsequent phases mirror.

**Architecture:** New feature folder `apps/backoffice/src/features/suppliers/` (3 components + 4 hooks) plus a new page `apps/backoffice/src/pages/Suppliers.tsx`, wired to `/backoffice/suppliers` behind `<PermissionGate required="suppliers.read">`. All writes go through plain `supabase.from('suppliers')` calls (no RPC needed). RLS handles auth server-side.

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/superpowers/specs/2026-05-11-session-11-backoffice-crud-spec.md` §3.2, §4.3
**Parent plan:** `docs/superpowers/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites (verify before starting):**
- `suppliers` table exists (`supabase/migrations/20260513000001_init_suppliers.sql`)
- Perms `suppliers.{read,create,update,delete}` seeded (`20260513000004_seed_backoffice_crud_perms.sql`)
- `PermissionCode` TS union in `packages/supabase/src/rls/permissions.ts` includes all 4 codes
- `packages/supabase/src/types.generated.ts` has the `Database['public']['Tables']['suppliers']` types

If any of those is missing, STOP and run `pnpm db:reset && pnpm db:types`, then re-verify.

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `apps/backoffice/src/features/suppliers/hooks/useSuppliersList.ts` |
| CREATE | `apps/backoffice/src/features/suppliers/hooks/useCreateSupplier.ts` |
| CREATE | `apps/backoffice/src/features/suppliers/hooks/useUpdateSupplier.ts` |
| CREATE | `apps/backoffice/src/features/suppliers/hooks/useDeleteSupplier.ts` |
| CREATE | `apps/backoffice/src/features/suppliers/components/SupplierFormModal.tsx` |
| CREATE | `apps/backoffice/src/features/suppliers/components/SupplierListRow.tsx` |
| CREATE | `apps/backoffice/src/features/suppliers/components/SupplierDeleteConfirm.tsx` |
| CREATE | `apps/backoffice/src/pages/Suppliers.tsx` |
| MODIFY | `apps/backoffice/src/routes/index.tsx` (add `/suppliers` route + import) |
| CREATE | `apps/backoffice/src/__tests__/suppliers-crud.smoke.test.tsx` |

---

## Task 1: List hook + types

**Files:**
- Create: `apps/backoffice/src/features/suppliers/hooks/useSuppliersList.ts`

- [ ] **Step 1: Write the list hook**

```ts
// apps/backoffice/src/features/suppliers/hooks/useSuppliersList.ts
//
// Filtered BO list of suppliers. Excludes soft-deleted rows. Filterable by
// active/inactive + free-text search across name/code.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type SupplierRow = Database['public']['Tables']['suppliers']['Row'];
export type SupplierInsert = Database['public']['Tables']['suppliers']['Insert'];
export type SupplierUpdate = Database['public']['Tables']['suppliers']['Update'];

export type ActiveFilter = 'all' | 'active' | 'inactive';

export interface SuppliersListFilters {
  active?: ActiveFilter;
  search?: string;
}

export const SUPPLIERS_QUERY_KEY = ['suppliers-bo'] as const;

export function useSuppliersList(filters: SuppliersListFilters = {}) {
  return useQuery<SupplierRow[]>({
    queryKey: [...SUPPLIERS_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('suppliers')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (filters.active === 'active')   q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);

      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = filters.search.trim().replace(/[%_]/g, '\\$&');
        q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
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
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/suppliers/hooks/useSuppliersList.ts
git commit -m "feat(backoffice): session 11 — useSuppliersList hook + types"
```

---

## Task 2: Mutation hooks (create / update / delete)

**Files:**
- Create: `apps/backoffice/src/features/suppliers/hooks/useCreateSupplier.ts`
- Create: `apps/backoffice/src/features/suppliers/hooks/useUpdateSupplier.ts`
- Create: `apps/backoffice/src/features/suppliers/hooks/useDeleteSupplier.ts`

- [ ] **Step 1: Write `useCreateSupplier`**

```ts
// apps/backoffice/src/features/suppliers/hooks/useCreateSupplier.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { SUPPLIERS_QUERY_KEY, type SupplierInsert, type SupplierRow } from './useSuppliersList.js';

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation<SupplierRow, Error, SupplierInsert>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('suppliers')
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 2: Write `useUpdateSupplier`**

```ts
// apps/backoffice/src/features/suppliers/hooks/useUpdateSupplier.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { SUPPLIERS_QUERY_KEY, type SupplierRow, type SupplierUpdate } from './useSuppliersList.js';

export interface UpdateSupplierArgs {
  id: string;
  values: SupplierUpdate;
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation<SupplierRow, Error, UpdateSupplierArgs>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('suppliers')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 3: Write `useDeleteSupplier` (soft-delete)**

```ts
// apps/backoffice/src/features/suppliers/hooks/useDeleteSupplier.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { SUPPLIERS_QUERY_KEY } from './useSuppliersList.js';

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('suppliers')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter backoffice typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/suppliers/hooks/
git commit -m "feat(backoffice): session 11 — supplier create/update/soft-delete hooks"
```

---

## Task 3: FormModal component (create/edit)

**Files:**
- Create: `apps/backoffice/src/features/suppliers/components/SupplierFormModal.tsx`

The form is a single dialog used in both create and edit mode (`mode` prop). On submit it dispatches the appropriate mutation and closes.

- [ ] **Step 1: Write the modal**

```tsx
// apps/backoffice/src/features/suppliers/components/SupplierFormModal.tsx
//
// Create / edit dialog for the suppliers BO. Plain React state + inline Zod
// validation. Mirrors the session 10 CustomerFormModal pattern.

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
import { useCreateSupplier } from '../hooks/useCreateSupplier.js';
import { useUpdateSupplier } from '../hooks/useUpdateSupplier.js';
import type { SupplierRow } from '../hooks/useSuppliersList.js';

const SCHEMA = z.object({
  code: z.string().trim().min(1, 'Code is required').max(32, '≤ 32 chars'),
  name: z.string().trim().min(1, 'Name is required').max(120, '≤ 120 chars'),
  contact_phone: z.string().trim().max(32, '≤ 32 chars').nullable(),
  contact_email: z.string().trim().email('Invalid email').max(120).nullable().or(z.literal('')),
  address: z.string().trim().max(255, '≤ 255 chars').nullable(),
  payment_terms_days: z.number().int().min(0, 'Must be ≥ 0').max(365, '≤ 365'),
  notes: z.string().trim().max(500, '≤ 500 chars').nullable(),
  is_active: z.boolean(),
});

interface Draft {
  code: string;
  name: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  payment_terms_days: number;
  notes: string;
  is_active: boolean;
}

const DEFAULT: Draft = {
  code: '',
  name: '',
  contact_phone: '',
  contact_email: '',
  address: '',
  payment_terms_days: 30,
  notes: '',
  is_active: true,
};

function rowToDraft(row: SupplierRow): Draft {
  return {
    code: row.code,
    name: row.name,
    contact_phone: row.contact_phone ?? '',
    contact_email: row.contact_email ?? '',
    address: row.address ?? '',
    payment_terms_days: row.payment_terms_days,
    notes: row.notes ?? '',
    is_active: row.is_active,
  };
}

function draftToPayload(d: Draft) {
  return {
    code: d.code.trim(),
    name: d.name.trim(),
    contact_phone: d.contact_phone.trim() === '' ? null : d.contact_phone.trim(),
    contact_email: d.contact_email.trim() === '' ? null : d.contact_email.trim(),
    address:       d.address.trim()       === '' ? null : d.address.trim(),
    notes:         d.notes.trim()         === '' ? null : d.notes.trim(),
    payment_terms_days: d.payment_terms_days,
    is_active: d.is_active,
  };
}

export interface SupplierFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: SupplierRow | undefined;
  onClose: () => void;
}

export function SupplierFormModal({ open, mode, initial, onClose }: SupplierFormModalProps) {
  const createMut = useCreateSupplier();
  const updateMut = useUpdateSupplier();

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
    const payload = draftToPayload(draft);
    try {
      if (mode === 'create') {
        await createMut.mutateAsync(payload);
      } else if (initial !== undefined) {
        await updateMut.mutateAsync({ id: initial.id, values: payload });
      }
      onClose();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to save supplier');
    }
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{mode === 'create' ? 'New supplier' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>Suppliers feed the inventory receiving flow. Code must be unique.</DialogDescription>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-1">
            <label htmlFor="sup-code" className="text-xs uppercase tracking-widest text-text-secondary">Code *</label>
            <input id="sup-code" value={draft.code} onChange={(e) => setField('code', e.target.value)}
              maxLength={32} disabled={mode === 'edit'}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono uppercase text-text-primary disabled:opacity-50" />
            {errors.code && <p className="text-red text-xs mt-1">{errors.code}</p>}
          </div>
          <div className="col-span-1">
            <label htmlFor="sup-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
            <input id="sup-name" value={draft.name} onChange={(e) => setField('name', e.target.value)} maxLength={120}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="sup-phone" className="text-xs uppercase tracking-widest text-text-secondary">Phone</label>
            <input id="sup-phone" value={draft.contact_phone} onChange={(e) => setField('contact_phone', e.target.value)} maxLength={32}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.contact_phone && <p className="text-red text-xs mt-1">{errors.contact_phone}</p>}
          </div>
          <div>
            <label htmlFor="sup-email" className="text-xs uppercase tracking-widest text-text-secondary">Email</label>
            <input id="sup-email" type="email" value={draft.contact_email} onChange={(e) => setField('contact_email', e.target.value)} maxLength={120}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.contact_email && <p className="text-red text-xs mt-1">{errors.contact_email}</p>}
          </div>
          <div className="col-span-2">
            <label htmlFor="sup-addr" className="text-xs uppercase tracking-widest text-text-secondary">Address</label>
            <input id="sup-addr" value={draft.address} onChange={(e) => setField('address', e.target.value)} maxLength={255}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
          </div>
          <div>
            <label htmlFor="sup-terms" className="text-xs uppercase tracking-widest text-text-secondary">Payment terms (days)</label>
            <input id="sup-terms" type="number" min={0} max={365} value={draft.payment_terms_days}
              onChange={(e) => setField('payment_terms_days', Number(e.target.value) || 0)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.payment_terms_days && <p className="text-red text-xs mt-1">{errors.payment_terms_days}</p>}
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.is_active} onChange={(e) => setField('is_active', e.target.checked)} />
              Active
            </label>
          </div>
          <div className="col-span-2">
            <label htmlFor="sup-notes" className="text-xs uppercase tracking-widest text-text-secondary">Notes</label>
            <textarea id="sup-notes" rows={3} value={draft.notes} onChange={(e) => setField('notes', e.target.value)} maxLength={500}
              className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary" />
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

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter backoffice typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/features/suppliers/components/SupplierFormModal.tsx
git commit -m "feat(backoffice): session 11 — SupplierFormModal (create + edit)"
```

---

## Task 4: ListRow + DeleteConfirm components

**Files:**
- Create: `apps/backoffice/src/features/suppliers/components/SupplierListRow.tsx`
- Create: `apps/backoffice/src/features/suppliers/components/SupplierDeleteConfirm.tsx`

- [ ] **Step 1: Write `SupplierListRow`**

```tsx
// apps/backoffice/src/features/suppliers/components/SupplierListRow.tsx
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { SupplierRow } from '../hooks/useSuppliersList.js';

export interface SupplierListRowProps {
  row: SupplierRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: SupplierRow) => void;
  onToggleActive: (row: SupplierRow) => void;
  onDelete: (row: SupplierRow) => void;
}

export function SupplierListRow({ row, canUpdate, canDelete, onEdit, onToggleActive, onDelete }: SupplierListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3 font-mono uppercase text-text-secondary">{row.code}</td>
      <td className="px-4 py-3 font-semibold">{row.name}</td>
      <td className="px-4 py-3 text-text-secondary text-sm">{row.contact_phone ?? '—'}</td>
      <td className="px-4 py-3 text-text-secondary text-sm">{row.contact_email ?? '—'}</td>
      <td className="px-4 py-3 text-right font-mono">{row.payment_terms_days}d</td>
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

- [ ] **Step 2: Write `SupplierDeleteConfirm`**

```tsx
// apps/backoffice/src/features/suppliers/components/SupplierDeleteConfirm.tsx
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteSupplier } from '../hooks/useDeleteSupplier.js';
import type { SupplierRow } from '../hooks/useSuppliersList.js';

export interface SupplierDeleteConfirmProps {
  open: boolean;
  row: SupplierRow | undefined;
  onClose: () => void;
}

export function SupplierDeleteConfirm({ open, row, onClose }: SupplierDeleteConfirmProps) {
  const deleteMut = useDeleteSupplier();
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (row === undefined) return;
    setError(null);
    try {
      await deleteMut.mutateAsync(row.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete supplier');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogTitle>Soft-delete supplier</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Supplier <span className="text-text-primary font-semibold">{row.name}</span> ({row.code}) will be
              hidden from the list. Historical stock movements that reference it stay intact.
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

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter backoffice typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/features/suppliers/components/SupplierListRow.tsx apps/backoffice/src/features/suppliers/components/SupplierDeleteConfirm.tsx
git commit -m "feat(backoffice): session 11 — SupplierListRow + SupplierDeleteConfirm"
```

---

## Task 5: Page + route wiring

**Files:**
- Create: `apps/backoffice/src/pages/Suppliers.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/backoffice/src/pages/Suppliers.tsx
//
// BO suppliers list. Mirrors the session 10 Loyalty page shape: filters bar,
// table, create/edit/delete modals. RLS handles real auth at the DB layer;
// UI permission checks gate the buttons.

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { SupplierDeleteConfirm } from '@/features/suppliers/components/SupplierDeleteConfirm.js';
import { SupplierFormModal } from '@/features/suppliers/components/SupplierFormModal.js';
import { SupplierListRow } from '@/features/suppliers/components/SupplierListRow.js';
import { useUpdateSupplier } from '@/features/suppliers/hooks/useUpdateSupplier.js';
import {
  useSuppliersList,
  type ActiveFilter,
  type SupplierRow,
  type SuppliersListFilters,
} from '@/features/suppliers/hooks/useSuppliersList.js';

export default function SuppliersPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('suppliers.read');
  const canCreate = hasPermission('suppliers.create');
  const canUpdate = hasPermission('suppliers.update');
  const canDelete = hasPermission('suppliers.delete');

  const [active, setActive] = useState<ActiveFilter>('all');
  const [search, setSearch] = useState<string>('');

  const filters = useMemo<SuppliersListFilters>(
    () => ({ active, ...(search.trim() !== '' ? { search } : {}) }),
    [active, search],
  );

  const list = useSuppliersList(filters);
  const updateMut = useUpdateSupplier();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<SupplierRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<SupplierRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view suppliers.</div>;
  }

  function handleToggleActive(row: SupplierRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Suppliers</h1>
          <p className="text-text-secondary text-sm mt-1">Vendors that feed the receiving flow.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New supplier
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[12rem]">
          <label htmlFor="sup-search" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input id="sup-search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code" maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="sup-active" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="sup-active" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}
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
              <th className="text-left px-4 py-3 w-28">Code</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 w-40">Phone</th>
              <th className="text-left px-4 py-3 w-56">Email</th>
              <th className="text-right px-4 py-3 w-24">Terms</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>Loading…</td></tr>}
            {list.error && <tr><td className="px-4 py-6 text-red" colSpan={7}>Failed to load: {list.error.message}</td></tr>}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>No suppliers match the current filters.</td></tr>
            )}
            {list.data?.map((row) => (
              <SupplierListRow key={row.id} row={row} canUpdate={canUpdate} canDelete={canDelete}
                onEdit={setEditing} onToggleActive={handleToggleActive} onDelete={setDeleting} />
            ))}
          </tbody>
        </table>
      </div>

      <SupplierFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <SupplierFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <SupplierDeleteConfirm open={deleting !== undefined} row={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
```

- [ ] **Step 2: Modify `apps/backoffice/src/routes/index.tsx`**

Add the import near the existing page imports:

```tsx
import SuppliersPage from '@/pages/Suppliers.js';
```

Add a `<Route>` inside the `/backoffice` block (anywhere after `inventory`, before `*`):

```tsx
<Route
  path="suppliers"
  element={
    <PermissionGate required="suppliers.read">
      <SuppliersPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 3: Boot dev server, manually click through**

```bash
pnpm --filter backoffice dev
```

Open `http://localhost:5174/backoffice/suppliers` after logging in as a MANAGER PIN. Expected: page renders, list query returns an empty array (no seed for suppliers), "New supplier" button visible. Click it, fill the form, submit, see the row appear.

- [ ] **Step 4: Typecheck + lint**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/pages/Suppliers.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 11 — Suppliers page + /backoffice/suppliers route"
```

---

## Task 6: Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/suppliers-crud.smoke.test.tsx`

- [ ] **Step 1: Write the smoke test**

```tsx
// apps/backoffice/src/__tests__/suppliers-crud.smoke.test.tsx
//
// Boots SuppliersPage under a mocked MANAGER session, asserts list load,
// creates one row, edits it, toggles inactive, then soft-deletes.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SuppliersPage from '@/pages/Suppliers.js';
import { useAuthStore } from '@/stores/authStore.js';
import { supabase } from '@/lib/supabase.js';

vi.mock('@/lib/supabase.js', () => {
  // The test stubs supabase.from('suppliers') with an in-memory store.
  const store: Record<string, unknown>[] = [];
  function makeBuilder() {
    let chain: { filters: Record<string, unknown>; isDeletedNull: boolean } = { filters: {}, isDeletedNull: false };
    const api = {
      select: () => api,
      is: (col: string, val: unknown) => { if (col === 'deleted_at' && val === null) chain.isDeletedNull = true; return api; },
      eq: (col: string, val: unknown) => { chain.filters[col] = val; return api; },
      or: () => api,
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
      <SuppliersPage />
    </QueryClientProvider>,
  );
}

describe('SuppliersPage smoke', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'MANAGER', full_name: 'Mgr', permissions: [
        'suppliers.read', 'suppliers.create', 'suppliers.update', 'suppliers.delete',
      ] },
      isAuthenticated: true,
    } as never);
  });

  it('renders the page, creates a supplier, toggles inactive, and soft-deletes', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Suppliers/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New supplier/i }));

    await user.type(screen.getByLabelText(/^Code/i),  'SUP-001');
    await user.type(screen.getByLabelText(/^Name/i),  'Acme Wholesale');
    await user.type(screen.getByLabelText(/^Email/i), 'ap@acme.test');
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(screen.getByText('Acme Wholesale')).toBeInTheDocument());
    expect(screen.getByText('SUP-001')).toBeInTheDocument();

    const row = screen.getByText('Acme Wholesale').closest('tr')!;
    await user.click(within(row).getByLabelText(/Toggle Acme Wholesale active/i));
    await waitFor(() => expect(within(row).getByText(/Inactive/i)).toBeInTheDocument());

    await user.click(within(row).getByRole('button', { name: /Delete Acme Wholesale/i }));
    await user.click(screen.getByRole('button', { name: /Confirm delete/i }));
    await waitFor(() => expect(screen.queryByText('Acme Wholesale')).not.toBeInTheDocument());

    expect(supabase.from).toHaveBeenCalledWith('suppliers');
  });
});
```

> Note: the inline supabase mock is intentionally minimal — it's a builder shim that returns the in-memory store on `await`. If the existing repo has a richer mock factory (check `apps/backoffice/src/__tests__/setup.ts` or similar before writing), reuse that instead of duplicating.

- [ ] **Step 2: Run the test**

```bash
pnpm --filter backoffice test -- suppliers-crud.smoke
```
Expected: 1 test passes.

- [ ] **Step 3: Run the full BO test suite to catch regressions**

```bash
pnpm --filter backoffice test
```

- [ ] **Step 4: Commit**

```bash
git add apps/backoffice/src/__tests__/suppliers-crud.smoke.test.tsx
git commit -m "test(backoffice): session 11 — suppliers CRUD smoke"
```

---

## Phase exit criteria

- [ ] `/backoffice/suppliers` renders for a MANAGER, redirects for a CASHIER
- [ ] All 6 commits landed in order on the working branch
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings
- [ ] `pnpm --filter backoffice test` passes including the new smoke
- [ ] No new files outside `apps/backoffice/src/features/suppliers/`, `apps/backoffice/src/pages/Suppliers.tsx`, `apps/backoffice/src/routes/index.tsx`, and `apps/backoffice/src/__tests__/suppliers-crud.smoke.test.tsx`

Once all checked, the subagent reports completion to the lead and Phase 02 can start.
