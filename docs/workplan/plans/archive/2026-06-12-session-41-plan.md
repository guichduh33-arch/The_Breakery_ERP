# Session 41 — Plan : Import / Export du catalogue (produits + recettes)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un onglet « Import / Export » dans la page Products du BO : template Excel 6 onglets, import bulk atomique avec dry-run (`import_catalog_v1`), export round-trip (`export_catalog_v1`).

**Architecture:** Le front parse le `.xlsx` dans le navigateur (SheetJS) et envoie un payload JSONB à une RPC SECURITY DEFINER unique qui valide tout (erreurs exhaustives ligne par ligne), puis écrit atomiquement en upsert-par-SKU. L'export renvoie le même shape JSONB, converti en `.xlsx` côté client via la même définition de template.

**Tech Stack:** Postgres plpgsql (Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP — PAS de Docker), React + TanStack Query (BO), SheetJS (`xlsx`), pgTAP via MCP `execute_sql`, Vitest.

**Spec:** [`docs/workplan/specs/2026-06-12-session-41-catalog-import-spec.md`](../../specs/archive/2026-06-12-session-41-catalog-import-spec.md)

**Branche:** `swarm/session-41` (base `master` post-`1eb8b4b`). Commits conventionnels `feat(db|backoffice): session 41 — task N — <topic>`.

**Rappels projet non négociables (CLAUDE.md):**
- Migrations via `mcp__plugin_supabase_supabase__apply_migration` (project_id `ikcyvlovptebroadgtvd`), fichier local miroir dans `supabase/migrations/` nommé sur le NAME-block `20260625000010..013`.
- pgTAP via `mcp__plugin_supabase_supabase__execute_sql` enveloppé `BEGIN; ... ROLLBACK;`.
- Après toute migration : regen types via `mcp__plugin_supabase_supabase__generate_typescript_types` → `packages/supabase/src/types.generated.ts` + commit.
- REVOKE pair canonique : `REVOKE ALL ... FROM PUBLIC` + `REVOKE EXECUTE ... FROM anon` + `GRANT EXECUTE ... TO authenticated` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` (leçon P11 S40 — les 3 lignes complètes, inline dans chaque migration RPC).
- `pnpm` 9.15 + turbo. Jamais `npm`.

---

## Wave 0 — Setup

### Task 0 : Branche + vérification de la base de migrations

**Files:** aucun.

- [ ] **Step 0.1 :** `git checkout -b swarm/session-41` depuis `master` à jour.
- [ ] **Step 0.2 :** Vérifier la monotonie : `mcp__plugin_supabase_supabase__list_migrations` (project_id `ikcyvlovptebroadgtvd`) — le dernier NAME-block attendu est `20260624000022` (S40). Si un NAME ≥ `20260625000010` existe déjà, décaler le block de cette session (`..000020+`) et le noter en déviation.
- [ ] **Step 0.3 :** Vérifier que le seed users existe (requis pgTAP) : `execute_sql` → `SELECT auth_user_id, role_code FROM user_profiles up JOIN roles r ON r.id = up.role_id WHERE auth_user_id IN ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004');` Attendu : CASHIER (…002) et MANAGER (…004). (Colonne de jointure réelle à adapter si besoin — les UUID sont la référence, cf. `supabase/tests/s40_reports.test.sql:28-31`.)

---

## Wave A — DB (séquentiel)

### Task 1 : Migration `_010` — table `catalog_import_idempotency_keys`

**Files:**
- Create: `supabase/migrations/20260625000010_create_catalog_import_idempotency_keys.sql`

- [ ] **Step 1.1 :** Écrire le fichier migration :

```sql
-- 20260625000010_create_catalog_import_idempotency_keys.sql
-- S41 — dedicated idempotency-keys table for import_catalog_v1 (S25 flavor 2).
-- PK = client-generated UUID. Stores the first successful report for replay.
-- RPC-only access: REVOKE everything from app roles (SECURITY DEFINER bypasses).

CREATE TABLE catalog_import_idempotency_keys (
  key        UUID PRIMARY KEY,
  report     JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE catalog_import_idempotency_keys IS
  'S41 — idempotency keys for import_catalog_v1 (S25 flavor 2). Replay returns the stored report.';

ALTER TABLE catalog_import_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- No policy: RPC-only access (SECURITY DEFINER), pattern b2b_settings S39.

REVOKE ALL ON catalog_import_idempotency_keys FROM PUBLIC;
REVOKE ALL ON catalog_import_idempotency_keys FROM anon;
REVOKE ALL ON catalog_import_idempotency_keys FROM authenticated;
```

- [ ] **Step 1.2 :** Appliquer via MCP `apply_migration` (name `create_catalog_import_idempotency_keys`, body = SQL ci-dessus).
- [ ] **Step 1.3 :** Commit : `git add supabase/migrations/20260625000010_*.sql && git commit -m "feat(db): session 41 — task 1 — catalog_import_idempotency_keys table"`.

### Task 2 : Migration `_011` — RPC `import_catalog_v1`

**Files:**
- Create: `supabase/migrations/20260625000011_create_import_catalog_v1_rpc.sql`

