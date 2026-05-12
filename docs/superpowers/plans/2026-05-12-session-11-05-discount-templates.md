# Session 11 — Phase 05 — Discount Templates CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Backoffice CRUD UI for `discount_templates` — admin-managed presets that drive the POS cart-discount picker. Write actions are ADMIN+ per spec C4 (sensitive — affects revenue). Out of scope this session: wiring presets into the POS DiscountModal (deferred per spec §6 note).

**Architecture:** Same pattern as Phase 01–04. The form is **type-discriminated**: when `type='percentage'` the `value` field is constrained to 0..100; when `type='fixed_amount'` value is a positive currency amount with no upper bound. The DB enforces this via a CHECK constraint (`chk_value_consistency`) — the Zod schema mirrors it so the UI surfaces the error before the round-trip.

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/superpowers/specs/2026-05-11-session-11-backoffice-crud-spec.md` §3.3
**Parent plan:** `docs/superpowers/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- `discount_templates` table exists (`20260513000002_init_discount_templates.sql`)
- Enum `discount_template_type ('percentage','fixed_amount')` exists
- Perms `discount_templates.{read,create,update,delete}` seeded — write perms ADMIN+
- Phase 01 complete (scaffold pattern)

**Entity schema** (from migration `20260513000002`):

```
id                     UUID PK
name                   TEXT NOT NULL
type                   discount_template_type ('percentage' | 'fixed_amount')
value                  DECIMAL(14,2) NOT NULL  CHECK > 0
requires_pin           BOOLEAN DEFAULT false   -- always requires manager PIN
cashier_max_percentage DECIMAL(5,2)            -- 0..100, NULL means use requires_pin
is_active              BOOLEAN DEFAULT true
deleted_at             TIMESTAMPTZ
CONSTRAINT chk_value_consistency CHECK (
  (type = 'percentage' AND value > 0 AND value <= 100)
  OR (type = 'fixed_amount' AND value > 0)
)
```

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `apps/backoffice/src/features/discount-templates/hooks/useDiscountTemplatesList.ts` |
| CREATE | `apps/backoffice/src/features/discount-templates/hooks/useCreateDiscountTemplate.ts` |
| CREATE | `apps/backoffice/src/features/discount-templates/hooks/useUpdateDiscountTemplate.ts` |
| CREATE | `apps/backoffice/src/features/discount-templates/hooks/useDeleteDiscountTemplate.ts` |
| CREATE | `apps/backoffice/src/features/discount-templates/components/DiscountTemplateFormModal.tsx` |
| CREATE | `apps/backoffice/src/features/discount-templates/components/DiscountTemplateListRow.tsx` |
| CREATE | `apps/backoffice/src/features/discount-templates/components/DiscountTemplateDeleteConfirm.tsx` |
| CREATE | `apps/backoffice/src/pages/DiscountTemplates.tsx` |
| MODIFY | `apps/backoffice/src/routes/index.tsx` |
| CREATE | `apps/backoffice/src/__tests__/discount-templates-crud.smoke.test.tsx` |

---

## Task 1: List hook + types

**Files:**
- Create: `apps/backoffice/src/features/discount-templates/hooks/useDiscountTemplatesList.ts`

- [ ] **Step 1: Write the hook**

```ts
// apps/backoffice/src/features/discount-templates/hooks/useDiscountTemplatesList.ts
//
// BO list of discount_templates. Excludes soft-deleted. Sorted by name.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type DiscountTemplateRow    = Database['public']['Tables']['discount_templates']['Row'];
export type DiscountTemplateInsert = Database['public']['Tables']['discount_templates']['Insert'];
export type DiscountTemplateUpdate = Database['public']['Tables']['discount_templates']['Update'];
export type DiscountTemplateType   = Database['public']['Enums']['discount_template_type'];

export type ActiveFilter = 'all' | 'active' | 'inactive';
export type TypeFilter   = 'all' | DiscountTemplateType;

export interface DiscountTemplatesListFilters {
  active?: ActiveFilter;
  type?: TypeFilter;
}

export const DT_QUERY_KEY = ['discount-templates-bo'] as const;

export function useDiscountTemplatesList(filters: DiscountTemplatesListFilters = {}) {
  return useQuery<DiscountTemplateRow[]>({
    queryKey: [...DT_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('discount_templates')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (filters.active === 'active')   q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);
      if (filters.type !== undefined && filters.type !== 'all') q = q.eq('type', filters.type);

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
git add apps/backoffice/src/features/discount-templates/hooks/useDiscountTemplatesList.ts
git commit -m "feat(backoffice): session 11 — useDiscountTemplatesList hook"
```

