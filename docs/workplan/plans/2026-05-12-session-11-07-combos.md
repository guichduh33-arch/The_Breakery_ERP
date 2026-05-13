# Session 11 — Phase 07 — Combos CRUD Implementation Plan

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Module concerné** : [`13-promotions-discounts`](../../reference/04-modules/13-promotions-discounts.md) (combos)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Backoffice CRUD UI for combo products — a "header" row in `products` with `product_type='combo'` plus N rows in `combo_items` pointing at component (finished) products. Add a new `create_combo_with_items` RPC that wraps the header + items inserts atomically (per spec §7 garde-fou). Phase 06 (Products) MUST be done first — we reuse the categories reference-data hook and the ProductFormModal pattern.

**Architecture:** New feature folder `apps/backoffice/src/features/combos/`. The "header" is just a `products` row with `product_type='combo'` and `current_stock` ignored (computed at point-of-sale). The "items" live in `combo_items` (composite PK `(parent_product_id, component_product_id)`). The form uses a nested item picker (`ComboItemPicker.tsx`) that searches finished products and adds rows with quantity. Submitting the form calls `create_combo_with_items` for atomic write; editing the items list of an existing combo uses sequential ops (delete missing rows + insert new ones) because the partial-update RPC is out of scope this session. ListRow shows the component count + total component cost.

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md` §0 (Combos CRUD), §7 (Combo CRUD nested write risk)
**Parent plan:** `docs/workplan/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- Phase 06 (Products full CRUD) complete — categories ref hook + product form pattern proven
- `products.product_type ('finished' | 'combo')` column exists
- `combo_items` table + `enforce_combo_parent_type` trigger exist (`20260509000005_init_combo_items.sql`)
- Perms `combos.{read,create,update,delete}` seeded

**Entity schema:**

```
products (header row)
  product_type      'combo'
  retail_price      DECIMAL — the combo bundle price
  current_stock     IGNORED (combos derive their stock from components at POS)
  ...other fields as Phase 06

combo_items
  parent_product_id    UUID REFERENCES products(id) ON DELETE CASCADE
  component_product_id UUID REFERENCES products(id) ON DELETE RESTRICT
  quantity             INTEGER > 0
  sort_order           INTEGER
  PRIMARY KEY (parent_product_id, component_product_id)
  -- trigger enforce_combo_parent_type rejects nested combos
```

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `supabase/migrations/20260517000003_create_combo_with_items_rpc.sql` |
| CREATE | `supabase/tests/combos.test.sql` (pgTAP — atomicity + RLS) |
| MODIFY | `packages/supabase/src/types.generated.ts` (regen via `pnpm db:types`) |
| CREATE | `apps/backoffice/src/features/combos/hooks/useCombosList.ts` |
| CREATE | `apps/backoffice/src/features/combos/hooks/useComboDetails.ts` |
| CREATE | `apps/backoffice/src/features/combos/hooks/useFinishedProductsForPicker.ts` |
| CREATE | `apps/backoffice/src/features/combos/hooks/useCreateCombo.ts` |
| CREATE | `apps/backoffice/src/features/combos/hooks/useUpdateCombo.ts` |
| CREATE | `apps/backoffice/src/features/combos/hooks/useDeleteCombo.ts` |
| CREATE | `apps/backoffice/src/features/combos/components/ComboItemPicker.tsx` |
| CREATE | `apps/backoffice/src/features/combos/components/ComboFormModal.tsx` |
| CREATE | `apps/backoffice/src/features/combos/components/ComboListRow.tsx` |
| CREATE | `apps/backoffice/src/features/combos/components/ComboDeleteConfirm.tsx` |
| CREATE | `apps/backoffice/src/pages/Combos.tsx` |
| MODIFY | `apps/backoffice/src/routes/index.tsx` |
| CREATE | `apps/backoffice/src/__tests__/combos-crud.smoke.test.tsx` |

---

## Task 1: DB — `create_combo_with_items` RPC

**Files:**
- Create: `supabase/migrations/20260517000003_create_combo_with_items_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260517000003_create_combo_with_items_rpc.sql
-- Session 11 — atomic creation of a combo header (products row with
-- product_type='combo') + its combo_items children.
--
-- Without this RPC, the BO would have to insert the header, then loop-insert
-- items, leaving a half-built combo if any item insert fails. The trigger
-- enforce_combo_parent_type also rejects items that point to a non-combo
-- parent, so the items inserts must happen AFTER the header commits — yet
-- atomically. A single SQL function gives us that.

CREATE OR REPLACE FUNCTION create_combo_with_items(
  p_header JSONB,
  p_items  JSONB DEFAULT '[]'::jsonb
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_combo_id    UUID;
  v_item        JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_user_id, 'combos.create') THEN
    RAISE EXCEPTION 'Permission denied: combos.create' USING ERRCODE = 'P0003';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Combo must have at least one component' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(p_items) > 20 THEN
    RAISE EXCEPTION 'Combo cannot have more than 20 components' USING ERRCODE = 'check_violation';
  END IF;

  -- 1. INSERT the header. Force product_type='combo' regardless of input.
  INSERT INTO products (
    sku, name, category_id, retail_price, wholesale_price, tax_inclusive,
    image_url, current_stock, is_active, is_favorite, product_type
  ) VALUES (
    (p_header->>'sku')::TEXT,
    (p_header->>'name')::TEXT,
    (p_header->>'category_id')::UUID,
    (p_header->>'retail_price')::DECIMAL(12,2),
    NULLIF(p_header->>'wholesale_price','')::DECIMAL(12,2),
    COALESCE((p_header->>'tax_inclusive')::BOOLEAN, true),
    NULLIF(p_header->>'image_url',''),
    0,                                      -- current_stock is derived at POS
    COALESCE((p_header->>'is_active')::BOOLEAN, true),
    COALESCE((p_header->>'is_favorite')::BOOLEAN, false),
    'combo'
  ) RETURNING id INTO v_combo_id;

  -- 2. INSERT each combo_items row. The trigger enforce_combo_parent_type
  --    accepts this because the header is now committed in the same xact.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO combo_items (parent_product_id, component_product_id, quantity, sort_order)
    VALUES (
      v_combo_id,
      (v_item->>'component_product_id')::UUID,
      COALESCE((v_item->>'quantity')::INTEGER, 1),
      COALESCE((v_item->>'sort_order')::INTEGER, 0)
    );
  END LOOP;

  -- 3. Audit log
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    SELECT
      up.id, 'combo.create', 'products', v_combo_id,
      jsonb_build_object(
        'name',         p_header->>'name',
        'item_count',   jsonb_array_length(p_items),
        'retail_price', (p_header->>'retail_price')::DECIMAL(12,2)
      )
    FROM user_profiles up WHERE up.auth_user_id = v_user_id AND up.deleted_at IS NULL;

  RETURN v_combo_id;
END $$;

GRANT EXECUTE ON FUNCTION create_combo_with_items TO authenticated;

COMMENT ON FUNCTION create_combo_with_items IS
  'Session 11. Atomic creation of a combo product + its combo_items rows. '
  'Header product_type is force-set to ''combo''. Rejects empty or >20 component lists.';
```

