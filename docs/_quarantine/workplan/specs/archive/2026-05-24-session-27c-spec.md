# Session 27c — Product Variants (Spec)

> **Date** : 2026-05-24
> **Branche cible** : `swarm/session-27c`
> **Base** : `master` @ `cab4ce3` (post-merge PR #35 turbo bump)
> **Effort estimé** : ~1.5j wall-time
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Predecessor** : [`./2026-05-20-session-27b-spec.md`](./2026-05-20-session-27b-spec.md) — S27c clôt le follow-up #2 listé dans S27b §7 (Variants schema + UI).

---

## 1. Contexte

Session 27 + 27b ont livré Product CRUD complet (create/update/categories management + DnD). Restait dans le scope déféré 8 follow-ups, dont le plus structurant : **les variants**. Aucun schema `product_variants` n'existe en DB ; la tab "Variants" dans `ProductDetailPage` rend un `StubPanel` ("Construction") depuis S14. Le module 05 (Products) est marqué DONE dans la roadmap globale 2026-05-20 mais cette tab reste un placeholder visible utilisateur.

**Distinction variants vs modifiers — décision business 2026-05-24** :

| Critère | Modifier (existant) | Variant (à créer) |
|---|---|---|
| SKU séparé | Non | Oui |
| Stock séparé | Non | Oui (mouvements distincts) |
| Recipe séparée | Non | Oui (recipe per variant) |
| Cost_price (WAC) séparé | Non | Oui |
| Prix retail | Ajusté via `price_adjustment` | Propre par variant |
| Choix | Au POS au moment de la commande | Référence catalogue distincte |
| Production / réception | Pas distinguées | Distinguées |
| Exemple Breakery | Capuccino Hot/Iced + Whole/Oat milk | Croissant Nature / Amande / Choco |

**Use cases business retenus** (3 axes, 1 axe par produit-parent) :
- **Saveur / recette** : croissant nature/amande/chocolat (recettes physiquement différentes, stock distinct)
- **Taille** : café 12oz/16oz/20oz, pâtisserie petit/moyen/grand (prix différents, potentiellement recipe scaling)
- **Format** : entier/demi/tranché, fresh/frozen (stock distinct, conversion future hors scope)

**Hors scope explicite cette session** :
- Matrix multi-axis (taille × saveur) — décision business 2026-05-24
- Modifier inheritance parent → variants — décision business 2026-05-24
- Conversion d'unités entre variants (1 entier = 6 tranches) — backlog futur
- Bulk operations / UnitsPanel / Sections editor / delete_category_v1 / pgTAP update_category_v1 / NewProductDialog Zod / optimistic reorder — backlog S27d ou plus tard (cf. S27b §7 #1, #3-8)

---

## 2. Architecture data

**Approche A — Linked products** (extend table `products`). Préférée à une table dédiée parce que chaque variant possède SKU+stock+recipe+cost_price propres, soit le profil d'un product complet : zéro cascade migration sur `order_items`, `stock_movements`, `recipes`, `po_lines`, `product_modifiers`, etc.

### 2.1 Schema changes

```sql
-- Migration _010 : ENUM
CREATE TYPE variant_axis_type AS ENUM ('flavor', 'size', 'format');

-- Migration _011 : ALTER products
ALTER TABLE products
  ADD COLUMN parent_product_id  UUID REFERENCES products(id) ON DELETE RESTRICT,
  ADD COLUMN variant_label      TEXT,
  ADD COLUMN variant_axis       variant_axis_type,
  ADD COLUMN variant_sort_order INT NOT NULL DEFAULT 0;

-- XOR : soit standalone/parent (3 NULL), soit variant (3 NOT NULL)
ALTER TABLE products
  ADD CONSTRAINT products_variant_xor CHECK (
    (parent_product_id IS NULL AND variant_label IS NULL AND variant_axis IS NULL)
    OR
    (parent_product_id IS NOT NULL AND variant_label IS NOT NULL AND variant_axis IS NOT NULL)
  );

-- Anti-self-reference (CHECK simple)
ALTER TABLE products
  ADD CONSTRAINT products_variant_no_self CHECK (parent_product_id IS NULL OR parent_product_id != id);

-- Index lookup variants by parent (partial actif)
CREATE INDEX idx_products_parent_id ON products(parent_product_id)
  WHERE parent_product_id IS NOT NULL AND deleted_at IS NULL;

-- Unicité (parent, label)
CREATE UNIQUE INDEX uniq_products_parent_label ON products(parent_product_id, variant_label)
  WHERE parent_product_id IS NOT NULL AND deleted_at IS NULL;
```

### 2.2 Trigger anti-nesting (1 niveau de hiérarchie max)

```sql
-- Migration _012
CREATE OR REPLACE FUNCTION enforce_variant_no_nesting() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_product_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM products
      WHERE id = NEW.parent_product_id
        AND parent_product_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Cannot nest variants: parent % is itself a variant', NEW.parent_product_id
        USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- Reverse check : if THIS product becomes a parent (has children), it cannot have a parent_product_id
  IF NEW.parent_product_id IS NULL
     AND EXISTS (SELECT 1 FROM products WHERE parent_product_id = NEW.id)
  THEN
    -- OK : already a parent staying parent (no-op)
    NULL;
  ELSIF NEW.parent_product_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM products WHERE parent_product_id = NEW.id)
  THEN
    RAISE EXCEPTION 'Cannot make % a variant: it is already a parent', NEW.id
      USING ERRCODE = 'P0004';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_products_variant_no_nesting
  BEFORE INSERT OR UPDATE OF parent_product_id ON products
  FOR EACH ROW EXECUTE FUNCTION enforce_variant_no_nesting();
```

### 2.3 Convention name virtuel

`create_variant_v1` et `convert_product_to_parent_v1` settent par défaut `products.name = parent.name || ' ' || variant_label` pour bénéficier de la trigram GIN index existante sur `products.name` (S16). Override possible via `update_variant_v1` patch ultérieur.

**Mitigation impact rapports historiques** : `convert_product_to_parent_v1` accepte un paramètre optionnel `p_first_variant_name TEXT` ; si NULL, le name d'origine est préservé (pour éviter de muter retrospectivement le name dans les orders passés).

### 2.4 Propriétés downstream (zéro changement)

- `order_items.product_id` → variant directement
- `stock_movements.product_id` → variant
- `recipes.product_id` → variant
- `po_lines.product_id` → variant
- `product_modifiers.product_id` → variant (pas d'héritage parent)

---

## 3. RPCs (6 nouvelles, SECURITY DEFINER)

Toutes : audit_log row obligatoire, REVOKE pair S20 canonique (REVOKE EXECUTE FROM PUBLIC + ALTER DEFAULT PRIVILEGES).

### 3.1 `convert_product_to_parent_v1`

```
convert_product_to_parent_v1(
  p_product_id          UUID,
  p_first_variant_label TEXT,
  p_variant_axis        variant_axis_type,
  p_first_variant_name  TEXT DEFAULT NULL
) RETURNS UUID  -- new parent_id (the original UUID becomes the first variant)
```

Gate : `products.variants.write`. Transforme un product standalone en parent-with-one-variant. **Préserve l'UUID original** (qui devient le first variant — stock_movements, order_items, recipes, modifiers, cost_price restent attachés). Insère une **nouvelle** row parent (UUID retourné). Erreurs :
- `P0002 product_not_found` si product n'existe pas
- `P0004 already_parent` si product est déjà parent
- `P0004 already_variant` si product est déjà variant
- `P0003 forbidden` si user sans perm

Audit : `products.variant.parent_created` avec payload `{parent_id, first_variant_label, variant_axis}`.

### 3.2 `create_variant_v1`

```
create_variant_v1(
  p_parent_id      UUID,
  p_variant_label  TEXT,
  p_sku            TEXT,
  p_retail_price   NUMERIC,
  p_cost_price     NUMERIC DEFAULT NULL,
  p_unit           TEXT    DEFAULT NULL,
  p_sort_order     INT     DEFAULT NULL,
  p_name           TEXT    DEFAULT NULL  -- default: parent.name || ' ' || label
) RETURNS UUID  -- new variant_id
```

Gate : `products.variants.write`. Crée un nouveau variant. Hérite du parent : `category_id`, `visible_on_pos`, `available_for_sale`, `track_inventory`, `deduct_stock`, `unit` (sauf override explicite). Si `p_sort_order IS NULL` → assigne `MAX(variant_sort_order) + 10` des siblings.

Erreurs :
- `P0002 parent_not_found`
- `P0004 parent_is_variant` (anti-nesting via trigger mais double-check explicite avec message clair)
- `23505 unique_violation` si (parent_id, label) déjà existant
- `23505 sku_taken` si SKU déjà existant sur un autre product
- `P0003 forbidden`

### 3.3 `update_variant_v1`

```
update_variant_v1(p_variant_id UUID, p_patch JSONB) RETURNS UUID
```

4-col patch allowlist : `variant_label`, `sku`, `retail_price`, `variant_sort_order`. Refuse de changer `parent_product_id` et `variant_axis` (move/re-axis = delete + recreate via UI).

### 3.4 `delete_variant_v1`

```
delete_variant_v1(p_variant_id UUID) RETURNS UUID
```

**Soft delete** : `is_active = false`. Préserve historique stock_movements / order_items intégralement (foreign keys intactes, le variant reste résolvable). Refuse si c'est le dernier variant actif du parent (utiliser `convert_parent_to_standalone_v1` à la place).

Erreurs : `P0004 last_variant_remaining`.

### 3.5 `reorder_variants_v1`

```
reorder_variants_v1(p_parent_id UUID, p_ordered_variant_ids UUID[]) RETURNS INT  -- count
```

Pattern S27b `reorder_categories_v1` : assigne `variant_sort_order = 10, 20, 30, ...` selon l'ordre. Complete-coverage gate : `p_ordered_variant_ids` doit contenir TOUS les variants actifs du parent (sinon `P0004 incomplete_coverage`). Pré-empte le bug ambiguous-id S27b corrective `_102709` en qualifiant explicitement avec table aliases.

### 3.6 `convert_parent_to_standalone_v1`

```
convert_parent_to_standalone_v1(p_parent_id UUID) RETURNS UUID
```

Reverse de `convert_product_to_parent_v1`. Refuse si parent a >1 variant actif. Si exactement 1 variant actif : NULL-out les 3 cols variant + flip le variant en standalone product (préserve UUID + historique du variant).

Erreurs : `P0004 multiple_variants_remaining`.

---

## 4. Permissions

2 nouvelles permissions seedées via migration `_040` :

| Permission | Roles |
|---|---|
| `products.variants.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `products.variants.write` | ADMIN, SUPER_ADMIN |

`PermissionCode` TS étendu dans `packages/utils/permissions.ts`.

---

## 5. BO Variants tab (replace StubPanel)

### 5.1 Composant racine `VariantsPanel.tsx`

Switch sur l'état du product :

**Cas 1 — Standalone** (`parent_product_id IS NULL` ET pas de variants enfants) :
- `EmptyState` "Ce produit n'a pas de variants."
- Form inline : axis selector (radio flavor/size/format) + first_variant_label input + optional name override
- CTA : `[Convert to parent + create first variant]` (gate `products.variants.write`)

**Cas 2 — Parent** (`parent_product_id IS NULL` AND `EXISTS variants`) :
- Header : axis badge + "N variants" + `[+ Add variant]`
- Table 6 cols (DnD via @dnd-kit, pattern S27b `CategorySortableRow`) :
  - Drag handle | Label | SKU | Retail | Cost (read) | Active toggle
- Row click → naviguer vers `/products/<variant_id>` (ProductDetailPage du variant)
- Footer : `[Dissolve parent]` visible uniquement si `count(active variants) ≤ 1`

**Cas 3 — Variant** (`parent_product_id IS NOT NULL`) :
- Banner : "Ce produit est un variant de [Parent name]" + `[← Voir le parent]`
- Lecture seule : axis (read), label (read), sibling variants list (avec count)

### 5.2 Composants nouveaux

- `VariantsPanel.tsx` — switch racine
- `ConvertToParentDialog.tsx` — stepper 2 steps (axis + first variant label + optional first_variant_name override)
- `AddVariantDialog.tsx` — form (label + SKU + retail_price + cost_price optionnel + name optionnel)
- `VariantRowSortable.tsx` — réutilise pattern `CategorySortableRow` (@dnd-kit pointer + keyboard sensors + rollback-on-error)
- `DissolveParentDialog.tsx` — confirm modal avec preview "this will turn [variant_name] into a standalone product"

### 5.3 Hooks nouveaux (8)

| Hook | Source | Description |
|---|---|---|
| `useProductVariants(parentId)` | SELECT | products WHERE parent_product_id=$1 AND deleted_at IS NULL ORDER BY variant_sort_order |
| `useProductParent(variantId)` | SELECT | products WHERE id = $1.parent_product_id (banner Cas 3) |
| `useConvertProductToParent` | RPC | convert_product_to_parent_v1 |
| `useCreateVariant` | RPC | create_variant_v1 |
| `useUpdateVariant` | RPC | update_variant_v1 |
| `useDeleteVariant` | RPC | delete_variant_v1 |
| `useReorderVariants` | RPC | reorder_variants_v1 |
| `useConvertParentToStandalone` | RPC | convert_parent_to_standalone_v1 |

### 5.4 ProductsList changes (BO)

- Hook `useProducts` étend son SELECT : `parent_product_id`, `variant_label`, `variant_axis`
- Badge dans la row :
  - `Parent` (gold pill) si product a des variants enfants
  - `Variant of <parent>` (subtle pill) si parent_product_id NOT NULL
- Filter dropdown : `[Tout / Standalone / Parents / Variants]` (default = Tout)

---

## 6. POS variant modal

### 6.1 VariantSelectModal

Pattern UX inspiré de `ModifierModal.tsx` (Radix Dialog, S22 focus-trap locked).

```
┌────────────────────────────────────────────┐
│ Croissant                            [×]   │
│ Saveur (badge axis)                        │
│ ────────────────────────────────────────── │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│ │ Amande   │  │ Nature   │  │ Chocolat │  │
│ │ Rp 25k   │  │ Rp 20k   │  │ Rp 27k   │  │
│ │ stock 8  │  │ stock 12 │  │ stock 4  │  │
│ └──────────┘  └──────────┘  └──────────┘  │
│       [Annuler]                            │
└────────────────────────────────────────────┘
```

Comportement :
- Tap tile variant → close modal + `addToCart(variant)` (variant est traité comme un product normal)
- Tile grisée si `is_active=false` OU `current_stock=0 AND deduct_stock=true`
- Si parent n'a qu'un seul variant actif → skip modal, addToCart direct (UX shortcut)
- Si variant a des modifiers attachés → enchaîner ouverture ModifierModal (déjà géré par flux POS existant)

### 6.2 Grille POS filter

Modification minimale dans le hook POS (`useProducts` POS-side ou équivalent) : ajouter filter `parent_product_id IS NULL`. La grille n'affiche que les parents + standalone products.

### 6.3 Search POS

**Zéro changement RPC ou index** grâce au name virtuel concat (cf. §2.3) :
- Search "croissant" matche le parent (name="Croissant") + tous les variants (name="Croissant Amande", etc.)
- Search "amande" matche le variant directement (trigram GIN sur products.name)
- Search SKU exact retourne le variant

Décision UX search (déterministe) :
- Pour chaque résultat search, identifier le parent (soit `id` si le row est lui-même un parent ou standalone, soit `parent_product_id` si le row est un variant)
- Group-by parent_id, prendre un représentant unique :
  - Si parent existe dans les results → afficher le parent
  - Sinon (search matche uniquement un sous-ensemble de variants), afficher chaque variant individuellement comme tiles directes (max 5 tiles, sort by relevance trigram score)
- Conséquence : "croissant" → 1 tile parent (modal au tap). "amande" → 1 tile variant "Croissant Amande" (cart direct au tap).

### 6.4 Composant POS

- `VariantSelectModal.tsx` dans `apps/pos/src/features/cart/`
- Hook `useProductVariants` POS-side (mirror BO)
- Modification dans le ProductGridTile (ou équivalent) : at click, check `has_variants` → open modal vs addToCart direct

---

## 7. Tests

### 7.1 pgTAP (1 fichier, 14 asserts)

`supabase/tests/product_variants.test.sql` :

| # | Test | Couvre |
|---|---|---|
| T1 | convert happy path SUPER_ADMIN | RPC + audit_log row |
| T2 | convert rejette si déjà variant | P0004 already_variant |
| T3 | convert CASHIER → P0003 | Permission gate |
| T4 | create_variant happy + hérite unit/category | RPC + heritage |
| T5 | create_variant SKU duplicate → 23505 | UNIQUE SKU + (parent, label) |
| T6 | update_variant 4-col patch happy | Patch allowlist |
| T7 | delete_variant soft (is_active=false) | Soft delete |
| T8 | delete_variant refuse last remaining | P0004 last_variant_remaining |
| T9 | reorder_variants complete-coverage | Pattern S27b |
| T10 | reorder_variants ambiguous-id check | Pré-empte S27b corrective |
| T11 | dissolve refuse si >1 variant | P0004 multiple_variants_remaining |
| T12 | dissolve happy si 1 variant | Reverse RPC |
| T13 | Anti-nesting trigger | Trigger CHECK |
| T14 | CHECK products_variant_xor | DB integrity |

### 7.2 BO smoke (5 fichiers, 10 asserts)

- `variants-panel-empty.smoke.test.tsx` 2/2
- `variants-panel-parent.smoke.test.tsx` 3/3
- `variants-panel-variant.smoke.test.tsx` 1/1
- `convert-to-parent-dialog.smoke.test.tsx` 2/2
- `products-list-filter.smoke.test.tsx` 2/2

### 7.3 POS smoke (2 fichiers, 4 asserts)

- `variant-select-modal.smoke.test.tsx` 2/2
- `pos-grid-hides-variants.smoke.test.tsx` 2/2

**Total** : 28 asserts.

### 7.4 Typecheck

- `pnpm --filter @breakery/app-backoffice typecheck` doit rester clean (sauf erreurs pré-existantes `@dnd-kit/*`, `recharts`, `sonner` env install)
- `pnpm --filter @breakery/app-pos typecheck` doit rester clean

---

## 8. Migrations (block `20260524000010..099`)

16 migrations planifiées, monotonic :

| # | Description |
|---|---|
| `_010` | CREATE TYPE variant_axis_type |
| `_011` | ALTER products ADD 4 cols + 3 CHECK + 2 indexes |
| `_012` | Trigger anti-nesting |
| `_020` / `_021` | RPC convert_product_to_parent_v1 + REVOKE pair |
| `_022` / `_023` | RPC create_variant_v1 + REVOKE pair |
| `_024` / `_025` | RPC update_variant_v1 + REVOKE pair |
| `_026` / `_027` | RPC delete_variant_v1 + REVOKE pair |
| `_028` / `_029` | RPC reorder_variants_v1 + REVOKE pair |
| `_030` / `_031` | RPC convert_parent_to_standalone_v1 + REVOKE pair |
| `_040` | Seed perms `products.variants.{read,write}` + role_permissions |

Types regen via `mcp__plugin_supabase_supabase__generate_typescript_types` après Wave 1 (_011) puis après Wave 3 (_040) — 2 regens.

---

## 9. Wave plan

| Wave | Description | Effort |
|---|---|---|
| 0 | Spec doc + branche `swarm/session-27c` | XS |
| 1 | DB schema (3 migrations) + types regen | S |
| 2 | RPCs CRUD (12 migrations) + pgTAP T1-T12 | M |
| 3 | Permissions seed + PermissionCode TS | XS |
| 4 | BO Variants tab (15 fichiers) + ProductsList filter + 5 BO smoke | M-L |
| 5 | POS variant modal (6 fichiers) + grid filter + 2 POS smoke | M |
| 6 | Closeout : INDEX + CLAUDE.md "Active Workplan" update + typecheck sweep | XS |

Wall-time estimé : **~1.5 jour**.

---

## 10. Closes & tracking

- **TASK-05-003** (variants minimum) — DONE
- **S27b §7 #2** (Variants tab + schema) — DONE
- **S27 INDEX §6** deferred (Variants tab) — DONE

---

## 11. Risques & mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| `convert_product_to_parent_v1` mute le `name` d'un product avec orders historiques | Moyenne | Paramètre `p_first_variant_name` optionnel ; default = préserver name d'origine |
| Search POS de-dup par parent_id pourrait perdre l'accès direct au variant via search exacte | Faible | Si match exact sur `variant_label` (≥3 chars), afficher le variant individuellement (heuristique) |
| Trigger anti-nesting double-check coûteux sur bulk updates | Faible | OK pour Breakery cardinalité ; BEFORE INSERT/UPDATE OF parent_product_id only |
| Recipe per variant : si user convertit un product avec recipe attachée → la recipe reste sur le variant (qui est l'ancien product) | Faible | Documenté ; comportement attendu et désiré |
| Hard delete vs soft : si user veut HARD delete variant sans orders → reset is_active=false uniquement | Faible | Acceptable MVP, ajouter hard_delete_variant_v1 si demande |

---

## 12. Hors scope (déféré S27d ou plus tard)

S27b §7 follow-ups non couverts cette session :
- #1 Bulk operations Products list
- #3 UnitsPanel write mode (set_product_units_v1 UI consumer)
- #4 Sections editor (set_product_sections_v1 UI consumer)
- #5 delete_category_v1 + UI
- #6 pgTAP update_category_v1
- #7 NewProductDialog Zod validation
- #8 Fully-optimistic useReorderCategories

Et nouvelles deferred S27c :
- Conversion d'unités entre variants (entier→tranches)
- Matrix multi-axis (taille × saveur)
- Modifier inheritance parent → variants
- KDS variant rendering custom (probablement déjà OK via `order_items.product_name` virtuel concat)
- Receipt template variant fields (idem)
- Hard delete variants (vs soft)

---

## 13. Liens

- Predecessor S27b spec : [`./2026-05-20-session-27b-spec.md`](./2026-05-20-session-27b-spec.md)
- S27b INDEX : [`../plans/2026-05-20-session-27b-INDEX.md`](../../plans/archive/2026-05-20-session-27b-INDEX.md)
- Plan S24-S30 : [`../plans/2026-05-19-S24-to-S30-plan.md`](../../plans/archive/2026-05-19-S24-to-S30-plan.md)
- Module backlog 05 : [`../backlog-by-module/05-products-categories.md`](../backlog-by-module/05-products-categories.md)
- Conventions code : [`../../../CLAUDE.md`](../../../../CLAUDE.md)