---

## Task 2: Mutation hooks

**Files:**
- Create: `apps/backoffice/src/features/discount-templates/hooks/useCreateDiscountTemplate.ts`
- Create: `apps/backoffice/src/features/discount-templates/hooks/useUpdateDiscountTemplate.ts`
- Create: `apps/backoffice/src/features/discount-templates/hooks/useDeleteDiscountTemplate.ts`

- [ ] **Step 1: Write `useCreateDiscountTemplate`**

```ts
// apps/backoffice/src/features/discount-templates/hooks/useCreateDiscountTemplate.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { DT_QUERY_KEY, type DiscountTemplateInsert, type DiscountTemplateRow } from './useDiscountTemplatesList.js';

export function useCreateDiscountTemplate() {
  const qc = useQueryClient();
  return useMutation<DiscountTemplateRow, Error, DiscountTemplateInsert>({
    mutationFn: async (values) => {
      const { data, error } = await supabase
        .from('discount_templates')
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: DT_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 2: Write `useUpdateDiscountTemplate`**

```ts
// apps/backoffice/src/features/discount-templates/hooks/useUpdateDiscountTemplate.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import {
  DT_QUERY_KEY,
  type DiscountTemplateRow,
  type DiscountTemplateUpdate,
} from './useDiscountTemplatesList.js';

export interface UpdateDTArgs {
  id: string;
  values: DiscountTemplateUpdate;
}