- [ ] **Step 2: Apply + regen types**

```bash
pnpm db:reset
pnpm db:types
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260517000003_create_combo_with_items_rpc.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db): session 11 — create_combo_with_items RPC + GRANT"
```

---

## Task 2: DB — pgTAP test for the RPC

**Files:**
- Create: `supabase/tests/combos.test.sql`

- [ ] **Step 1: Write the pgTAP test**

```sql
-- supabase/tests/combos.test.sql
-- Session 11 — create_combo_with_items pgTAP

BEGIN;
SELECT plan(7);

-- C1: function exists with correct signature
SELECT has_function(
  'public', 'create_combo_with_items', ARRAY['jsonb', 'jsonb'],
  'create_combo_with_items(p_header JSONB, p_items JSONB) exists'
);

-- C2: SECURITY DEFINER
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'create_combo_with_items'),
  true,
  'create_combo_with_items is SECURITY DEFINER'
);

-- Seed: pin a SUPER_ADMIN auth.uid()
SELECT set_session_user('00000000-0000-0000-0000-000000000001');

-- C3: empty items array raises
SELECT throws_ok(
  $$ SELECT create_combo_with_items(
       '{"sku":"COMBO-T","name":"X","category_id":"00000000-0000-0000-0000-000000000010","retail_price":10000}'::jsonb,
       '[]'::jsonb
     ) $$,
  'check_violation',
  'rejects empty items'
);

-- C4: too many items raises
SELECT throws_ok(
  $$ SELECT create_combo_with_items(
       '{"sku":"COMBO-T","name":"X","category_id":"00000000-0000-0000-0000-000000000010","retail_price":10000}'::jsonb,
       (SELECT jsonb_agg(jsonb_build_object('component_product_id','00000000-0000-0000-0000-000000000020','quantity',1))
        FROM generate_series(1, 21))::jsonb
     ) $$,
  'check_violation',
  'rejects > 20 items'
);

-- C5: happy path — atomically creates header + items
-- (assumes seed data: category '...010' exists, finished products '...020', '...021' exist)
SELECT lives_ok(
  $$ SELECT create_combo_with_items(
       '{"sku":"COMBO-OK","name":"Set lunch","category_id":"00000000-0000-0000-0000-000000000010","retail_price":50000}'::jsonb,
       '[{"component_product_id":"00000000-0000-0000-0000-000000000020","quantity":1,"sort_order":1},
         {"component_product_id":"00000000-0000-0000-0000-000000000021","quantity":2,"sort_order":2}]'::jsonb
     ) $$,
  'happy path succeeds'
);
SELECT is(
  (SELECT count(*) FROM combo_items WHERE parent_product_id = (SELECT id FROM products WHERE sku = 'COMBO-OK')),
  2::bigint,
  'happy path inserted exactly 2 component rows'
);
SELECT is(
  (SELECT product_type FROM products WHERE sku = 'COMBO-OK'),
  'combo',
  'header is product_type=combo'
);

SELECT * FROM finish();
ROLLBACK;
```

> The seed UUIDs assume the test fixture seeds a category + two finished products with those IDs. If your repo's existing pgTAP fixture uses different seeds (see `supabase/tests/*.test.sql` for the patterns currently in use), adapt the IDs accordingly. The shape of the assertions stays the same.

- [ ] **Step 2: Run the test**

```bash
bash supabase/tests/run_pgtap.sh combos
```

Expected: 7 ok / 0 not ok.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/combos.test.sql
git commit -m "test(db): session 11 — pgTAP for create_combo_with_items"
```

---

## Task 3: List + details + picker hooks

**Files:**
- Create: `apps/backoffice/src/features/combos/hooks/useCombosList.ts`
- Create: `apps/backoffice/src/features/combos/hooks/useComboDetails.ts`
- Create: `apps/backoffice/src/features/combos/hooks/useFinishedProductsForPicker.ts`

- [ ] **Step 1: `useCombosList`**

```ts
// apps/backoffice/src/features/combos/hooks/useCombosList.ts
//
// BO list of combo "header" rows — products with product_type='combo'.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type ComboRow = Database['public']['Tables']['products']['Row'] & {
  component_count?: number;
};

