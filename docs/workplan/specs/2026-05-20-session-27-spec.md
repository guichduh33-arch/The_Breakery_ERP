# Session 27 — spec (Product CRUD : update flow MVP)

**Date :** 2026-05-20
**Branch :** `claude/continue-session-27-5iall` (Claude Code on the web)
**Multi-session plan :** [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/2026-05-19-S24-to-S30-plan.md) §S27
**INDEX :** [`../plans/2026-05-20-session-27-INDEX.md`](../plans/2026-05-20-session-27-INDEX.md)

---

## 1. Context — why this session is unusual

When this session opened, a **previous Claude Code session had already applied
18 migrations to the V3 dev cloud project** (timestamps `20260520022207` →
`20260520025140`) implementing the foundational DB layer of S27 :

- `products` : +5 settings columns (`description`, `visible_on_pos`,
  `available_for_sale`, `track_inventory`, `deduct_stock`)
- New tables : `product_unit_alternatives`, `product_unit_contexts`,
  `product_sections` (M2M product↔section, partial-unique primary index)
- `product_modifiers` : +`ingredients_to_deduct` JSONB
- New SECURITY DEFINER RPCs (S25 canonical REVOKE pair pattern) :
  `update_product_v1(uuid, jsonb)`,
  `set_product_units_v1(uuid, jsonb, jsonb)`,
  `set_product_sections_v1(uuid, uuid[], uuid)`,
  `upsert_product_modifiers_v1(uuid, jsonb)`
- New permissions seeded for `MANAGER`/`ADMIN`/`SUPER_ADMIN` :
  `products.units.update`, `products.sections.update`,
  `products.modifiers.update`
- Corrective `_025140` fix on `set_product_sections_v1` primary reassign race

**None of these were committed to git.** The local branch was at `cf084ae`
(S26 INDEX commit) with no S27 code. This session :

1. Mirrors the 18 cloud-applied migrations into git as proper files
   (using the cloud's actual `schema_migrations.version` so `list_migrations`
   reports zero drift).
2. Regens `packages/supabase/src/types.generated.ts` and extends
   `PermissionCode` with the 3 new perms.
3. Wires the BO ProductDetail page (read-only since S14) to call
   `update_product_v1` end-to-end.
4. Writes tests (pgTAP + BO smoke).

What was originally planned for S27 in the multi-session plan but **deferred
to S27b** to keep this session shippable :

- `create_product_v1` RPC + "New product" modal flow
- Categories CRUD : `create_category_v1`, `update_category_v1`,
  `reorder_categories_v1` + Categories management page with DnD
- Bulk operations on the products list (toggle active, change category)
- Variants tab beyond stub

---

## 2. Scope — what this session ships

### 2.1 DB catch-up (Wave 1.A — already on cloud, mirrored to git)

| Migration | Purpose |
|---|---|
| `20260520022207` | `ALTER products` add 5 settings columns |
| `20260520022244` | `CREATE TABLE product_unit_alternatives` |
| `20260520022314` | `CREATE TABLE product_unit_contexts` |
| `20260520022341` | `CREATE TABLE product_sections` (M2M) |
| `20260520022404` | `ALTER product_modifiers` add `ingredients_to_deduct` |
| `20260520022442` | Seed initial alternatives + contexts |
| `20260520023035` | `CREATE FUNCTION update_product_v1` SECURITY DEFINER |
| `20260520023314` | `CREATE FUNCTION set_product_units_v1` |
| `20260520023419` | `CREATE FUNCTION set_product_sections_v1` (superseded by _025140) |
| `20260520023543` | `CREATE FUNCTION upsert_product_modifiers_v1` |
| `20260520023915` | REVOKE pair (S25 canonical) for `update_product_v1` |
| `20260520023932` | REVOKE pair for `set_product_units_v1` |
| `20260520023945` | REVOKE pair for `set_product_sections_v1` |
| `20260520023957` | REVOKE pair for `upsert_product_modifiers_v1` |
| `20260520024026` | Seed perm `products.modifiers.update` |
| `20260520024052` | Seed perm `products.sections.update` |
| `20260520024113` | Seed perm `products.units.update` |
| `20260520025140` | Corrective : `set_product_sections_v1` primary reassign two-step |

### 2.2 Types + PermissionCode (Wave 1.B)

- `packages/supabase/src/types.generated.ts` regenerated via MCP.
- `PermissionCode` union adds `products.units.update`,
  `products.sections.update`, `products.modifiers.update`.

### 2.3 BO wiring (Wave 2.A — ProductDetail save flow)

- New hook `apps/backoffice/src/features/products/hooks/useUpdateProduct.ts`
  with `ProductUpdatePatch` matching the 18-col RPC allowlist.
- `useProductDetail.ts` + `useProducts.ts` SELECT extended to surface the 8
  new fields (description + 5 booleans + is_semi_finished + 2 nullable
  numerics).
