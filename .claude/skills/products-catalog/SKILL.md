---
name: products-catalog
description: >-
  Product catalog expert — products CRUD, variants (linked-products architecture),
  categories, units/sections/modifiers, is_display_item flag. Knows the variant XOR +
  anti-nesting invariants, SKU uniqueness rules, and display-stock isolation. Use this
  skill whenever the task mentions product / produit, variant / variante / déclinaison,
  parent product / produit parent, linked product, category / catégorie, SKU, modifier /
  modificateur, unit / unité, section, vitrine / display item / is_display_item, import
  catalogue / import_catalog, visible_on_pos — or touches apps/backoffice
  features/products|categories, Product*/Categor* pages, POS variant code, or any supabase
  migration/test with product/variant/categor in the name. Invoke it BEFORE any catalog
  CRUD or variant-architecture change.
pathPatterns:
  - 'apps/backoffice/src/features/products/**'
  - 'apps/backoffice/src/features/categories/**'
  - 'apps/backoffice/src/pages/**/Product*'
  - 'apps/backoffice/src/pages/**/Categor*'
  - 'apps/pos/src/**/*variant*'
  - 'supabase/migrations/*product*.sql'
  - 'supabase/migrations/*variant*.sql'
  - 'supabase/migrations/*categor*.sql'
  - 'supabase/tests/*product*.test.sql'
  - 'supabase/tests/*variant*.test.sql'
promptSignals:
  phrases:
    - 'product'
    - 'variant'
    - 'parent product'
    - 'linked product'
    - 'category'
    - 'SKU'
    - 'modifier'
    - 'product unit'
    - 'product section'
    - 'is_display_item'
    - 'variant axis'
    - 'convert to parent'
    - 'dissolve parent'
---

# Products Catalog — The Breakery ERP

Expert on product CRUD, variants (linked-products), categories, units/sections/modifiers, and the `is_display_item` display-stock flag.

**`CLAUDE.md` is the source of truth** for project-wide patterns (RPC versioning, REVOKE pairs, anon defense-in-depth, types regen). This skill adds catalog-specific mental model, invariant checklists, and preventive guidance.

---

## Mental model — variants (architecture "Linked-Products", S27c)

```
products table
─────────────────────────────────────────────────────────
STANDALONE     parent_product_id = NULL, variant_label = NULL, variant_axis = NULL
               → normal product, vendu directement

PARENT         parent_product_id = NULL, variant_label = NULL, variant_axis = NULL
               → groupement logique, NEVER sold directly, ne se vend pas
               → POS affiche modal variant picker au tap
               → SKU = "{original_sku}-PARENT"

VARIANT        parent_product_id IS NOT NULL, variant_label IS NOT NULL, variant_axis IS NOT NULL
               → enfant du parent, propre SKU/prix/stock, 1 niveau max
               → sort_order géré par reorder_variants_v1 (paliers 10/20/30…)
```

### Colonnes variant (ajoutées migration `20260524002210`, +1 depuis init)

| Colonne | Type | Nullable | Contrainte |
|---|---|---|---|
| `parent_product_id` | UUID REFERENCES products(id) | YES | XOR |
| `variant_label` | TEXT | YES | XOR, UNIQUE (parent_id, label) partial |
| `variant_axis` | `variant_axis_type` | YES | XOR |
| `variant_sort_order` | INTEGER NOT NULL DEFAULT 0 | NO | — |

**ENUM `variant_axis_type`** (migration `20260524002129`): `'flavor' | 'size' | 'format'`

### Invariants critiques (vérifiés sur V3 dev `ikcyvlovptebroadgtvd`)

1. **XOR CHECK `products_variant_xor`** — les 3 cols `(parent_product_id, variant_label, variant_axis)` sont soit ALL NULL (standalone/parent) soit ALL NOT NULL (variant). Un soft-delete doit NULL-er les 3, pas juste `parent_product_id` (bug corrigé corrective `20260524012658`).
2. **Anti-self CHECK `products_variant_no_self`** — `parent_product_id != id`.
3. **Trigger `tr_products_variant_no_nesting`** (fonction `enforce_variant_no_nesting`, `BEFORE INSERT OR UPDATE OF parent_product_id`) — 1 niveau max : (a) le parent ne doit pas être lui-même un variant ; (b) un produit avec des enfants ne peut pas devenir un variant. Errcode `P0004`.
4. **`products.sku` UNIQUE GLOBAL** (pas partial) — le parent créé par `convert_product_to_parent_v1` suffix son SKU en `"-PARENT"`. La dissolution (`convert_parent_to_standalone_v1`) hard-delete le parent pour libérer le SKU orphelin.

---

## RPCs catalog (SECURITY DEFINER, tous avec REVOKE pair S25 canonique)

