# Product Modifiers Editor (Backoffice) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Backoffice "Modifiers" tab on the product detail page that authors a product's variant types (modifier groups) and options — name, single/multi select, required, per-option price adjustment, default, and ingredients-to-deduct — persisted via the existing `upsert_product_modifiers_v1` RPC.

**Architecture:** Backoffice-only, **zero DB migration**. All infra exists (table `product_modifiers`, RPC `upsert_product_modifiers_v1`, perm `products.modifiers.update`, POS `ModifierModal` consumer). We add pure-TS domain helpers (`@breakery/domain/modifiers`), two BO hooks (load + upsert), four BO components, and wire a new tab into `ProductDetailPage`. Price-per-option works end-to-end the moment a product is saved (the POS already applies it). Per-option `ingredients_to_deduct` is **captured and persisted but not yet consumed** — actual stock deduction is Phase 2 (separate spec).

**Tech Stack:** React 18 + TypeScript (ESM, `.js` import specifiers), TanStack Query v5, Zustand auth store, Vitest + Testing Library, `@breakery/ui` primitives, Supabase JS (`supabase.rpc`).

## Global Constraints

- **No DB migration, no types regen** — the schema and RPC already exist; `product_modifiers` and `upsert_product_modifiers_v1` are already in `packages/supabase/src/types.generated.ts`. Do not add migrations.
- **`@breakery/domain` is IO-free** — no `fetch`, no Supabase, no React in domain files.
- **No raw inserts** — all writes go through `supabase.rpc('upsert_product_modifiers_v1', …)`.
- **`@breakery/ui` exports no `Select`/`RadioGroup`** — use native `<select>` / `<input type="radio">` / `<input type="checkbox">`.
- **Save gate** — the Save action is gated on `products.modifiers.update` via `useAuthStore((s) => s.hasPermission('products.modifiers.update'))`.
- **Permission code value** — exactly `'products.modifiers.update'` (already in the `PermissionCode` union).
- **RPC argument names** — exactly `{ p_product_id: string, p_groups: <jsonb> }`.
- **RPC group JSONB shape** (consumed by `upsert_product_modifiers_v1`): array of
  `{ group_name, group_sort_order, group_required, group_type, options: [{ option_label, option_sort_order, price_adjustment, is_default, ingredients_to_deduct }] }`.
- **`ingredients_to_deduct` element shape**: `{ product_id: string, qty: number, unit: string }` (per the `product_modifiers.ingredients_to_deduct` column comment).
- **Vitest mock-data rule** — mock DATA objects feeding `useEffect`/query deps must be module-scoped or `vi.hoisted` stable refs to avoid the infinite-render OOM (S39 lesson).
- **Run commands from repo root** using pnpm filters; never `npm`.
- **Commit style** — conventional commits; co-author line `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Domain (`packages/domain/src/modifiers/`)**
- Modify `types.ts` — add `ModifierIngredient`, `EditableModifierOption`, `EditableModifierGroup`, `AdminProductModifierRow`.
- Create `parseIngredients.ts` — `parseModifierIngredientsToDeduct`.
- Create `editModel.ts` — `foldModifierRowsForEdit`, `validateModifierDraft`, `serializeModifierGroups`, `ModifierDraftError`.
- Modify `index.ts` — export the new symbols.
- Create `__tests__/parseIngredients.test.ts`, `__tests__/editModel.test.ts`.

**Backoffice hooks (`apps/backoffice/src/features/products/hooks/`)**
- Create `useProductModifiersAdmin.ts` — product-scoped load + fold.
- Create `useUpsertProductModifiers.ts` — RPC wrapper + invalidation.

**Backoffice components (`apps/backoffice/src/features/products/components/`)**
- Create `OptionIngredientPicker.tsx` — `ingredients_to_deduct` editor (reuses `useAllProductsForPO`).
- Create `ModifierOptionRow.tsx` — one option editor.
- Create `ModifierGroupCard.tsx` — one group editor (renders option rows).
- Create `ModifiersPanel.tsx` — orchestrator (load, draft, validation, save).
- Create `__tests__/option-ingredient-picker.smoke.test.tsx`, `__tests__/modifier-group-card.smoke.test.tsx`, `__tests__/modifiers-panel.smoke.test.tsx`.

**Backoffice wiring**
- Modify `apps/backoffice/src/features/products/types.ts` — add `'modifiers'` to `ProductDetailTab`.
- Modify `apps/backoffice/src/features/products/components/ProductDetailTabs.tsx` — add the tab entry.
- Modify `apps/backoffice/src/pages/products/ProductDetailPage.tsx` — render `<ModifiersPanel>`.
- Create `apps/backoffice/src/pages/products/__tests__/product-modifiers-tab.smoke.test.tsx`.

---

## Task 1: Domain — editor types + ingredient parser

**Files:**
- Modify: `packages/domain/src/modifiers/types.ts`
- Create: `packages/domain/src/modifiers/parseIngredients.ts`
- Modify: `packages/domain/src/modifiers/index.ts`
- Test: `packages/domain/src/modifiers/__tests__/parseIngredients.test.ts`

**Interfaces:**
- Consumes: existing `ModifierGroupType`, `ProductModifierRow` from `./types.js`.
- Produces:
  - `interface ModifierIngredient { product_id: string; qty: number; unit: string }`
  - `interface EditableModifierOption { option_label: string; price_adjustment: number; is_default: boolean; option_sort_order: number; ingredients_to_deduct: ModifierIngredient[] }`
  - `interface EditableModifierGroup { group_name: string; group_type: ModifierGroupType; group_required: boolean; group_sort_order: number; options: EditableModifierOption[] }`
  - `interface AdminProductModifierRow extends ProductModifierRow { ingredients_to_deduct: unknown }`
  - `function parseModifierIngredientsToDeduct(value: unknown): ModifierIngredient[]` — tolerant: returns only well-formed rows (`product_id` non-empty string, `qty` finite number `> 0`, `unit` non-empty string); non-array or all-malformed input returns `[]`. Never throws.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/modifiers/__tests__/parseIngredients.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseModifierIngredientsToDeduct } from '../parseIngredients.js';

describe('parseModifierIngredientsToDeduct', () => {
  it('parses a well-formed array', () => {
    const input = [{ product_id: 'p1', qty: 30, unit: 'ml' }];
    expect(parseModifierIngredientsToDeduct(input)).toEqual([
      { product_id: 'p1', qty: 30, unit: 'ml' },
    ]);
  });

  it('returns [] for a non-array', () => {
    expect(parseModifierIngredientsToDeduct(null)).toEqual([]);
    expect(parseModifierIngredientsToDeduct({})).toEqual([]);
    expect(parseModifierIngredientsToDeduct('x')).toEqual([]);
  });

  it('drops rows with missing or empty product_id', () => {
    const input = [
      { product_id: '', qty: 1, unit: 'g' },
      { qty: 1, unit: 'g' },
      { product_id: 'ok', qty: 1, unit: 'g' },
    ];
    expect(parseModifierIngredientsToDeduct(input)).toEqual([
      { product_id: 'ok', qty: 1, unit: 'g' },
    ]);
  });

  it('drops rows with non-positive or non-finite qty', () => {
    const input = [
      { product_id: 'a', qty: 0, unit: 'g' },
      { product_id: 'b', qty: -5, unit: 'g' },
      { product_id: 'c', qty: Number.NaN, unit: 'g' },
      { product_id: 'd', qty: 2, unit: 'g' },
    ];
    expect(parseModifierIngredientsToDeduct(input)).toEqual([
      { product_id: 'd', qty: 2, unit: 'g' },
    ]);
  });

  it('coerces numeric-string qty and drops empty unit', () => {
    const input = [
      { product_id: 'a', qty: '15', unit: 'ml' },
      { product_id: 'b', qty: 3, unit: '' },
    ];
    expect(parseModifierIngredientsToDeduct(input)).toEqual([
      { product_id: 'a', qty: 15, unit: 'ml' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/domain exec vitest run src/modifiers/__tests__/parseIngredients.test.ts`