- [ ] **Step 2.1 :** Écrire le fichier migration avec le SQL complet ci-dessous. Points structurants :
  - temp tables avec `DROP TABLE IF EXISTS` en prologue (elles survivent entre 2 appels d'une même session/transaction — indispensable pour pgTAP qui enchaîne les appels dans une seule tx) ;
  - validation exhaustive dans `t_err`, jamais fail-fast ;
  - le payload arrive typé du parseur front : un cast invalide (`22P02`) d'un caller hostile est acceptable (boundary validée client-side) ;
  - cycle/profondeur détectés au niveau SKU sur le graphe effectif (lignes fichier + BOM DB des produits non remplacés) — le trigger `tr_validate_recipe_no_cycle` reste la défense en profondeur au commit ;
  - upsert par SKU ; `unit` de base jamais modifié sur un produit existant (erreur explicite) ;
  - REPLACE semantics units (miroir `set_product_units_v1`), remplacement complet de BOM (le snapshot `recipe_versions` FOR EACH ROW produit plusieurs versions — documenté S15 D4, acceptable).

```sql
-- 20260625000011_create_import_catalog_v1_rpc.sql
-- S41 — bulk catalog import (categories / ingredients / products / units /
-- variants / recipes). Dry-run = full validation + summary, zero writes.
-- Commit = same validation, then atomic upsert-by-SKU in this tx.
-- Gate catalog.import. Idempotency S25 flavor 2 (catalog_import_idempotency_keys).

CREATE OR REPLACE FUNCTION public.import_catalog_v1(
  p_payload         JSONB,
  p_dry_run         BOOLEAN DEFAULT TRUE,
  p_idempotency_key UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  r           RECORD;
  v_cat_id    UUID;
  v_slug      TEXT;
  v_slug_base TEXT;
  v_i         INT;
  v_pid       UUID;
  v_parent    RECORD;
  v_probe     NUMERIC;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'catalog.import') THEN
    RAISE EXCEPTION 'permission denied: catalog.import required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM catalog_import_idempotency_keys
     WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  -- ════════════════════════ STAGING ════════════════════════
  DROP TABLE IF EXISTS t_cat, t_item, t_var, t_unit, t_rec, t_eff_codes, t_err;

  CREATE TEMP TABLE t_cat ON COMMIT DROP AS
  SELECT ord::INT                                                     AS row_num,
         NULLIF(trim(elt->>'name'), '')                               AS name,
         COALESCE(NULLIF(trim(elt->>'dispatch_station'), ''), 'none') AS dispatch_station,
         (elt->>'sort_order')::INT                                    AS sort_order
    FROM jsonb_array_elements(COALESCE(p_payload->'categories', '[]'::jsonb))
         WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_item ON COMMIT DROP AS
  SELECT 'Ingredients'::TEXT                     AS sheet,
         ord::INT                                AS row_num,
         'ingredient'::TEXT                      AS kind,
         NULLIF(trim(elt->>'sku'), '')           AS sku,
         NULLIF(trim(elt->>'name'), '')          AS name,
         NULLIF(trim(elt->>'unit'), '')          AS unit,
         (elt->>'cost_price')::NUMERIC           AS cost_price,
         NULLIF(trim(elt->>'category'), '')      AS category,
         NULL::NUMERIC                           AS retail_price,
         NULL::NUMERIC                           AS wholesale_price,
         NULL::TEXT                              AS description,
         NULL::TEXT                              AS image_url,
         NULL::BOOLEAN                           AS visible_on_pos,
         NULL::BOOLEAN                           AS is_favorite,
         (elt->>'min_stock_threshold')::NUMERIC  AS min_stock_threshold,
         (elt->>'shelf_life_hours')::INT         AS shelf_life_hours,
         NULLIF(trim(elt->>'purchase_unit'), '') AS purchase_unit,
         NULLIF(trim(elt->>'recipe_unit'), '')   AS recipe_unit,
         NULLIF(trim(elt->>'opname_unit'), '')   AS opname_unit,
         NULLIF(trim(elt->>'sales_unit'), '')    AS sales_unit
    FROM jsonb_array_elements(COALESCE(p_payload->'ingredients', '[]'::jsonb))
         WITH ORDINALITY AS t(elt, ord)
  UNION ALL
  SELECT 'Products', ord::INT, 'product',
         NULLIF(trim(elt->>'sku'), ''),
         NULLIF(trim(elt->>'name'), ''),
         NULLIF(trim(elt->>'unit'), ''),
         NULL,
         NULLIF(trim(elt->>'category'), ''),
         (elt->>'retail_price')::NUMERIC,
         (elt->>'wholesale_price')::NUMERIC,
         NULLIF(elt->>'description', ''),
         NULLIF(trim(elt->>'image_url'), ''),
         COALESCE((elt->>'visible_on_pos')::BOOLEAN, TRUE),
         COALESCE((elt->>'is_favorite')::BOOLEAN, FALSE),
         NULL,
         (elt->>'shelf_life_hours')::INT,
         NULLIF(trim(elt->>'purchase_unit'), ''),
         NULLIF(trim(elt->>'recipe_unit'), ''),
         NULLIF(trim(elt->>'opname_unit'), ''),
         NULLIF(trim(elt->>'sales_unit'), '')
    FROM jsonb_array_elements(COALESCE(p_payload->'products', '[]'::jsonb))
         WITH ORDINALITY AS t(elt, ord);

  -- unité effective : fichier > DB > 'pcs' (les ingrédients ont unit requis — V1)
  ALTER TABLE t_item ADD COLUMN eff_unit TEXT;
  UPDATE t_item i
     SET eff_unit = COALESCE(
       i.unit,
       (SELECT p.unit FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL),
       'pcs');

  CREATE TEMP TABLE t_var ON COMMIT DROP AS
  SELECT ord::INT                                AS row_num,
         NULLIF(trim(elt->>'parent_sku'), '')    AS parent_sku,
         NULLIF(trim(elt->>'variant_axis'), '')  AS variant_axis,
         NULLIF(trim(elt->>'variant_label'), '') AS variant_label,
         NULLIF(trim(elt->>'sku'), '')           AS sku,
         (elt->>'retail_price')::NUMERIC         AS retail_price,
         NULLIF(trim(elt->>'image_url'), '')     AS image_url,
         (row_number() OVER (PARTITION BY NULLIF(trim(elt->>'parent_sku'), '')
                             ORDER BY ord) * 10)::INT AS sort_order
    FROM jsonb_array_elements(COALESCE(p_payload->'variants', '[]'::jsonb))
         WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_unit ON COMMIT DROP AS
  SELECT ord::INT                              AS row_num,
         NULLIF(trim(elt->>'product_sku'), '') AS product_sku,
         NULLIF(trim(elt->>'code'), '')        AS code,
         (elt->>'factor_to_base')::NUMERIC     AS factor_to_base,
         CASE WHEN elt->'tags' IS NULL OR jsonb_typeof(elt->'tags') <> 'array'
              THEN ARRAY['purchase','recipe','sales']
              ELSE ARRAY(SELECT jsonb_array_elements_text(elt->'tags'))
         END                                   AS tags,
         (row_number() OVER (PARTITION BY NULLIF(trim(elt->>'product_sku'), '')
                             ORDER BY ord) * 10)::INT AS display_order
    FROM jsonb_array_elements(COALESCE(p_payload->'units', '[]'::jsonb))
         WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_rec ON COMMIT DROP AS
  SELECT ord::INT                               AS row_num,
         NULLIF(trim(elt->>'product_sku'), '')  AS product_sku,
         NULLIF(trim(elt->>'material_sku'), '') AS material_sku,
         (elt->>'quantity')::NUMERIC            AS quantity,
         NULLIF(trim(elt->>'unit'), '')         AS unit,
         NULLIF(elt->>'notes', '')              AS notes
    FROM jsonb_array_elements(COALESCE(p_payload->'recipes', '[]'::jsonb))
         WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (
    sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT
  ) ON COMMIT DROP;

  -- codes d'unités effectifs par SKU : les lignes Units du fichier remplacent
  -- la déclaration DB (REPLACE) ; sinon on garde les alternatives DB actives.
  CREATE TEMP TABLE t_eff_codes ON COMMIT DROP AS
  SELECT u.product_sku AS sku, u.code
    FROM t_unit u WHERE u.product_sku IS NOT NULL AND u.code IS NOT NULL
  UNION
  SELECT p.sku, a.code
    FROM product_unit_alternatives a
    JOIN products p ON p.id = a.product_id AND p.deleted_at IS NULL
   WHERE a.deleted_at IS NULL
     AND p.sku NOT IN (SELECT DISTINCT product_sku FROM t_unit WHERE product_sku IS NOT NULL);

  -- ════════════════════════ VALIDATION ════════════════════════
  -- V1 — champs requis / domaines
  INSERT INTO t_err SELECT 'Categories', row_num, NULL, 'missing_name', 'name is required'
    FROM t_cat WHERE name IS NULL;
  INSERT INTO t_err SELECT 'Categories', row_num, NULL, 'invalid_dispatch_station',
         format('dispatch_station "%s" must be kitchen|barista|bakery|none', dispatch_station)
    FROM t_cat WHERE dispatch_station NOT IN ('kitchen','barista','bakery','none');
  INSERT INTO t_err SELECT 'Categories', MIN(row_num), NULL, 'duplicate_category',
         format('category "%s" appears %s times in the file', name, COUNT(*))
    FROM t_cat WHERE name IS NOT NULL GROUP BY name HAVING COUNT(*) > 1;

  INSERT INTO t_err SELECT sheet, row_num, sku, 'missing_required', 'sku and name are required'
    FROM t_item WHERE sku IS NULL OR name IS NULL;
  INSERT INTO t_err SELECT sheet, row_num, sku, 'missing_unit', 'unit is required for ingredients'
    FROM t_item WHERE kind = 'ingredient' AND unit IS NULL;
  INSERT INTO t_err SELECT sheet, row_num, sku, 'invalid_cost_price', 'cost_price is required and must be >= 0'
    FROM t_item WHERE kind = 'ingredient' AND (cost_price IS NULL OR cost_price < 0);
  INSERT INTO t_err SELECT sheet, row_num, sku, 'invalid_retail_price', 'retail_price is required and must be >= 0'
    FROM t_item WHERE kind = 'product' AND (retail_price IS NULL OR retail_price < 0);
  INSERT INTO t_err SELECT sheet, row_num, sku, 'missing_category', 'category is required for products'
    FROM t_item WHERE kind = 'product' AND category IS NULL;

  -- V2 — SKU dupliqués dans le fichier (cross-onglets, variants inclus)
  WITH all_skus AS (
    SELECT sheet, row_num, sku FROM t_item WHERE sku IS NOT NULL
    UNION ALL
    SELECT 'Variants', row_num, sku FROM t_var WHERE sku IS NOT NULL
  )
  INSERT INTO t_err
  SELECT MIN(sheet), MIN(row_num), sku, 'duplicate_sku',
         format('SKU "%s" appears %s times in the file', sku, COUNT(*))
    FROM all_skus GROUP BY sku HAVING COUNT(*) > 1;

  -- V3 — catégorie inconnue (ni fichier ni DB)
  INSERT INTO t_err
  SELECT i.sheet, i.row_num, i.sku, 'unknown_category',
         format('category "%s" not found in file or database', i.category)
    FROM t_item i
   WHERE i.category IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_cat c WHERE c.name = i.category)
     AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = i.category AND c.deleted_at IS NULL);

  -- V4 — le fichier déclare standalone, la DB dit variante
  INSERT INTO t_err
  SELECT i.sheet, i.row_num, i.sku, 'sku_is_variant_in_db',
         format('SKU "%s" exists in the database as a variant — cannot import it as standalone', i.sku)
    FROM t_item i
    JOIN products p ON p.sku = i.sku AND p.deleted_at IS NULL
   WHERE p.parent_product_id IS NOT NULL;

  -- V5 — changement d'unité de base interdit
  INSERT INTO t_err
  SELECT i.sheet, i.row_num, i.sku, 'unit_change_not_supported',
         format('SKU "%s": base unit cannot be changed by import (db=%s, file=%s)', i.sku, p.unit, i.unit)
    FROM t_item i
    JOIN products p ON p.sku = i.sku AND p.deleted_at IS NULL
   WHERE i.unit IS NOT NULL AND p.unit <> i.unit;

  -- V6/V7/V8/V9/V10 — variantes
  INSERT INTO t_err SELECT 'Variants', row_num, sku, 'missing_required',
         'parent_sku, variant_axis, variant_label and sku are required'
    FROM t_var WHERE parent_sku IS NULL OR variant_axis IS NULL OR variant_label IS NULL OR sku IS NULL;
  INSERT INTO t_err SELECT 'Variants', row_num, sku, 'invalid_variant_axis',
         format('variant_axis "%s" must be flavor|size|format', variant_axis)
    FROM t_var WHERE variant_axis IS NOT NULL AND variant_axis NOT IN ('flavor','size','format');
  INSERT INTO t_err
  SELECT 'Variants', v.row_num, v.sku, 'unknown_parent',
         format('parent_sku "%s" not found in Products sheet or database', v.parent_sku)
    FROM t_var v
   WHERE v.parent_sku IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = v.parent_sku AND i.kind = 'product')
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = v.parent_sku
                       AND p.deleted_at IS NULL AND p.parent_product_id IS NULL);
  INSERT INTO t_err
  SELECT 'Variants', v.row_num, v.sku, 'parent_is_variant',
         format('parent_sku "%s" is itself a variant — nesting is not allowed', v.parent_sku)
    FROM t_var v
    JOIN products p ON p.sku = v.parent_sku AND p.deleted_at IS NULL
   WHERE p.parent_product_id IS NOT NULL;
  INSERT INTO t_err
  SELECT 'Variants', MIN(row_num), parent_sku, 'mixed_axes',
         format('parent "%s" has more than one variant_axis in the file', parent_sku)
    FROM t_var WHERE parent_sku IS NOT NULL AND variant_axis IS NOT NULL
   GROUP BY parent_sku HAVING COUNT(DISTINCT variant_axis) > 1;
  INSERT INTO t_err
  SELECT 'Variants', v.row_num, v.sku, 'axis_conflict_db',
         format('parent "%s" already has variants with axis "%s" in the database', v.parent_sku, dbv.axis)
    FROM t_var v
    JOIN products parent ON parent.sku = v.parent_sku AND parent.deleted_at IS NULL
    JOIN LATERAL (
      SELECT c.variant_axis::TEXT AS axis FROM products c
       WHERE c.parent_product_id = parent.id AND c.deleted_at IS NULL AND c.is_active = TRUE
       LIMIT 1
    ) dbv ON TRUE
   WHERE v.variant_axis IS NOT NULL AND dbv.axis <> v.variant_axis;
  INSERT INTO t_err
  SELECT 'Variants', v.row_num, v.sku, 'sku_is_standalone_in_db',
         format('SKU "%s" exists in the database as a standalone product — converting via import is not supported', v.sku)
    FROM t_var v
    JOIN products p ON p.sku = v.sku AND p.deleted_at IS NULL
   WHERE p.parent_product_id IS NULL;
  INSERT INTO t_err
  SELECT 'Variants', v.row_num, v.sku, 'variant_parent_mismatch',
         format('SKU "%s" is already a variant of another parent in the database', v.sku)
    FROM t_var v
    JOIN products p  ON p.sku = v.sku AND p.deleted_at IS NULL
    JOIN products pp ON pp.id = p.parent_product_id
   WHERE pp.sku <> v.parent_sku;

  -- V11/V12 — units
  INSERT INTO t_err SELECT 'Units', row_num, product_sku, 'missing_required',
         'product_sku, code and factor_to_base are required'
    FROM t_unit WHERE product_sku IS NULL OR code IS NULL OR factor_to_base IS NULL;
  INSERT INTO t_err SELECT 'Units', row_num, product_sku, 'invalid_factor', 'factor_to_base must be > 0'
    FROM t_unit WHERE factor_to_base IS NOT NULL AND factor_to_base <= 0;
  INSERT INTO t_err SELECT 'Units', row_num, product_sku, 'invalid_tags',
         'tags must be a subset of {purchase,recipe,sales}'
    FROM t_unit WHERE NOT (tags <@ ARRAY['purchase','recipe','sales']);
  INSERT INTO t_err
  SELECT 'Units', u.row_num, u.product_sku, 'unknown_product',
         format('product_sku "%s" not found in file or database', u.product_sku)
    FROM t_unit u
   WHERE u.product_sku IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = u.product_sku)
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = u.product_sku AND p.deleted_at IS NULL);
  INSERT INTO t_err
  SELECT 'Units', MIN(row_num), product_sku, 'duplicate_unit_code',
         format('unit code "%s" declared twice for product "%s"', code, product_sku)
    FROM t_unit WHERE product_sku IS NOT NULL AND code IS NOT NULL
   GROUP BY product_sku, code HAVING COUNT(*) > 1;
  INSERT INTO t_err
  SELECT 'Units', u.row_num, u.product_sku, 'code_is_base_unit',
         format('unit code "%s" equals the base unit of product "%s"', u.code, u.product_sku)
    FROM t_unit u
    JOIN t_item i ON i.sku = u.product_sku
   WHERE u.code = i.eff_unit;
  INSERT INTO t_err
  SELECT 'Units', u.row_num, u.product_sku, 'code_is_base_unit',
         format('unit code "%s" equals the base unit of product "%s"', u.code, u.product_sku)
    FROM t_unit u
    JOIN products p ON p.sku = u.product_sku AND p.deleted_at IS NULL
   WHERE u.code = p.unit
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = u.product_sku);

  -- V13 — contextes du fichier : base unit ou code effectif
  INSERT INTO t_err
  SELECT i.sheet, i.row_num, i.sku, 'invalid_context_unit',
         format('context %s = "%s" is neither the base unit nor a declared alternative', ctx.k, ctx.v)
    FROM t_item i,
         LATERAL (VALUES ('purchase_unit', i.purchase_unit),
                         ('recipe_unit',   i.recipe_unit),
                         ('opname_unit',   i.opname_unit),
                         ('sales_unit',    i.sales_unit)) AS ctx(k, v)
   WHERE ctx.v IS NOT NULL
     AND ctx.v <> i.eff_unit
     AND NOT EXISTS (SELECT 1 FROM t_eff_codes e WHERE e.sku = i.sku AND e.code = ctx.v);

  -- V14 — contextes DB existants orphelins après REPLACE des units
  INSERT INTO t_err
  SELECT 'Units', MIN(u.row_num), p.sku, 'context_orphaned_by_units_replace',
         format('existing context %s = "%s" on product "%s" would no longer reference a declared unit', ctx.k, ctx.v, p.sku)
    FROM (SELECT DISTINCT product_sku FROM t_unit WHERE product_sku IS NOT NULL) fu
    JOIN products p ON p.sku = fu.product_sku AND p.deleted_at IS NULL
    JOIN product_unit_contexts c ON c.product_id = p.id
    JOIN t_unit u ON u.product_sku = fu.product_sku,
         LATERAL (VALUES ('stock_opname_unit', c.stock_opname_unit),
                         ('recipe_unit',       c.recipe_unit),
                         ('purchase_unit',     c.purchase_unit),
                         ('sales_unit',        c.sales_unit)) AS ctx(k, v)
   WHERE ctx.v IS NOT NULL
     AND ctx.v <> p.unit
     AND NOT EXISTS (SELECT 1 FROM t_eff_codes e WHERE e.sku = p.sku AND e.code = ctx.v)
     AND NOT EXISTS (
       SELECT 1 FROM t_item i WHERE i.sku = p.sku
          AND CASE ctx.k
                WHEN 'stock_opname_unit' THEN i.opname_unit
                WHEN 'recipe_unit'       THEN i.recipe_unit
                WHEN 'purchase_unit'     THEN i.purchase_unit
                WHEN 'sales_unit'        THEN i.sales_unit
              END IS NOT NULL)
   GROUP BY p.sku, ctx.k, ctx.v;

  -- V15/V16 — recettes : requis, qty, self-ref, doublons, résolution
  INSERT INTO t_err SELECT 'Recipes', row_num, product_sku, 'missing_required',
         'product_sku, material_sku and quantity are required'
    FROM t_rec WHERE product_sku IS NULL OR material_sku IS NULL OR quantity IS NULL;
  INSERT INTO t_err SELECT 'Recipes', row_num, product_sku, 'invalid_quantity', 'quantity must be > 0'
    FROM t_rec WHERE quantity IS NOT NULL AND quantity <= 0;
  INSERT INTO t_err SELECT 'Recipes', row_num, product_sku, 'self_reference',
         'a product cannot be its own material'
    FROM t_rec WHERE product_sku = material_sku;
  INSERT INTO t_err
  SELECT 'Recipes', MIN(row_num), product_sku, 'duplicate_recipe_line',
         format('material "%s" appears twice for product "%s"', material_sku, product_sku)
    FROM t_rec WHERE product_sku IS NOT NULL AND material_sku IS NOT NULL
   GROUP BY product_sku, material_sku HAVING COUNT(*) > 1;
  INSERT INTO t_err
  SELECT 'Recipes', r2.row_num, r2.product_sku, 'unknown_product',
         format('product_sku "%s" not found in file or database', r2.product_sku)
    FROM t_rec r2
   WHERE r2.product_sku IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = r2.product_sku)
     AND NOT EXISTS (SELECT 1 FROM t_var v WHERE v.sku = r2.product_sku)
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = r2.product_sku AND p.deleted_at IS NULL);
  INSERT INTO t_err
  SELECT 'Recipes', r2.row_num, r2.product_sku, 'unknown_material',
         format('material_sku "%s" not found in file or database', r2.material_sku)
    FROM t_rec r2
   WHERE r2.material_sku IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = r2.material_sku)
     AND NOT EXISTS (SELECT 1 FROM t_var v WHERE v.sku = r2.material_sku)
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = r2.material_sku AND p.deleted_at IS NULL);

  -- V17 — convertibilité d'unité (base, alternative effective, ou conversion globale)
  FOR r IN
    SELECT DISTINCT rr.unit AS from_unit,
           COALESCE(i.eff_unit, p.unit) AS to_unit,
           rr.material_sku
      FROM t_rec rr
      LEFT JOIN t_item i ON i.sku = rr.material_sku
      LEFT JOIN products p ON p.sku = rr.material_sku AND p.deleted_at IS NULL
     WHERE rr.unit IS NOT NULL
       AND COALESCE(i.eff_unit, p.unit) IS NOT NULL
       AND rr.unit <> COALESCE(i.eff_unit, p.unit)
       AND NOT EXISTS (SELECT 1 FROM t_eff_codes e
                        WHERE e.sku = rr.material_sku AND e.code = rr.unit)
  LOOP
    BEGIN
      v_probe := convert_quantity(1, r.from_unit, r.to_unit);
      IF v_probe IS NULL THEN
        RAISE EXCEPTION 'no_conversion';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO t_err
      SELECT 'Recipes', rr.row_num, rr.product_sku, 'unit_not_convertible',
             format('unit "%s" cannot be converted to material base unit "%s"', r.from_unit, r.to_unit)
        FROM t_rec rr
       WHERE rr.material_sku = r.material_sku AND rr.unit = r.from_unit;
    END;
  END LOOP;

  -- V18 — cycles + profondeur > 5 au niveau SKU sur le graphe effectif
  WITH RECURSIVE eff_edges AS (
    SELECT rr.product_sku, rr.material_sku
      FROM t_rec rr
     WHERE rr.product_sku IS NOT NULL AND rr.material_sku IS NOT NULL
    UNION ALL
    SELECT p.sku, m.sku
      FROM recipes rec
      JOIN products p ON p.id = rec.product_id AND p.deleted_at IS NULL
      JOIN products m ON m.id = rec.material_id AND m.deleted_at IS NULL
     WHERE rec.is_active = TRUE AND rec.deleted_at IS NULL
       AND p.sku NOT IN (SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL)
  ),
  walk(start_sku, cur_sku, depth, path) AS (
    SELECT e.product_sku, e.material_sku, 1, ARRAY[e.product_sku, e.material_sku]
      FROM eff_edges e
     WHERE e.product_sku IN (SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL)
    UNION ALL
    SELECT w.start_sku, e.material_sku, w.depth + 1, w.path || e.material_sku
      FROM walk w
      JOIN eff_edges e ON e.product_sku = w.cur_sku
     WHERE w.depth < 7
       AND NOT (e.material_sku = ANY(w.path))
  ),
  cycles AS (
    SELECT DISTINCT w.start_sku
      FROM walk w
      JOIN eff_edges e ON e.product_sku = w.cur_sku
     WHERE e.material_sku = w.start_sku
  ),
  too_deep AS (
    SELECT DISTINCT start_sku FROM walk WHERE depth > 5
  )
  INSERT INTO t_err
  SELECT 'Recipes', MIN(rr.row_num), c.start_sku, 'recipe_cycle',
         format('recipe of "%s" creates a cycle in the BOM graph', c.start_sku)
    FROM cycles c JOIN t_rec rr ON rr.product_sku = c.start_sku
   GROUP BY c.start_sku;

  WITH RECURSIVE eff_edges AS (
    SELECT rr.product_sku, rr.material_sku
      FROM t_rec rr
     WHERE rr.product_sku IS NOT NULL AND rr.material_sku IS NOT NULL
    UNION ALL
    SELECT p.sku, m.sku
      FROM recipes rec
      JOIN products p ON p.id = rec.product_id AND p.deleted_at IS NULL
      JOIN products m ON m.id = rec.material_id AND m.deleted_at IS NULL
     WHERE rec.is_active = TRUE AND rec.deleted_at IS NULL
       AND p.sku NOT IN (SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL)
  ),
  walk(start_sku, cur_sku, depth, path) AS (
    SELECT e.product_sku, e.material_sku, 1, ARRAY[e.product_sku, e.material_sku]
      FROM eff_edges e
     WHERE e.product_sku IN (SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL)
    UNION ALL
    SELECT w.start_sku, e.material_sku, w.depth + 1, w.path || e.material_sku
      FROM walk w
      JOIN eff_edges e ON e.product_sku = w.cur_sku
     WHERE w.depth < 7
       AND NOT (e.material_sku = ANY(w.path))
  )
  INSERT INTO t_err
  SELECT 'Recipes', MIN(rr.row_num), w.start_sku, 'recipe_depth_exceeded',
         format('recipe of "%s" exceeds the maximum BOM depth of 5', w.start_sku)
    FROM walk w JOIN t_rec rr ON rr.product_sku = w.start_sku
   WHERE w.depth > 5
     AND NOT EXISTS (SELECT 1 FROM t_err e WHERE e.code = 'recipe_cycle' AND e.sku = w.start_sku)
   GROUP BY w.start_sku;

  -- ════════════════════════ SUMMARY + RAPPORT ════════════════════════
  SELECT jsonb_build_object(
    'categories', jsonb_build_object(
      'create', (SELECT COUNT(*) FROM t_cat c WHERE c.name IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.name = c.name AND x.deleted_at IS NULL)),
      'update', (SELECT COUNT(*) FROM t_cat c WHERE c.name IS NOT NULL
                   AND EXISTS (SELECT 1 FROM categories x WHERE x.name = c.name AND x.deleted_at IS NULL))),
    'ingredients', jsonb_build_object(
      'create', (SELECT COUNT(*) FROM t_item i WHERE i.kind = 'ingredient' AND i.sku IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL)),
      'update', (SELECT COUNT(*) FROM t_item i WHERE i.kind = 'ingredient'
                   AND EXISTS (SELECT 1 FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL))),
    'products', jsonb_build_object(
      'create', (SELECT COUNT(*) FROM t_item i WHERE i.kind = 'product' AND i.sku IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL)),
      'update', (SELECT COUNT(*) FROM t_item i WHERE i.kind = 'product'
                   AND EXISTS (SELECT 1 FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL))),
    'units', jsonb_build_object(
      'replace_products', (SELECT COUNT(DISTINCT product_sku) FROM t_unit WHERE product_sku IS NOT NULL)),
    'variants', jsonb_build_object(
      'create', (SELECT COUNT(*) FROM t_var v WHERE v.sku IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = v.sku AND p.deleted_at IS NULL)),
      'update', (SELECT COUNT(*) FROM t_var v
                   AND EXISTS (SELECT 1 FROM products p WHERE p.sku = v.sku AND p.deleted_at IS NULL))),
    'recipes', jsonb_build_object(
      'products_replaced', (SELECT COUNT(DISTINCT product_sku) FROM t_rec WHERE product_sku IS NOT NULL))
  ) INTO v_summary;

  SELECT COUNT(*),
         COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message)
           ORDER BY sheet, row_num), '[]'::jsonb)
    INTO v_err_count, v_errors
    FROM t_err;

  v_report := jsonb_build_object(
    'valid',             v_err_count = 0,
    'errors',            v_errors,
    'summary',           v_summary,
    'idempotent_replay', false
  );

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  -- ════════════════════════ ÉCRITURES (atomiques) ════════════════════════
  -- W1 — catégorie auto « Ingredients » si nécessaire
  IF EXISTS (SELECT 1 FROM t_item WHERE kind = 'ingredient' AND category IS NULL)
     AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Ingredients' AND deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM t_cat WHERE name = 'Ingredients') THEN
    v_slug_base := 'ingredients'; v_slug := v_slug_base; v_i := 1;
    WHILE EXISTS (SELECT 1 FROM categories WHERE slug = v_slug) LOOP
      v_i := v_i + 1; v_slug := v_slug_base || '-' || v_i;
    END LOOP;
    INSERT INTO categories (name, slug, sort_order, is_active, dispatch_station)
    VALUES ('Ingredients', v_slug,
            (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories), TRUE, 'none');
  END IF;

  -- W2 — catégories : upsert par nom
  FOR r IN SELECT * FROM t_cat WHERE name IS NOT NULL ORDER BY row_num LOOP
    SELECT id INTO v_cat_id FROM categories WHERE name = r.name AND deleted_at IS NULL LIMIT 1;
    IF v_cat_id IS NOT NULL THEN
      UPDATE categories
         SET dispatch_station = r.dispatch_station,
             sort_order = COALESCE(r.sort_order, sort_order),
             is_active = TRUE
       WHERE id = v_cat_id;
    ELSE
      v_slug_base := trim(BOTH '-' FROM regexp_replace(lower(trim(r.name)), '[^a-z0-9]+', '-', 'g'));
      IF v_slug_base = '' THEN v_slug_base := 'category'; END IF;
      v_slug := v_slug_base; v_i := 1;
      WHILE EXISTS (SELECT 1 FROM categories WHERE slug = v_slug) LOOP
        v_i := v_i + 1; v_slug := v_slug_base || '-' || v_i;
      END LOOP;
      INSERT INTO categories (name, slug, sort_order, is_active, dispatch_station)
      VALUES (r.name, v_slug,
              COALESCE(r.sort_order, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories)),
              TRUE, r.dispatch_station);
    END IF;
  END LOOP;

  -- W3 — ingredients + products : upsert par SKU
  FOR r IN SELECT * FROM t_item ORDER BY row_num LOOP
    SELECT id INTO v_cat_id FROM categories
     WHERE name = COALESCE(r.category, 'Ingredients') AND deleted_at IS NULL LIMIT 1;

    SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NULL LIMIT 1;
    IF v_pid IS NULL THEN
      INSERT INTO products (
        sku, name, category_id, unit,
        retail_price, wholesale_price, cost_price,
        description, image_url,
        visible_on_pos, available_for_sale, track_inventory, deduct_stock,
        is_active, is_favorite,
        min_stock_threshold, default_shelf_life_hours
      ) VALUES (
        r.sku, r.name, v_cat_id, r.eff_unit,
        COALESCE(r.retail_price, 0), r.wholesale_price, COALESCE(r.cost_price, 0),
        r.description, r.image_url,
        CASE WHEN r.kind = 'ingredient' THEN FALSE ELSE COALESCE(r.visible_on_pos, TRUE) END,
        CASE WHEN r.kind = 'ingredient' THEN FALSE ELSE TRUE END,
        TRUE, TRUE,
        TRUE, COALESCE(r.is_favorite, FALSE),
        r.min_stock_threshold, r.shelf_life_hours
      ) RETURNING id INTO v_pid;

      INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
      VALUES (v_pid, r.eff_unit, r.eff_unit, r.eff_unit, r.eff_unit)
      ON CONFLICT (product_id) DO NOTHING;
    ELSE
      UPDATE products SET
        name                     = r.name,
        category_id              = COALESCE(v_cat_id, category_id),
        retail_price             = COALESCE(r.retail_price, retail_price),
        wholesale_price          = COALESCE(r.wholesale_price, wholesale_price),
        cost_price               = COALESCE(r.cost_price, cost_price),
        description              = COALESCE(r.description, description),
        image_url                = COALESCE(r.image_url, image_url),
        visible_on_pos           = CASE WHEN r.kind = 'ingredient' THEN visible_on_pos
                                        ELSE COALESCE(r.visible_on_pos, visible_on_pos) END,
        is_favorite              = COALESCE(r.is_favorite, is_favorite),
        min_stock_threshold      = COALESCE(r.min_stock_threshold, min_stock_threshold),
        default_shelf_life_hours = COALESCE(r.shelf_life_hours, default_shelf_life_hours),
        is_active                = TRUE,
        updated_at               = now()
      WHERE id = v_pid;
    END IF;
  END LOOP;

  -- W4 — variantes : upsert par SKU (clone-from-parent à la création)
  FOR r IN SELECT * FROM t_var ORDER BY row_num LOOP
    SELECT p.id, p.name, p.category_id, p.unit, p.retail_price, p.image_url
      INTO v_parent
      FROM products p WHERE p.sku = r.parent_sku AND p.deleted_at IS NULL LIMIT 1;

    SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NULL LIMIT 1;
    IF v_pid IS NULL THEN
      INSERT INTO products (
        sku, name, category_id, unit,
        retail_price, cost_price, image_url,
        visible_on_pos, available_for_sale, track_inventory, deduct_stock, is_active,
        parent_product_id, variant_label, variant_axis, variant_sort_order
      ) VALUES (
        r.sku,
        v_parent.name || ' — ' || r.variant_label,
        v_parent.category_id, v_parent.unit,
        COALESCE(r.retail_price, v_parent.retail_price), 0,
        COALESCE(r.image_url, v_parent.image_url),
        TRUE, TRUE, TRUE, TRUE, TRUE,
        v_parent.id, r.variant_label, r.variant_axis::variant_axis_type, r.sort_order
      ) RETURNING id INTO v_pid;

      INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
      VALUES (v_pid, v_parent.unit, v_parent.unit, v_parent.unit, v_parent.unit)
      ON CONFLICT (product_id) DO NOTHING;
    ELSE
      UPDATE products SET
        variant_label      = r.variant_label,
        variant_axis       = r.variant_axis::variant_axis_type,
        variant_sort_order = r.sort_order,
        retail_price       = COALESCE(r.retail_price, retail_price),
        image_url          = COALESCE(r.image_url, image_url),
        is_active          = TRUE,
        updated_at         = now()
      WHERE id = v_pid;
    END IF;
  END LOOP;

  -- W5 — units : REPLACE par produit (miroir set_product_units_v1)
  FOR r IN SELECT DISTINCT product_sku FROM t_unit WHERE product_sku IS NOT NULL LOOP
    SELECT id INTO v_pid FROM products WHERE sku = r.product_sku AND deleted_at IS NULL LIMIT 1;

    UPDATE product_unit_alternatives
       SET deleted_at = now(), updated_at = now()
     WHERE product_id = v_pid AND deleted_at IS NULL
       AND code NOT IN (SELECT code FROM t_unit WHERE product_sku = r.product_sku);

    INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, tags, display_order)
    SELECT v_pid, u.code, u.factor_to_base, u.tags, u.display_order
      FROM t_unit u WHERE u.product_sku = r.product_sku
    ON CONFLICT (product_id, code) WHERE deleted_at IS NULL
    DO UPDATE SET factor_to_base = EXCLUDED.factor_to_base,
                  tags           = EXCLUDED.tags,
                  display_order  = EXCLUDED.display_order,
                  updated_at     = now();
  END LOOP;

  -- W6 — contextes depuis les colonnes du fichier
  FOR r IN SELECT * FROM t_item
            WHERE purchase_unit IS NOT NULL OR recipe_unit IS NOT NULL
               OR opname_unit IS NOT NULL OR sales_unit IS NOT NULL LOOP
    SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NULL LIMIT 1;
    INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
    VALUES (v_pid,
            COALESCE(r.opname_unit, r.eff_unit),
            COALESCE(r.recipe_unit, r.eff_unit),
            COALESCE(r.purchase_unit, r.eff_unit),
            COALESCE(r.sales_unit, r.eff_unit))
    ON CONFLICT (product_id) DO UPDATE SET
      stock_opname_unit = COALESCE(r.opname_unit,   product_unit_contexts.stock_opname_unit),
      recipe_unit       = COALESCE(r.recipe_unit,   product_unit_contexts.recipe_unit),
      purchase_unit     = COALESCE(r.purchase_unit, product_unit_contexts.purchase_unit),
      sales_unit        = COALESCE(r.sales_unit,    product_unit_contexts.sales_unit),
      updated_at        = now();
  END LOOP;

  -- W7 — recettes : remplacement complet de BOM par produit
  FOR r IN SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL LOOP
    SELECT id INTO v_pid FROM products WHERE sku = r.product_sku AND deleted_at IS NULL LIMIT 1;

    UPDATE recipes SET is_active = FALSE, deleted_at = now(), updated_at = now()
     WHERE product_id = v_pid AND is_active = TRUE AND deleted_at IS NULL;

    INSERT INTO recipes (product_id, material_id, quantity, unit, notes, is_active)
    SELECT v_pid, m.id, rr.quantity, COALESCE(rr.unit, m.unit), rr.notes, TRUE
      FROM t_rec rr
      JOIN products m ON m.sku = rr.material_sku AND m.deleted_at IS NULL
     WHERE rr.product_sku = r.product_sku;
  END LOOP;

  -- W8 — audit + idempotency key (race: unique_violation → replay)
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller, 'catalog.imported', 'catalog', NULL, v_summary);

  BEGIN
    INSERT INTO catalog_import_idempotency_keys (key, report, created_by)
    VALUES (p_idempotency_key, v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM catalog_import_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.import_catalog_v1(JSONB, BOOLEAN, UUID) IS
  'S41 — bulk catalog import (6 sheets), dry-run validation report + atomic upsert-by-SKU commit. Gate catalog.import. Idempotency S25 flavor 2.';

REVOKE ALL ON FUNCTION public.import_catalog_v1(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_catalog_v1(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_catalog_v1(JSONB, BOOLEAN, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

  ⚠️ **Bug connu à corriger en recopiant** : dans le bloc SUMMARY ci-dessus, la branche `variants.update` contient une faute de frappe (`FROM t_var v AND EXISTS …`) — écrire `FROM t_var v WHERE v.sku IS NOT NULL AND EXISTS (SELECT 1 FROM products p WHERE p.sku = v.sku AND p.deleted_at IS NULL)`.

- [ ] **Step 2.2 :** Appliquer via MCP `apply_migration` (name `create_import_catalog_v1_rpc`). Si erreur de syntaxe, corriger le fichier ET ré-appliquer (le fichier local doit toujours refléter le cloud).
- [ ] **Step 2.3 :** Smoke rapide via `execute_sql` : `SELECT import_catalog_v1('{}'::jsonb, true);` → doit lever 42501 (pas d'auth.uid() en service role… si l'outil MCP exécute en postgres, attendu `permission denied: catalog.import required`). C'est le comportement voulu.
- [ ] **Step 2.4 :** Commit : `feat(db): session 41 — task 2 — import_catalog_v1 RPC`.

### Task 3 : Migration `_012` — RPC `export_catalog_v1`

**Files:**
- Create: `supabase/migrations/20260625000012_create_export_catalog_v1_rpc.sql`

- [ ] **Step 3.1 :** Écrire le fichier :

```sql
-- 20260625000012_create_export_catalog_v1_rpc.sql
-- S41 — full catalog export in the exact import payload shape (round-trip).
-- Ingredients heuristic: visible_on_pos = FALSE AND available_for_sale = FALSE.
-- Gate catalog.export (export contains cost_price).

CREATE OR REPLACE FUNCTION public.export_catalog_v1()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'catalog.export') THEN
    RAISE EXCEPTION 'permission denied: catalog.export required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'categories', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', c.name,
               'dispatch_station', c.dispatch_station,
               'sort_order', c.sort_order
             ) ORDER BY c.sort_order, c.name), '[]'::jsonb)
        FROM categories c
       WHERE c.is_active = TRUE AND c.deleted_at IS NULL
    ),
    'ingredients', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'sku', p.sku, 'name', p.name, 'unit', p.unit,
               'cost_price', p.cost_price,
               'category', c.name,
               'min_stock_threshold', p.min_stock_threshold,
               'shelf_life_hours', p.default_shelf_life_hours,
               'purchase_unit', ctx.purchase_unit,
               'recipe_unit',   ctx.recipe_unit,
               'opname_unit',   ctx.stock_opname_unit,
               'sales_unit',    ctx.sales_unit
             ) ORDER BY p.sku), '[]'::jsonb)
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_unit_contexts ctx ON ctx.product_id = p.id
       WHERE p.deleted_at IS NULL AND p.is_active = TRUE
         AND p.parent_product_id IS NULL
         AND p.visible_on_pos = FALSE AND p.available_for_sale = FALSE
    ),
    'products', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'sku', p.sku, 'name', p.name,
               'category', c.name, 'unit', p.unit,
               'retail_price', p.retail_price,
               'wholesale_price', p.wholesale_price,
               'description', p.description,
               'image_url', p.image_url,
               'visible_on_pos', p.visible_on_pos,
               'is_favorite', p.is_favorite,
               'shelf_life_hours', p.default_shelf_life_hours,
               'purchase_unit', ctx.purchase_unit,
               'recipe_unit',   ctx.recipe_unit,
               'opname_unit',   ctx.stock_opname_unit,
               'sales_unit',    ctx.sales_unit
             ) ORDER BY p.sku), '[]'::jsonb)
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_unit_contexts ctx ON ctx.product_id = p.id
       WHERE p.deleted_at IS NULL AND p.is_active = TRUE
         AND p.parent_product_id IS NULL
         AND NOT (p.visible_on_pos = FALSE AND p.available_for_sale = FALSE)
    ),
    'units', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'product_sku', p.sku, 'code', a.code,
               'factor_to_base', a.factor_to_base,
               'tags', to_jsonb(a.tags)
             ) ORDER BY p.sku, a.display_order), '[]'::jsonb)
        FROM product_unit_alternatives a
        JOIN products p ON p.id = a.product_id AND p.deleted_at IS NULL AND p.is_active = TRUE
       WHERE a.deleted_at IS NULL
    ),
    'variants', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'parent_sku', pp.sku,
               'variant_axis', p.variant_axis,
               'variant_label', p.variant_label,
               'sku', p.sku,
               'retail_price', p.retail_price,
               'image_url', p.image_url
             ) ORDER BY pp.sku, p.variant_sort_order), '[]'::jsonb)
        FROM products p
        JOIN products pp ON pp.id = p.parent_product_id
       WHERE p.deleted_at IS NULL AND p.is_active = TRUE
    ),
    'recipes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'product_sku', p.sku, 'material_sku', m.sku,
               'quantity', r.quantity, 'unit', r.unit, 'notes', r.notes
             ) ORDER BY p.sku, m.sku), '[]'::jsonb)
        FROM recipes r
        JOIN products p ON p.id = r.product_id AND p.deleted_at IS NULL
        JOIN products m ON m.id = r.material_id AND m.deleted_at IS NULL
       WHERE r.is_active = TRUE AND r.deleted_at IS NULL
    )
  );