export type ActiveFilter = 'all' | 'active' | 'inactive';

export interface CombosListFilters {
  active?: ActiveFilter;
  search?: string;
}

export const COMBOS_QUERY_KEY = ['combos-bo'] as const;

export function useCombosList(filters: CombosListFilters = {}) {
  return useQuery<ComboRow[]>({
    queryKey: [...COMBOS_QUERY_KEY, filters] as const,
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select('*, combo_items!combo_items_parent_product_id_fkey(count)')
        .eq('product_type', 'combo')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (filters.active === 'active')   q = q.eq('is_active', true);
      if (filters.active === 'inactive') q = q.eq('is_active', false);
      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = filters.search.trim().replace(/[%_]/g, '\\$&');
        q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      // The PostgREST count embedding shape is [{ count: N }]; flatten it.
      return (data ?? []).map((r) => {
        const rec = r as unknown as { combo_items?: Array<{ count: number }> } & ComboRow;
        return { ...rec, component_count: rec.combo_items?.[0]?.count ?? 0 };
      });
    },
  });
}
```

- [ ] **Step 2: `useComboDetails`** (fetches the items for editing)

```ts
// apps/backoffice/src/features/combos/hooks/useComboDetails.ts
//
// Fetch the components of a single combo for the edit modal.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export interface ComboItemDetail {
  component_product_id: string;
  component_name: string;
  component_sku: string;
  quantity: number;
  sort_order: number;
}

export const COMBO_DETAILS_KEY = (id: string) => ['combo-details', id] as const;

export function useComboDetails(comboId: string | undefined) {
  return useQuery<ComboItemDetail[]>({
    queryKey: COMBO_DETAILS_KEY(comboId ?? '__none__'),
    enabled: comboId !== undefined,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('combo_items')
        .select('component_product_id, quantity, sort_order, products!combo_items_component_product_id_fkey(name, sku)')
        .eq('parent_product_id', comboId!)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => {
        const product = (r as { products: { name: string; sku: string } | null }).products;
        return {
          component_product_id: r.component_product_id,
          component_name: product?.name ?? '(deleted)',
          component_sku:  product?.sku  ?? '?',
          quantity: r.quantity,
          sort_order: r.sort_order,
        };
      });
    },
  });
}
```

- [ ] **Step 3: `useFinishedProductsForPicker`**

```ts
// apps/backoffice/src/features/combos/hooks/useFinishedProductsForPicker.ts
//
// Search hook for the combo item picker. Returns up to 20 active, non-combo
// products matching the search term.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface FinishedProductOption {
  id: string;
  sku: string;
  name: string;
  retail_price: number;
}

export function useFinishedProductsForPicker(search: string) {
  return useQuery<FinishedProductOption[]>({
    queryKey: ['combo-item-picker', search] as const,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const term = search.trim();
      let q = supabase
        .from('products')
        .select('id, sku, name, retail_price')
        .eq('product_type', 'finished')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name', { ascending: true })
        .limit(20);

      if (term !== '') {
        const safe = term.replace(/[%_]/g, '\\$&');
        q = q.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id, sku: r.sku, name: r.name, retail_price: Number(r.retail_price),
      }));
    },
  });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/combos/hooks/useCombosList.ts apps/backoffice/src/features/combos/hooks/useComboDetails.ts apps/backoffice/src/features/combos/hooks/useFinishedProductsForPicker.ts
git commit -m "feat(backoffice): session 11 — combos list/details/picker hooks"
```

---

## Task 4: Mutation hooks

**Files:**
- Create: `apps/backoffice/src/features/combos/hooks/useCreateCombo.ts`
- Create: `apps/backoffice/src/features/combos/hooks/useUpdateCombo.ts`
- Create: `apps/backoffice/src/features/combos/hooks/useDeleteCombo.ts`

- [ ] **Step 1: `useCreateCombo`** (calls the RPC)

```ts
// apps/backoffice/src/features/combos/hooks/useCreateCombo.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { COMBOS_QUERY_KEY } from './useCombosList.js';

export interface CreateComboArgs {
  header: {
    sku: string;
    name: string;
    category_id: string;
    retail_price: number;
    wholesale_price?: number | null;
    tax_inclusive?: boolean;
    image_url?: string | null;
    is_active?: boolean;
    is_favorite?: boolean;
  };
  items: Array<{
    component_product_id: string;
    quantity: number;
    sort_order: number;
  }>;
}