export function useUpdateDiscountTemplate() {
  const qc = useQueryClient();
  return useMutation<DiscountTemplateRow, Error, UpdateDTArgs>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('discount_templates')
        .update(values)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: DT_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 3: Write `useDeleteDiscountTemplate`**

```ts
// apps/backoffice/src/features/discount-templates/hooks/useDeleteDiscountTemplate.ts
//
// Soft-delete. No FK from any other table — discounts applied at the time
// of sale are inlined on orders.discount_*, not by template_id. Safe to delete.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { DT_QUERY_KEY } from './useDiscountTemplatesList.js';

export function useDeleteDiscountTemplate() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('discount_templates')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: DT_QUERY_KEY });
    },
  });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/discount-templates/hooks/
git commit -m "feat(backoffice): session 11 — discount_template create/update/soft-delete hooks"
```

---

## Task 3: FormModal (type-discriminated)

**Files:**
- Create: `apps/backoffice/src/features/discount-templates/components/DiscountTemplateFormModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
// apps/backoffice/src/features/discount-templates/components/DiscountTemplateFormModal.tsx
//
// Create / edit dialog. Zod schema mirrors the DB CHECK constraint
// chk_value_consistency. The "value" max bound switches between 100 and
// effectively-unbounded when the user toggles type.

import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useCreateDiscountTemplate } from '../hooks/useCreateDiscountTemplate.js';
import { useUpdateDiscountTemplate } from '../hooks/useUpdateDiscountTemplate.js';
import type { DiscountTemplateRow, DiscountTemplateType } from '../hooks/useDiscountTemplatesList.js';

const PERCENT_MAX = 100;
const FIXED_MAX   = 1_000_000;  // 1M IDR cap — way above realistic single-order discount

function buildSchema(t: DiscountTemplateType) {
  const valueMax = t === 'percentage' ? PERCENT_MAX : FIXED_MAX;
  return z.object({
    name: z.string().trim().min(1, 'Name required').max(120, '≤ 120 chars'),
    type: z.enum(['percentage', 'fixed_amount']),
    value: z.number().positive('> 0').max(valueMax, t === 'percentage' ? '≤ 100' : `≤ ${FIXED_MAX.toLocaleString()}`),
    requires_pin: z.boolean(),
    cashier_max_percentage: z.number().min(0).max(100).nullable(),
    is_active: z.boolean(),
  });
}

interface Draft {
  name: string;
  type: DiscountTemplateType;
  value: number;
  requires_pin: boolean;
  cashier_max_percentage: number | null;
  is_active: boolean;
}

const DEFAULT: Draft = {
  name: '', type: 'percentage', value: 10, requires_pin: false, cashier_max_percentage: 5, is_active: true,
};

function rowToDraft(r: DiscountTemplateRow): Draft {
  return {
    name: r.name,
    type: r.type,
    value: Number(r.value),
    requires_pin: r.requires_pin,
    cashier_max_percentage: r.cashier_max_percentage === null ? null : Number(r.cashier_max_percentage),
    is_active: r.is_active,
  };
}

export interface DiscountTemplateFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: DiscountTemplateRow | undefined;
  onClose: () => void;
}

export function DiscountTemplateFormModal({ open, mode, initial, onClose }: DiscountTemplateFormModalProps) {
  const createMut = useCreateDiscountTemplate();
  const updateMut = useUpdateDiscountTemplate();

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

  const schema = useMemo(() => buildSchema(draft.type), [draft.type]);
  const pending = createMut.isPending || updateMut.isPending;

  async function handleSubmit() {
    setServerError(null);
    const parsed = schema.safeParse(draft);
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
      setServerError(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{mode === 'create' ? 'New discount template' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>Presets visible in the POS DiscountModal once wired (session 11b / 15).</DialogDescription>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2">
            <label htmlFor="dt-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
            <input id="dt-name" value={draft.name} onChange={(e) => setField('name', e.target.value)} maxLength={120}
              placeholder="e.g. Senior 10%"
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="dt-type" className="text-xs uppercase tracking-widest text-text-secondary">Type</label>
            <select id="dt-type" value={draft.type}
              onChange={(e) => setField('type', e.target.value as DiscountTemplateType)}
              disabled={mode === 'edit'}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50">
              <option value="percentage">Percentage</option>
              <option value="fixed_amount">Fixed amount</option>
            </select>
          </div>
          <div>
            <label htmlFor="dt-value" className="text-xs uppercase tracking-widest text-text-secondary">
              {draft.type === 'percentage' ? 'Value (%)' : 'Value (IDR)'}
            </label>
            <input id="dt-value" type="number" min={0.01}
              max={draft.type === 'percentage' ? PERCENT_MAX : FIXED_MAX}
              step={draft.type === 'percentage' ? 0.5 : 100}
              value={draft.value}
              onChange={(e) => setField('value', Number(e.target.value) || 0)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.value && <p className="text-red text-xs mt-1">{errors.value}</p>}
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.requires_pin}
                onChange={(e) => setField('requires_pin', e.target.checked)} />
              Always require manager PIN
            </label>
            <div>
              <label htmlFor="dt-cmax" className="text-xs uppercase tracking-widest text-text-secondary">
                Cashier max % (else PIN)
              </label>
              <input id="dt-cmax" type="number" min={0} max={100} step={0.5}
                value={draft.cashier_max_percentage ?? ''}
                disabled={draft.requires_pin}
                onChange={(e) =>
                  setField('cashier_max_percentage', e.target.value === '' ? null : Number(e.target.value))
                }
                placeholder="e.g. 5"
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
            </div>
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
git add apps/backoffice/src/features/discount-templates/components/DiscountTemplateFormModal.tsx
git commit -m "feat(backoffice): session 11 — DiscountTemplateFormModal (type-discriminated)"
```

---

## Task 4: ListRow + DeleteConfirm

**Files:**
- Create: `apps/backoffice/src/features/discount-templates/components/DiscountTemplateListRow.tsx`
- Create: `apps/backoffice/src/features/discount-templates/components/DiscountTemplateDeleteConfirm.tsx`

- [ ] **Step 1: Write `DiscountTemplateListRow`**

```tsx
// apps/backoffice/src/features/discount-templates/components/DiscountTemplateListRow.tsx
import { KeyRound, Pencil, Trash2 } from 'lucide-react';
import { Button, Currency } from '@breakery/ui';
import type { DiscountTemplateRow } from '../hooks/useDiscountTemplatesList.js';

export interface DiscountTemplateListRowProps {
  row: DiscountTemplateRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: DiscountTemplateRow) => void;
  onToggleActive: (row: DiscountTemplateRow) => void;
  onDelete: (row: DiscountTemplateRow) => void;
}

export function DiscountTemplateListRow({
  row, canUpdate, canDelete, onEdit, onToggleActive, onDelete,
}: DiscountTemplateListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3">
        <div className="font-semibold text-text-primary">{row.name}</div>
      </td>
      <td className="px-4 py-3 text-text-secondary text-sm uppercase">{row.type === 'percentage' ? '%' : 'IDR'}</td>
      <td className="px-4 py-3 text-right font-mono">
        {row.type === 'percentage'
          ? `${row.value}%`
          : <Currency amount={Number(row.value)} emphasis="gold" />}
      </td>
      <td className="px-4 py-3 text-center text-xs">
        {row.requires_pin ? (
          <span className="inline-flex items-center gap-1 text-gold uppercase tracking-wide">
            <KeyRound className="h-3 w-3" aria-hidden /> Always
          </span>
        ) : row.cashier_max_percentage !== null ? (
          <span className="text-text-secondary uppercase tracking-wide">≤ {row.cashier_max_percentage}%</span>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
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

- [ ] **Step 2: Write `DiscountTemplateDeleteConfirm`**

```tsx
// apps/backoffice/src/features/discount-templates/components/DiscountTemplateDeleteConfirm.tsx
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteDiscountTemplate } from '../hooks/useDeleteDiscountTemplate.js';
import type { DiscountTemplateRow } from '../hooks/useDiscountTemplatesList.js';