END;
$$;

COMMENT ON FUNCTION public.export_catalog_v1() IS
  'S41 — full catalog export in the import_catalog_v1 payload shape (round-trip). Gate catalog.export.';

REVOKE ALL ON FUNCTION public.export_catalog_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_catalog_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.export_catalog_v1() TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 3.2 :** Appliquer via MCP `apply_migration` (name `create_export_catalog_v1_rpc`).
- [ ] **Step 3.3 :** Commit : `feat(db): session 41 — task 3 — export_catalog_v1 RPC`.

### Task 4 : Migration `_013` — seed permissions `catalog.import` + `catalog.export`

**Files:**
- Create: `supabase/migrations/20260625000013_seed_catalog_import_export_perms.sql`

- [ ] **Step 4.1 :** Écrire le fichier (pattern `20260524005926_seed_perm_products_variants.sql`) :

```sql
-- 20260625000013_seed_catalog_import_export_perms.sql
-- S41 — seed catalog.import + catalog.export, granted to MANAGER/ADMIN/SUPER_ADMIN.

INSERT INTO permissions (code, module, action, description) VALUES
  ('catalog.import', 'products', 'create',
   'Bulk import the catalog (products, recipes, variants, units) from the BO Import/Export tab'),
  ('catalog.export', 'products', 'read',
   'Export the full catalog (includes cost prices) in the import template shape')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, p.perm
  FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
 CROSS JOIN (VALUES ('catalog.import'), ('catalog.export')) AS p(perm)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 4.2 :** Appliquer via MCP `apply_migration` (name `seed_catalog_import_export_perms`).
- [ ] **Step 4.3 :** Vérifier : `execute_sql` → `SELECT role_code FROM role_permissions WHERE permission_code = 'catalog.import' ORDER BY 1;` Attendu : ADMIN, MANAGER, SUPER_ADMIN.
- [ ] **Step 4.4 :** Commit : `feat(db): session 41 — task 4 — seed catalog.import/export permissions`.

### Task 5 : pgTAP `catalog_import.test.sql` (≈15 cas)

**Files:**
- Create: `supabase/tests/catalog_import.test.sql`

- [ ] **Step 5.1 :** Écrire la suite. Modèle d'impersonation : `supabase/tests/s40_reports.test.sql` (`SET LOCAL "request.jwt.claims" = '{"sub":"<auth-uid>"}'`, GUC-flags entre DO blocks — DEV-S25-2.A-03). Users seed : MANAGER `00000000-0000-0000-0000-000000000004`, CASHIER `00000000-0000-0000-0000-000000000002`. Squelette complet :

```sql
-- supabase/tests/catalog_import.test.sql
-- S41 — pgTAP suite for import_catalog_v1 / export_catalog_v1 (T1-T15).
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK — self-cleaning.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