export function useCreateCombo() {
  const qc = useQueryClient();
  return useMutation<string, Error, CreateComboArgs>({
    mutationFn: async ({ header, items }) => {
      const { data, error } = await supabase.rpc('create_combo_with_items', {
        p_header: header,
        p_items: items,
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('RPC returned no combo id');
      return data;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: COMBOS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 2: `useUpdateCombo`** (sequential — header UPDATE then items diff)

```ts
// apps/backoffice/src/features/combos/hooks/useUpdateCombo.ts
//
// Partial update: UPDATE the header row directly, then reconcile combo_items
// (DELETE rows that are gone, UPSERT the new shape). NOT atomic — the
// in-session race is tolerable because admin edits are infrequent. If a
// future spec requires atomicity, swap this for an `update_combo_with_items` RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';
import { COMBOS_QUERY_KEY } from './useCombosList.js';
import { COMBO_DETAILS_KEY } from './useComboDetails.js';

type ProductUpdate = Database['public']['Tables']['products']['Update'];

export interface UpdateComboArgs {
  id: string;
  header: ProductUpdate;
  items: Array<{ component_product_id: string; quantity: number; sort_order: number }>;
}

export function useUpdateCombo() {
  const qc = useQueryClient();
  return useMutation<void, Error, UpdateComboArgs>({
    mutationFn: async ({ id, header, items }) => {
      // 1. Header
      const { error: headerErr } = await supabase
        .from('products')
        .update(header)
        .eq('id', id);
      if (headerErr) throw headerErr;

      // 2. Items reconciliation — wipe + reinsert is simplest. The trigger
      //    enforce_combo_parent_type stays happy because the parent header
      //    already has product_type='combo'.
      const { error: delErr } = await supabase
        .from('combo_items')
        .delete()
        .eq('parent_product_id', id);
      if (delErr) throw delErr;

      if (items.length > 0) {
        const { error: insErr } = await supabase
          .from('combo_items')
          .insert(items.map((it) => ({ ...it, parent_product_id: id })));
        if (insErr) throw insErr;
      }
    },
    onSuccess: async (_, vars) => {
      await qc.invalidateQueries({ queryKey: COMBOS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: COMBO_DETAILS_KEY(vars.id) });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 3: `useDeleteCombo`**

```ts
// apps/backoffice/src/features/combos/hooks/useDeleteCombo.ts
//
// Soft-deletes the header (products row). combo_items are FK CASCADE on
// parent_product_id so they don't dangle. We don't physical-delete to keep
// historical order_items.product_id references resolvable.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { COMBOS_QUERY_KEY } from './useCombosList.js';

export function useDeleteCombo() {
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
      await qc.invalidateQueries({ queryKey: COMBOS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/combos/hooks/useCreateCombo.ts apps/backoffice/src/features/combos/hooks/useUpdateCombo.ts apps/backoffice/src/features/combos/hooks/useDeleteCombo.ts
git commit -m "feat(backoffice): session 11 — combo create (RPC) / update (sequential) / soft-delete hooks"
```

---

## Task 5: `ComboItemPicker` component

**Files:**
- Create: `apps/backoffice/src/features/combos/components/ComboItemPicker.tsx`

The picker is its own sub-component (extracted from the form modal to keep the file under 500 lines per CLAUDE.md).

- [ ] **Step 1: Write the picker**

```tsx
// apps/backoffice/src/features/combos/components/ComboItemPicker.tsx
//
// Item picker for the combo form. Two parts:
//   1) a search input + result dropdown of finished products (max 20)
//   2) a stacked list of already-picked items with quantity inputs

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useFinishedProductsForPicker } from '../hooks/useFinishedProductsForPicker.js';

export interface PickedItem {
  component_product_id: string;
  component_name: string;
  component_sku: string;
  quantity: number;
  sort_order: number;
}

export interface ComboItemPickerProps {
  value: PickedItem[];
  onChange: (next: PickedItem[]) => void;
}

export function ComboItemPicker({ value, onChange }: ComboItemPickerProps) {
  const [search, setSearch] = useState('');
  const results = useFinishedProductsForPicker(search);

  function add(item: { id: string; name: string; sku: string }) {
    if (value.some((v) => v.component_product_id === item.id)) return;
    const next: PickedItem[] = [
      ...value,
      {
        component_product_id: item.id,
        component_name: item.name,
        component_sku: item.sku,
        quantity: 1,
        sort_order: value.length,
      },
    ];
    onChange(next);
    setSearch('');
  }

  function remove(id: string) {
    onChange(value.filter((v) => v.component_product_id !== id).map((v, i) => ({ ...v, sort_order: i })));
  }

  function setQty(id: string, qty: number) {
    onChange(value.map((v) => v.component_product_id === id ? { ...v, quantity: Math.max(1, qty) } : v));
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="combo-pick" className="text-xs uppercase tracking-widest text-text-secondary">Search component</label>
        <input id="combo-pick" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Type a product name or SKU…" maxLength={64}
          className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
      </div>

      {search.trim() !== '' && (results.data ?? []).length > 0 && (
        <div className="border border-border-subtle rounded-md max-h-48 overflow-y-auto">
          {(results.data ?? [])
            .filter((p) => !value.some((v) => v.component_product_id === p.id))
            .map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => add(p)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-bg-overlay text-left"
              >
                <span>
                  <span className="font-mono text-xs text-text-secondary mr-2">{p.sku}</span>
                  {p.name}
                </span>
                <Plus className="h-4 w-4 text-gold" aria-hidden />
              </button>
            ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-text-secondary">Components ({value.length})</p>
        {value.length === 0 && (
          <p className="text-sm text-text-secondary italic">Pick at least one component above.</p>
        )}
        {value.map((it) => (
          <div key={it.component_product_id} className="flex items-center gap-3 p-2 rounded-md bg-bg-overlay">
            <span className="font-mono text-xs text-text-secondary">{it.component_sku}</span>
            <span className="flex-1 text-sm">{it.component_name}</span>
            <label className="text-xs text-text-secondary">Qty</label>
            <input type="number" min={1} max={999} value={it.quantity}
              onChange={(e) => setQty(it.component_product_id, Number(e.target.value) || 1)}
              className="h-8 w-16 rounded-md border border-border-subtle bg-bg-input px-2 text-sm text-text-primary" />
            <Button type="button" variant="ghostDestructive" size="sm"
              onClick={() => remove(it.component_product_id)}
              aria-label={`Remove ${it.component_name}`}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter backoffice typecheck
git add apps/backoffice/src/features/combos/components/ComboItemPicker.tsx
git commit -m "feat(backoffice): session 11 — ComboItemPicker (search + add + qty + remove)"
```

---

## Task 6: ComboFormModal

**Files:**
- Create: `apps/backoffice/src/features/combos/components/ComboFormModal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
// apps/backoffice/src/features/combos/components/ComboFormModal.tsx
//
// Create / edit a combo. Header fields = subset of the regular product form
// (no stock — combos don't track stock). Item picker handles the components.

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
import { useCreateCombo } from '../hooks/useCreateCombo.js';
import { useUpdateCombo } from '../hooks/useUpdateCombo.js';
import { useComboDetails } from '../hooks/useComboDetails.js';
import { useCategoriesForProductForm } from '@/features/products/hooks/useCategoriesForProductForm.js';
import { ComboItemPicker, type PickedItem } from './ComboItemPicker.js';
import type { ComboRow } from '../hooks/useCombosList.js';

const HEADER_SCHEMA = z.object({
  sku: z.string().trim().min(1, 'SKU required').max(32, '≤ 32 chars'),
  name: z.string().trim().min(1, 'Name required').max(120, '≤ 120 chars'),
  category_id: z.string().uuid('Pick a category'),
  retail_price: z.number().min(0, '≥ 0').max(999_999_999, '≤ 1B'),
  wholesale_price: z.number().min(0).max(999_999_999).nullable(),
  tax_inclusive: z.boolean(),
  image_url: z.string().trim().url().max(500).nullable().or(z.literal('')),
  is_active: z.boolean(),
  is_favorite: z.boolean(),
});

interface HeaderDraft {
  sku: string;
  name: string;
  category_id: string;
  retail_price: number;
  wholesale_price: number | null;
  tax_inclusive: boolean;
  image_url: string;
  is_active: boolean;
  is_favorite: boolean;
}

const DEFAULT_HEADER: HeaderDraft = {
  sku: '', name: '', category_id: '',
  retail_price: 0, wholesale_price: null, tax_inclusive: true,
  image_url: '', is_active: true, is_favorite: false,
};

function rowToHeaderDraft(r: ComboRow): HeaderDraft {
  return {
    sku: r.sku, name: r.name, category_id: r.category_id,
    retail_price: Number(r.retail_price),
    wholesale_price: r.wholesale_price === null ? null : Number(r.wholesale_price),
    tax_inclusive: r.tax_inclusive,
    image_url: r.image_url ?? '',
    is_active: r.is_active,
    is_favorite: r.is_favorite,
  };
}

function draftToHeaderPayload(d: HeaderDraft) {
  return {
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
}

export interface ComboFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: ComboRow | undefined;
  onClose: () => void;
}

export function ComboFormModal({ open, mode, initial, onClose }: ComboFormModalProps) {
  const createMut = useCreateCombo();
  const updateMut = useUpdateCombo();
  const cats      = useCategoriesForProductForm();
  const details   = useComboDetails(mode === 'edit' && initial ? initial.id : undefined);

  const [header, setHeader] = useState<HeaderDraft>(initial ? rowToHeaderDraft(initial) : DEFAULT_HEADER);
  const [items,  setItems]  = useState<PickedItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setHeader(initial ? rowToHeaderDraft(initial) : DEFAULT_HEADER);
      setErrors({});
      setServerError(null);
    }
  }, [open, initial]);

  useEffect(() => {
    if (mode === 'edit' && details.data) {
      setItems(details.data.map((d, i) => ({
        component_product_id: d.component_product_id,
        component_name: d.component_name,
        component_sku: d.component_sku,
        quantity: d.quantity,
        sort_order: d.sort_order ?? i,
      })));
    } else if (mode === 'create' && open) {
      setItems([]);
    }
  }, [mode, details.data, open]);

  const pending = createMut.isPending || updateMut.isPending;

  async function handleSubmit() {
    setServerError(null);
    const parsed = HEADER_SCHEMA.safeParse(header);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    if (items.length === 0) {
      setServerError('Pick at least one component.');
      return;
    }
    if (items.length > 20) {
      setServerError('Combos cannot have more than 20 components.');
      return;
    }
    setErrors({});

    const headerPayload = draftToHeaderPayload(header);
    const itemsPayload  = items.map((it, i) => ({
      component_product_id: it.component_product_id,
      quantity: it.quantity,
      sort_order: i,
    }));

    try {
      if (mode === 'create') {
        await createMut.mutateAsync({ header: headerPayload, items: itemsPayload });
      } else if (initial !== undefined) {
        await updateMut.mutateAsync({ id: initial.id, header: headerPayload, items: itemsPayload });
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      setServerError(msg.includes('23505') || /duplicate/i.test(msg)
        ? `A product with SKU "${header.sku}" already exists.` : msg);
    }
  }

  function setHeaderField<K extends keyof HeaderDraft>(k: K, v: HeaderDraft[K]) {
    setHeader((d) => ({ ...d, [k]: v }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{mode === 'create' ? 'New combo' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>
          A combo = bundle of finished products at a fixed bundle price. Combos do not track their own
          stock — POS checks each component's stock at checkout.
        </DialogDescription>

        {cats.isLoading ? (
          <div className="text-text-secondary py-8 text-center">Loading…</div>
        ) : (
          <div className="grid grid-cols-3 gap-4 py-4">
            <div>
              <label htmlFor="cmb-sku" className="text-xs uppercase tracking-widest text-text-secondary">SKU *</label>
              <input id="cmb-sku" value={header.sku}
                onChange={(e) => setHeaderField('sku', e.target.value.toUpperCase())}
                maxLength={32} disabled={mode === 'edit'}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono uppercase text-text-primary disabled:opacity-50" />
              {errors.sku && <p className="text-red text-xs mt-1">{errors.sku}</p>}
            </div>
            <div className="col-span-2">
              <label htmlFor="cmb-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
              <input id="cmb-name" value={header.name}
                onChange={(e) => setHeaderField('name', e.target.value)} maxLength={120}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
              {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
            </div>
            <div>
              <label htmlFor="cmb-cat" className="text-xs uppercase tracking-widest text-text-secondary">Category *</label>
              <select id="cmb-cat" value={header.category_id}
                onChange={(e) => setHeaderField('category_id', e.target.value)}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
                <option value="">— Select —</option>
                {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.category_id && <p className="text-red text-xs mt-1">{errors.category_id}</p>}
            </div>
            <div>
              <label htmlFor="cmb-price" className="text-xs uppercase tracking-widest text-text-secondary">Bundle price *</label>
              <input id="cmb-price" type="number" min={0} step={100} value={header.retail_price}
                onChange={(e) => setHeaderField('retail_price', Number(e.target.value) || 0)}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
              {errors.retail_price && <p className="text-red text-xs mt-1">{errors.retail_price}</p>}
            </div>
            <div className="col-span-3 flex flex-wrap gap-6">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={header.tax_inclusive}
                  onChange={(e) => setHeaderField('tax_inclusive', e.target.checked)} />
                Tax-inclusive price
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={header.is_active}
                  onChange={(e) => setHeaderField('is_active', e.target.checked)} />
                Active
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={header.is_favorite}
                  onChange={(e) => setHeaderField('is_favorite', e.target.checked)} />
                Favorite
              </label>
            </div>
            <div className="col-span-3 border-t border-border-subtle pt-4">
              <ComboItemPicker value={items} onChange={setItems} />
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
git add apps/backoffice/src/features/combos/components/ComboFormModal.tsx
git commit -m "feat(backoffice): session 11 — ComboFormModal (RPC create + sequential edit)"
```

---

## Task 7: ListRow + DeleteConfirm

**Files:**
- Create: `apps/backoffice/src/features/combos/components/ComboListRow.tsx`
- Create: `apps/backoffice/src/features/combos/components/ComboDeleteConfirm.tsx`

- [ ] **Step 1: `ComboListRow`**

```tsx
// apps/backoffice/src/features/combos/components/ComboListRow.tsx
import { Layers, Pencil, Star, Trash2 } from 'lucide-react';
import { Button, Currency } from '@breakery/ui';
import type { ComboRow } from '../hooks/useCombosList.js';

export interface ComboListRowProps {
  row: ComboRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: ComboRow) => void;
  onToggleActive: (row: ComboRow) => void;
  onToggleFavorite: (row: ComboRow) => void;
  onDelete: (row: ComboRow) => void;
}

export function ComboListRow({
  row, canUpdate, canDelete, onEdit, onToggleActive, onToggleFavorite, onDelete,
}: ComboListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3 font-mono text-text-secondary">{row.sku}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-3 w-3 text-gold" aria-hidden />
          <span className="font-semibold">{row.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-right"><Currency amount={Number(row.retail_price)} emphasis="gold" /></td>
      <td className="px-4 py-3 text-right font-mono">{row.component_count ?? 0}</td>
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

- [ ] **Step 2: `ComboDeleteConfirm`**

```tsx
// apps/backoffice/src/features/combos/components/ComboDeleteConfirm.tsx
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteCombo } from '../hooks/useDeleteCombo.js';
import type { ComboRow } from '../hooks/useCombosList.js';

export interface ComboDeleteConfirmProps {
  open: boolean;
  row: ComboRow | undefined;
  onClose: () => void;
}

export function ComboDeleteConfirm({ open, row, onClose }: ComboDeleteConfirmProps) {
  const deleteMut = useDeleteCombo();
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
        <DialogTitle>Soft-delete combo</DialogTitle>
        <DialogDescription>
          {row !== undefined ? (
            <>
              Combo <span className="text-text-primary font-semibold">{row.name}</span> ({row.sku}) will
              disappear from the POS catalog. The component products and any past orders stay intact.
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
git add apps/backoffice/src/features/combos/components/ComboListRow.tsx apps/backoffice/src/features/combos/components/ComboDeleteConfirm.tsx
git commit -m "feat(backoffice): session 11 — ComboListRow + DeleteConfirm"
```

---

## Task 8: Page + route wiring

**Files:**
- Create: `apps/backoffice/src/pages/Combos.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx`

- [ ] **Step 1: Write the page**

```tsx
// apps/backoffice/src/pages/Combos.tsx

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { ComboDeleteConfirm } from '@/features/combos/components/ComboDeleteConfirm.js';
import { ComboFormModal } from '@/features/combos/components/ComboFormModal.js';
import { ComboListRow } from '@/features/combos/components/ComboListRow.js';
import { useUpdateCombo } from '@/features/combos/hooks/useUpdateCombo.js';
import {
  useCombosList,
  type ActiveFilter,
  type ComboRow,
  type CombosListFilters,
} from '@/features/combos/hooks/useCombosList.js';

export default function CombosPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('combos.read');
  const canCreate = hasPermission('combos.create');
  const canUpdate = hasPermission('combos.update');
  const canDelete = hasPermission('combos.delete');

  const [search, setSearch] = useState<string>('');
  const [active, setActive] = useState<ActiveFilter>('all');

  const filters = useMemo<CombosListFilters>(
    () => ({ active, ...(search.trim() !== '' ? { search } : {}) }),
    [active, search],
  );

  const list = useCombosList(filters);
  const updateMut = useUpdateCombo();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<ComboRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<ComboRow | undefined>(undefined);

  if (!canRead) {
    return <div className="text-text-secondary">You do not have permission to view combos.</div>;
  }

  // Header-only updates (toggle active / favorite) skip the items reconciliation
  // by passing an empty items array would WIPE them — so we re-fetch details for
  // these toggle paths. Simpler: call a one-shot supabase update for the header
  // through the existing update hook with the current items being passed back
  // verbatim is overkill for a checkbox toggle.
  // Workaround: use a dedicated supabase call inline.
  async function handleToggleActive(row: ComboRow): Promise<void> {
    const { supabase } = await import('@/lib/supabase.js');
    await supabase.from('products').update({ is_active: !row.is_active }).eq('id', row.id);
    // Mutate cache directly via the existing query invalidation in updateMut.onSuccess
    updateMut.mutate({ id: row.id, header: { is_active: !row.is_active }, items: [] }, {
      onError: () => { /* swallow — already done */ },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Combos</h1>
          <p className="text-text-secondary text-sm mt-1">Bundled products at a fixed price. Component stock is checked at checkout.</p>
        </div>
        {canCreate && (
          <Button type="button" variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New combo
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-end bg-bg-elevated border border-border-subtle rounded-lg p-4">
        <div className="space-y-1 flex-1 min-w-[14rem]">
          <label htmlFor="cmb-search-f" className="text-xs uppercase tracking-widest text-text-secondary">Search</label>
          <input id="cmb-search-f" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or SKU" maxLength={64}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
        </div>
        <div className="space-y-1">
          <label htmlFor="cmb-active-f" className="text-xs uppercase tracking-widest text-text-secondary">Status</label>
          <select id="cmb-active-f" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}
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
              <th className="text-left px-4 py-3 w-32">SKU</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-right px-4 py-3 w-32">Price</th>
              <th className="text-right px-4 py-3 w-24">Components</th>
              <th className="text-center px-4 py-3 w-16">Fav</th>
              <th className="text-center px-4 py-3 w-32">Status</th>
              <th className="text-right px-4 py-3 w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>Loading…</td></tr>}
            {list.error && <tr><td className="px-4 py-6 text-red" colSpan={7}>Failed: {list.error.message}</td></tr>}
            {list.data?.length === 0 && !list.isLoading && (
              <tr><td className="px-4 py-6 text-text-secondary" colSpan={7}>No combos yet.</td></tr>
            )}
            {list.data?.map((row) => (
              <ComboListRow key={row.id} row={row} canUpdate={canUpdate} canDelete={canDelete}
                onEdit={setEditing}
                onToggleActive={(r) => { void handleToggleActive(r); }}
                onToggleFavorite={(r) => updateMut.mutate({ id: r.id, header: { is_favorite: !r.is_favorite }, items: [] })}
                onDelete={setDeleting} />
            ))}
          </tbody>
        </table>
      </div>

      <ComboFormModal open={creating} mode="create" onClose={() => setCreating(false)} />
      <ComboFormModal open={editing !== undefined} mode="edit" {...(editing !== undefined ? { initial: editing } : {})} onClose={() => setEditing(undefined)} />
      <ComboDeleteConfirm open={deleting !== undefined} row={deleting} onClose={() => setDeleting(undefined)} />
    </div>
  );
}
```

> **Caveat for the implementer:** the inline toggle paths in `Combos.tsx` above use the unified `updateMut` with an empty items array which would WIPE combo_items. That's wrong. **Fix the implementation:** before mutation merging is added, write a small `useUpdateComboHeaderOnly` hook that does only the `products` UPDATE without touching `combo_items`, and call it from the toggle handlers. Update this plan if you choose a different split.

- [ ] **Step 2: Add the dedicated header-only hook (fixing the caveat)**

Create `apps/backoffice/src/features/combos/hooks/useUpdateComboHeader.ts`:

```ts
// apps/backoffice/src/features/combos/hooks/useUpdateComboHeader.ts
//
// Updates ONLY the products row of a combo. Used by inline toggle UI
// (active/favorite). The full edit goes through useUpdateCombo which also
// reconciles combo_items.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';
import { COMBOS_QUERY_KEY } from './useCombosList.js';

type ProductUpdate = Database['public']['Tables']['products']['Update'];

export interface UpdateComboHeaderArgs {
  id: string;
  values: ProductUpdate;
}

export function useUpdateComboHeader() {
  const qc = useQueryClient();
  return useMutation<void, Error, UpdateComboHeaderArgs>({
    mutationFn: async ({ id, values }) => {
      const { error } = await supabase
        .from('products')
        .update(values)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: COMBOS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

Then in `apps/backoffice/src/pages/Combos.tsx`, replace the `useUpdateCombo` import + toggle handlers with this dedicated hook:

```tsx
import { useUpdateComboHeader } from '@/features/combos/hooks/useUpdateComboHeader.js';
// ...
const headerMut = useUpdateComboHeader();
// ...
onToggleActive={(r)   => headerMut.mutate({ id: r.id, values: { is_active:  !r.is_active  } })}
onToggleFavorite={(r) => headerMut.mutate({ id: r.id, values: { is_favorite: !r.is_favorite } })}
```

- [ ] **Step 3: Wire the route**

```tsx
import CombosPage from '@/pages/Combos.js';
```

```tsx
<Route
  path="combos"
  element={
    <PermissionGate required="combos.read">
      <CombosPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 4: Typecheck + lint + commit**

```bash
pnpm --filter backoffice typecheck && pnpm --filter backoffice lint
git add apps/backoffice/src/pages/Combos.tsx apps/backoffice/src/routes/index.tsx apps/backoffice/src/features/combos/hooks/useUpdateComboHeader.ts
git commit -m "feat(backoffice): session 11 — Combos page + route + header-only update hook"
```

---

## Task 9: Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/combos-crud.smoke.test.tsx`

- [ ] **Step 1: Write the smoke**

```tsx
// apps/backoffice/src/__tests__/combos-crud.smoke.test.tsx
//
// MANAGER session. Asserts: page loads → opens create modal → searches a
// component → adds it → submits → RPC is called with header+items shape.
// Does NOT round-trip the in-memory store all the way (the RPC isn't shimmed
// — we assert the call shape).

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CombosPage from '@/pages/Combos.js';
import { useAuthStore } from '@/stores/authStore.js';

const rpcSpy = vi.fn().mockResolvedValue({ data: 'new-combo-id', error: null });

vi.mock('@/lib/supabase.js', () => {
  const tables: Record<string, Record<string, unknown>[]> = {
    products: [
      { id: 'p-1', sku: 'COF-1', name: 'Coffee',  product_type: 'finished', is_active: true, deleted_at: null, retail_price: 25000 },
      { id: 'p-2', sku: 'CRO-1', name: 'Croissant', product_type: 'finished', is_active: true, deleted_at: null, retail_price: 15000 },
    ],
    categories: [
      { id: 'cat-1', name: 'Meals', slug: 'meals', sort_order: 1, is_active: true, deleted_at: null },
    ],
    combo_items: [],
  };
  function makeBuilder(table: string) {
    let chain: { filters: Record<string, unknown>; isDeletedNull: boolean; neqs: [string, unknown][]; orderBy: string | null } =
      { filters: {}, isDeletedNull: false, neqs: [], orderBy: null };
    const api = {
      select: () => api,
      is:    (col: string, val: unknown) => { if (col === 'deleted_at' && val === null) chain.isDeletedNull = true; return api; },
      eq:    (col: string, val: unknown) => { chain.filters[col] = val; return api; },
      neq:   (col: string, val: unknown) => { chain.neqs.push([col, val]); return api; },
      or:    () => api,
      ilike: () => api,
      order: () => api,
      limit: () => api,
      single: async () => ({ data: tables[table][tables[table].length - 1], error: null }),
      insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
        const arr = Array.isArray(row) ? row : [row];
        tables[table].push(...arr.map((r) => ({ id: crypto.randomUUID(), ...r })));
        return api;
      },
      update: (vals: Record<string, unknown>) => {
        const target = tables[table].find((r) => Object.entries(chain.filters).every(([k, v]) => r[k] === v));
        if (target) Object.assign(target, vals);
        return api;
      },
      delete: () => { tables[table] = tables[table].filter((r) => !Object.entries(chain.filters).every(([k, v]) => r[k] === v)); return api; },
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
  return { supabase: { from: vi.fn().mockImplementation((t: string) => makeBuilder(t)), rpc: rpcSpy } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CombosPage />
    </QueryClientProvider>,
  );
}

describe('CombosPage smoke', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    useAuthStore.setState({
      user: { id: 'u1', role_code: 'MANAGER', full_name: 'Mgr', permissions: [
        'combos.read', 'combos.create', 'combos.update', 'combos.delete',
      ] },
      isAuthenticated: true,
    } as never);
  });

  it('opens create modal, adds 2 components, calls create_combo_with_items RPC', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/Combos/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New combo/i }));

    await user.type(screen.getByLabelText(/^SKU/i),  'SET-LUNCH');
    await user.type(screen.getByLabelText(/^Name/i), 'Lunch Set');
    await user.selectOptions(screen.getByLabelText(/^Category/i), 'cat-1');
    const price = screen.getByLabelText(/Bundle price/i) as HTMLInputElement;
    await user.clear(price); await user.type(price, '35000');

    // Pick the 2 components
    const search = screen.getByLabelText(/Search component/i);
    await user.type(search, 'Coffee');
    const coffeeOption = await screen.findByText('Coffee');
    await user.click(coffeeOption);
    await user.clear(search); await user.type(search, 'Croissant');
    const croOption = await screen.findByText('Croissant');
    await user.click(croOption);

    expect(screen.getByText(/Components \(2\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('create_combo_with_items', expect.objectContaining({
      p_header: expect.objectContaining({ sku: 'SET-LUNCH', name: 'Lunch Set', retail_price: 35000 }),
      p_items: expect.arrayContaining([
        expect.objectContaining({ component_product_id: 'p-1', quantity: 1 }),
        expect.objectContaining({ component_product_id: 'p-2', quantity: 1 }),
      ]),
    })));
  });
});
```

- [ ] **Step 2: Run smoke + full BO suite**

```bash
pnpm --filter backoffice test -- combos-crud.smoke
pnpm --filter backoffice test
```

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/__tests__/combos-crud.smoke.test.tsx
git commit -m "test(backoffice): session 11 — combos CRUD smoke (RPC call shape)"
```

---

## Phase exit criteria

- [ ] Migration `20260517000003_create_combo_with_items_rpc.sql` applied; pgTAP shows 7 ok
- [ ] `/backoffice/combos` renders for MANAGER; combos list excludes finished products
- [ ] Create flow calls the RPC with the correct `{ p_header, p_items }` shape
- [ ] Edit flow reconciles items via DELETE + INSERT inside the same render cycle
- [ ] Deleting a combo soft-deletes the header; combo_items are removed via FK CASCADE on a future hard-delete pass (not this session)
- [ ] All 9 commits landed
- [ ] `pnpm typecheck` 0 errors, `pnpm lint` 0 warnings, `pnpm test` green

Once all checked, dispatch the subagent for Phase 08 (Customers page extraction).
