# Session 27b — INDEX (Product CRUD : create + categories management)

**Spec :** [`../specs/2026-05-20-session-27b-spec.md`](../../specs/archive/2026-05-20-session-27b-spec.md)
**Date :** 2026-05-20
**Branch :** `claude/continue-session-27-5iall` (same as S27, PR #29)
**Migration block used :** `20260520101735..102709` (9 migrations).
**Predecessor :** [`./2026-05-20-session-27-INDEX.md`](./2026-05-20-session-27-INDEX.md) — S27 shipped the update flow ; this sub-session closes create + categories.

---

## 1. Résumé exécutif

Continuation directe de S27 sur la même branche / même PR. **Closes the
remaining S27 scope** : `create_product_v1` + categories CRUD + management
page DnD.

**Livré :**
- 9 migrations DB + types regénérés
- `useCreateProduct` + `NewProductDialog` → ProductsHeader "+ New Product" wired
- `/backoffice/categories` page avec DnD reorder + create/edit dialogs
- 10 pgTAP asserts (all green) + 2 BO smoke cas (green)
- Corrective migration `_102709` (ambiguous-id bug caught by pgTAP)

**Reporté en S27c / backlog :**
- Bulk operations on products list
- Variants schema + tab UI
- UI consumers for `set_product_units_v1`, `set_product_sections_v1`,
  `upsert_product_modifiers_v1` (UnitsPanel / sections / Variants tab)
- Soft-delete category RPC
- pgTAP for `update_category_v1` happy + 42501 paths

---

## 2. Phases

| Phase | Description | Status |
|---|---|---|
| 1   | `create_product_v1` RPC + REVOKE pair (block `_101735..749`) | ✓ |
| 2   | BO `useCreateProduct` + `NewProductDialog` + Products.tsx wiring | ✓ |
| 3   | Categories CRUD RPCs + REVOKE pairs (block `_101810..924`) + corrective `_102709` | ✓ |
| 4   | BO `/categories` page + DnD + sidebar/route | ✓ |
| 5   | Tests : pgTAP 10 asserts + BO smoke 2 cas | ✓ |
| 6   | Spec + INDEX + CLAUDE.md + push | ✓ |

---

## 3. Commits (S27b only — appended to PR #29)

| # | SHA | Message |
|---|---|---|
| 7 | `fc88ef9` | feat(db,types): session 27b — phase 1+3 — create_product_v1 + categories CRUD RPCs |
| 8 | `a282525` | feat(backoffice): session 27b — phase 2+4 — new product modal + categories page DnD |
| 9 | `e8c33b9` | test(db,backoffice): session 27b — phase 5 — pgTAP + BO smoke for create + categories CRUD |
| 10 | _this commit_ | docs(workplan): session 27b — phase 6 — spec + INDEX + closeout |

---

## 4. Quality gates

- `pnpm typecheck` 6/6 successful.
- pgTAP `product_category_crud.test.sql` 10/10 green via MCP.
- BO smoke `new-product-dialog.smoke.test.tsx` 2/2 green.
- BO smoke `product-detail-save.smoke.test.tsx` (S27 regression) 2/2 still green.
- Migration drift : zero — 9 local files match `schema_migrations.version` exactly.

---

## 5. Coverage des modules

- Module 05 (products & catalog) : **create + update flows DONE** ; categories
  CRUD + DnD page DONE. Closes TASK-05-002 fully, TASK-05-006 (categories
  management), TASK-05-007 (DnD reorder).

---

## 6. Deviations vs plan

| # | Code | Description | Action |
|---|------|-------------|--------|
| 1 | DEV-S27B-3.A-01 | First-pass `reorder_categories_v1` had ambiguous-id 42702 bug caught by pgTAP T7 | Fixed via corrective `_102709` ; both files kept in git (`_101850` superseded). **Medium — fixed this session.** |
| 2 | DEV-S27B-2.A-01 | `NewProductDialog` shows a single error banner rather than per-field validation feedback | MVP acceptable ; polish in S27c. **Informational.** |
| 3 | DEV-S27B-4.A-01 | Categories DnD rolls back on error rather than fully-optimistic onMutate cache update | Acceptable trade-off ; `useReorderCategories` already invalidates `['categories', 'all']` query on success. **Informational.** |
| 4 | DEV-S27B-4.A-02 | `CategoryFormDialog` hardcodes 5-station dispatch/kds lists | If stations become configurable elsewhere, switch to fetched list. **Informational.** |
| 5 | DEV-S27B-SCOPE-01 | S27b doesn't ship `delete_category_v1` — hide-via-toggle-active is the soft alternative | Acceptable ; categories rarely deleted ; backlog if a hard delete is needed. **Informational.** |
| 6 | DEV-S27B-SCOPE-02 | Bulk operations, variants tab, and UI consumers for the 3 unit/section/modifier RPCs remain deferred | Tracked in §7 follow-ups. **Informational.** |
| 7 | DEV-S27B-5.A-01 | No pgTAP for `update_category_v1` happy + 42501 paths (only create + reorder covered) | Backlog for S27c. **Informational.** |

---

## 7. Follow-ups (S27c backlog)

1. Bulk operations on Products list : multi-select column + bulk toggle
   active + bulk change category.
2. Variants tab : design `product_variants` schema, then ship UI consumer
   of `upsert_product_modifiers_v1` (existing RPC from S27 catch-up).
3. UnitsPanel write mode : wire `set_product_units_v1` (existing RPC).
4. Sections editor in GeneralPanel : wire `set_product_sections_v1`
   (existing RPC).
5. `delete_category_v1` RPC (soft delete) + Categories page delete action.
6. pgTAP for `update_category_v1` happy + 42501 + slug_taken paths.
7. NewProductDialog : per-field validation feedback (Zod schema).
8. Fully-optimistic `useReorderCategories` via onMutate/onError pattern.
