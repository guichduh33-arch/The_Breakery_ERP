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

> **Familles de RPC, jamais de version.** Cette fiche nomme les RPCs par leur
> **famille** (`create_product`, `update_category`, `create_variant`…), sans suffixe
> `_vN`. Les versions bumpent souvent et un `_vN` écrit ici pourrit au premier bump —
> c'est exactement ce qui a périmé cette fiche : elle a longtemps pointé
> `create_product_v1` / `update_product_v1`, **droppées** depuis. Avant tout appel ou
> toute migration, **relire la version live** : plus haut fichier concerné dans
> `supabase/migrations/` **+** le call-site (`supabase.rpc('…')` dans les hooks BO/POS).
> Les seuls `_vN` légitimes ci-dessous sont des **noms de fichiers de migration ou de
> test** — des faits historiques, pas des pointeurs vers l'objet vivant.

> **Faits re-vérifiés le 2026-08-31** contre `supabase/migrations/` et les call-sites
> BO/POS. Tout énoncé factuel plus ancien que cette date se re-vérifie avant usage.

---

## Mental model — variants (architecture "Linked-Products")

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
               → sort_order géré par la famille reorder_variants (paliers 10/20/30…)
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
4. **`products.sku` UNIQUE GLOBAL** (pas partial) — le parent créé par la famille `convert_product_to_parent` suffix son SKU en `"-PARENT"`. La dissolution (famille `convert_parent_to_standalone`) hard-delete le parent pour libérer le SKU orphelin.

---

## RPCs catalog (SECURITY DEFINER, tous avec le trio REVOKE anon canonique)

> Les noms ci-dessous sont des **familles**. La version vivante se lit dans le plus
> haut fichier de `supabase/migrations/` qui la touche, et se recoupe avec le
> call-site. Les **allowlists ne sont jamais recopiées en compte** ici : elles bougent
> à chaque bump — lire le tableau `v_allowed` / `v_allowed_fields` **dans la migration
> vivante**, c'est la seule liste qui fait foi.

### Produit CRUD