- `ProductRow` type extended in `features/products/types.ts`.
- `ProductDetailPage` :
  - Tracks controlled patch state, dirty flag, resets on product change or
    save success.
  - Saves via `useUpdateProduct.mutate` with optimistic invalidation of
    `['products']` + `['products', 'detail', id]`.
  - Perm gate via `useAuthStore.hasPermission('products.update')` :
    `readOnly` propagated to `GeneralPanel`, button hidden if no perm.
- `GeneralPanel` :
  - Re-syncs draft from `product` prop on change (post-mutation refetch).
  - Description textarea is now controlled and emits `onChange`.
  - 5 boolean toggles (`visible_on_pos`, `deduct_stock`, `is_active`,
    `available_for_sale`, `track_inventory`) are now controlled
    interactive switches (`role="switch"`).
- `ProductDetailHeader` :
  - Gains `isSaving` prop, renders "Saving…" text and disables button
    during pending mutation.
  - `data-testid="product-detail-save"` for testing.
  - Prop types tightened for `exactOptionalPropertyTypes`.

### 2.4 Tests (Wave 3)

- **pgTAP** `supabase/tests/update_product_v1.test.sql` — 5 asserts, all
  green via MCP `execute_sql` :
  - T1 happy path (MANAGER patches name + retail_price)
  - T2 CASHIER raises 42501 `permission_denied`
  - T3 unknown product_id raises P0002 `product_not_found`
  - T4 `cost_price` in patch is reported in `ignored_fields` AND NOT mutated
  - T5 `audit_logs` has 2 rows of `action='product.update'`
- **BO smoke** `product-detail-save.smoke.test.tsx` — 2 cases, vitest green :
  - Save Changes button disabled when nothing is dirty
  - Editing the name enables Save AND triggers `update_product_v1` RPC with
    the right `p_patch`

---

## 3. Out of scope (deferred to S27b)

- `create_product_v1` RPC + "New product" modal flow (`apps/backoffice/.../Products.tsx`
  still has no create button).
- Category management : `create_category_v1`, `update_category_v1`,
  `reorder_categories_v1` RPCs + Categories management page with DnD
  (the current sidebar only shows customer_categories).
- Bulk operations on products list (multi-select + toggle active +
  change category in bulk).
- Variants tab beyond stub (no `product_variants` schema designed yet).
- Tests for `set_product_units_v1`, `set_product_sections_v1`,
  `upsert_product_modifiers_v1` (the RPCs exist + are REVOKE-paired but
  have no UI consumer yet, so deferred until those UIs land).

---

## 4. Risks + decisions

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Cloud-applied migrations have non-standard timestamps (e.g. `20260520022207` clock-based) instead of the originally-planned `20260604000010+` block | Kept the cloud timestamps in local filenames to match `schema_migrations.version`. Future `list_migrations` reports zero drift. |
| R2 | `_023419` (original `set_product_sections_v1`) is superseded by `_025140` corrective in the same block; running migrations in order replays them as a CREATE OR REPLACE pair, which is correct | Documented in both files' header comments. |
| R3 | `useUpdateProduct` casts patch to `any` to bypass the generated `Json` type's array narrowing | One-line `@typescript-eslint/no-explicit-any` disable with a comment. The runtime path is type-safe via `ProductUpdatePatch`. |
| R4 | `GeneralPanel`'s `useEffect` re-sync may overwrite the user's in-progress edits if `product.data` happens to refetch mid-edit | Acceptable trade-off : refetch only triggers on save success (we invalidate), so the draft is `{}` at that point and overwrite is idempotent. Could be tightened later with a deep-equal check. |
| R5 | `useProducts` now SELECTs 8 more columns on every catalog list render | Negligible : `products` table has ~30 rows in V3 dev, transfer increase is sub-kilobyte. |

---

## 5. Acceptance — green light

- [x] 18 migrations mirrored in git ; `pnpm typecheck` 6/6 green.
- [x] `update_product_v1` callable from BO ProductDetail save button.
- [x] pgTAP `update_product_v1.test.sql` 5/5 green on V3 dev cloud.
- [x] BO smoke `product-detail-save.smoke.test.tsx` 2/2 green.
- [x] Branch pushed to `origin/claude/continue-session-27-5iall`.

---

## 6. Notes for S27b (next session)

- Pre-flight should confirm whether any other DB or UI work has been
  applied to V3 dev cloud between this session's end and S27b's start
  (re-run `list_migrations` since `20260520025140`).
- `create_product_v1` RPC should follow the same JSONB-patch + 18-col
  allowlist pattern as `update_product_v1`, with extra validation for
  required fields (`name`, `sku`, `category_id`, `retail_price`, `unit`)
  and SKU uniqueness check.
- Categories DnD reorder should write to `categories.sort_order` via
  `reorder_categories_v1(p_ids UUID[])` that walks the array and assigns
  `sort_order = ordinality * 10` to leave gaps.