Expected: FAIL — cannot resolve `../parseIngredients.js`.

- [ ] **Step 3: Add editor types to `types.ts`**

Append to `packages/domain/src/modifiers/types.ts`:

```ts
/**
 * One raw-material deduction line attached to a modifier option.
 * Stored in `product_modifiers.ingredients_to_deduct` (JSONB).
 * Consumed by the money-path RPCs in Phase 2 (currently inert).
 */
export interface ModifierIngredient {
  product_id: string;
  qty: number;
  unit: string;
}

/** Editable option shape used by the Backoffice modifiers editor. */
export interface EditableModifierOption {
  option_label: string;
  price_adjustment: number;
  is_default: boolean;
  option_sort_order: number;
  ingredients_to_deduct: ModifierIngredient[];
}

/** Editable group shape used by the Backoffice modifiers editor. */
export interface EditableModifierGroup {
  group_name: string;
  group_type: ModifierGroupType;
  group_required: boolean;
  group_sort_order: number;
  options: EditableModifierOption[];
}

/**
 * `product_modifiers` row including the raw JSONB `ingredients_to_deduct`
 * column (not present on the POS-facing `ProductModifierRow`).
 */
export interface AdminProductModifierRow extends ProductModifierRow {
  ingredients_to_deduct: unknown;
}
```

- [ ] **Step 4: Create the parser**

Create `packages/domain/src/modifiers/parseIngredients.ts`:

```ts
// packages/domain/src/modifiers/parseIngredients.ts
//
// Tolerant parser for the `product_modifiers.ingredients_to_deduct` JSONB
// column. Returns only well-formed rows; never throws (robust at load time).
// Shape per the column comment: { product_id: string, qty: number, unit: string }.

import type { ModifierIngredient } from './types.js';

export function parseModifierIngredientsToDeduct(value: unknown): ModifierIngredient[] {
  if (!Array.isArray(value)) return [];
  const out: ModifierIngredient[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const product_id = typeof r.product_id === 'string' ? r.product_id.trim() : '';
    const unit = typeof r.unit === 'string' ? r.unit.trim() : '';
    const qty = Number(r.qty);
    if (product_id === '' || unit === '') continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ product_id, qty, unit });
  }
  return out;
}
```

- [ ] **Step 5: Export from `index.ts`**

In `packages/domain/src/modifiers/index.ts`, add after the existing exports:

```ts
export { parseModifierIngredientsToDeduct } from './parseIngredients.js';
export type {
  ModifierIngredient,
  EditableModifierOption,
  EditableModifierGroup,
  AdminProductModifierRow,
} from './types.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @breakery/domain exec vitest run src/modifiers/__tests__/parseIngredients.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/modifiers/types.ts packages/domain/src/modifiers/parseIngredients.ts packages/domain/src/modifiers/index.ts packages/domain/src/modifiers/__tests__/parseIngredients.test.ts
git commit -m "feat(domain): modifier editor types + ingredients parser"
```

---

## Task 2: Domain — fold, validate, serialize

**Files:**
- Create: `packages/domain/src/modifiers/editModel.ts`
- Modify: `packages/domain/src/modifiers/index.ts`
- Test: `packages/domain/src/modifiers/__tests__/editModel.test.ts`

**Interfaces:**
- Consumes: `AdminProductModifierRow`, `EditableModifierGroup`, `EditableModifierOption`, `ModifierGroupType` from `./types.js`; `parseModifierIngredientsToDeduct` from `./parseIngredients.js`.
- Produces:
  - `interface ModifierDraftError { message: string }`
  - `function foldModifierRowsForEdit(rows: AdminProductModifierRow[]): EditableModifierGroup[]` — groups flat rows by `group_name`; groups sorted by `group_sort_order` then `group_name`; options sorted by `option_sort_order` then `option_label`; parses each row's `ingredients_to_deduct`.
  - `function validateModifierDraft(groups: EditableModifierGroup[]): ModifierDraftError[]` — rules in the spec.
  - `function serializeModifierGroups(groups: EditableModifierGroup[]): unknown` — builds the RPC `p_groups` JSONB; reassigns `group_sort_order`/`option_sort_order` from array index.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/modifiers/__tests__/editModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  foldModifierRowsForEdit,
  validateModifierDraft,
  serializeModifierGroups,
} from '../editModel.js';
import type { AdminProductModifierRow, EditableModifierGroup } from '../types.js';

function row(over: Partial<AdminProductModifierRow>): AdminProductModifierRow {
  return {
    id: 'r',
    product_id: 'prod',
    category_id: null,
    group_name: 'Milk',
    group_sort_order: 0,
    group_required: true,
    group_type: 'single_select',
    option_label: 'Fresh milk',
    option_icon: null,
    option_sort_order: 0,
    price_adjustment: 0,
    is_default: true,
    is_active: true,
    ingredients_to_deduct: [],
    ...over,
  };
}

describe('foldModifierRowsForEdit', () => {
  it('folds flat rows into sorted groups with parsed ingredients', () => {
    const rows: AdminProductModifierRow[] = [
      row({ id: '1', group_name: 'Milk', group_sort_order: 0, option_label: 'Oat milk', option_sort_order: 1, price_adjustment: 10000, is_default: false, ingredients_to_deduct: [{ product_id: 'oat', qty: 30, unit: 'ml' }] }),
      row({ id: '2', group_name: 'Milk', group_sort_order: 0, option_label: 'Fresh milk', option_sort_order: 0, is_default: true }),
      row({ id: '3', group_name: 'ICE/HOT', group_sort_order: 1, group_type: 'single_select', option_label: 'Ice', option_sort_order: 0, is_default: true, group_required: true }),
    ];
    const groups = foldModifierRowsForEdit(rows);
    expect(groups.map((g) => g.group_name)).toEqual(['Milk', 'ICE/HOT']);
    expect(groups[0].options.map((o) => o.option_label)).toEqual(['Fresh milk', 'Oat milk']);
    expect(groups[0].options[1]).toMatchObject({
      option_label: 'Oat milk',
      price_adjustment: 10000,
      is_default: false,
      ingredients_to_deduct: [{ product_id: 'oat', qty: 30, unit: 'ml' }],
    });
  });
});