| Famille | Gate | Allowlist |
|---|---|---|
| `create_product(p_payload jsonb)` | `products.create` | name, sku, category_id, description, retail_price, wholesale_price, **cost_price**, image_url, is_active, is_favorite, is_semi_finished, visible_on_pos, available_for_sale, track_inventory, deduct_stock, **is_display_item**, **dispatch_stations**, min_stock_threshold, target_gross_margin_pct, default_shelf_life_hours, **product_type**, **unit** |
| `update_product(p_product_id, p_patch jsonb)` | `products.update` | la même **moins** `cost_price`, `product_type` et `unit` — chacun a sa RPC dédiée (voir ci-dessous) |
| `delete_product(p_product_id, p_idempotency_key?)` | `products.delete` | soft-delete `is_active = false` + `deleted_at`. Garde : un parent avec ≥1 variant actif → `P0001 parent_has_active_variants`. Replay idempotent (pas de 2ᵉ ligne d'audit). |

- **`tax_inclusive` n'existe plus.** Retiré des allowlists par
  `20260717000180_product_rpcs_v2_drop_tax_inclusive.sql` (le mode fiscal est
  **global**, `business_config.tax_inclusive`, ADR-006 déc. 7), puis **la colonne
  elle-même a été droppée** par `20260722000204_drop_products_tax_inclusive.sql`
  (ADR-007 déc. 4). L'écrire = champ mort en `ignored_fields`.
- **`dispatch_stations`** (`text[]`, override produit du routage multi-station) est
  entré dans les allowlists par `20260710000043_add_dispatch_stations_to_product_rpcs.sql`.
  Sémantique du patch : clé **absente** → inchangé ; clé = **array** → pose l'override
  (CHECK `<@ {kitchen,barista,display}`) ; clé = **null** → efface (NULL = hériter de
  `categories.dispatch_station`). C'est le seul champ à sémantique 3-états de l'allowlist.
- `create_product` seed aussi `product_unit_contexts` (stock_opname/recipe/purchase/sales
  unit = `unit` par défaut). SKU auto-uppercase dans le hook BO.
- Les migrations `20260520023035`/`20260520101735` (créations d'origine) et
  `20260530192331`/`20260710000043` (bumps d'allowlist) portent sur des fonctions
  **aujourd'hui droppées** : les lire pour l'historique, **jamais** les rejouer comme
  base d'un bump.

### Champs produit hors allowlist (RPC dédiée, à dessein)

| Famille | Gate | Pourquoi hors allowlist |
|---|---|---|
| `update_cost_price` | `inventory.cost_correction` | le coût est de la valorisation : WAC + trace `stock_movements`. Un UPDATE direct de `products.cost_price` est d'ailleurs révoqué (`20260526000010`). Call-site `useCorrectCostPrice`. |
| `set_product_base_unit(p_product_id, p_new_unit)` | `products.units.update` | changer `products.unit` réinterprète toute quantité/coût stocké. Refuse sauf `current_stock = 0` **et** aucun `stock_movements` **et** aucun `display_stock` ; reset des unités alternatives/contextes ; `cost_price` converti si une conversion globale existe. Call-site `useSetProductBaseUnit`. |
| `set_product_is_test(p_product_id, p_is_test)` | `products.test_flag.update` (ADMIN/SUPER_ADMIN) | le flag exclut le produit des rapports — un MANAGER titulaire de `products.update` ne doit pas pouvoir le poser. Call-site `useSetProductTestFlag`. |

### Variants

| Famille | Description |
|---|---|
| `convert_product_to_parent(p_product_id, p_first_variant_label, p_variant_axis, p_first_variant_name?)` | standalone → parent + premier variant. Retourne `parent_id UUID`. Pre-check collision SKU `-PARENT`. |
| `create_variant(p_parent_id, p_variant_label, p_sku, p_retail_price, p_cost_price?, p_unit?, p_sort_order?, p_name?)` | **Signature positionnelle, pas d'allowlist JSONB.** L'héritage depuis le parent (category_id, unit, visible_on_pos, available_for_sale, track_inventory, deduct_stock, description) est **interne à la fonction**, pas un paramètre. L'axe est lu sur un sibling existant (le parent a `variant_axis NULL` par XOR) → sans sibling, `P0004 parent_has_no_variants` : passer d'abord par `convert_product_to_parent`. `p_sort_order` NULL → `MAX + 10`. |
| `update_variant(p_variant_id, p_patch jsonb)` | Patch **JSONB** sur `variant_label`, `sku`, `retail_price`, `variant_sort_order` — rien d'autre. Un prix de revient ou un flag POS passe par `update_product` / `update_cost_price`. |
| `delete_variant(p_variant_id)` | Soft-delete `is_active = false` — jamais hard (FK order_items). Garde last-variant : sur le dernier variant actif → `P0004 last_variant_remaining`, utiliser `convert_parent_to_standalone`. |
| `reorder_variants(p_parent_id, p_variant_ids[])` | Assigne sort_order 10/20/30… + gate complete-coverage (tous les variants **actifs** doivent être dans le tableau). |
| `convert_parent_to_standalone(p_parent_id)` | Dissolution parent → standalone. Hard-delete le parent pour libérer le SKU `-PARENT`. NULL-e les 3 cols sur les siblings soft-deleted (correctif `20260524012658`). |

Tous gated `products.variants.write` (ADMIN/SUPER_ADMIN). `products.variants.read` pour MANAGER+.

### Catégories

| Famille | Gate | Notes |
|---|---|---|
| `create_category(p_payload jsonb)` | **`categories.create`** | auto-slugify depuis `name` si `slug` absent, `sort_order` auto (`MAX + 10`). Champs posés : name, slug, sort_order, is_active, dispatch_station (défaut `'none'`), kds_station (défaut `'expo'`), show_in_pos (défaut `true`), category_type (défaut `'finished'`). |
| `update_category(p_category_id, p_patch jsonb)` | **`categories.update`** | allowlist : name, slug, sort_order, is_active, dispatch_station, kds_station, **show_in_pos**, **category_type**. |
| `reorder_categories(p_category_ids[])` | **`categories.update`** | assigne sort_order + complete-coverage gate ; correctif ambiguous-id `20260520102709`. |
| `delete_category(p_category_id, p_idempotency_key?)` | **`categories.delete`** | soft-delete. Garde : refuse si ≥1 produit non supprimé pointe la catégorie → `P0001 category_has_products` (`DETAIL` porte le `product_count`). Replay idempotent sur `deleted_at`. Call-site `useDeleteCategory`. |

- **`categories.write` n'existe pas** et n'a jamais été le gate — le code de permission
  est introuvable dans le dépôt. Les quatre codes réels sont
  `categories.{read,create,update,delete}`.
- **`category_type`** (`raw_material | semi_finished | finished`) a **remplacé**
  `is_raw_material` (`20260630000015` puis les bumps `…016`/`…017`) ; il est **validé
  côté RPC** (`22023 invalid_category_type` hors des 3 valeurs).
- **Flags POS de catégorie** : `show_in_pos` et `kds_station`/`dispatch_station`
  pilotent la visibilité en caisse et le routage KDS. Ils sont patchables par
  `update_category` — ne pas les écrire en UPDATE direct.

### Units / sections / modifiers

Familles `set_product_units`, `set_product_sections`, `upsert_product_modifiers` —
sémantique **REPLACE** (la liste passée devient la liste). Perms
`products.{units,sections,modifiers}.update`.

**Ces trois RPCs sont bel et bien consommées** : `useSetProductUnits`,
`useSetProductSections`, `useUpsertProductModifiers` (hooks BO, `features/products/hooks/`),
surfacés par `UnitsPanel`, `StationsPanel`, `ModifiersPanel`. La sérialisation des
groupes de modificateurs vit côté domaine (`packages/domain/src/modifiers/editModel.ts`).
Toute affirmation de « stub » sur ce trio est périmée.

---

## is_display_item — pont display-stock

`products.is_display_item BOOLEAN NOT NULL DEFAULT false` (migration `20260530184403`). Présent dans l'allowlist des **deux** familles `create_product` et `update_product` (entré par `20260530192331`, conservé à travers les bumps suivants — vérifier dans la migration vivante, pas dans celle-ci qui bumpe des fonctions droppées).

- **true** = produit fini exposé en vitrine POS. La vente double-déduit `display_stock` + `products.current_stock` (via la famille `complete_order_with_payment` — version à relever dans `supabase/migrations/` + le call-site).
- **Isolation** : POS `usePOSReceiveStock` → famille `add_display_stock` (pas `record_incoming_stock`, réservée au back-office).
- Ne pas toucher `current_stock` depuis les gestes POS vitrine → voir skill `stock-management` + memory `project_pos_display_stock_isolation`.

---

## POS — variant picker

- `useProducts` filtre les variants OUT (parents apparaissent avec badge "Variants").
- `<VariantSelectModal>` (`apps/pos/src/features/cart/`) s'ouvre au tap sur un parent → sélection du variant → ajout au cart.
- Wired dans `ProductTapHandler.tsx` (`apps/pos/src/features/products/`), pas dans `ProductGrid` — séparation des responsabilités.
- **Le filtre parent ne vaut que pour la grille.** `useStationMap` et `useFireToStations` **relâchent** `parent_product_id IS NULL` : sans ça les lignes de variant ne routeraient vers aucune station KDS.

---

## Audit checklist

- [ ] **XOR intègre** — `SELECT id, parent_product_id, variant_label, variant_axis FROM products WHERE (parent_product_id IS NULL) != (variant_label IS NULL) OR (parent_product_id IS NULL) != (variant_axis IS NULL)` → doit être vide.
- [ ] **Nesting absent** — `SELECT v.id FROM products v JOIN products p ON v.parent_product_id = p.id WHERE p.parent_product_id IS NOT NULL` → vide.
- [ ] **SKU unique global** — `SELECT sku, count(*) FROM products WHERE deleted_at IS NULL GROUP BY sku HAVING count(*) > 1` → vide (attention : le parent hérite `"{sku}-PARENT"`, possible collision si un produit a déjà ce SKU).
- [ ] **sort_order complet** — pour chaque parent, tous ses variants actifs ont des sort_orders distincts et non nuls.
- [ ] **`is_display_item` cohérent** — tout produit `is_display_item=true` doit avoir une row dans `display_stock`. Vérifier via `SELECT p.id FROM products p LEFT JOIN display_stock ds ON ds.product_id = p.id WHERE p.is_display_item = true AND ds.product_id IS NULL`.
- [ ] **Perms seedées** — `products.variants.{read,write}` dans `role_permissions` pour les rôles attendus (migration `20260524005926`).
- [ ] **Gates réels, pas supposés** — pour chaque RPC catalogue touchée, le code de permission du `has_permission(...)` de la **migration vivante** est bien celui câblé dans le `PermissionGate` / le hook BO.
- [ ] **Allowlist ↔ formulaire** — chaque champ que le formulaire BO envoie est dans l'allowlist de la version vivante ; sinon il ressort en `ignored_fields` et le toggle est inerte.
- [ ] **`category_type` valide** — `SELECT id, category_type FROM categories WHERE category_type NOT IN ('raw_material','semi_finished','finished')` → vide.
- [ ] **Types regen** — après toute migration qui touche `products` ou tables liées, regen `packages/supabase/src/types.generated.ts` via MCP `generate_typescript_types` + commit.

---

## Pièges connus

| Piège | Détail | Correctif |
|---|---|---|
| XOR partial-NULL sur soft-delete | La famille `delete_variant`, ou du code custom, qui NULL-e seulement `parent_product_id` → violation CHECK 23514 | NULL-er les 3 cols + reset `variant_sort_order=0` (pattern corrective `20260524012658`) |
| SKU collision sur "-PARENT" | Si un produit "Croissant-PARENT" existe déjà, `convert_product_to_parent` lève 23505 | Pre-check côté client (hook BO) + correctif `20260524005402` ; `create_variant` a le sien depuis `20260601183121` |
| `cost_price` ignoré dans update | `update_product` ne patch pas `cost_price` — silencieusement ignoré (dans `ignored_fields`). Passer par `update_cost_price` | Lire `ignored_fields` dans la réponse RPC |
| Champ mort écrit sans erreur | Un champ hors allowlist (`tax_inclusive`, `unit`, `product_type`, `is_test`… dans un patch d'update) **ne lève rien** : il ressort en `ignored_fields` et le formulaire paraît avoir enregistré | Toujours assert sur `ignored_fields` dans les tests de hook, et recouper l'allowlist dans la migration vivante avant d'ajouter un champ au formulaire |
| `reorder_categories` ambiguous id | Correctif `20260520102709` — sans lui, la query `WHERE id = ANY(...)` lève 42702 | Migration déjà appliquée, ne pas rééditer la fonction sans bump vN+1 |
| Gate catégorie supposé | Il n'y a pas de `categories.write` : create / update+reorder / delete ont **trois** codes distincts | Lire le `has_permission(...)` de la migration vivante avant de câbler un `PermissionGate` |

---

## Sources de vérité (pointers)

Relevé du 2026-08-31 — la liste vivante se retrouve par
`ls supabase/migrations | grep -iE 'product|variant|categor'`, qui compte mieux que
cette fiche. Les noms ci-dessous sont des **fichiers**, donc des faits historiques.

```
Variants (bloc 20260524002129..012658)
  20260524002129_create_variant_axis_type.sql
  20260524002210_alter_products_add_variant_columns.sql
  20260524002257_create_enforce_variant_no_nesting_trigger.sql
  20260524003312..003833_*.sql   (6 RPCs variants + REVOKE pairs)
  20260524005339 / _005402 / _012658  (correctives convert_* : hard-delete, SKU, XOR)
  20260524005926_seed_perm_products_variants.sql
  20260601183121_add_sku_precheck_create_variant_v1.sql

Produit CRUD — ATTENTION, tout n'est pas vivant
  20260520022207_alter_products_add_settings_columns.sql
  20260520023035 / 20260520101735   création des RPCs d'origine  ← fonctions DROPPÉES
  20260530192331_add_is_display_item_to_product_rpcs.sql          ← bump, fonctions DROPPÉES
  20260710000040_add_product_dispatch_stations.sql                (colonne + CHECK + index GIN)
  20260710000043_add_dispatch_stations_to_product_rpcs.sql        ← bump, fonctions DROPPÉES
  20260717000180_product_rpcs_v2_drop_tax_inclusive.sql           ← DERNIÈRE base connue du CRUD
  20260722000204_drop_products_tax_inclusive.sql                  (colonne droppée)
  20260629000010 + _000012  delete_product (+ correctif deleted_at)
  20260630000020_create_set_product_base_unit_v1_rpc.sql
  20260722000205_set_product_is_test_v1.sql
  20260526000010_revoke_direct_update_products_cost_price.sql

Catégories
  20260520101810..101924_*.sql   (3 RPCs + REVOKE pairs)
  20260520102709_fix_reorder_categories_v1_ambiguous_id.sql
  20260630000010 / _000011 / _000012   flags POS (show_in_pos) + bumps create/update
  20260630000013 / _000014             delete_category + REVOKE
  20260630000015 / _000016 / _000017   category_type (remplace is_raw_material) + bumps

Tests (pgTAP)
  supabase/tests/product_variants.test.sql
  supabase/tests/product_category_crud.test.sql
  supabase/tests/update_product_v2.test.sql
  supabase/tests/delete_product_v1.test.sql
  supabase/tests/set_product_is_test.test.sql
  supabase/tests/products_cost_price_guard.test.sql
```

**« Dernière base connue » ≠ « base vivante ».** Avant tout bump, relever le plus haut
fichier de `supabase/migrations/` qui touche la famille visée **et** confirmer le corps
live par `pg_get_functiondef` — c'est de là que part toute copie (CLAUDE.md).

Patterns canon : `CLAUDE.md` § *Critical patterns* (RPC versioning monotone, trio
REVOKE anon, régénération des types).

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

# pgTAP (via MCP execute_sql, BEGIN/ROLLBACK envelope) — le SELECT plan(N)
# en tête de chaque fichier dit combien de tests attendre, ne pas le mémoriser ici.
# supabase/tests/product_variants.test.sql
# supabase/tests/product_category_crud.test.sql
# supabase/tests/update_product_v2.test.sql
# supabase/tests/delete_product_v1.test.sql
# supabase/tests/set_product_is_test.test.sql
```

Les filtres vitest matchent le **nom de fichier**, pas le `describe` : localiser par glob
(`apps/backoffice/src/**/__tests__/*product*`), sinon un filtre qui ne matche rien passe
pour un succès. Baseline connue : des échecs BO env-gated (`VITE_SUPABASE_URL Required`,
DEV-S25-2.A-02) ≠ régression — leur nombre se relève à l'exécution, pas ici.

---

## When to escalate

- Ajout d'une valeur à `variant_axis_type` → `ALTER TYPE … ADD VALUE` dans une migration dédiée (ne pas éditer l'ENUM CREATE).
- Relaxation ou durcissement de `products_variant_xor` ou `tr_products_variant_no_nesting` → flag, risque de violation de données existantes.
- `products.sku` UNIQUE — tout changement en partial UNIQUE changerait la sémantique globale des collisions. Ne pas faire sans analyse complète.
- **Nouveau champ dans l'allowlist `create_product` / `update_product`** → **ne pas
  rejouer `20260530192331` ni `20260710000043`** : ces deux migrations bumpent des
  fonctions **droppées** (`_v1`), un `CREATE OR REPLACE` recréerait des fonctions mortes
  à côté des vivantes. Marche à suivre : (1) trouver la version vivante de la famille
  (plus haut fichier `supabase/migrations/` la concernant + le call-site dans
  `useCreateProduct` / `useUpdateProduct`) ; (2) partir du **corps live**
  (`pg_get_functiondef`), jamais du fichier de migration ; (3) si la signature est
  inchangée, `CREATE OR REPLACE` suffit et l'ACL est préservée ; si elle change,
  `_vN+1` + `DROP` de l'ancienne dans la même migration + trio REVOKE/GRANT ;
  (4) régénérer les types.
- Toute interaction avec `is_display_item` qui touche `current_stock` ou `stock_movements` → voir skill `stock-management` (isolation display-stock est non-négociable).
