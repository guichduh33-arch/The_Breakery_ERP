# products-catalog — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- RPCs catalog (SECURITY DEFINER, tous avec le trio REVOKE anon canonique)
- is_display_item — pont display-stock
- POS — variant picker

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