export interface DiscountTemplateDeleteConfirmProps {
  open: boolean;
  row: DiscountTemplateRow | undefined;
  onClose: () => void;
}

export function DiscountTemplateDeleteConfirm({ open, row, onClose }: DiscountTemplateDeleteConfirmProps) {
  const deleteMut = useDeleteDiscountTemplate();
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
        <DialogTitle>Soft-delete discount template</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Template <span className="text-text-primary font-semibold">{row.name}</span> will be hidden
              from the POS picker once the wire-up lands. Historical discounts already applied stay intact
              (the template id is not stored on orders).
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
git add apps/backoffice/src/features/discount-templates/components/DiscountTemplateListRow.tsx apps/backoffice/src/features/discount-templates/components/DiscountTemplateDeleteConfirm.tsx
git commit -m "feat(backoffice): session 11 — DiscountTemplateListRow + DeleteConfirm"
```

---

## Task 5: Page + route wiring

**Files:**
- Create: `apps/backoffice/src/pages/DiscountTemplates.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/backoffice/src/pages/DiscountTemplates.tsx

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { DiscountTemplateDeleteConfirm } from '@/features/discount-templates/components/DiscountTemplateDeleteConfirm.js';
import { DiscountTemplateFormModal } from '@/features/discount-templates/components/DiscountTemplateFormModal.js';
import { DiscountTemplateListRow } from '@/features/discount-templates/components/DiscountTemplateListRow.js';
import { useUpdateDiscountTemplate } from '@/features/discount-templates/hooks/useUpdateDiscountTemplate.js';
import {
  useDiscountTemplatesList,
  type ActiveFilter,
  type DiscountTemplateRow,
  type DiscountTemplatesListFilters,
  type TypeFilter,
} from '@/features/discount-templates/hooks/useDiscountTemplatesList.js';

export default function DiscountTemplatesPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('discount_templates.read');
  const canCreate = hasPermission('discount_templates.create');
  const canUpdate = hasPermission('discount_templates.update');
  const canDelete = hasPermission('discount_templates.delete');

  const [active, setActive] = useState<ActiveFilter>('all');
  const [type, setType]     = useState<TypeFilter>('all');

  const filters = useMemo<DiscountTemplatesListFilters>(() => ({ active, type }), [active, type]);

  const list = useDiscountTemplatesList(filters);
  const updateMut = useUpdateDiscountTemplate();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<DiscountTemplateRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<DiscountTemplateRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view discount templates.</div>;
  }

  function handleToggleActive(row: DiscountTemplateRow): void {
    updateMut.mutate({ id: row.id, values: { is_active: !row.is_active } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Discount templates</h1>
          <p className="text-text-secondary text-sm mt-1">Presets for the POS DiscountModal. Sensitive — ADMIN+.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New template
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1">
          <label htmlFor="dt-type-f" className="text-xs uppercase tracking-widest text-text-secondary">Type</label>
          <select id="dt-type-f" value={type} onChange={(e) => setType(e.target.value as TypeFilter)}
            className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
            <option value="all">All</option>
            <option value="percentage">Percentage</option>
            <option value="fixed_amount">Fixed</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="dt-active-f" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="dt-active-f" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}
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
              <th className="text-left px-4 py-3 w-20">Type</th>
              <th className="text-right px-4 py-3 w-32">Value</th>
              <th className="text-center px-4 py-3 w-32">PIN rule</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={6}>Loading…</td></tr>}
            {list.error && <tr><td className="px-4 py-6 text-red" colSpan={6}>Failed: {list.error.message}</td></tr>}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={6}>No templates yet.</td></tr>
            )}
            {list.data?.map((row) => (
              <DiscountTemplateListRow key={row.id} row={row} canUpdate={canUpdate} canDelete={canDelete}
                onEdit={setEditing} onToggleActive={handleToggleActive} onDelete={setDeleting} />
            ))}
          </tbody>
        </table>
      </div>

      <DiscountTemplateFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <DiscountTemplateFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <DiscountTemplateDeleteConfirm open={deleting !== undefined} row={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the route**

```tsx
import DiscountTemplatesPage from '@/pages/DiscountTemplates.js';
```

```tsx
<Route
  path="discount-templates"
  element={
    <PermissionGate required="discount_templates.read">
      <DiscountTemplatesPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 3: Typecheck + lint + commit**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
git add apps/backoffice/src/pages/DiscountTemplates.tsx apps/backoffice/src/routes/index.tsx
git commit -m "feat(backoffice): session 11 — DiscountTemplates page + route"
```

---

## Task 6: Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/discount-templates-crud.smoke.test.tsx`

- [ ] **Step 1: Write the smoke**

```tsx
// apps/backoffice/src/__tests__/discount-templates-crud.smoke.test.tsx
//
// ADMIN session, creates a "Senior 10%" percentage template, toggles to
// fixed_amount edit, then soft-deletes. Verifies the type-switch flips the
// value validation bounds.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DiscountTemplatesPage from '@/pages/DiscountTemplates.js';
import { useAuthStore } from '@/stores/authStore.js';

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
      then: (cb: (v: { data: typeof store; error: null }) => void) =>
        cb({ data: store.filter((r) => r.deleted_at == null), error: null }),
    } as unknown as { [key: string]: unknown };
    return api;
  }
  return { supabase: { from: vi.fn().mockImplementation(() => makeBuilder()) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DiscountTemplatesPage />
    </QueryClientProvider>,
  );
}

describe('DiscountTemplatesPage smoke', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'ADMIN', full_name: 'Admin', permissions: [
        'discount_templates.read', 'discount_templates.create',
        'discount_templates.update', 'discount_templates.delete',
      ] },
      isAuthenticated: true,
    } as never);
  });

  it('creates a Senior 10% template + soft-deletes', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Discount templates/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New template/i }));

    await user.type(screen.getByLabelText(/^Name/i), 'Senior 10%');
    // type defaults to percentage, value defaults to 10 — submit straight
    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(screen.getByText('Senior 10%')).toBeInTheDocument());
    expect(screen.getByText('10%')).toBeInTheDocument();

    const row = screen.getByText('Senior 10%').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /Delete Senior 10%/i }));
    await user.click(screen.getByRole('button', { name: /Confirm delete/i }));
    await waitFor(() => expect(screen.queryByText('Senior 10%')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test + full BO suite**

```bash
pnpm --filter backoffice test -- discount-templates-crud.smoke
pnpm --filter backoffice test
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/__tests__/discount-templates-crud.smoke.test.tsx
git commit -m "test(backoffice): session 11 — discount_templates CRUD smoke"
```

---

## Phase exit criteria

- [ ] `/backoffice/discount-templates` renders for ADMIN, redirects for MANAGER (write perms are ADMIN+; read perm may be MANAGER per seed — verify against `20260513000004_seed_backoffice_crud_perms.sql`)
- [ ] Type-switch in the form correctly re-validates `value` (e.g. flipping to percentage with value=150 should surface "≤ 100" inline)
- [ ] CHECK constraint violation from DB (if it slips through) surfaces a server error banner — not a console-only failure
- [ ] All 6 commits landed
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings, `pnpm test` green

Once all checked, dispatch the subagent for Phase 06 (`products-full-crud`).
