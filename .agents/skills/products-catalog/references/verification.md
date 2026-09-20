# products-catalog — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit checklist
- Sources de vérité (pointers)
- Verification before claiming a fix is complete
- When to escalate

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
live par `pg_get_functiondef` — c'est de là que part toute copie (AGENTS.md).

Patterns canon : `AGENTS.md` § *Critical patterns* (RPC versioning monotone, trio
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