-- T1 : CASHIER → 42501 on import
DO $$ BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM import_catalog_v1('{}'::jsonb, true);
    PERFORM set_config('breakery.t1', 'no_error', true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('breakery.t1', '42501', true);
  END;
END $$;
SELECT is(current_setting('breakery.t1'), '42501', 'T1 import CASHIER rejected 42501');

-- Fixtures payload (happy path) stored in a GUC for reuse
DO $$ BEGIN
  PERFORM set_config('breakery.payload', '{
    "categories": [{"name": "S41 Test Cat", "dispatch_station": "bakery"}],
    "ingredients": [
      {"sku": "S41-FLOUR", "name": "S41 Flour", "unit": "kg", "cost_price": 12000},
      {"sku": "S41-BUTTER", "name": "S41 Butter", "unit": "kg", "cost_price": 95000}
    ],
    "products": [
      {"sku": "S41-CROIS", "name": "S41 Croissant", "category": "S41 Test Cat", "unit": "pcs", "retail_price": 25000},
      {"sku": "S41-DOUGH", "name": "S41 Dough", "category": "S41 Test Cat", "unit": "kg", "retail_price": 0, "visible_on_pos": false}
    ],
    "units": [
      {"product_sku": "S41-FLOUR", "code": "g", "factor_to_base": 0.001, "tags": ["recipe"]}
    ],
    "variants": [
      {"parent_sku": "S41-CROIS", "variant_axis": "flavor", "variant_label": "Almond", "sku": "S41-CROIS-ALM", "retail_price": 28000}
    ],
    "recipes": [
      {"product_sku": "S41-DOUGH", "material_sku": "S41-FLOUR", "quantity": 500, "unit": "g"},
      {"product_sku": "S41-DOUGH", "material_sku": "S41-BUTTER", "quantity": 0.25, "unit": "kg"},
      {"product_sku": "S41-CROIS", "material_sku": "S41-DOUGH", "quantity": 0.08, "unit": "kg"}
    ]
  }', true);
END $$;

-- T2 : MANAGER dry-run → valid=true + zéro écriture
DO $$
DECLARE v_before INT; v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT COUNT(*) INTO v_before FROM products;
  v_rep := import_catalog_v1(current_setting('breakery.payload')::jsonb, true);
  PERFORM set_config('breakery.t2_valid', (v_rep->>'valid'), true);
  PERFORM set_config('breakery.t2_create', (v_rep->'summary'->'products'->>'create'), true);
  PERFORM set_config('breakery.t2_delta',
    ((SELECT COUNT(*) FROM products) - v_before)::text, true);
END $$;
SELECT is(current_setting('breakery.t2_valid'), 'true', 'T2 dry-run valid');
SELECT is(current_setting('breakery.t2_delta'), '0', 'T2 dry-run writes nothing');

-- T3 : commit → produits créés avec bons flags
DO $$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(current_setting('breakery.payload')::jsonb, false,
                             'aaaaaaaa-0000-0000-0000-000000000001');
  PERFORM set_config('breakery.t3_valid', (v_rep->>'valid'), true);
END $$;
SELECT is(current_setting('breakery.t3_valid'), 'true', 'T3 commit valid');
SELECT is(
  (SELECT visible_on_pos FROM products WHERE sku = 'S41-FLOUR'), FALSE,
  'T4 ingredient hidden from POS');
SELECT is(
  (SELECT pp.sku FROM products v JOIN products pp ON pp.id = v.parent_product_id
    WHERE v.sku = 'S41-CROIS-ALM'), 'S41-CROIS',
  'T5 variant linked to parent');
SELECT is(
  (SELECT COUNT(*)::INT FROM product_unit_alternatives a
     JOIN products p ON p.id = a.product_id
    WHERE p.sku = 'S41-FLOUR' AND a.deleted_at IS NULL), 1,
  'T6 unit alternative created');
SELECT is(
  (SELECT COUNT(*)::INT FROM recipes r JOIN products p ON p.id = r.product_id
    WHERE p.sku = 'S41-DOUGH' AND r.is_active AND r.deleted_at IS NULL), 2,
  'T7 BOM created (2 lines)');

-- T8 : replay même clé → idempotent_replay
DO $$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(current_setting('breakery.payload')::jsonb, false,
                             'aaaaaaaa-0000-0000-0000-000000000001');
  PERFORM set_config('breakery.t8', (v_rep->>'idempotent_replay'), true);
END $$;
SELECT is(current_setting('breakery.t8'), 'true', 'T8 idempotent replay');

-- T9 : ré-import upsert — prix modifié + BOM remplacée
DO $$
DECLARE v_payload JSONB; v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_payload := jsonb_build_object(
    'products', jsonb_build_array(jsonb_build_object(
      'sku', 'S41-CROIS', 'name', 'S41 Croissant', 'category', 'S41 Test Cat',
      'unit', 'pcs', 'retail_price', 27000)),
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-DOUGH', 'material_sku', 'S41-FLOUR', 'quantity', 600, 'unit', 'g'))
  );
  v_rep := import_catalog_v1(v_payload, false, 'aaaaaaaa-0000-0000-0000-000000000002');
  PERFORM set_config('breakery.t9', (v_rep->>'valid'), true);
END $$;
SELECT is((SELECT retail_price FROM products WHERE sku = 'S41-CROIS'), 27000::NUMERIC,
  'T9 upsert price updated');
SELECT is(
  (SELECT COUNT(*)::INT FROM recipes r JOIN products p ON p.id = r.product_id
    WHERE p.sku = 'S41-DOUGH' AND r.is_active AND r.deleted_at IS NULL), 1,
  'T10 BOM fully replaced (1 line)');

-- T11 : matériau inconnu → valid=false + code, zéro écriture
DO $$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-CROIS', 'material_sku', 'S41-GHOST', 'quantity', 1))),
    false, 'aaaaaaaa-0000-0000-0000-000000000003');
  PERFORM set_config('breakery.t11_valid', (v_rep->>'valid'), true);
  PERFORM set_config('breakery.t11_code', (v_rep->'errors'->0->>'code'), true);
