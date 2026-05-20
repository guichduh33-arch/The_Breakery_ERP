# Session 27b — spec (Product CRUD : create + categories management)

**Date :** 2026-05-20
**Branch :** `claude/continue-session-27-5iall` (same branch as S27 — PR #29)
**Multi-session plan :** [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/2026-05-19-S24-to-S30-plan.md) §S27
**INDEX :** [`../plans/2026-05-20-session-27b-INDEX.md`](../plans/2026-05-20-session-27b-INDEX.md)
**S27 spec (predecessor) :** [`./2026-05-20-session-27-spec.md`](./2026-05-20-session-27-spec.md)

---

## 1. Context

S27 (this morning) shipped the **update flow** for products
(`update_product_v1` + BO ProductDetail save wiring) and rapatriated 18
cloud-applied migrations to git. This S27b sub-session closes the rest of
the originally-planned S27 scope :

1. `create_product_v1` RPC + "New product" modal in BO Products page.
2. Categories CRUD : `create_category_v1`, `update_category_v1`,
   `reorder_categories_v1` + Categories management page with DnD reorder.

Bulk operations and variants tab remain deferred (S27c if needed).

---

## 2. Scope — what S27b ships

### 2.1 DB (block `20260520101735..102709`, 9 migrations)

| Migration | Purpose |
|---|---|
| `20260520101735` | `create_product_v1(jsonb)` SECURITY DEFINER, 21-col allowlist |
| `20260520101749` | REVOKE pair S25 canonical for `create_product_v1` |
| `20260520101810` | `create_category_v1(jsonb)` auto-slugify + auto-sort_order |
| `20260520101830` | `update_category_v1(uuid,jsonb)` 6-col allowlist patch |
| `20260520101850` | `reorder_categories_v1(uuid[])` (superseded by `_102709`) |
| `20260520101902` | REVOKE pair `create_category_v1` |
| `20260520101913` | REVOKE pair `update_category_v1` |
| `20260520101924` | REVOKE pair `reorder_categories_v1` |
| `20260520102709` | Corrective : `reorder_categories_v1` ambiguous-id fix (42702) |

### 2.2 BO UI

**Products page (`apps/backoffice/src/pages/Products.tsx`) :**
- New `useCreateProduct` hook (`apps/backoffice/.../features/products/hooks/useCreateProduct.ts`).
- New `NewProductDialog` component with name / sku / category / unit / retail /
  description fields + SKU auto-uppercase + slug validation feedback.
- Header's "+ New Product" pill wired to open the dialog, gated by
  `products.create` via `useAuthStore.hasPermission`.
- On success : navigates to the new product's `/backoffice/products/:id` page.

**Categories management page (new `/backoffice/categories`) :**
- New route registered, new sidebar entry under Products
  (`categories.read` gated).
- New `useAllCategories` hook (returns active + inactive, ordered by `sort_order`).
- New `useCreateCategory`, `useUpdateCategory`, `useReorderCategories` hooks.
- DnD reorder via `@dnd-kit/core` + `@dnd-kit/sortable` :
  - Pointer + keyboard sensors.
  - Optimistic local reordering ; rolls back on RPC error.
  - Drag handle is a dedicated button (a11y).
- `CategorySortableRow` with name / slug / dispatch+kds station / active
  badge / Edit + Hide/Activate inline actions.
- `CategoryFormDialog` (`mode: 'create' | 'edit'`) with dispatch/kds
  selects, active toggle, optional slug field.

### 2.3 Tests

**pgTAP `supabase/tests/product_category_crud.test.sql`** — 10 asserts,
all green on V3 dev :
- T1 + T1b : `create_product_v1` happy path + `product_unit_contexts` seed
- T2 : CASHIER 42501
- T3 : missing required fields 22023
- T4 : duplicate sku 23505 `sku_taken`
- T5 : auto-slugify lowercase hyphenated
- T6 : empty name 22023
- T7 : `reorder_categories_v1` assigns 10, 20, ... in given order
- T8 : reorder with unknown id raises `incomplete_ordered_ids`
- T9 : reorder with duplicate ids raises `duplicate_ids`

**BO smoke `new-product-dialog.smoke.test.tsx`** — 2 cases, vitest green :
- Blocks submit on invalid input (validates before calling RPC)
- Calls `create_product_v1` with normalized payload on valid submit
  (SKU upper-cased, default unit `pcs`, fires `onCreated` + `onClose`)

---

## 3. Out of scope (S27c / backlog)

- Bulk operations on the products list (multi-select + bulk toggle active
  + bulk change category).
- Variants tab beyond stub (needs `product_variants` schema design first).
- UI consumers for `set_product_units_v1`, `set_product_sections_v1`,
  `upsert_product_modifiers_v1` (the 3 RPCs landed in S27 catch-up have
  no UI yet — `UnitsPanel`, sections in `GeneralPanel`, Variants tab
  remain read-only / stubs).
- pgTAP for `update_category_v1` happy path / 42501 path (only `create_*`
  and `reorder_*` covered for time).
- Soft-delete RPC for categories (`delete_category_v1`) — currently the
  page exposes hide-via-toggle-active as a soft alternative.

---

## 4. Risks + decisions

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | `reorder_categories_v1` had a 42702 ambiguous-id bug caught by pgTAP T7 on first run — `unnest(arr) AS id` collided with `categories.id` | Caught immediately + fixed via corrective migration `_102709` ; pgTAP suite green after fix |
| R2 | `NewProductDialog` has no per-field validation feedback beyond a single error banner | Acceptable for MVP ; future polish in S27c |
| R3 | DnD optimistic update rolls back to last successful query data on error — there's a brief flash before query revalidates | Acceptable ; `useReorderCategories` could be made fully optimistic with onMutate/onError pattern in S27c |
| R4 | `reorder_categories_v1` requires complete coverage (every live category in the input array) — partial reorder not supported | By design : keeps `sort_order` values gap-friendly (10, 20, ...) and removes the partial-coverage edge cases |
| R5 | `CategoryFormDialog` uses native `<select>` for dispatch/kds station — hardcoded list of 5 stations each | Acceptable MVP ; if stations become configurable elsewhere, switch to a fetched list |

---

## 5. Acceptance — green light

- [x] 9 migrations on cloud + mirrored in git.
- [x] `pnpm typecheck` 6/6 green.
- [x] pgTAP `product_category_crud.test.sql` 10/10 green via MCP.
- [x] BO smoke `new-product-dialog.smoke.test.tsx` 2/2 green.
- [x] BO smoke `product-detail-save.smoke.test.tsx` (S27 regression) 2/2 still green.
- [x] PR #29 updated by pushing new commits.