### Produit CRUD

| RPC | Gate | Allowlist (colonnes autorisées) |
|---|---|---|
| `create_product_v1(p_payload jsonb)` | `products.create` | 22 cols : name/sku/category_id/description/retail_price/wholesale_price/cost_price/tax_inclusive/image_url/is_active/is_favorite/is_semi_finished/visible_on_pos/available_for_sale/track_inventory/deduct_stock/**is_display_item**/min_stock_threshold/target_gross_margin_pct/default_shelf_life_hours/product_type/unit |
| `update_product_v1(p_product_id, p_patch jsonb)` | `products.update` | 19 cols (pas cost_price/unit/product_type) : idem create moins 3 |

`create_product_v1` seed aussi `product_unit_contexts` (stock_opname/recipe/purchase/sales unit = `unit` par défaut). SKU auto-uppercase dans le hook BO. `cost_price` intentionnellement absent de `update_product_v1` (géré via WAC trigger ou `update_cost_price_v1` S22).

### Variants

| RPC | Description |
|---|---|
| `convert_product_to_parent_v1(p_product_id, p_first_variant_label, p_variant_axis, p_first_variant_name?)` | standalone → parent+premier variant. Retourne `parent_id UUID`. |
| `create_variant_v1` | Nouveau variant rattaché à un parent existant (allowlist 14 cols clone-from-parent + overrides). |
| `update_variant_v1` | Patch 6 cols sur un variant. |
| `delete_variant_v1` | Soft-delete (`is_active = false`) — jamais hard (FK order_items). |
| `reorder_variants_v1(p_parent_id, p_variant_ids[])` | Assigns sort_order 10/20/30… + gate complete-coverage (tous les variants actifs doivent être dans le tableau). |
| `convert_parent_to_standalone_v1(p_parent_id)` | Dissolution parent → standalone. Hard-delete le parent pour libérer le SKU "-PARENT". NULL-er les 3 cols sur les siblings soft-deleted (correctif `_012658`). |

Tous gated `products.variants.write` (ADMIN/SUPER_ADMIN). `products.variants.read` pour MANAGER+.

### Catégories

| RPC | Gate |
|---|---|
| `create_category_v1` | `categories.write` (auto-slugify) |
| `update_category_v1` | `categories.write` (6-col patch) |
| `reorder_categories_v1(p_category_ids[])` | `categories.write` (assigns sort_order + complete-coverage gate ; correctif ambiguous-id `20260520102709`) |

### Autres (write RPCs, less commonly touched)

- `set_product_units_v1`, `set_product_sections_v1`, `upsert_product_modifiers_v1` — existent depuis S27 mais leurs consumers BO sont stubs (déféré S27d+). Perms : `products.{units,sections,modifiers}.update`.

---

## is_display_item — pont display-stock

`products.is_display_item BOOLEAN NOT NULL DEFAULT false` (migration `20260530184403`). Dans l'allowlist de `create_product_v1` ET `update_product_v1` (bump `20260530192331`).

- **true** = produit fini exposé en vitrine POS. La vente double-déduit `display_stock` + `products.current_stock` (via `complete_order_with_payment_v10`).
- **Isolation** : POS `usePOSReceiveStock` → `add_display_stock_v1` (pas `record_incoming_stock_v1`). `record_incoming_stock_v1` réservé au BackOffice.
- Ne pas toucher `current_stock` depuis les gestes POS vitrine → voir skill `stock-management` + memory `project_pos_display_stock_isolation`.

---

## POS — variant picker

- `useProducts` filtre les variants OUT (parents apparaissent avec badge "Variants").
- `<VariantSelectModal>` (Radix Dialog) s'ouvre au tap sur un parent → sélection du variant → ajout au cart.
- Wired dans `ProductTapHandler.tsx` (pas dans `ProductGrid` — séparation des responsabilités).

---

## Audit checklist

- [ ] **XOR intègre** — `SELECT id, parent_product_id, variant_label, variant_axis FROM products WHERE (parent_product_id IS NULL) != (variant_label IS NULL) OR (parent_product_id IS NULL) != (variant_axis IS NULL)` → doit être vide.
- [ ] **Nesting absent** — `SELECT v.id FROM products v JOIN products p ON v.parent_product_id = p.id WHERE p.parent_product_id IS NOT NULL` → vide.
- [ ] **SKU unique global** — `SELECT sku, count(*) FROM products WHERE deleted_at IS NULL GROUP BY sku HAVING count(*) > 1` → vide (attention : le parent hérite `"{sku}-PARENT"`, possible collision si un produit a déjà ce SKU).
- [ ] **sort_order complet** — pour chaque parent, tous ses variants actifs ont des sort_orders distincts et non nuls.
- [ ] **`is_display_item` cohérent** — tout produit `is_display_item=true` doit avoir une row dans `display_stock`. Vérifier via `SELECT p.id FROM products p LEFT JOIN display_stock ds ON ds.product_id = p.id WHERE p.is_display_item = true AND ds.product_id IS NULL`.
- [ ] **Perms seedées** — `products.variants.{read,write}` dans `role_permissions` pour les rôles attendus (migration `20260524005926`).
- [ ] **Types regen** — après toute migration qui touche `products` ou tables liées, regen `packages/supabase/src/types.generated.ts` via MCP `generate_typescript_types` + commit.