END $$;
SELECT is(current_setting('breakery.t11_valid'), 'false', 'T11 unknown material invalid');
SELECT is(current_setting('breakery.t11_code'), 'unknown_material', 'T11 error code');

-- T12 : cycle → recipe_cycle (S41-DOUGH consomme S41-CROIS qui consomme S41-DOUGH)
DO $$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-DOUGH', 'material_sku', 'S41-CROIS', 'quantity', 1))),
    true);
  PERFORM set_config('breakery.t12',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'recipe_cycle'), true);
END $$;
SELECT is(current_setting('breakery.t12'), '1', 'T12 cycle detected');

-- T13 : commit sans clé → P0001
DO $$ BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM import_catalog_v1('{}'::jsonb, false, NULL);
    PERFORM set_config('breakery.t13', 'no_error', true);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM set_config('breakery.t13', 'P0001', true);
  END;
END $$;
SELECT is(current_setting('breakery.t13'), 'P0001', 'T13 missing idempotency key');

-- T14 : export CASHIER → 42501 ; T15 : export MANAGER shape + round-trip
DO $$ BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM export_catalog_v1();
    PERFORM set_config('breakery.t14', 'no_error', true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('breakery.t14', '42501', true);
  END;
END $$;
SELECT is(current_setting('breakery.t14'), '42501', 'T14 export CASHIER rejected');

DO $$
DECLARE v_exp JSONB; v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_exp := export_catalog_v1();
  -- round-trip : ré-importer l'export en dry-run doit être valide, 0 création
  v_rep := import_catalog_v1(v_exp, true);
  PERFORM set_config('breakery.t15',
    CASE WHEN (v_rep->>'valid')::boolean
              AND (v_rep->'summary'->'products'->>'create')::int = 0
              AND (v_rep->'summary'->'ingredients'->>'create')::int = 0
         THEN 'ok' ELSE 'ko: ' || v_rep::text END, true);
END $$;
SELECT is(current_setting('breakery.t15'), 'ok', 'T15 export → import dry-run round-trip');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 5.2 :** Exécuter via MCP `execute_sql` (le fichier entier, BEGIN/ROLLBACK inclus). Attendu : **15/15 PASS**.
- [ ] **Step 5.3 :** Si échec : diagnostiquer (skill superpowers:systematic-debugging), corriger via **migration corrective** `20260625000014_fix_…` (jamais éditer une migration appliquée), ré-exécuter jusqu'à 15/15.
- [ ] **Step 5.4 :** Commit : `test(db): session 41 — task 5 — pgTAP catalog_import 15/15`.

### Task 6 : Types regen + `PermissionCode`

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (regen complet)
- Modify: `packages/supabase/src/rls/permissions.ts` (union)

- [ ] **Step 6.1 :** MCP `generate_typescript_types` → écrire le résultat dans `packages/supabase/src/types.generated.ts`.
- [ ] **Step 6.2 :** Dans `packages/supabase/src/rls/permissions.ts`, ajouter au union `PermissionCode` (à côté du bloc products, garder le style commentaire) :

```ts
  // Session 41 — catalog import/export
  | 'catalog.import'
  | 'catalog.export'
```

- [ ] **Step 6.3 :** `pnpm --filter @breakery/supabase typecheck` → PASS.
- [ ] **Step 6.4 :** Commit : `feat(db): session 41 — task 6 — types regen + PermissionCode catalog.import/export`.

---

## Wave B — Backoffice (après Wave A)

### Task 7 : Dépendance `xlsx`

**Files:**
- Modify: `apps/backoffice/package.json`

- [ ] **Step 7.1 :** `pnpm --filter @breakery/app-backoffice add xlsx`.
- [ ] **Step 7.2 :** Commit : `feat(backoffice): session 41 — task 7 — add xlsx (SheetJS) dependency`.

### Task 8 : `templateDefinition.ts` + `buildTemplateWorkbook.ts` (TDD)

**Files:**
- Create: `apps/backoffice/src/features/catalog-import/templateDefinition.ts`
- Create: `apps/backoffice/src/features/catalog-import/buildTemplateWorkbook.ts`
- Test: `apps/backoffice/src/features/catalog-import/__tests__/template-definition.test.ts`

- [ ] **Step 8.1 :** Écrire le test (échoue : modules absents) :

```ts
// apps/backoffice/src/features/catalog-import/__tests__/template-definition.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { CATALOG_SHEETS } from '../templateDefinition.js';
import { buildTemplateWorkbook } from '../buildTemplateWorkbook.js';

describe('templateDefinition', () => {
  it('defines the 6 sheets in import order', () => {
    expect(CATALOG_SHEETS.map((s) => s.name)).toEqual([
      'Categories', 'Ingredients', 'Products', 'Units', 'Variants', 'Recipes',
    ]);
  });

  it('every sheet has its required key columns', () => {
    const req = (name: string) =>
      CATALOG_SHEETS.find((s) => s.name === name)!.columns.filter((c) => c.required).map((c) => c.key);
    expect(req('Categories')).toEqual(['name']);
    expect(req('Ingredients')).toEqual(['sku', 'name', 'unit', 'cost_price']);
    expect(req('Products')).toEqual(['sku', 'name', 'category', 'retail_price']);
    expect(req('Units')).toEqual(['product_sku', 'code', 'factor_to_base']);
    expect(req('Variants')).toEqual(['parent_sku', 'variant_axis', 'variant_label', 'sku']);
    expect(req('Recipes')).toEqual(['product_sku', 'material_sku', 'quantity']);
  });
});

describe('buildTemplateWorkbook', () => {
  it('produces a workbook with 6 sheets, headers + 1 example row each', () => {
    const wb = buildTemplateWorkbook();
    expect(wb.SheetNames).toEqual(CATALOG_SHEETS.map((s) => s.name));
    for (const def of CATALOG_SHEETS) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[def.name]!, { defval: null });
      expect(rows).toHaveLength(1); // example row
    }
  });
});
```

- [ ] **Step 8.2 :** Lancer : `pnpm --filter @breakery/app-backoffice test catalog-import` → FAIL (modules absents).
- [ ] **Step 8.3 :** Implémenter `templateDefinition.ts` :

```ts
// apps/backoffice/src/features/catalog-import/templateDefinition.ts
// S41 — single source of truth for the 6-sheet Excel template.
// Consumed by the parser, the empty-template generator AND the export generator.
// Column keys are the exact Excel headers and the exact JSONB payload keys.

export type SheetColumnType = 'text' | 'number' | 'boolean' | 'tags';

export interface SheetColumnDef {
  key: string;
  required: boolean;
  type: SheetColumnType;
}

export type PayloadKey =
  | 'categories' | 'ingredients' | 'products' | 'units' | 'variants' | 'recipes';

export interface SheetDef {
  name: string;          // exact Excel tab name
  payloadKey: PayloadKey;
  columns: readonly SheetColumnDef[];
  example: Record<string, string | number | boolean>;
}

const CONTEXT_COLS: readonly SheetColumnDef[] = [
  { key: 'purchase_unit', required: false, type: 'text' },
  { key: 'recipe_unit',   required: false, type: 'text' },
  { key: 'opname_unit',   required: false, type: 'text' },
  { key: 'sales_unit',    required: false, type: 'text' },
];

export const CATALOG_SHEETS: readonly SheetDef[] = [
  {
    name: 'Categories',
    payloadKey: 'categories',
    columns: [
      { key: 'name',             required: true,  type: 'text' },
      { key: 'dispatch_station', required: false, type: 'text' },
      { key: 'sort_order',       required: false, type: 'number' },
    ],
    example: { name: 'Viennoiserie', dispatch_station: 'bakery', sort_order: 10 },
  },
  {
    name: 'Ingredients',
    payloadKey: 'ingredients',
    columns: [
      { key: 'sku',                 required: true,  type: 'text' },
      { key: 'name',                required: true,  type: 'text' },
      { key: 'unit',                required: true,  type: 'text' },
      { key: 'cost_price',          required: true,  type: 'number' },
      { key: 'category',            required: false, type: 'text' },
      { key: 'min_stock_threshold', required: false, type: 'number' },
      { key: 'shelf_life_hours',    required: false, type: 'number' },
      ...CONTEXT_COLS,
    ],
    example: {
      sku: 'ING-FARINE-T55', name: 'Farine T55', unit: 'kg', cost_price: 12000,
      category: 'Ingredients', purchase_unit: 'kg', recipe_unit: 'g',
    },
  },
  {
    name: 'Products',
    payloadKey: 'products',
    columns: [
      { key: 'sku',              required: true,  type: 'text' },
      { key: 'name',             required: true,  type: 'text' },
      { key: 'category',         required: true,  type: 'text' },
      { key: 'unit',             required: false, type: 'text' },
      { key: 'retail_price',     required: true,  type: 'number' },
      { key: 'wholesale_price',  required: false, type: 'number' },
      { key: 'description',      required: false, type: 'text' },
      { key: 'image_url',        required: false, type: 'text' },
      { key: 'visible_on_pos',   required: false, type: 'boolean' },
      { key: 'is_favorite',      required: false, type: 'boolean' },
      { key: 'shelf_life_hours', required: false, type: 'number' },
      ...CONTEXT_COLS,
    ],
    example: {
      sku: 'PRD-CROISSANT', name: 'Croissant', category: 'Viennoiserie',
      unit: 'pcs', retail_price: 25000, visible_on_pos: true,
    },
  },
  {
    name: 'Units',
    payloadKey: 'units',
    columns: [
      { key: 'product_sku',    required: true,  type: 'text' },
      { key: 'code',           required: true,  type: 'text' },
      { key: 'factor_to_base', required: true,  type: 'number' },
      { key: 'tags',           required: false, type: 'tags' },
    ],
    example: { product_sku: 'ING-FARINE-T55', code: 'g', factor_to_base: 0.001, tags: 'recipe' },
  },
  {
    name: 'Variants',
    payloadKey: 'variants',
    columns: [
      { key: 'parent_sku',    required: true,  type: 'text' },
      { key: 'variant_axis',  required: true,  type: 'text' },
      { key: 'variant_label', required: true,  type: 'text' },
      { key: 'sku',           required: true,  type: 'text' },
      { key: 'retail_price',  required: false, type: 'number' },
      { key: 'image_url',     required: false, type: 'text' },
    ],
    example: {
      parent_sku: 'PRD-CROISSANT', variant_axis: 'flavor',
      variant_label: 'Amande', sku: 'PRD-CROISSANT-AMD', retail_price: 28000,
    },
  },
  {
    name: 'Recipes',
    payloadKey: 'recipes',
    columns: [
      { key: 'product_sku',  required: true,  type: 'text' },
      { key: 'material_sku', required: true,  type: 'text' },
      { key: 'quantity',     required: true,  type: 'number' },
      { key: 'unit',         required: false, type: 'text' },
      { key: 'notes',        required: false, type: 'text' },
    ],
    example: { product_sku: 'PRD-CROISSANT', material_sku: 'ING-FARINE-T55', quantity: 80, unit: 'g' },
  },
];
```

et `buildTemplateWorkbook.ts` :

```ts
// apps/backoffice/src/features/catalog-import/buildTemplateWorkbook.ts
// S41 — generates the empty template workbook (headers + 1 example row per sheet).

import * as XLSX from 'xlsx';
import { CATALOG_SHEETS } from './templateDefinition.js';

export function buildTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const def of CATALOG_SHEETS) {
    const headers = def.columns.map((c) => c.key);
    const example = headers.map((h) => def.example[h] ?? null);
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(wb, filename);
}
```

- [ ] **Step 8.4 :** Relancer le test → PASS.
- [ ] **Step 8.5 :** Commit : `feat(backoffice): session 41 — task 8 — template definition + workbook generator`.

### Task 9 : `parseCatalogWorkbook.ts` (TDD)

**Files:**
- Create: `apps/backoffice/src/features/catalog-import/parseCatalogWorkbook.ts`
- Test: `apps/backoffice/src/features/catalog-import/__tests__/parse-catalog-workbook.test.ts`

- [ ] **Step 9.1 :** Écrire le test (fixtures xlsx en mémoire) :

```ts
// apps/backoffice/src/features/catalog-import/__tests__/parse-catalog-workbook.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { CATALOG_SHEETS } from '../templateDefinition.js';
import { buildTemplateWorkbook } from '../buildTemplateWorkbook.js';
import { parseCatalogWorkbook } from '../parseCatalogWorkbook.js';

function wbToBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

function makeWb(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  // always create all 6 sheets with headers; override rows where provided
  for (const def of CATALOG_SHEETS) {
    const headers = def.columns.map((c) => c.key);
    const rows = sheets[def.name] ?? [];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }
  return wbToBuffer(wb);
}

describe('parseCatalogWorkbook', () => {
  it('round-trips the generated template without structure errors', () => {
    const { payload, errors } = parseCatalogWorkbook(wbToBuffer(buildTemplateWorkbook()));
    expect(errors).toEqual([]);
    expect(payload).not.toBeNull();
    expect(payload!.categories).toHaveLength(1); // example row parsed
  });

  it('flags a missing sheet', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name']]), 'Categories');
    const { payload, errors } = parseCatalogWorkbook(wbToBuffer(wb));
    expect(payload).toBeNull();
    expect(errors.some((e) => e.message.includes('Ingredients'))).toBe(true);
  });

  it('flags an empty required cell with sheet + row', () => {
    const buf = makeWb({ Products: [[null, 'Croissant', 'Cat', 'pcs', 25000, null, null, null, null, null, null, null, null, null, null]] });
    const { errors } = parseCatalogWorkbook(buf);
    const err = errors.find((e) => e.sheet === 'Products' && e.column === 'sku');
    expect(err).toBeDefined();
    expect(err!.row).toBe(2); // header = row 1
  });

  it('flags a non-numeric value in a number column', () => {
    const buf = makeWb({ Ingredients: [['ING-1', 'Farine', 'kg', 'abc', null, null, null, null, null, null, null]] });
    const { errors } = parseCatalogWorkbook(buf);
    expect(errors.some((e) => e.column === 'cost_price')).toBe(true);
  });

  it('flags duplicate SKUs across Ingredients/Products/Variants', () => {
    const buf = makeWb({
      Ingredients: [['DUP-1', 'Farine', 'kg', 1000, null, null, null, null, null, null, null]],
      Products:    [['DUP-1', 'Croissant', 'Cat', 'pcs', 25000, null, null, null, null, null, null, null, null, null, null]],
    });
    const { errors } = parseCatalogWorkbook(buf);
    expect(errors.some((e) => e.message.includes('DUP-1'))).toBe(true);
  });

  it('parses tags CSV cell into an array and booleans into booleans', () => {
    const buf = makeWb({
      Ingredients: [['ING-2', 'Beurre', 'kg', 95000, null, null, null, null, null, null, null]],
      Units:       [['ING-2', 'g', 0.001, 'recipe, purchase']],
      Products:    [['PRD-2', 'Pain', 'Cat', 'pcs', 15000, null, null, null, 'FALSE', null, null, null, null, null, null]],
    });
    const { payload, errors } = parseCatalogWorkbook(buf);
    expect(errors).toEqual([]);
    expect(payload!.units[0]!.tags).toEqual(['recipe', 'purchase']);
    expect(payload!.products[0]!.visible_on_pos).toBe(false);
  });
});
```

- [ ] **Step 9.2 :** Lancer → FAIL (module absent).
- [ ] **Step 9.3 :** Implémenter :

```ts
// apps/backoffice/src/features/catalog-import/parseCatalogWorkbook.ts
// S41 — pure ArrayBuffer → { payload, structure errors }. No network, no DOM.
// Structure errors are exhaustive (never fail-fast). Semantic validation
// (category resolution, cycles, conversions…) lives in import_catalog_v1.

import * as XLSX from 'xlsx';
import { CATALOG_SHEETS, type SheetDef } from './templateDefinition.js';

export interface StructureError {
  sheet: string;
  row: number;          // 1-based Excel row (header = 1)
  column?: string;
  message: string;
}

export type SheetRow = Record<string, string | number | boolean | string[] | null>;

export interface CatalogPayload {
  categories: SheetRow[];
  ingredients: SheetRow[];
  products: SheetRow[];
  units: SheetRow[];
  variants: SheetRow[];
  recipes: SheetRow[];
}

const TRUTHY = new Set(['true', '1', 'yes', 'oui', 'vrai']);
const FALSY  = new Set(['false', '0', 'no', 'non', 'faux']);

function coerce(
  def: SheetDef, key: string, type: string, raw: unknown,
  rowIdx: number, errors: StructureError[],
): string | number | boolean | string[] | null {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (Number.isNaN(n)) {
        errors.push({ sheet: def.name, row: rowIdx, column: key, message: `"${String(raw)}" is not a number` });
        return null;
      }
      return n;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).trim().toLowerCase();
      if (TRUTHY.has(s)) return true;
      if (FALSY.has(s)) return false;
      errors.push({ sheet: def.name, row: rowIdx, column: key, message: `"${String(raw)}" is not a boolean (TRUE/FALSE)` });
      return null;
    }
    case 'tags': {
      const parts = String(raw).split(',').map((p) => p.trim()).filter((p) => p !== '');
      return parts;
    }
    default:
      return String(raw).trim() === '' ? null : String(raw).trim();
  }
}

export function parseCatalogWorkbook(buf: ArrayBuffer): {
  payload: CatalogPayload | null;
  errors: StructureError[];
} {
  const errors: StructureError[] = [];
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array' });
  } catch {
    return { payload: null, errors: [{ sheet: '—', row: 0, message: 'File is not a readable .xlsx workbook' }] };
  }

  const payload: CatalogPayload = {
    categories: [], ingredients: [], products: [], units: [], variants: [], recipes: [],
  };

  for (const def of CATALOG_SHEETS) {
    const ws = wb.Sheets[def.name];
    if (ws === undefined) {
      errors.push({ sheet: def.name, row: 0, message: `Missing sheet "${def.name}"` });
      continue;
    }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as unknown[][];
    if (aoa.length === 0) continue; // empty sheet = no rows, fine
    const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
    const known = new Set(def.columns.map((c) => c.key));
    headers.forEach((h) => {
      if (h !== '' && !known.has(h)) {
        errors.push({ sheet: def.name, row: 1, column: h, message: `Unknown column "${h}"` });
      }
    });

    for (let i = 1; i < aoa.length; i++) {
      const cells = aoa[i] ?? [];
      if (cells.every((c) => c === null || String(c).trim() === '')) continue; // skip blank rows
      const rowIdx = i + 1; // 1-based Excel row
      const row: SheetRow = {};
      for (const col of def.columns) {
        const hIdx = headers.indexOf(col.key);
        const raw = hIdx === -1 ? null : cells[hIdx] ?? null;
        const v = coerce(def, col.key, col.type, raw, rowIdx, errors);
        if (col.required && (v === null || v === '')) {
          errors.push({ sheet: def.name, row: rowIdx, column: col.key, message: `Required value missing` });
        }
        row[col.key] = v;
      }
      payload[def.payloadKey].push(row);
    }
  }

  // duplicate SKUs across Ingredients / Products / Variants
  const seen = new Map<string, string>();
  const skuRows: Array<[string, SheetRow[]]> = [
    ['Ingredients', payload.ingredients], ['Products', payload.products], ['Variants', payload.variants],
  ];
  for (const [sheet, rows] of skuRows) {
    rows.forEach((row, idx) => {
      const sku = typeof row['sku'] === 'string' ? row['sku'] : null;
      if (sku === null) return;
      const prev = seen.get(sku);
      if (prev !== undefined) {
        errors.push({ sheet, row: idx + 2, column: 'sku', message: `Duplicate SKU "${sku}" (already used in ${prev})` });
      } else {
        seen.set(sku, sheet);
      }
    });
  }

  const fatal = errors.some((e) => e.row === 0);
  return { payload: fatal ? null : payload, errors };
}
```

- [ ] **Step 9.4 :** Relancer → PASS (ajuster les index de colonnes des fixtures si l'ordre des colonnes diffère — la fixture `makeWb` suit `def.columns`).
- [ ] **Step 9.5 :** Commit : `feat(backoffice): session 41 — task 9 — parseCatalogWorkbook + structure validation`.

### Task 10 : `buildExportWorkbook.ts` (TDD, round-trip export)

**Files:**
- Create: `apps/backoffice/src/features/catalog-import/buildExportWorkbook.ts`
- Test: `apps/backoffice/src/features/catalog-import/__tests__/export-roundtrip.test.ts`

- [ ] **Step 10.1 :** Test :

```ts
// apps/backoffice/src/features/catalog-import/__tests__/export-roundtrip.test.ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildExportWorkbook } from '../buildExportWorkbook.js';
import { parseCatalogWorkbook, type CatalogPayload } from '../parseCatalogWorkbook.js';

const SAMPLE: CatalogPayload = {
  categories:  [{ name: 'Viennoiserie', dispatch_station: 'bakery', sort_order: 10 }],
  ingredients: [{ sku: 'ING-1', name: 'Farine', unit: 'kg', cost_price: 12000, category: 'Ingredients', min_stock_threshold: null, shelf_life_hours: null, purchase_unit: null, recipe_unit: 'g', opname_unit: null, sales_unit: null }],
  products:    [{ sku: 'PRD-1', name: 'Croissant', category: 'Viennoiserie', unit: 'pcs', retail_price: 25000, wholesale_price: null, description: null, image_url: null, visible_on_pos: true, is_favorite: false, shelf_life_hours: null, purchase_unit: null, recipe_unit: null, opname_unit: null, sales_unit: null }],
  units:       [{ product_sku: 'ING-1', code: 'g', factor_to_base: 0.001, tags: ['recipe'] }],
  variants:    [{ parent_sku: 'PRD-1', variant_axis: 'flavor', variant_label: 'Amande', sku: 'PRD-1-AMD', retail_price: 28000, image_url: null }],
  recipes:     [{ product_sku: 'PRD-1', material_sku: 'ING-1', quantity: 80, unit: 'g', notes: null }],
};

describe('buildExportWorkbook', () => {
  it('export → parse round-trips to an equivalent payload with no errors', () => {
    const wb = buildExportWorkbook(SAMPLE);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { payload, errors } = parseCatalogWorkbook(buf);
    expect(errors).toEqual([]);
    expect(payload!.products[0]!.sku).toBe('PRD-1');
    expect(payload!.units[0]!.tags).toEqual(['recipe']);
    expect(payload!.recipes[0]!.quantity).toBe(80);
    expect(payload!.variants[0]!.parent_sku).toBe('PRD-1');
  });
});
```

- [ ] **Step 10.2 :** Lancer → FAIL. Implémenter :

```ts
// apps/backoffice/src/features/catalog-import/buildExportWorkbook.ts
// S41 — converts the export_catalog_v1 payload back into the 6-sheet workbook.

import * as XLSX from 'xlsx';
import { CATALOG_SHEETS } from './templateDefinition.js';
import type { CatalogPayload, SheetRow } from './parseCatalogWorkbook.js';

function cellValue(v: SheetRow[string]): string | number | boolean | null {
  if (Array.isArray(v)) return v.join(',');
  return v;
}

export function buildExportWorkbook(payload: CatalogPayload): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const def of CATALOG_SHEETS) {
    const headers = def.columns.map((c) => c.key);
    const rows = payload[def.payloadKey].map((row) => headers.map((h) => cellValue(row[h] ?? null)));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }
  return wb;
}
```

- [ ] **Step 10.3 :** Relancer → PASS. Commit : `feat(backoffice): session 41 — task 10 — buildExportWorkbook round-trip`.

### Task 11 : Hooks `useImportCatalog` + `useExportCatalog`

**Files:**
- Create: `apps/backoffice/src/features/catalog-import/hooks/useImportCatalog.ts`
- Create: `apps/backoffice/src/features/catalog-import/hooks/useExportCatalog.ts`

- [ ] **Step 11.1 :** `useImportCatalog.ts` (pattern `useCreateProduct.ts`) :

```ts
// apps/backoffice/src/features/catalog-import/hooks/useImportCatalog.ts
// S41 — wraps import_catalog_v1. dryRun=true → validation report only.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { CatalogPayload } from '../parseCatalogWorkbook.js';

export interface ImportError {
  sheet: string;
  row: number;
  sku: string | null;
  code: string;
  message: string;
}

export interface ImportReport {
  valid: boolean;
  errors: ImportError[];
  summary: Record<string, Record<string, number>>;
  idempotent_replay: boolean;
}

interface ImportVars {
  payload: CatalogPayload;
  dryRun: boolean;
  idempotencyKey?: string;
}

export function useImportCatalog() {
  const qc = useQueryClient();
  return useMutation<ImportReport, Error, ImportVars>({
    mutationFn: async ({ payload, dryRun, idempotencyKey }) => {
      const { data, error } = await supabase.rpc('import_catalog_v1', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_payload: payload as any,
        p_dry_run: dryRun,
        p_idempotency_key: idempotencyKey ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (error !== null) throw new Error(error.message);
      return data as unknown as ImportReport;
    },
    onSuccess: async (_report, vars) => {
      if (!vars.dryRun) {
        await qc.invalidateQueries({ queryKey: ['products'] });
        await qc.invalidateQueries({ queryKey: ['categories'] });
      }
    },
  });
}
```

- [ ] **Step 11.2 :** `useExportCatalog.ts` :

```ts
// apps/backoffice/src/features/catalog-import/hooks/useExportCatalog.ts
// S41 — wraps export_catalog_v1 (read-only, returns the import payload shape).

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { CatalogPayload } from '../parseCatalogWorkbook.js';

export function useExportCatalog() {
  return useMutation<CatalogPayload, Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('export_catalog_v1');
      if (error !== null) throw new Error(error.message);
      return data as unknown as CatalogPayload;
    },
  });
}
```

- [ ] **Step 11.3 :** `pnpm --filter @breakery/app-backoffice typecheck` → PASS (les types RPC viennent du regen Task 6). Commit : `feat(backoffice): session 41 — task 11 — import/export hooks`.

### Task 12 : Onglets page Products + route + page Import/Export + composants

**Files:**
- Create: `apps/backoffice/src/features/products/components/ProductsPageTabs.tsx`
- Create: `apps/backoffice/src/pages/products/ProductsImportExportPage.tsx`
- Create: `apps/backoffice/src/features/catalog-import/components/ImportDropzone.tsx`
- Create: `apps/backoffice/src/features/catalog-import/components/ImportSummaryCards.tsx`
- Create: `apps/backoffice/src/features/catalog-import/components/ImportErrorsTable.tsx`
- Modify: `apps/backoffice/src/pages/Products.tsx` (insérer `<ProductsPageTabs />` sous `<ProductsHeader />`)
- Modify: `apps/backoffice/src/routes/index.tsx` (nouvelle route)

- [ ] **Step 12.1 :** `ProductsPageTabs.tsx` (style `ProductDetailTabs.tsx` — underline gold, mais en `NavLink` route-based ; l'onglet Import / Export n'apparaît qu'avec la permission) :

```tsx
// apps/backoffice/src/features/products/components/ProductsPageTabs.tsx
// S41 — route-based tab strip for the Products area (list / import-export).

import type { JSX } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';

export function ProductsPageTabs(): JSX.Element {
  const canImport = useAuthStore((s) => s.hasPermission('catalog.import'));
  const tabs = [
    { to: '/backoffice/products', label: 'Products', end: true },
    ...(canImport
      ? [{ to: '/backoffice/products/import-export', label: 'Import / Export', end: false }]
      : []),
  ];
  return (
    <div className="border-b border-border-subtle">
      <nav role="tablist" aria-label="Products sections" className="flex flex-wrap gap-x-6">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            role="tab"
            className={({ isActive }) =>
              cn(
                'relative -mb-px py-3 text-xs font-semibold uppercase tracking-widest transition-colors duration-fast',
                isActive ? 'text-gold border-b-2 border-gold' : 'text-text-muted hover:text-text-primary',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 12.2 :** Dans `Products.tsx`, insérer `<ProductsPageTabs />` juste après `<ProductsHeader … />` (ligne ~96) + import.
- [ ] **Step 12.3 :** `ProductsImportExportPage.tsx` — la page hôte. Lazy-import des utils SheetJS (`await import('../../features/catalog-import/…')`) pour ne pas alourdir le bundle de la liste produits. État machine locale : `idle → parsed (payload + structureErrors) → previewed (report dry-run) → done (report final)`. Idempotency key : `useRef<string>(crypto.randomUUID())`, régénérée après un commit réussi. Structure :

```tsx
// apps/backoffice/src/pages/products/ProductsImportExportPage.tsx
// S41 — Import / Export tab: template download, full export, 3-step import.

import { useRef, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { Button, Card } from '@breakery/ui';
import { ProductsPageTabs } from '@/features/products/components/ProductsPageTabs.js';
import { ImportDropzone } from '@/features/catalog-import/components/ImportDropzone.js';
import { ImportSummaryCards } from '@/features/catalog-import/components/ImportSummaryCards.js';
import { ImportErrorsTable } from '@/features/catalog-import/components/ImportErrorsTable.js';
import { useImportCatalog, type ImportReport } from '@/features/catalog-import/hooks/useImportCatalog.js';
import { useExportCatalog } from '@/features/catalog-import/hooks/useExportCatalog.js';
import type { CatalogPayload } from '@/features/catalog-import/parseCatalogWorkbook.js';
import type { StructureError } from '@/features/catalog-import/parseCatalogWorkbook.js';

type Stage =
  | { step: 'idle' }
  | { step: 'parsed'; payload: CatalogPayload | null; structureErrors: StructureError[]; filename: string }
  | { step: 'previewed'; payload: CatalogPayload; report: ImportReport; filename: string }
  | { step: 'done'; report: ImportReport };

export default function ProductsImportExportPage(): JSX.Element {
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const importMutation = useImportCatalog();
  const exportMutation = useExportCatalog();
  const idemKeyRef = useRef<string>(crypto.randomUUID());

  async function handleDownloadTemplate(): Promise<void> {
    const { buildTemplateWorkbook, downloadWorkbook } =
      await import('@/features/catalog-import/buildTemplateWorkbook.js');
    downloadWorkbook(buildTemplateWorkbook(), 'breakery-catalog-template.xlsx');
  }

  async function handleExport(): Promise<void> {
    try {
      const payload = await exportMutation.mutateAsync();
      const [{ buildExportWorkbook }, { downloadWorkbook }] = await Promise.all([
        import('@/features/catalog-import/buildExportWorkbook.js'),
        import('@/features/catalog-import/buildTemplateWorkbook.js'),
      ]);
      downloadWorkbook(buildExportWorkbook(payload), `breakery-catalog-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  }

  async function handleFile(buf: ArrayBuffer, filename: string): Promise<void> {
    const { parseCatalogWorkbook } = await import('@/features/catalog-import/parseCatalogWorkbook.js');
    const { payload, errors } = parseCatalogWorkbook(buf);
    setStage({ step: 'parsed', payload, structureErrors: errors, filename });
    if (payload !== null && errors.length === 0) {
      try {
        const report = await importMutation.mutateAsync({ payload, dryRun: true });
        setStage({ step: 'previewed', payload, report, filename });
      } catch (e) {
        toast.error(`Validation failed: ${(e as Error).message}`);
      }
    }
  }

  async function handleConfirmImport(): Promise<void> {
    if (stage.step !== 'previewed') return;
    try {
      const report = await importMutation.mutateAsync({
        payload: stage.payload,
        dryRun: false,
        idempotencyKey: idemKeyRef.current,
      });
      idemKeyRef.current = crypto.randomUUID(); // reset for the next import
      setStage({ step: 'done', report });
      toast.success('Catalog imported');
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  }

  // … render: <ProductsPageTabs /> en tête, puis 3 <Card> :
  // 1. Template  — bouton "Download empty template" (handleDownloadTemplate)
  // 2. Export    — bouton "Export full catalog" (handleExport, spinner exportMutation.isPending)
  // 3. Import    — <ImportDropzone onFile={handleFile} /> ;
  //    si parsed avec structureErrors → <ImportErrorsTable structureErrors={…} /> ;
  //    si previewed → <ImportSummaryCards summary={stage.report.summary} />
  //                 + <ImportErrorsTable errors={stage.report.errors} />
  //                 + <Button disabled={!stage.report.valid || importMutation.isPending}
  //                           onClick={handleConfirmImport} data-testid="confirm-import">
  //                     Import {…} items</Button>
  //    si done → summary final + idempotent_replay badge + lien "View products"
}
```

  Compléter le render avec les primitives réellement exportées par `@breakery/ui` (vérifier — pas de `Select`/`RadioGroup` ; `Card`/`Button`/`Badge` existent ; fallback natif sinon, convention skill breakery-ui-kit).
- [ ] **Step 12.4 :** `ImportDropzone.tsx` — `<input type="file" accept=".xlsx">` + zone drag&drop (handlers `onDragOver`/`onDrop`, `file.arrayBuffer()` → `onFile(buf, file.name)`), `data-testid="import-dropzone"`. `ImportSummaryCards.tsx` — grille de cards par clé du summary (`create`/`update`/`replace_products`/`products_replaced`). `ImportErrorsTable.tsx` — table `{sheet, row, sku, code, message}` + props `errors?: ImportError[]` et `structureErrors?: StructureError[]` (normalisées en lignes), `data-testid="import-errors-table"`.
- [ ] **Step 12.5 :** Route dans `routes/index.tsx` — **placer AVANT** `products/:productId` (sinon `import-export` matche `:productId`) :

```tsx
import ProductsImportExportPage from '@/pages/products/ProductsImportExportPage.js';
// …
<Route
  path="products/import-export"
  element={
    <PermissionGate required="catalog.import">
      <ProductsImportExportPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 12.6 :** `pnpm --filter @breakery/app-backoffice typecheck` → PASS. Commit : `feat(backoffice): session 41 — task 12 — Import/Export tab + page + components`.

### Task 13 : Smoke tests BO

**Files:**
- Test: `apps/backoffice/src/features/catalog-import/__tests__/import-export-page.smoke.test.tsx`

- [ ] **Step 13.1 :** Écrire le smoke (mimer un smoke récent du repo, p.ex. `apps/backoffice/src/features/**/__tests__/*.smoke.test.tsx`, pour le wrapper QueryClient + MemoryRouter + mock authStore/supabase). Cas :
  1. la page rend les 3 zones (Template / Export / Import) ;
  2. après un dry-run avec erreurs (mock `supabase.rpc` → report `valid:false`), le bouton `confirm-import` est `disabled` ;
  3. après un dry-run valide, cliquer `confirm-import` appelle `supabase.rpc` avec `p_dry_run: false` et une `p_idempotency_key` non nulle.
  Mock module-level : `vi.mock('@/lib/supabase.js', …)` avec `vi.hoisted` pour les refs stables (leçon DEV-S39-B1-01 : data objects mockés en `vi.hoisted` sinon boucle de rendu infinie).
- [ ] **Step 13.2 :** `pnpm --filter @breakery/app-backoffice test catalog-import` → tous PASS.
- [ ] **Step 13.3 :** Commit : `test(backoffice): session 41 — task 13 — import/export smoke tests`.

### Task 14 : Sweeps + typecheck

- [ ] **Step 14.1 :** `pnpm --filter @breakery/app-backoffice test` → sweep complet BO. Baseline attendue : ~473 tests, 1 skip pré-existant (S40) + flakes connus `journal-entries` (DEV-S39-D2-01). Aucune NOUVELLE failure.
- [ ] **Step 14.2 :** `pnpm typecheck` → 6/6 PASS.
- [ ] **Step 14.3 :** Commit éventuel des ajustements : `fix(backoffice): session 41 — task 14 — sweep fixes`.

---

## Wave C — Closeout

### Task 15 : E2E navigateur, INDEX, CLAUDE.md, PR

- [ ] **Step 15.1 :** E2E Playwright (pattern S39/S40 `tests/e2e/`) : `tests/e2e/s41-catalog-import.spec.ts` — login BO, naviguer `/backoffice/products/import-export`, vérifier les 3 zones, télécharger le template (event download non vide), uploader un fichier de test généré (2 produits + 1 recette), vérifier le summary dry-run à l'écran, confirmer l'import, vérifier en DB (via MCP) que les SKUs existent, puis exporter et vérifier download non vide. Nettoyer les rows de test en DB après.
- [ ] **Step 15.2 :** Créer `docs/workplan/plans/2026-06-12-session-41-INDEX.md` (modèle S40 : §scope, §tasks, §deviations numérotées DEV-S41-…, §hors-scope S42+).
- [ ] **Step 15.3 :** Mettre à jour `CLAUDE.md` → bloc « Active Workplan » (S41 devient current, S40 descend en référence) + ledger « Migration sequence active » (NAME-block `20260625000010..013` + correctives éventuelles).
- [ ] **Step 15.4 :** Push + PR vers `master` : `gh pr create` titre `Session 41 — Catalog Import/Export (products + recipes)`, body = résumé spec + tests + deviations. Squash-merge après review.

---

## Self-review (fait à la rédaction)

- **Couverture spec :** §3 template → Task 8 ; §4 payload → Tasks 8/9 ; §5 import RPC → Task 2 (validations V1-V18 ⊇ liste spec) ; §6 export → Task 3 ; §7 UI → Tasks 11-12 ; §8 migrations/perms → Tasks 1-4, 6 ; §9 tests → Tasks 5, 8-10, 13-15.
- **Écarts assumés vs spec :** 4 migrations au lieu de ~6 (REVOKE pairs inline dans les migrations RPC, pattern S40) — noter DEV-S41-PLAN-01 dans l'INDEX. Erreur « conflit variant/standalone » couverte par V4/V10/`variant_parent_mismatch`.
- **Types cohérents :** `CatalogPayload`/`SheetRow` définis Task 9, consommés Tasks 10-12 ; `ImportReport` défini Task 11, consommé Task 12 ; shape JSONB RPC = shape payload front (mêmes clés snake_case).
- **Pièges signalés dans les tasks :** typo summary variants (Task 2 ⚠️), route `import-export` avant `:productId` (Step 12.5), temp tables DROP IF EXISTS (pgTAP single-tx), trigger snapshot FOR EACH ROW (spec corrigée).