describe('validateModifierDraft', () => {
  const good: EditableModifierGroup = {
    group_name: 'Milk',
    group_type: 'single_select',
    group_required: true,
    group_sort_order: 0,
    options: [
      { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
      { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [] },
    ],
  };

  it('passes a valid draft', () => {
    expect(validateModifierDraft([good])).toEqual([]);
  });

  it('flags a blank group name', () => {
    const errs = validateModifierDraft([{ ...good, group_name: '  ' }]);
    expect(errs.length).toBeGreaterThan(0);
  });

  it('flags duplicate group names', () => {
    const errs = validateModifierDraft([good, { ...good }]);
    expect(errs.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it('flags a group with no options', () => {
    const errs = validateModifierDraft([{ ...good, options: [] }]);
    expect(errs.some((e) => /at least one option/i.test(e.message))).toBe(true);
  });

  it('flags duplicate option labels within a group', () => {
    const errs = validateModifierDraft([{
      ...good,
      options: [good.options[0], { ...good.options[0] }],
    }]);
    expect(errs.some((e) => /duplicate option/i.test(e.message))).toBe(true);
  });

  it('flags a required single_select group without exactly one default', () => {
    const noDefault = { ...good, options: good.options.map((o) => ({ ...o, is_default: false })) };
    expect(validateModifierDraft([noDefault]).some((e) => /default/i.test(e.message))).toBe(true);
    const twoDefault = { ...good, options: good.options.map((o) => ({ ...o, is_default: true })) };
    expect(validateModifierDraft([twoDefault]).some((e) => /default/i.test(e.message))).toBe(true);
  });

  it('flags an ingredient with non-positive qty', () => {
    const bad = {
      ...good,
      options: [
        { ...good.options[0], ingredients_to_deduct: [{ product_id: 'x', qty: 0, unit: 'g' }] },
        good.options[1],
      ],
    };
    expect(validateModifierDraft([bad]).some((e) => /qty/i.test(e.message))).toBe(true);
  });
});

describe('serializeModifierGroups', () => {
  it('reassigns sort orders by index and keeps ingredients', () => {
    const groups: EditableModifierGroup[] = [
      {
        group_name: 'Milk',
        group_type: 'single_select',
        group_required: true,
        group_sort_order: 99,
        options: [
          { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 5, ingredients_to_deduct: [] },
          { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 9, ingredients_to_deduct: [{ product_id: 'oat', qty: 30, unit: 'ml' }] },
        ],
      },
    ];
    const out = serializeModifierGroups(groups) as Array<Record<string, unknown>>;
    expect(out[0].group_sort_order).toBe(0);
    const opts = out[0].options as Array<Record<string, unknown>>;
    expect(opts[0].option_sort_order).toBe(0);
    expect(opts[1].option_sort_order).toBe(1);
    expect(opts[1].ingredients_to_deduct).toEqual([{ product_id: 'oat', qty: 30, unit: 'ml' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/domain exec vitest run src/modifiers/__tests__/editModel.test.ts`
Expected: FAIL — cannot resolve `../editModel.js`.

- [ ] **Step 3: Implement `editModel.ts`**

Create `packages/domain/src/modifiers/editModel.ts`:

```ts
// packages/domain/src/modifiers/editModel.ts
//
// Pure (IO-free) helpers for the Backoffice modifiers editor:
//   - foldModifierRowsForEdit: flat product_modifiers rows -> editable groups
//   - validateModifierDraft:   client-side validation rules
//   - serializeModifierGroups: editable groups -> upsert_product_modifiers_v1 p_groups JSONB

import type {
  AdminProductModifierRow,
  EditableModifierGroup,
  EditableModifierOption,
} from './types.js';
import { parseModifierIngredientsToDeduct } from './parseIngredients.js';

export interface ModifierDraftError {
  message: string;
}

export function foldModifierRowsForEdit(
  rows: AdminProductModifierRow[],
): EditableModifierGroup[] {
  const byName = new Map<string, EditableModifierGroup>();
  for (const r of rows) {
    let g = byName.get(r.group_name);
    if (!g) {
      g = {
        group_name: r.group_name,
        group_type: r.group_type,
        group_required: r.group_required,
        group_sort_order: r.group_sort_order,
        options: [],
      };
      byName.set(r.group_name, g);
    }
    const option: EditableModifierOption = {
      option_label: r.option_label,
      price_adjustment: Number(r.price_adjustment) || 0,
      is_default: r.is_default,
      option_sort_order: r.option_sort_order,
      ingredients_to_deduct: parseModifierIngredientsToDeduct(r.ingredients_to_deduct),
    };
    g.options.push(option);
  }
  const groups = [...byName.values()];
  groups.sort(
    (a, b) =>
      a.group_sort_order - b.group_sort_order || a.group_name.localeCompare(b.group_name),
  );
  for (const g of groups) {
    g.options.sort(
      (a, b) =>
        a.option_sort_order - b.option_sort_order ||
        a.option_label.localeCompare(b.option_label),
    );
  }
  return groups;
}

export function validateModifierDraft(
  groups: EditableModifierGroup[],
): ModifierDraftError[] {
  const errors: ModifierDraftError[] = [];
  const seenGroup = new Set<string>();

  for (const g of groups) {
    const gname = g.group_name.trim();
    if (gname === '') {
      errors.push({ message: 'A variant type (group) name is required.' });
    } else {
      const key = gname.toLowerCase();
      if (seenGroup.has(key)) {
        errors.push({ message: `Duplicate variant type name: "${gname}".` });
      }
      seenGroup.add(key);
    }

    if (g.options.length === 0) {
      errors.push({ message: `"${gname || 'Unnamed'}" must have at least one option.` });
    }

    const seenOption = new Set<string>();
    let defaultCount = 0;
    for (const o of g.options) {
      const olabel = o.option_label.trim();
      if (olabel === '') {
        errors.push({ message: `An option in "${gname || 'Unnamed'}" needs a label.` });
      } else {
        const okey = olabel.toLowerCase();
        if (seenOption.has(okey)) {
          errors.push({ message: `Duplicate option "${olabel}" in "${gname}".` });
        }
        seenOption.add(okey);
      }
      if (o.is_default) defaultCount += 1;
      for (const ing of o.ingredients_to_deduct) {
        if (!(ing.qty > 0)) {
          errors.push({
            message: `Ingredient qty must be greater than 0 in option "${olabel || 'Unnamed'}".`,
          });
        }
        if (ing.product_id.trim() === '') {
          errors.push({
            message: `Pick a raw material for every ingredient line in "${olabel || 'Unnamed'}".`,
          });
        }
      }
    }

    if (g.group_type === 'single_select' && g.group_required && defaultCount !== 1) {
      errors.push({
        message: `Required single-select "${gname || 'Unnamed'}" must have exactly one default option.`,
      });
    }
    if (g.group_type === 'single_select' && !g.group_required && defaultCount > 1) {
      errors.push({
        message: `Single-select "${gname || 'Unnamed'}" can have at most one default option.`,
      });
    }
  }

  return errors;
}

export function serializeModifierGroups(groups: EditableModifierGroup[]): unknown {
  return groups.map((g, gi) => ({
    group_name: g.group_name.trim(),
    group_type: g.group_type,
    group_required: g.group_required,
    group_sort_order: gi,
    options: g.options.map((o, oi) => ({
      option_label: o.option_label.trim(),
      option_sort_order: oi,
      price_adjustment: o.price_adjustment,
      is_default: o.is_default,
      ingredients_to_deduct: o.ingredients_to_deduct.map((ing) => ({
        product_id: ing.product_id,
        qty: ing.qty,
        unit: ing.unit,
      })),
    })),
  }));
}
```

- [ ] **Step 4: Export from `index.ts`**

In `packages/domain/src/modifiers/index.ts`, add:

```ts
export {
  foldModifierRowsForEdit,
  validateModifierDraft,
  serializeModifierGroups,
  type ModifierDraftError,
} from './editModel.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @breakery/domain exec vitest run src/modifiers/__tests__/editModel.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the domain package**

Run: `pnpm --filter @breakery/domain typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/modifiers/editModel.ts packages/domain/src/modifiers/index.ts packages/domain/src/modifiers/__tests__/editModel.test.ts
git commit -m "feat(domain): modifier draft fold/validate/serialize helpers"
```

---

## Task 3: Backoffice hooks — load + upsert

**Files:**
- Create: `apps/backoffice/src/features/products/hooks/useProductModifiersAdmin.ts`
- Create: `apps/backoffice/src/features/products/hooks/useUpsertProductModifiers.ts`
- Test: `apps/backoffice/src/features/products/hooks/__tests__/useUpsertProductModifiers.smoke.test.tsx`

**Interfaces:**
- Consumes: `foldModifierRowsForEdit`, `serializeModifierGroups`, `EditableModifierGroup`, `AdminProductModifierRow` from `@breakery/domain`; `supabase` from `@/lib/supabase.js`.
- Produces:
  - `useProductModifiersAdmin(productId: string)` → TanStack query returning `EditableModifierGroup[]`; key `['product-modifiers-admin', productId]`.
  - `useUpsertProductModifiers(productId: string)` → TanStack mutation; `mutationFn(groups: EditableModifierGroup[])` calls `supabase.rpc('upsert_product_modifiers_v1', { p_product_id, p_groups })`; invalidates `['product-modifiers-admin', productId]` and `['product-modifiers']`.

- [ ] **Step 1: Write the failing test**

Create `apps/backoffice/src/features/products/hooks/__tests__/useUpsertProductModifiers.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { useUpsertProductModifiers } from '../useUpsertProductModifiers.js';
import type { EditableModifierGroup } from '@breakery/domain';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const GROUPS: EditableModifierGroup[] = [
  {
    group_name: 'Milk',
    group_type: 'single_select',
    group_required: true,
    group_sort_order: 0,
    options: [
      { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
      { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [{ product_id: 'oat', qty: 30, unit: 'ml' }] },
    ],
  },
];

describe('useUpsertProductModifiers', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { modifiers: [] }, error: null });
  });

  it('calls upsert_product_modifiers_v1 with the serialized payload', async () => {
    const { result } = renderHook(() => useUpsertProductModifiers('prod-1'), { wrapper });
    result.current.mutate(GROUPS);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith('upsert_product_modifiers_v1', expect.objectContaining({
      p_product_id: 'prod-1',
    }));
    const arg = rpc.mock.calls[0][1] as { p_groups: Array<Record<string, unknown>> };
    expect(arg.p_groups[0].group_name).toBe('Milk');
    expect(arg.p_groups[0].group_sort_order).toBe(0);
    const opts = arg.p_groups[0].options as Array<Record<string, unknown>>;
    expect(opts[1].ingredients_to_deduct).toEqual([{ product_id: 'oat', qty: 30, unit: 'ml' }]);
  });

  it('throws on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission_denied' } });
    const { result } = renderHook(() => useUpsertProductModifiers('prod-1'), { wrapper });
    result.current.mutate(GROUPS);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/permission_denied/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/features/products/hooks/__tests__/useUpsertProductModifiers.smoke.test.tsx`
Expected: FAIL — cannot resolve `../useUpsertProductModifiers.js`.

- [ ] **Step 3: Implement `useProductModifiersAdmin.ts`**

Create `apps/backoffice/src/features/products/hooks/useProductModifiersAdmin.ts`:

```ts
// apps/backoffice/src/features/products/hooks/useProductModifiersAdmin.ts
//
// Loads a product's modifier rows (product-scoped) and folds them into the
// editable group structure used by ModifiersPanel. Includes the raw
// ingredients_to_deduct JSONB so the editor round-trips it.

import { useQuery } from '@tanstack/react-query';
import {
  foldModifierRowsForEdit,
  type AdminProductModifierRow,
  type EditableModifierGroup,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

const ADMIN_MODIFIER_COLUMNS =
  'id, product_id, category_id, group_name, group_sort_order, group_required, ' +
  'group_type, option_label, option_icon, option_sort_order, price_adjustment, ' +
  'is_default, is_active, ingredients_to_deduct';

export function productModifiersAdminKey(productId: string) {
  return ['product-modifiers-admin', productId] as const;
}

export function useProductModifiersAdmin(productId: string) {
  return useQuery<EditableModifierGroup[]>({
    queryKey: productModifiersAdminKey(productId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_modifiers')
        .select(ADMIN_MODIFIER_COLUMNS)
        .eq('product_id', productId)
        .eq('is_active', true)
        .is('deleted_at', null);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as AdminProductModifierRow[];
      return foldModifierRowsForEdit(rows);
    },
  });
}
```

- [ ] **Step 4: Implement `useUpsertProductModifiers.ts`**

Create `apps/backoffice/src/features/products/hooks/useUpsertProductModifiers.ts`:

```ts
// apps/backoffice/src/features/products/hooks/useUpsertProductModifiers.ts
//
// Wraps upsert_product_modifiers_v1 (S27, gate products.modifiers.update).
// REPLACE semantics: the RPC soft-deletes the product's current modifiers and
// re-inserts from the serialized payload. Invalidates both the admin load key
// and the POS-shared ['product-modifiers'] keys.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  serializeModifierGroups,
  type EditableModifierGroup,
} from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';
import { productModifiersAdminKey } from './useProductModifiersAdmin.js';

export function useUpsertProductModifiers(productId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, EditableModifierGroup[]>({
    mutationFn: async (groups) => {
      const { data, error } = await supabase.rpc('upsert_product_modifiers_v1', {
        p_product_id: productId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_groups: serializeModifierGroups(groups) as any,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productModifiersAdminKey(productId) });
      void qc.invalidateQueries({ queryKey: ['product-modifiers'] });
    },
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/features/products/hooks/__tests__/useUpsertProductModifiers.smoke.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/features/products/hooks/useProductModifiersAdmin.ts apps/backoffice/src/features/products/hooks/useUpsertProductModifiers.ts apps/backoffice/src/features/products/hooks/__tests__/useUpsertProductModifiers.smoke.test.tsx
git commit -m "feat(backoffice): product modifiers admin load + upsert hooks"
```

---

## Task 4: Backoffice — OptionIngredientPicker

**Files:**
- Create: `apps/backoffice/src/features/products/components/OptionIngredientPicker.tsx`
- Test: `apps/backoffice/src/features/products/components/__tests__/option-ingredient-picker.smoke.test.tsx`

**Interfaces:**
- Consumes: `useAllProductsForPO` from `@/features/purchasing/hooks/useAllProductsForPO.js` (returns `PoProductRow[]` with `{ id, name, unit, unitOptions: { code, factor }[] }`); `ModifierIngredient` from `@breakery/domain`.
- Produces: `OptionIngredientPicker({ value, onChange })` where `value: ModifierIngredient[]` and `onChange: (next: ModifierIngredient[]) => void`. Renders one row per ingredient (material `<select>`, qty `<input type="number">`, unit `<select>` from the chosen material's unit options), an "Add ingredient" button, and a per-row remove button.

- [ ] **Step 1: Write the failing test**

Create `apps/backoffice/src/features/products/components/__tests__/option-ingredient-picker.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { ModifierIngredient } from '@breakery/domain';

vi.mock('@/features/purchasing/hooks/useAllProductsForPO.js', () => ({
  useAllProductsForPO: () => ({
    data: [
      { id: 'oat', name: 'Oat Milk', unit: 'ml', unitOptions: [{ code: 'ml', factor: 1 }, { code: 'L', factor: 1000 }] },
      { id: 'sugar', name: 'Sugar', unit: 'g', unitOptions: [{ code: 'g', factor: 1 }] },
    ],
    isLoading: false,
  }),
}));

import { OptionIngredientPicker } from '../OptionIngredientPicker.js';

afterEach(cleanup);

describe('OptionIngredientPicker', () => {
  it('renders existing ingredient rows', () => {
    const value: ModifierIngredient[] = [{ product_id: 'oat', qty: 30, unit: 'ml' }];
    render(<OptionIngredientPicker value={value} onChange={() => {}} />);
    expect(screen.getByDisplayValue('30')).toBeInTheDocument();
  });

  it('adds a blank ingredient row on Add', () => {
    const onChange = vi.fn();
    render(<OptionIngredientPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add ingredient/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as ModifierIngredient[];
    expect(next).toHaveLength(1);
  });

  it('removes an ingredient row', () => {
    const onChange = vi.fn();
    const value: ModifierIngredient[] = [{ product_id: 'oat', qty: 30, unit: 'ml' }];
    render(<OptionIngredientPicker value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove ingredient/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/features/products/components/__tests__/option-ingredient-picker.smoke.test.tsx`
Expected: FAIL — cannot resolve `../OptionIngredientPicker.js`.

- [ ] **Step 3: Implement `OptionIngredientPicker.tsx`**

Create `apps/backoffice/src/features/products/components/OptionIngredientPicker.tsx`:

```tsx
// apps/backoffice/src/features/products/components/OptionIngredientPicker.tsx
//
// Edits a modifier option's `ingredients_to_deduct` array. Raw materials come
// from useAllProductsForPO (category_type='raw_material'). Phase 1 captures the
// data; actual stock deduction is wired in Phase 2.

import type { JSX } from 'react';
import { Button } from '@breakery/ui';
import { Trash2, Plus } from 'lucide-react';
import type { ModifierIngredient } from '@breakery/domain';
import { useAllProductsForPO } from '@/features/purchasing/hooks/useAllProductsForPO.js';

export interface OptionIngredientPickerProps {
  value: ModifierIngredient[];
  onChange: (next: ModifierIngredient[]) => void;
}

export function OptionIngredientPicker({
  value,
  onChange,
}: OptionIngredientPickerProps): JSX.Element {
  const { data: materials = [] } = useAllProductsForPO();

  function updateRow(idx: number, patch: Partial<ModifierIngredient>): void {
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    const first = materials[0];
    onChange([
      ...value,
      { product_id: first?.id ?? '', qty: 1, unit: first?.unit ?? '' },
    ]);
  }

  function removeRow(idx: number): void {
    onChange(value.filter((_, i) => i !== idx));
  }

  function unitsFor(productId: string): string[] {
    const m = materials.find((x) => x.id === productId);
    if (!m) return [];
    return m.unitOptions.map((u) => u.code);
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-widest text-text-muted">
        Ingredients to deduct (applied once stock-by-option ships)
      </p>
      {value.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <select
            aria-label="Raw material"
            className="flex-1 rounded border border-border-subtle bg-surface-2 px-2 py-1 text-sm"
            value={row.product_id}
            onChange={(e) => {
              const pid = e.target.value;
              const units = unitsFor(pid);
              updateRow(idx, { product_id: pid, unit: units[0] ?? row.unit });
            }}
          >
            <option value="">— Select material —</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <input
            aria-label="Quantity"
            type="number"
            min={0}
            step="any"
            className="w-24 rounded border border-border-subtle bg-surface-2 px-2 py-1 text-sm"
            value={row.qty}
            onChange={(e) => updateRow(idx, { qty: Number(e.target.value) })}
          />
          <select
            aria-label="Unit"
            className="w-24 rounded border border-border-subtle bg-surface-2 px-2 py-1 text-sm"
            value={row.unit}
            onChange={(e) => updateRow(idx, { unit: e.target.value })}
          >
            {unitsFor(row.product_id).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Remove ingredient"
            onClick={() => removeRow(idx)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={addRow}>
        <Plus className="mr-1 h-4 w-4" /> Add ingredient
      </Button>
    </div>
  );
}
```

> Note: if `Button` does not accept `size="sm"` / `variant="ghost"` in this repo's `@breakery/ui`, drop those props (verify against `packages/ui/src/components/Button.tsx` during implementation — keep `type="button"` and `aria-label`). Icons `Trash2`/`Plus` are from `lucide-react` (already a dependency).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/features/products/components/__tests__/option-ingredient-picker.smoke.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/products/components/OptionIngredientPicker.tsx apps/backoffice/src/features/products/components/__tests__/option-ingredient-picker.smoke.test.tsx
git commit -m "feat(backoffice): OptionIngredientPicker for modifier options"
```

---

## Task 5: Backoffice — ModifierOptionRow + ModifierGroupCard

**Files:**
- Create: `apps/backoffice/src/features/products/components/ModifierOptionRow.tsx`
- Create: `apps/backoffice/src/features/products/components/ModifierGroupCard.tsx`
- Test: `apps/backoffice/src/features/products/components/__tests__/modifier-group-card.smoke.test.tsx`

**Interfaces:**
- Consumes: `EditableModifierGroup`, `EditableModifierOption`, `ModifierGroupType` from `@breakery/domain`; `OptionIngredientPicker` from `./OptionIngredientPicker.js`.
- Produces:
  - `ModifierOptionRow({ option, groupType, onChange, onRemove, onMakeDefault })` — edits one option; `is_default` is a radio for single_select (calls `onMakeDefault`), a checkbox for multi_select (calls `onChange`).
  - `ModifierGroupCard({ group, onChange, onRemove })` — edits one group; renders the option rows; "Add option" and "Remove group". `onChange(next: EditableModifierGroup)` bubbles all edits up.

- [ ] **Step 1: Write the failing test**

Create `apps/backoffice/src/features/products/components/__tests__/modifier-group-card.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { EditableModifierGroup } from '@breakery/domain';

vi.mock('@/features/purchasing/hooks/useAllProductsForPO.js', () => ({
  useAllProductsForPO: () => ({ data: [], isLoading: false }),
}));

import { ModifierGroupCard } from '../ModifierGroupCard.js';

afterEach(cleanup);

const GROUP: EditableModifierGroup = {
  group_name: 'Milk',
  group_type: 'single_select',
  group_required: true,
  group_sort_order: 0,
  options: [
    { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
    { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [] },
  ],
};

describe('ModifierGroupCard', () => {
  it('renders the group name and options', () => {
    render(<ModifierGroupCard group={GROUP} onChange={() => {}} onRemove={() => {}} />);
    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fresh')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Oat')).toBeInTheDocument();
  });

  it('bubbles a group name edit', () => {
    const onChange = vi.fn();
    render(<ModifierGroupCard group={GROUP} onChange={onChange} onRemove={() => {}} />);
    fireEvent.change(screen.getByDisplayValue('Milk'), { target: { value: 'Milk type' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ group_name: 'Milk type' }));
  });

  it('adds an option', () => {
    const onChange = vi.fn();
    render(<ModifierGroupCard group={GROUP} onChange={onChange} onRemove={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add option/i }));
    const next = onChange.mock.calls[0][0] as EditableModifierGroup;
    expect(next.options).toHaveLength(3);
  });

  it('switching default in single-select makes exactly one default', () => {
    const onChange = vi.fn();
    render(<ModifierGroupCard group={GROUP} onChange={onChange} onRemove={() => {}} />);
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]); // make "Oat" the default
    const next = onChange.mock.calls[0][0] as EditableModifierGroup;
    expect(next.options.filter((o) => o.is_default).map((o) => o.option_label)).toEqual(['Oat']);
  });

  it('removes the group', () => {
    const onRemove = vi.fn();
    render(<ModifierGroupCard group={GROUP} onChange={() => {}} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove (variant type|group)/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/features/products/components/__tests__/modifier-group-card.smoke.test.tsx`
Expected: FAIL — cannot resolve `../ModifierGroupCard.js`.

- [ ] **Step 3: Implement `ModifierOptionRow.tsx`**

Create `apps/backoffice/src/features/products/components/ModifierOptionRow.tsx`:

```tsx
// apps/backoffice/src/features/products/components/ModifierOptionRow.tsx
//
// Edits a single modifier option: label, price adjustment (IDR), default
// (radio for single_select, checkbox for multi_select), ingredients-to-deduct.

import type { JSX } from 'react';
import { Button } from '@breakery/ui';
import { Trash2 } from 'lucide-react';
import type {
  EditableModifierOption,
  ModifierGroupType,
  ModifierIngredient,
} from '@breakery/domain';
import { OptionIngredientPicker } from './OptionIngredientPicker.js';

export interface ModifierOptionRowProps {
  option: EditableModifierOption;
  groupType: ModifierGroupType;
  onChange: (next: EditableModifierOption) => void;
  onRemove: () => void;
  /** single_select only — request this option becomes the sole default. */
  onMakeDefault: () => void;
}

export function ModifierOptionRow({
  option,
  groupType,
  onChange,
  onRemove,
  onMakeDefault,
}: ModifierOptionRowProps): JSX.Element {
  return (
    <div className="rounded border border-border-subtle p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          aria-label="Option label"
          className="flex-1 rounded border border-border-subtle bg-surface-2 px-2 py-1 text-sm"
          placeholder="e.g. Oat milk"
          value={option.option_label}
          onChange={(e) => onChange({ ...option, option_label: e.target.value })}
        />
        <label className="flex items-center gap-1 text-xs text-text-muted">
          + IDR
          <input
            aria-label="Price adjustment"
            type="number"
            step="1"
            className="w-28 rounded border border-border-subtle bg-surface-2 px-2 py-1 text-sm"
            value={option.price_adjustment}
            onChange={(e) =>
              onChange({ ...option, price_adjustment: Number(e.target.value) || 0 })
            }
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          {groupType === 'single_select' ? (
            <input
              type="radio"
              aria-label="Default option"
              checked={option.is_default}
              onChange={onMakeDefault}
            />
          ) : (
            <input
              type="checkbox"
              aria-label="Default option"
              checked={option.is_default}
              onChange={(e) => onChange({ ...option, is_default: e.target.checked })}
            />
          )}
          Default
        </label>
        <Button type="button" aria-label="Remove option" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <OptionIngredientPicker
        value={option.ingredients_to_deduct}
        onChange={(next: ModifierIngredient[]) =>
          onChange({ ...option, ingredients_to_deduct: next })
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Implement `ModifierGroupCard.tsx`**

Create `apps/backoffice/src/features/products/components/ModifierGroupCard.tsx`:

```tsx
// apps/backoffice/src/features/products/components/ModifierGroupCard.tsx
//
// Edits one modifier group (variant type): name, type (single/multi), required,
// and its options. Bubbles the whole edited group up via onChange.

import type { JSX } from 'react';
import { Button, Card } from '@breakery/ui';
import { Trash2, Plus } from 'lucide-react';
import type {
  EditableModifierGroup,
  EditableModifierOption,
  ModifierGroupType,
} from '@breakery/domain';
import { ModifierOptionRow } from './ModifierOptionRow.js';

export interface ModifierGroupCardProps {
  group: EditableModifierGroup;
  onChange: (next: EditableModifierGroup) => void;
  onRemove: () => void;
}

const BLANK_OPTION: EditableModifierOption = {
  option_label: '',
  price_adjustment: 0,
  is_default: false,
  option_sort_order: 0,
  ingredients_to_deduct: [],
};

export function ModifierGroupCard({
  group,
  onChange,
  onRemove,
}: ModifierGroupCardProps): JSX.Element {
  function patch(p: Partial<EditableModifierGroup>): void {
    onChange({ ...group, ...p });
  }

  function changeOption(idx: number, next: EditableModifierOption): void {
    onChange({
      ...group,
      options: group.options.map((o, i) => (i === idx ? next : o)),
    });
  }

  function makeDefault(idx: number): void {
    onChange({
      ...group,
      options: group.options.map((o, i) => ({ ...o, is_default: i === idx })),
    });
  }

  function removeOption(idx: number): void {
    onChange({ ...group, options: group.options.filter((_, i) => i !== idx) });
  }

  function addOption(): void {
    onChange({ ...group, options: [...group.options, { ...BLANK_OPTION }] });
  }

  function changeType(t: ModifierGroupType): void {
    // Switching to single_select with >1 default would be invalid; keep the first.
    if (t === 'single_select') {
      let seen = false;
      const options = group.options.map((o) => {
        if (o.is_default && !seen) {
          seen = true;
          return o;
        }
        return { ...o, is_default: false };
      });
      onChange({ ...group, group_type: t, options });
    } else {
      patch({ group_type: t });
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Variant type name"
          className="flex-1 min-w-48 rounded border border-border-subtle bg-surface-2 px-2 py-1 text-sm font-semibold"
          placeholder="e.g. Milk"
          value={group.group_name}
          onChange={(e) => patch({ group_name: e.target.value })}
        />
        <select
          aria-label="Selection type"
          className="rounded border border-border-subtle bg-surface-2 px-2 py-1 text-sm"
          value={group.group_type}
          onChange={(e) => changeType(e.target.value as ModifierGroupType)}
        >
          <option value="single_select">Single choice</option>
          <option value="multi_select">Multiple choice</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-text-muted">
          <input
            type="checkbox"
            aria-label="Required"
            checked={group.group_required}
            onChange={(e) => patch({ group_required: e.target.checked })}
          />
          Required
        </label>
        <Button type="button" aria-label="Remove variant type" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {group.options.map((o, idx) => (
          <ModifierOptionRow
            key={idx}
            option={o}
            groupType={group.group_type}
            onChange={(next) => changeOption(idx, next)}
            onRemove={() => removeOption(idx)}
            onMakeDefault={() => makeDefault(idx)}
          />
        ))}
      </div>

      <Button type="button" onClick={addOption}>
        <Plus className="mr-1 h-4 w-4" /> Add option
      </Button>
    </Card>
  );
}
```

> Note: verify `Card` is exported from `@breakery/ui` (it is used widely, e.g. in `CombosKpiGrid`). If `Card` does not accept `className`, wrap in a `<div>` instead. Verify `Button` prop names during implementation.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/features/products/components/__tests__/modifier-group-card.smoke.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/features/products/components/ModifierOptionRow.tsx apps/backoffice/src/features/products/components/ModifierGroupCard.tsx apps/backoffice/src/features/products/components/__tests__/modifier-group-card.smoke.test.tsx
git commit -m "feat(backoffice): ModifierOptionRow + ModifierGroupCard editors"
```

---

## Task 6: Backoffice — ModifiersPanel orchestrator

**Files:**
- Create: `apps/backoffice/src/features/products/components/ModifiersPanel.tsx`
- Test: `apps/backoffice/src/features/products/components/__tests__/modifiers-panel.smoke.test.tsx`

**Interfaces:**
- Consumes: `useProductModifiersAdmin`, `useUpsertProductModifiers` (Task 3); `ModifierGroupCard` (Task 5); `validateModifierDraft`, `EditableModifierGroup` from `@breakery/domain`; `useAuthStore` from `@/stores/authStore.js`.
- Produces: `ModifiersPanel({ product })` where `product: { id: string }`. Loads groups into local draft state, tracks dirty, renders `ModifierGroupCard` per group + "Add variant type", shows validation errors, and a **Save** button gated on `products.modifiers.update`.

- [ ] **Step 1: Write the failing test**

Create `apps/backoffice/src/features/products/components/__tests__/modifiers-panel.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { EditableModifierGroup } from '@breakery/domain';

const mutate = vi.fn();
const loadData: { current: EditableModifierGroup[] } = { current: [] };

vi.mock('@/features/purchasing/hooks/useAllProductsForPO.js', () => ({
  useAllProductsForPO: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../hooks/useProductModifiersAdmin.js', () => ({
  useProductModifiersAdmin: () => ({ data: loadData.current, isLoading: false }),
  productModifiersAdminKey: (id: string) => ['product-modifiers-admin', id],
}));
vi.mock('../../hooks/useUpsertProductModifiers.js', () => ({
  useUpsertProductModifiers: () => ({ mutate, isPending: false }),
}));

const hasPermMock = vi.fn();
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (c: string) => boolean }) => unknown) =>
    sel({ hasPermission: hasPermMock }),
}));

import { ModifiersPanel } from '../ModifiersPanel.js';

afterEach(cleanup);

describe('ModifiersPanel', () => {
  beforeEach(() => {
    mutate.mockReset();
    hasPermMock.mockReset();
    hasPermMock.mockReturnValue(true);
    loadData.current = [
      {
        group_name: 'Milk',
        group_type: 'single_select',
        group_required: true,
        group_sort_order: 0,
        options: [
          { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
          { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [] },
        ],
      },
    ];
  });

  it('renders loaded groups', () => {
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument();
  });

  it('adds a new variant type', () => {
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /add variant type/i }));
    // a second name input appears (blank)
    const nameInputs = screen.getAllByLabelText(/variant type name/i);
    expect(nameInputs.length).toBe(2);
  });

  it('saves the serialized draft via the upsert hook', async () => {
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const groups = mutate.mock.calls[0][0] as EditableModifierGroup[];
    expect(groups[0].group_name).toBe('Milk');
  });

  it('hides Save without products.modifiers.update', () => {
    hasPermMock.mockReturnValue(false);
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    expect(screen.queryByRole('button', { name: /^save/i })).toBeNull();
  });

  it('blocks save and shows an error on a blank group name', async () => {
    loadData.current = [
      {
        group_name: '',
        group_type: 'single_select',
        group_required: false,
        group_sort_order: 0,
        options: [{ option_label: 'X', price_adjustment: 0, is_default: false, option_sort_order: 0, ingredients_to_deduct: [] }],
      },
    ];
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/features/products/components/__tests__/modifiers-panel.smoke.test.tsx`
Expected: FAIL — cannot resolve `../ModifiersPanel.js`.

- [ ] **Step 3: Implement `ModifiersPanel.tsx`**

Create `apps/backoffice/src/features/products/components/ModifiersPanel.tsx`:

```tsx
// apps/backoffice/src/features/products/components/ModifiersPanel.tsx
//
// Backoffice editor for a product's modifier groups (variant types). Loads the
// product-scoped modifiers, holds an editable draft, validates, and persists
// via upsert_product_modifiers_v1. Price-per-option is applied by the POS
// immediately; ingredients_to_deduct is captured for Phase 2.

import { useEffect, useState, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { Plus } from 'lucide-react';
import {
  validateModifierDraft,
  type EditableModifierGroup,
  type ModifierDraftError,
} from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { useProductModifiersAdmin } from '../hooks/useProductModifiersAdmin.js';
import { useUpsertProductModifiers } from '../hooks/useUpsertProductModifiers.js';
import { ModifierGroupCard } from './ModifierGroupCard.js';

export interface ModifiersPanelProps {
  product: { id: string };
}

const BLANK_GROUP: EditableModifierGroup = {
  group_name: '',
  group_type: 'single_select',
  group_required: false,
  group_sort_order: 0,
  options: [],
};

export function ModifiersPanel({ product }: ModifiersPanelProps): JSX.Element {
  const canWrite = useAuthStore((s) => s.hasPermission('products.modifiers.update'));
  const { data: loaded, isLoading } = useProductModifiersAdmin(product.id);
  const upsert = useUpsertProductModifiers(product.id);

  const [draft, setDraft] = useState<EditableModifierGroup[]>([]);
  const [errors, setErrors] = useState<ModifierDraftError[]>([]);

  // Re-sync the draft whenever a fresh load arrives.
  useEffect(() => {
    if (loaded) setDraft(loaded);
  }, [loaded]);

  function changeGroup(idx: number, next: EditableModifierGroup): void {
    setDraft((d) => d.map((g, i) => (i === idx ? next : g)));
  }
  function removeGroup(idx: number): void {
    setDraft((d) => d.filter((_, i) => i !== idx));
  }
  function addGroup(): void {
    setDraft((d) => [...d, { ...BLANK_GROUP, options: [] }]);
  }

  function save(): void {
    const errs = validateModifierDraft(draft);
    setErrors(errs);
    if (errs.length > 0) return;
    upsert.mutate(draft);
  }

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading modifiers…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Modifiers / Variant types
          </h3>
          <p className="text-xs text-text-muted">
            Each type lets the cashier pick option(s); price adjusts automatically.
          </p>
        </div>
        {canWrite && (
          <Button type="button" onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving…' : 'Save modifiers'}
          </Button>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="rounded border border-red-fg/40 bg-red-fg/5 p-3 text-sm text-red-fg space-y-1">
          {errors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}

      {draft.length === 0 && (
        <p className="text-sm text-text-muted italic">
          No variant types yet. Add one to offer choices like Milk or Ice/Hot.
        </p>
      )}

      <div className="space-y-4">
        {draft.map((g, idx) => (
          <ModifierGroupCard
            key={idx}
            group={g}
            onChange={(next) => changeGroup(idx, next)}
            onRemove={() => removeGroup(idx)}
          />
        ))}
      </div>

      <Button type="button" onClick={addGroup}>
        <Plus className="mr-1 h-4 w-4" /> Add variant type
      </Button>
    </div>
  );
}
```

> Note: the `red-fg` token is the canonical danger color (PR #84). If the error-box classes don't resolve, fall back to `text-red-600 border-red-300 bg-red-50`. Verify `Button` `disabled` support during implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/features/products/components/__tests__/modifiers-panel.smoke.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/products/components/ModifiersPanel.tsx apps/backoffice/src/features/products/components/__tests__/modifiers-panel.smoke.test.tsx
git commit -m "feat(backoffice): ModifiersPanel orchestrator (load/validate/save)"
```

---

## Task 7: Wire the "Modifiers" tab into ProductDetailPage

**Files:**
- Modify: `apps/backoffice/src/features/products/types.ts` (the `ProductDetailTab` union)
- Modify: `apps/backoffice/src/features/products/components/ProductDetailTabs.tsx`
- Modify: `apps/backoffice/src/pages/products/ProductDetailPage.tsx`
- Test: `apps/backoffice/src/pages/products/__tests__/product-modifiers-tab.smoke.test.tsx`

**Interfaces:**
- Consumes: `ModifiersPanel` (Task 6).
- Produces: a selectable "Modifiers" tab rendering `<ModifiersPanel product={{ id: p.id }} />`.

- [ ] **Step 1: Write the failing test**

Create `apps/backoffice/src/pages/products/__tests__/product-modifiers-tab.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ProductDetailTabs } from '@/features/products/components/ProductDetailTabs.js';

afterEach(cleanup);

describe('ProductDetailTabs — Modifiers tab', () => {
  it('renders a Modifiers tab', () => {
    render(<ProductDetailTabs active="general" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /modifiers/i })).toBeInTheDocument();
  });

  it('marks the Modifiers tab selected when active', () => {
    render(<ProductDetailTabs active="modifiers" onChange={() => {}} />);
    const tab = screen.getByRole('tab', { name: /modifiers/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/pages/products/__tests__/product-modifiers-tab.smoke.test.tsx`
Expected: FAIL — `'modifiers'` is not assignable to `ProductDetailTab` and no Modifiers tab is rendered.

- [ ] **Step 3: Add `'modifiers'` to the tab union**

In `apps/backoffice/src/features/products/types.ts`, extend the `ProductDetailTab` union:

```ts
export type ProductDetailTab =
  | 'overview'
  | 'analytics'
  | 'general'
  | 'units'
  | 'recipe'
  | 'variants'
  | 'modifiers'
  | 'costing'
  | 'purchase'
  | 'history';
```

- [ ] **Step 4: Add the tab entry**

In `apps/backoffice/src/features/products/components/ProductDetailTabs.tsx`, add to the `TABS` array right after the `variants` entry:

```ts
  { id: 'variants', label: 'Variants' },
  { id: 'modifiers', label: 'Modifiers' },
  { id: 'costing',  label: 'Costing'  },
```

- [ ] **Step 5: Render the panel in ProductDetailPage**

In `apps/backoffice/src/pages/products/ProductDetailPage.tsx`:

Add the import near the other panel imports (after the `VariantsPanel` import):

```ts
import { ModifiersPanel } from '@/features/products/components/ModifiersPanel.js';
```

Add the render branch in the tab switch, right after the `variants` branch (which ends around line 142):

```tsx
        {tab === 'modifiers' && <ModifiersPanel product={{ id: p.id }} />}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @breakery/app-backoffice exec vitest run src/pages/products/__tests__/product-modifiers-tab.smoke.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck the whole backoffice app**

Run: `pnpm --filter @breakery/app-backoffice typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backoffice/src/features/products/types.ts apps/backoffice/src/features/products/components/ProductDetailTabs.tsx apps/backoffice/src/pages/products/ProductDetailPage.tsx apps/backoffice/src/pages/products/__tests__/product-modifiers-tab.smoke.test.tsx
git commit -m "feat(backoffice): wire Modifiers tab into product detail page"
```

---

## Final verification

- [ ] **Run the full modifier-related test set**

```bash
pnpm --filter @breakery/domain exec vitest run src/modifiers
pnpm --filter @breakery/app-backoffice exec vitest run src/features/products
```
Expected: all PASS.

- [ ] **Typecheck both packages**

```bash
pnpm --filter @breakery/domain typecheck
pnpm --filter @breakery/app-backoffice typecheck
```
Expected: no errors.

- [ ] **(Optional) Live smoke** — with the BO dev server running, open a finished product → **Modifiers** tab → add a "Milk" single-select group (Fresh default, Oat +10000) → Save → reload → values round-trip. Then in the POS, tap that product and confirm the ModifierModal shows the options and the price adjusts.

---

## Self-Review notes

- **Spec coverage:** Goal 1 (tab) → Task 7. Goal 2 (single+multi) → Task 5 (`changeType`) + domain types. Goal 3 (label/price/default/ingredients) → Tasks 4–5. Goal 4 (persist via RPC; POS price works) → Task 3 + reuse of existing POS consumer. Goal 5 (save gate) → Task 6 (`canWrite`). Validation rules → Task 2 (`validateModifierDraft`). No DB migration → honored (no migration task). IO-free domain → Tasks 1–2 are pure TS.
- **Phase-2 boundary:** `ingredients_to_deduct` is authored and serialized into the RPC payload but no money-path RPC is touched — matches the spec's deferral.
- **Type consistency:** `EditableModifierGroup`/`EditableModifierOption`/`ModifierIngredient` defined in Task 1, consumed unchanged in Tasks 2–7. `productModifiersAdminKey` defined in Task 3 and reused by the upsert hook + panel mock. RPC args `p_product_id`/`p_groups` consistent across Task 3 and the Global Constraints.
- **UI-primitive caveats:** Notes flag the spots to verify `Button`/`Card` props and Tailwind tokens against the real `@breakery/ui` during implementation (the repo has no `Select`/`RadioGroup`, hence native controls).
