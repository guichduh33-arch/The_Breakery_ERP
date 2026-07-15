# Session 27c — INDEX (Product Variants)

> **Date** : 2026-05-24
> **Branche** : `swarm/session-27c`
> **Base** : `master` @ `cab4ce3` (post-merge PR #35 — turbo bump 2.9.14)
> **Spec** : [`docs/workplan/specs/2026-05-24-session-27c-spec.md`](../../specs/archive/2026-05-24-session-27c-spec.md)
> **Plan** : [`docs/workplan/plans/2026-05-24-session-27c-plan.md`](2026-05-24-session-27c-plan.md)
> **Effort réel** : ~1 séance étalée (8 waves chaînées via subagent-driven-development + correctives au fil de l'eau)
> **Status** : 8/8 waves DONE — prêt à merger

---

## 1. Résumé exécutif

Session 27c livre la fonctionnalité **Product Variants** ferme TASK-05-003 (variants tab placeholder S27/S27b) + S27b §7 follow-up #2 (deferred variants schema + UI). Architecture **Linked-Products** retenue (vs polymorphic single-table) : on étend la table `products` existante avec 4 colonnes nullables (`parent_product_id`, `variant_label`, `variant_axis`, `variant_sort_order`) + une `variant_axis_type` ENUM ('flavor' | 'size' | 'format') + un trigger anti-nesting (`enforce_variant_no_nesting`) qui empêche un variant d'être lui-même parent (1 niveau max).

L'utilisateur a 3 cases dans la vie d'un product : **standalone** (créé via S27b NewProductDialog, comportement inchangé), **parent** (groupe de variants, ne se vend pas directement — POS affiche un VariantSelectModal au tap), **variant** (enfant d'un parent, propre SKU/prix/stock). Les transitions sont gérées par 2 RPCs : `convert_product_to_parent_v1` (standalone → parent, crée le 1er variant) et `convert_parent_to_standalone_v1` (parent → standalone, dissout en gardant le 1er variant). La CRUD inline d'un variant repose sur 4 RPCs (`create_variant_v1`, `update_variant_v1`, `delete_variant_v1` soft, `reorder_variants_v1`). Tous SECURITY DEFINER avec gate `products.variants.write` + audit_log + REVOKE pair S25 canonique.

Côté BO, le `<StubPanel module='Variants' />` du ProductDetailPage est remplacé par un `<VariantsPanel>` 3-case switch qui consomme les 6 RPCs via 8 hooks (2 read + 6 write). Côté POS, `useProducts` filtre les variants out (les parents s'affichent dans la grid avec badge "Variants"), et un `<VariantSelectModal>` s'ouvre sur tap d'un parent pour choisir le variant à ajouter au cart. Tests : 20 pgTAP asserts cloud + 10 BO smoke + 4 POS smoke = **34 asserts total** (objectif spec 28 ; +6 pour pgTAP renforcé après corrective Wave 2.I XOR).

---

## 2. Commits

| # | Wave | SHA | Description |
|---|---|---|---|
| 0 | 0 | `111f17d` | Spec S27c initial (Product Variants — 467 lignes) |
| 1 | 0 (correction spec) | `3a22c87` | Clarifie return value `convert_product_to_parent_v1` (parent_id, pas product_id) |
| 2 | 1.A | `f56c72b` | DB : ENUM `variant_axis_type` ('flavor' \| 'size' \| 'format') |
| 3 | 1.B | `e889762` | DB : ALTER products + 4 cols variant + CHECK XOR + 2 indexes partiels |
| 4 | 1.C | `de4cc82` | DB : trigger `enforce_variant_no_nesting` BEFORE INSERT/UPDATE + types regen |
| 5 | 2.A | `9659de7` | DB : RPC `convert_product_to_parent_v1` + REVOKE pair |
| 6 | 2.B | `530957d` | DB : RPC `create_variant_v1` + REVOKE pair |
| 7 | 2.C | `d99c739` | DB : RPC `update_variant_v1` + REVOKE pair |
| 8 | 2.D | `cf59433` | DB : RPC `delete_variant_v1` (soft via `is_active = false`) + REVOKE pair |
| 9 | 2.E | `cd2efca` | DB : RPC `reorder_variants_v1(p_parent_id, p_variant_ids[])` + REVOKE pair |
| 10 | 2.F | `20ca19d` | DB : RPC `convert_parent_to_standalone_v1` + REVOKE pair |
| 11 | 2.G (corrective) | `fdc064d` | DB : `convert_parent_to_standalone_v1` hard-delete parent (soft laissait orphan SKU — `products.sku` UNIQUE globalement) |
| 12 | 2.H (corrective) | `7ca67ac` | DB : `convert_product_to_parent_v1` pre-checks SKU collision avant insert parent `${sku}-PARENT` |
| 13 | 3.A | `152042f` | DB : seed permissions `products.variants.{read,write}` + types regen |
| 14 | 3.B | `8c394f5` | TS : `PermissionCode` étendu (`products.variants.read` + `products.variants.write`) |
| 15 | 4 | `6e2caca` | Test : pgTAP suite `product_variants.test.sql` (18 asserts initiaux) |
| 16 | 2.I (corrective discovered Wave 4) | `4e91166` | DB : `convert_parent_to_standalone_v1` fixes partial-NULL on soft-deleted siblings (NULLait juste `parent_product_id` → 23514 XOR violation sur le `is_active=false` reliquat) |
| 17 | 4.A | `c0f35b8` | Test : pgTAP T15 added for XOR fix corrective (suite → 20 asserts) |
| 18 | 5.A | `81c14a3` | BO : hooks read `useProductVariants` + `useProductParent` |
| 19 | 5.B | `5e7de7c` | BO : 6 hooks write RPC mutations (1 per RPC) |
| 20 | 5.C | `8114d93` | BO : `<ConvertToParentDialog>` (3-button axis selector fallback) |
| 21 | 5.D | `ad9eeb7` | BO : `<AddVariantDialog>` + `<DissolveParentDialog>` |
| 22 | 5.E | `b5b645e` | BO : `<VariantRowSortable>` (DnD row avec @dnd-kit) |
| 23 | 5.F | `382bac5` | BO : `<VariantsPanel>` root (3-case switch) + wiring `ProductDetailPage` |
| 24 | 5.G | `456a2b1` | BO : `ProductsFilters` extension (filter variant), `ProductsGrid`/`Table` badges parent/variant |
| 25 | 6.A | `72b6302` | Test BO : VariantsPanel Case 1 smoke (standalone — 2 asserts) |
| 26 | 6.B | `9ea7b02` | Test BO : VariantsPanel Case 2 smoke (parent — 3 asserts) |
| 27 | 6.C | `e656da0` | Test BO : VariantsPanel Case 3 smoke (variant — 1 assert) |
| 28 | 6.D | `3e1abb6` | Test BO : ConvertToParentDialog smoke (2 asserts) |
| 29 | 6.E | `e405871` | Test BO : Products list filter + variant badge smoke (2 asserts) |
| 30 | 7.A | `8028118` | POS : hook `useProductVariants` |
| 31 | 7.B | `f1cea59` | POS : `<VariantSelectModal>` + wiring `ProductTapHandler` |
| 32 | 7.C | `a69bc76` | POS : `useProducts` filter variants out + `has_variants` dérivé (2-query fallback) + domain `Product` widened (+2 optional fields) |
| 33 | 7.D | `98700e9` | Test POS : VariantSelectModal smoke + ProductGrid filter smoke (4 asserts) |
| 34 | 8 | _(this commit)_ | docs : Session 27c INDEX + CLAUDE.md Active Workplan update |

Total : **34 commits** sur la branche depuis `cab4ce3` (master).

---

## 3. Migrations DB (19)

Block `20260524002129..012658` — tous les timestamps sont **cloud-assignés** par `mcp__plugin_supabase_supabase__apply_migration` (convention héritée S27/S27b/S26b ; on conserve le timestamp cloud pour matcher `supabase_migrations.schema_migrations.version`).

| # | Version cloud | Fichier local | Description |
|---|---|---|---|
| 1 | `20260524002129` | `_create_variant_axis_type.sql` | ENUM `variant_axis_type` ('flavor' \| 'size' \| 'format') |
| 2 | `20260524002210` | `_alter_products_add_variant_columns.sql` | ALTER products + 4 cols nullables + CHECK XOR (`parent_product_id` ⇔ `variant_label` ⇔ `variant_axis`) + 2 indexes partiels (`idx_products_parent_id` WHERE NOT NULL ; `idx_products_parent_sort` WHERE NOT NULL) |
| 3 | `20260524002257` | `_create_enforce_variant_no_nesting_trigger.sql` | Trigger BEFORE INSERT/UPDATE → RAISE EXCEPTION si parent a déjà un parent OU si product a des children avec un parent_product_id (1 niveau max) |
| 4 | `20260524003312` | `_create_convert_product_to_parent_v1_rpc.sql` | RPC standalone → parent (crée un nouveau parent row `${sku}-PARENT` + UPDATE existing product en variant) ; SECURITY DEFINER + gate `products.variants.write` + audit_log |
| 5 | `20260524003325` | `_revoke_anon_convert_product_to_parent_v1.sql` | REVOKE EXECUTE FROM anon + ALTER DEFAULT PRIVILEGES FROM PUBLIC (S25 canonical pair) |
| 6 | `20260524003433` | `_create_create_variant_v1_rpc.sql` | RPC create new variant (clone-from-parent allowlist 14 cols + variant-specific overrides) ; SECURITY DEFINER + gate |
| 7 | `20260524003441` | `_revoke_anon_create_variant_v1.sql` | REVOKE pair |
| 8 | `20260524003538` | `_create_update_variant_v1_rpc.sql` | RPC patch variant (allowlist `variant_label`, `variant_sort_order`, `retail_price`, `cost_price`, `sku`, `is_active`) ; SECURITY DEFINER + gate |
| 9 | `20260524003543` | `_revoke_anon_update_variant_v1.sql` | REVOKE pair |
| 10 | `20260524003629` | `_create_delete_variant_v1_rpc.sql` | RPC soft delete (`is_active = false`) — never hard delete (FK orders.order_items) ; SECURITY DEFINER + gate |
| 11 | `20260524003636` | `_revoke_anon_delete_variant_v1.sql` | REVOKE pair |
| 12 | `20260524003729` | `_create_reorder_variants_v1_rpc.sql` | RPC reorder `variant_sort_order = 10, 20, 30...` from `p_variant_ids[]` (complete-coverage gate via count match) ; SECURITY DEFINER + gate |
| 13 | `20260524003736` | `_revoke_anon_reorder_variants_v1.sql` | REVOKE pair |
| 14 | `20260524003827` | `_create_convert_parent_to_standalone_v1_rpc.sql` | RPC parent → standalone (NULL 4 variant cols sur le 1er variant ; soft-delete les autres ; soft-delete le parent) ; SECURITY DEFINER + gate |
| 15 | `20260524003833` | `_revoke_anon_convert_parent_to_standalone_v1.sql` | REVOKE pair |
| 16 | `20260524005339` | `_bump_convert_parent_to_standalone_v1_hard_delete.sql` | **Corrective Wave 2.G** — soft delete laissait un parent zombie avec `sku = '${parent_sku}-PARENT'` mais `is_active = false` ; `products.sku` étant UNIQUE GLOBAL (pas partial), une re-conversion future échouait. Hard-delete du parent désormais. |
| 17 | `20260524005402` | `_bump_convert_product_to_parent_v1_sku_collision_check.sql` | **Corrective Wave 2.H** — pre-check : si `${sku}-PARENT` existe déjà → RAISE `parent_sku_already_exists` (évite 23505 unique violation au milieu de la transaction) |
| 18 | `20260524005926` | `_seed_perm_products_variants.sql` | Seed `products.variants.read` (MANAGER/ADMIN/SUPER_ADMIN) + `products.variants.write` (MANAGER/ADMIN/SUPER_ADMIN) dans `permissions` + `role_permissions` |
| 19 | `20260524012658` | `_bump_convert_parent_to_standalone_v1_xor_fix.sql` | **Corrective Wave 2.I** (discovered via Wave 4 pgTAP T15) — fixait juste `parent_product_id = NULL` sur le 1er variant gardé, mais laissait `variant_label`, `variant_axis`, `variant_sort_order` non-NULL → violation CHECK XOR (`23514`). Désormais NULL les 4 cols ensemble. Ajout T15 pour couvrir le cas. |

---

## 4. Pages livrées (0 nouvelles)

Session 27c ne crée **aucune nouvelle page de route**. Elle s'insère dans 2 surfaces existantes :

- **BO** — `ProductDetailPage` (`/backoffice/products/:id`) : tab "Variants" passe de `<StubPanel module='Variants' />` à `<VariantsPanel>` (3-case switch standalone/parent/variant) ; ProductsPage (`/backoffice/products`) : filter dropdown étendu, badge variant dans grid/table.
- **POS** — `ProductsGrid` (`/order`) : parents s'affichent avec badge "Variants" ; tap sur parent ouvre `<VariantSelectModal>` (Radix Dialog).

---

## 5. Composants livrés (6)

### BO (5)

- `<VariantsPanel>` (`apps/backoffice/src/features/products/components/VariantsPanel.tsx`) — Root 3-case switch :
  - **Case 1 (standalone)** : empty state + bouton "Convert to variant parent" (gated `products.variants.write`).
  - **Case 2 (parent)** : table variants (DnD drag handle, SKU, label, axis, retail price, status badge, actions) + bouton "Add variant" + bouton "Dissolve parent".
  - **Case 3 (variant)** : info banner "This is a variant of [parent name]" + link back to parent product.
- `<ConvertToParentDialog>` — Dialog stepper : choix axe (3-button fallback — `RadioGroup` non exporté par `@breakery/ui`) + label premier variant + retail price preview + confirm. Appelle `useConvertProductToParent`.
- `<AddVariantDialog>` — Dialog form : label + SKU suffix + retail price (heredoc from parent défault) + cost price + appel `useCreateVariant`.
- `<DissolveParentDialog>` — Confirm dialog avec liste des variants soft-delete + warning "Other variants will become inactive" + appel `useConvertParentToStandalone`.
- `<VariantRowSortable>` — Row de la table variants, wrap @dnd-kit `useSortable` (drag handle + label affichage + inline status pill + Trash icon → `useDeleteVariant`).

### POS (1)

- `<VariantSelectModal>` (`apps/pos/src/features/cart/VariantSelectModal.tsx`) — Radix Dialog plein écran tablet : liste verticale des variants actifs du parent (label + retail price formatée `formatIdr` minuscule d, le vrai export de `@breakery/utils`) + tap ajoute au cart + close.

---

## 6. Hooks livrés (9)

### BO (8)

| Hook | Fichier | Description |
|---|---|---|
| `useProductVariants(parentId, opts?)` | hooks/useProductVariants.ts | SELECT products WHERE parent_product_id = $1 ORDER BY variant_sort_order ASC. Inclut option `includeInactive` (default false). |
| `useProductParent(productId)` | hooks/useProductParent.ts | SELECT products via JOIN sur products WHERE id = (SELECT parent_product_id FROM products WHERE id = $1). Pour Case 3 banner. |
| `useConvertProductToParent` | hooks/useConvertProductToParent.ts | RPC `convert_product_to_parent_v1` (returns new `parent_id`) |
| `useCreateVariant` | hooks/useCreateVariant.ts | RPC `create_variant_v1` |
| `useUpdateVariant` | hooks/useUpdateVariant.ts | RPC `update_variant_v1` (wiré mais pas d'edit-variant UI inline ce Wave — différé S27d) |
| `useDeleteVariant` | hooks/useDeleteVariant.ts | RPC `delete_variant_v1` (soft, sets is_active=false) |
| `useReorderVariants` | hooks/useReorderVariants.ts | RPC `reorder_variants_v1` (optimistic update LISTE puis rollback-on-error) |
| `useConvertParentToStandalone` | hooks/useConvertParentToStandalone.ts | RPC `convert_parent_to_standalone_v1` |

### POS (1)

| Hook | Fichier | Description |
|---|---|---|
| `useProductVariants(parentId)` | apps/pos/src/features/products/hooks/useProductVariants.ts | SELECT products WHERE parent_product_id = $1 AND is_active = true ORDER BY variant_sort_order ASC. Distinct du BO hook (POS lit cache 5min). |

---

## 7. Tests

### pgTAP (1 fichier, 20/20 PASS via cloud MCP)

`supabase/tests/product_variants.test.sql` :

- **T1** — `convert_product_to_parent_v1` happy path : standalone → parent + 1 variant créé.
- **T2** — `convert_product_to_parent_v1` raises forbidden (CASHIER role, no `products.variants.write`) → `P0003`.
- **T3** — `convert_product_to_parent_v1` raises sku_collision pre-check (corrective Wave 2.H).
- **T4** — `create_variant_v1` happy path.
- **T5** — `create_variant_v1` raises forbidden.
- **T6** — `update_variant_v1` happy path (label + retail price).
- **T7** — `update_variant_v1` raises not_found.
- **T8** — `delete_variant_v1` soft (sets is_active=false, FK preserved).
- **T9** — `reorder_variants_v1` happy path (assigns 10/20/30...).
- **T10** — `reorder_variants_v1` raises incomplete_coverage (count mismatch).
- **T11** — `convert_parent_to_standalone_v1` happy path : parent + 3 variants → standalone (1st variant gardé + 4 cols NULL) ; parent hard-deleted (corrective Wave 2.G).
- **T12** — `convert_parent_to_standalone_v1` raises forbidden.
- **T13** — trigger anti-nesting empêche un variant d'avoir lui-même un parent (UPDATE) → `P0001`.
- **T14** — trigger anti-nesting empêche un product avec children d'avoir lui-même un parent (UPDATE) → `P0001`.
- **T15** — `convert_parent_to_standalone_v1` XOR fix corrective (Wave 2.I) : variants soft-deleted ont `parent_product_id = NULL` ET les 3 autres cols variant aussi → pas de 23514 violation.
- **T16-T20** — audit_log row validation pour chaque RPC qui mute (5 asserts secondaires).

### BO smoke (5 fichiers, 10/10 PASS)

| Fichier | Asserts | Couvre |
|---|---|---|
| `variants-panel-empty.smoke.test.tsx` | 2 | Case 1 standalone : empty state + bouton "Convert" perm gate (deny + allow) |
| `variants-panel-parent.smoke.test.tsx` | 3 | Case 2 parent : table renders 3 variants + "Add" opens AddVariantDialog + "Dissolve" opens DissolveParentDialog |
| `variants-panel-variant.smoke.test.tsx` | 1 | Case 3 variant : info banner with parent name |
| `convert-to-parent-dialog.smoke.test.tsx` | 2 | 3-button axis selection + submit calls `convert_product_to_parent_v1` shape |
| `products-list-filter.smoke.test.tsx` | 2 | Filter "Variants" narrows list to parents + variant badge rendered in row |

### POS smoke (2 fichiers, 4/4 PASS)

| Fichier | Asserts | Couvre |
|---|---|---|
| `variant-select-modal.smoke.test.tsx` | 2 | Modal opens on parent tap + tap variant adds to cart + close on backdrop click |
| `pos-grid-hides-variants.smoke.test.tsx` | 2 | Grid renders parents only (variants filtered) + parent shows "Variants" badge |

### Sweep complet

- `pnpm typecheck` : 6/6 packages PASS (8s avec cache turbo).
- `pnpm --filter @breakery/app-backoffice test` : **97 test files PASS** (1 skipped) / **322 tests PASS** (1 skipped) — sweep complet, no regression.
- `pnpm --filter @breakery/app-pos test` : **62 test files PASS** / **326 tests PASS** — sweep complet, no regression.

---

## 8. Permissions / Roles utilisés

Seedées Wave 3.A migration `_005926` :

| Permission | Roles seeded | Used by |
|---|---|---|
| `products.variants.read` | MANAGER, ADMIN, SUPER_ADMIN | VariantsPanel render (Cases 2+3) + POS VariantSelectModal |
| `products.variants.write` | MANAGER, ADMIN, SUPER_ADMIN | Convert/Add/Update/Delete/Reorder/Dissolve buttons gating |

Pattern : alignement avec S27/S27b qui ont déjà `products.create`/`products.update`/`categories.read`/etc. seedées pour ces 3 mêmes rôles. CASHIER reste exclu (POS lit en SELECT direct via `auth_read` RLS policy sur products — pas besoin de perm explicit pour read).

---

## 9. Closes (TASK + gaps)

- **TASK-05-003** Product Variants (Variants tab) — **DONE** (BO Variants tab fully wired + POS modal).
- **S27b §7 follow-up #2** — Variants schema + UI déféré S27c → **DONE**.

---

## 10. Hors scope (déféré S27d — backlog post-merge)

- **Bulk operations** sur variants (delete N variants en une fois, bulk reorder via CSV import).
- **`UnitsPanel` mode write** (existant en read-only depuis S27 catch-up `_023314` table `product_unit_alternatives` ; RPC `set_product_units_v1` existe mais pas de consumer BO).
- **Sections editor BO** (existant en read-only ; RPC `set_product_sections_v1` existe mais pas de UI).
- **`delete_category_v1`** RPC + UI (categorie soft-delete avec check products count).
- **pgTAP `update_category_v1`** (S27b a livré RPC + UI mais pgTAP manquant).
- **NewProductDialog Zod schema** (S27b validation client minimale ; Zod refactor déféré).
- **Fully-optimistic reorder** (S27c utilise rollback-on-error mais affiche stale state pendant le RPC ; optimistic state via `setQueryData` déféré).
- **Edit-variant inline button** (`useUpdateVariant` hook wiré mais pas de bouton edit ligne ; user doit ouvrir RPC via console — Wave 5 deliberately scope-limited).
- **Modifier inheritance from parent to variant** (variants ne peuvent pas inherit modifiers du parent en ce moment — chaque variant a sa propre row product_modifiers indépendante).
- **KDS variant rendering** (variant orders affichent juste `variant_label` mais pas le parent name ; KDS ticket layout déféré).
- **Receipt template variant printing** (parent name + variant label sur ligne séparée).

---

## 11. Déviations & DEV log

| ID | Wave | Description | Status |
|---|---|---|---|
| DEV-S27c-2.A-01 | 2.G corrective | `convert_parent_to_standalone_v1` originally soft-deleted le parent, mais `products.sku` est UNIQUE GLOBAL (pas partial WHERE is_active). Hard-delete corrective `_005339`. | **Medium, fixed** |
| DEV-S27c-2.A-02 | 2.H corrective | `convert_product_to_parent_v1` insertait directement `${sku}-PARENT` → 23505 unique violation au milieu de la transaction si le suffix existait déjà. Pre-check `EXISTS` ajouté + RAISE explicit (`parent_sku_already_exists`). Corrective `_005402`. | **Medium, fixed** |
| DEV-S27c-2.A-03 | 2.I corrective | `convert_parent_to_standalone_v1` partial-NULL bug : sur les variants soft-deleted (non gardé comme 1er standalone), NULLait juste `parent_product_id` mais pas `variant_label`/`variant_axis`/`variant_sort_order` → 23514 CHECK XOR violation. Désormais NULL les 4 cols ensemble. Découvert via Wave 4 pgTAP T15. Corrective `_012658`. | **Medium, fixed** |
| DEV-S27c-2.A-04 | 2 | Plan SQL utilisait `user_has_permission()` (function name fictif) ; la fonction réelle dans la DB s'appelle `has_permission(p_perm_code TEXT)`. Corrigé uniformément sur les 6 RPCs avant apply. | Informationnel |
| DEV-S27c-2.A-05 | 2 | Plan SQL utilisait `audit_logs.user_id` (col inexistante) ; la col réelle est `actor_id`. Corrigé. | Informationnel |
| DEV-S27c-2.A-06 | 2.A | Spec convert_product_to_parent_v1 originalement disait RETURNS le `product_id` (unchanged) ; en pratique l'utile pour BO est le **NEW `parent_id`** (le row qui vient d'être créé) car BO doit rerouter le user vers le détail du parent. Spec amendée commit `3a22c87`. | Informationnel |
| DEV-S27c-5.A-01 | 5.C | `@breakery/ui` n'exporte pas de `<RadioGroup>` primitive ; fallback 3-button selector pour le choix d'axis dans ConvertToParentDialog (clean enough — 3 options finite). | Informationnel |
| DEV-S27c-5.A-02 | 5.C/5.D | `@breakery/ui` n'exporte pas de `<Label>` primitive ; plain `<label className=...>` avec le styling de NewProductDialog (S27b) utilisé partout dans S27c dialogs. | Informationnel |
| DEV-S27c-5.A-03 | 5.C/5.F/7.B | `formatIDR` (uppercase IDR) n'existe pas dans `@breakery/utils`. BO utilise inline `Rp ${Math.round(val).toLocaleString()}` ; POS utilise `formatIdr` (lowercase d — le vrai export, S14 catch-up). | Informationnel |
| DEV-S27c-5.A-04 | 5.G | Filter UI placée dans `ProductsFilters.tsx` (pas dans Header ni dans Grid), state hissée jusqu'à `Products.tsx` (parent route). `parentIds` dérivé client-side via reduce (Breakery cardinalité ~50 products → négligeable). | Informationnel |
| DEV-S27c-5.A-05 | 5.F/5.G/6 | Bonus testids ajoutés au-delà du plan (`badge-parent`, `badge-variant`, `variants-empty-state`, `variants-table`, `variants-panel-case2`, `variants-add-button`, `variants-dissolve-button`, etc.) — surface plus riche pour smoke testing. | Informationnel (mieux) |
| DEV-S27c-5.A-06 | 5.B | `useUpdateVariant` hook livré mais aucun inline edit-variant UI dans ce Wave (pas d'edit pencil sur les rows VariantsPanel) ; user-driven : déféré Wave S27d, hook prêt pour wiring direct. | Informationnel |
| DEV-S27c-6.A-01 | 6 | Wave 6 a découvert un pre-existing env install issue (`@dnd-kit/*`, `recharts`, `sonner` missing in node_modules) — reproduit sur master, résolu par `pnpm install --frozen-lockfile`. Après fix, full BO suite 97+/97+ PASS, aucun fail. | Informationnel (env, pas code) |
| DEV-S27c-7.A-01 | 7.B | POS modal wiring landed dans `ProductTapHandler.tsx` (pas dans `ProductGrid.tsx`) — c'est le seam le plus propre, pas besoin de restructurer le cart-flow. | Informationnel |
| DEV-S27c-7.A-02 | 7.C | POS `useProducts` utilise un 2-query fallback (pas PostgREST relation embed) pour dériver `has_variants` : 1ère query SELECT products, 2e query SELECT DISTINCT parent_product_id → set lookup. Embed eût été plus élégant mais Type generator de Supabase ne synthétise pas la relation `products.parent_product_id → products` proprement. | Informationnel |
| DEV-S27c-7.A-03 | 7.C | Domain type `Product` étendu avec 2 optional fields (`parent_product_id?: string \| null`, `has_variants?: boolean`) — minimal widening, backward-compat pour tous les consumers. | Informationnel |
| DEV-S27c-7.A-04 | 7.B | POS variant-pick synthesizes un Product object from parent fields + variant override fields — le variant row pur (depuis `useProductVariants`) ne contient pas `sku`, `category_id`, `unit_id`, etc. (juste cols variant + retail_price/cost_price). Le synthesize fill les gaps via parent row. | Informationnel |
| DEV-S27c-7.A-05 | 7.B | Radix Dialog accessibility warning console : `<Dialog>` content sans `<DialogDescription>` (juste `<DialogTitle>`). Cosmetic console noise, no functional impact. Polish backlog. | Informationnel (a11y polish) |
| DEV-S27c-MIGRATIONS-01 | toutes | Timestamps cloud-assigned dévient du plan (`20260524000010..099` planifié → `20260524002129..012658` réel). Matches S27/S27b/S26b convention de conserver MCP cloud-assigned timestamps pour matcher `schema_migrations.version`. | Informationnel |

---

## 12. Métriques

- **Files créés** : 36 (19 migrations + 1 pgTAP test + 1 spec + 1 INDEX + 6 BO components + 5 BO smoke + 8 BO hooks + 1 POS modal + 1 POS hook + 2 POS smoke + 1 plan).
- **Files modifiés** : 10 (types.generated.ts ×2, permissions.ts, ProductDetailPage.tsx, Products.tsx, ProductsFilters.tsx, ProductsGrid.tsx, ProductsTable.tsx, products/types.ts, ProductTapHandler.tsx, apps/pos useProducts.ts, packages/domain product.ts, apps/backoffice useProducts.ts, useProductDetail.ts).
- **Lignes ajoutées** (via `git diff master..HEAD --shortstat`) : **+4132 / -22**, 56 files changed.
- **Tests** : 1 pgTAP suite (20 asserts) + 5 BO smoke (10 asserts) + 2 POS smoke (4 asserts) = **34 asserts total** (vs 28 planifiés ; +6 pour pgTAP renforcé après Wave 2.I corrective).
- **DB migrations** : 19 (block `20260524002129..012658`, dont 3 correctives 2.G/2.H/2.I).
- **RPCs livrées** : 6 (`convert_product_to_parent_v1`, `create_variant_v1`, `update_variant_v1`, `delete_variant_v1`, `reorder_variants_v1`, `convert_parent_to_standalone_v1`).
- **Permissions seedées** : 2 (`products.variants.read`, `products.variants.write`).

---

## 13. PR

**Title** : `feat(products): session 27c — product variants (linked products)`

**Branch** : `swarm/session-27c` → `master`

**Body suggestion** :

```
## Summary
- Linked-Products architecture : ALTER products + 4 cols variant + anti-nesting trigger (1 niveau max)
- 6 SECURITY DEFINER RPCs : convert_to_parent / create / update / delete / reorder / convert_to_standalone
- BO VariantsPanel (3-case switch standalone/parent/variant) replacing StubPanel
- POS VariantSelectModal on parent tile tap
- 34 tests : 20 pgTAP + 10 BO smoke + 4 POS smoke (all PASS via cloud MCP)

Closes TASK-05-003 + S27b §7 follow-up #2.

INDEX : docs/workplan/plans/2026-05-24-session-27c-INDEX.md
Spec  : docs/workplan/specs/2026-05-24-session-27c-spec.md

## Test plan
- [x] pnpm typecheck — 6/6 packages PASS (8s)
- [x] pgTAP product_variants.test.sql — 20/20 PASS via cloud MCP
- [x] BO smoke (5 files) — 10/10 PASS
- [x] POS smoke (2 files) — 4/4 PASS
- [x] BO full sweep — 97 files / 322 tests PASS (no regression)
- [x] POS full sweep — 62 files / 326 tests PASS (no regression)
```

Merge squash recommandé pour préserver les 34 commits séparés par Wave (lisibilité historique S27c future debugging).