---

## Pièges connus

| Piège | Détail | Correctif |
|---|---|---|
| XOR partial-NULL sur soft-delete | `delete_variant_v1` ou code custom qui NULL-e seulement `parent_product_id` → violation CHECK 23514 | NULL-er les 3 cols + reset `variant_sort_order=0` (pattern corrective `_012658`) |
| SKU collision sur "-PARENT" | Si un produit "Croissant-PARENT" existe déjà, `convert_product_to_parent_v1` lève 23505 | Pre-check côté client (hook BO) + correctif `_005402` |
| `cost_price` ignoré dans update | `update_product_v1` ne patch pas `cost_price` — silencieusement ignoré (in `ignored_fields`). Utiliser `update_cost_price_v1` (S22) | Lire `ignored_fields` dans la réponse RPC |
| `reorder_categories_v1` ambiguous id | Correctif `_102709` — sans lui, la query `WHERE id = ANY(...)` lève 42702 | Migration déjà appliquée, ne pas rééditer la fonction sans bump vN+1 |

---

## Sources de vérité (pointers)

```
Migrations variants (bloc S27c 20260524002129..012658)
  supabase/migrations/20260524002129_create_variant_axis_type.sql
  supabase/migrations/20260524002210_alter_products_add_variant_columns.sql
  supabase/migrations/20260524002257_create_enforce_variant_no_nesting_trigger.sql
  supabase/migrations/20260524003312..003833_*.sql  (6 variant RPCs + REVOKE pairs)
  supabase/migrations/20260524005339..012658_*.sql  (2 correctives convert_parent_to_standalone)
  supabase/migrations/20260524005926_seed_perm_products_variants.sql

Migrations product CRUD (bloc S27/S27b)
  supabase/migrations/20260520022207_alter_products_add_settings_columns.sql
  supabase/migrations/20260520023035_create_update_product_v1_rpc.sql
  supabase/migrations/20260520101735_create_create_product_v1_rpc.sql
  supabase/migrations/20260530192331_add_is_display_item_to_product_rpcs.sql  ← allowlist bump

Migrations catégories (S27b)
  supabase/migrations/20260520101810..101924_*.sql  (3 RPCs + REVOKE pairs)
  supabase/migrations/20260520102709_fix_reorder_categories_v1_ambiguous_id.sql

Tests
  supabase/tests/product_variants.test.sql   (20/20 PASS via cloud MCP)
  supabase/tests/product_category_crud.test.sql  (10/10 PASS)

Patterns canon
  CLAUDE.md §S27/S27b/S27c references
  CLAUDE.md §Critical patterns (RPC versioning, REVOKE pair, types regen)
```

---

## Verification before claiming a fix is complete

```bash
# Types (run first, catches allowlist drift immediately)
pnpm typecheck

# BO unit + smoke
pnpm --filter @breakery/app-backoffice test products
pnpm --filter @breakery/app-backoffice test categories

# POS smoke
pnpm --filter @breakery/app-pos test variant

# pgTAP (via MCP execute_sql, BEGIN/ROLLBACK envelope)
# supabase/tests/product_variants.test.sql  (T1-T20)
# supabase/tests/product_category_crud.test.sql  (T1-T10)
```

Baseline connue : ~24 BO échecs env-gated (`VITE_SUPABASE_URL Required`, DEV-S25-2.A-02) ≠ régression.

---

## When to escalate

- Ajout d'une valeur à `variant_axis_type` → `ALTER TYPE … ADD VALUE` dans une migration dédiée (ne pas éditer l'ENUM CREATE).
- Relaxation ou durcissement de `products_variant_xor` ou `tr_products_variant_no_nesting` → flag, risque de violation de données existantes.
- `products.sku` UNIQUE — tout changement en partial UNIQUE changerait la sémantique globale des collisions. Ne pas faire sans analyse complète.
- Nouveau champ dans `create_product_v1` / `update_product_v1` allowlist → bump `20260530192331` via `CREATE OR REPLACE` (signatures inchangées), puis regen types.
- Toute interaction avec `is_display_item` qui touche `current_stock` ou `stock_movements` → voir skill `stock-management` (isolation display-stock est non-négociable).
