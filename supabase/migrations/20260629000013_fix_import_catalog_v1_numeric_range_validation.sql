-- 20260629000013_fix_import_catalog_v1_numeric_range_validation.sql
-- Corrective (DEV-S45-IMP-01): add validation rule V19 — numeric magnitude.
--
-- BUG: import_catalog_v1 staged prices/quantities into UNCONSTRAINED NUMERIC temp
-- columns and V1-V18 never checked magnitude. A too-large value passed the dry-run
-- as valid=true, then the commit's INSERT/UPDATE products raised a raw 22003
-- (numeric_field_overflow) → PostgREST returned an opaque 400 with no message body.
-- Reproduced on cloud: retail_price 9.99e13 → "precision 12, scale 2 ... < 10^10".
--
-- FIX: V19 mirrors the products column bounds so the dry-run reports the exact
-- {sheet,row,sku} cell with code 'value_out_of_range' instead of crashing at commit.
--   retail_price / wholesale_price  NUMERIC(12,2) → |round(v,2)| < 10^10
--   cost_price                      NUMERIC(14,2) → |round(v,2)| < 10^12
--   min_stock_threshold             NUMERIC(10,3) → |round(v,3)| < 10^7
--   variants.retail_price           NUMERIC(12,2) → |round(v,2)| < 10^10
--
-- CREATE OR REPLACE on the CURRENTLY DEPLOYED body (incl. correctives _014 min_stock
-- COALESCE 0, _015 WHERE 1=1, _016 soft-deleted SKU restore in W3/W4). Signature
-- unchanged → no types regen.

CREATE OR REPLACE FUNCTION public.import_catalog_v1(
  p_payload jsonb,
  p_dry_run boolean DEFAULT true,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- FIX DEV-S41-T6-01: add WHERE 1=1 to satisfy Supabase "dangerous writes" check.
  ALTER TABLE t_item ADD COLUMN eff_unit TEXT;
  UPDATE t_item i
     SET eff_unit = COALESCE(
       i.unit,
       (SELECT p.unit FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL),
       'pcs')
   WHERE 1 = 1;

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

  -- codes d'unités effectifs par SKU
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
  -- V1
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

  -- V19 — magnitude : valeurs dans les bornes de la colonne NUMERIC cible, sinon
  -- le commit lève un 22003 brut (400 opaque). On reflète les bornes de products
  -- pour que le dry-run signale la cellule exacte. retail/wholesale=(12,2),
  -- cost=(14,2), min_stock=(10,3) ; variants.retail_price=(12,2).
  INSERT INTO t_err
  SELECT i.sheet, i.row_num, i.sku, 'value_out_of_range',
         format('%s value %s exceeds the maximum allowed for this field (%s)', f.field, f.val, f.maxlabel)
    FROM t_item i,
         LATERAL (VALUES
           ('retail_price',        i.retail_price,        2, 10000000000::NUMERIC,   '9,999,999,999.99'),
           ('wholesale_price',     i.wholesale_price,     2, 10000000000::NUMERIC,   '9,999,999,999.99'),
           ('cost_price',          i.cost_price,          2, 1000000000000::NUMERIC, '999,999,999,999.99'),
           ('min_stock_threshold', i.min_stock_threshold, 3, 10000000::NUMERIC,      '9,999,999.999')
         ) AS f(field, val, scale, maxbound, maxlabel)
   WHERE f.val IS NOT NULL AND abs(round(f.val, f.scale)) >= f.maxbound;
  INSERT INTO t_err
  SELECT 'Variants', v.row_num, v.sku, 'value_out_of_range',
         format('retail_price value %s exceeds the maximum allowed for this field (9,999,999,999.99)', v.retail_price)
    FROM t_var v
   WHERE v.retail_price IS NOT NULL AND abs(round(v.retail_price, 2)) >= 10000000000::NUMERIC;

  -- V2
  WITH all_skus AS (
    SELECT sheet, row_num, sku FROM t_item WHERE sku IS NOT NULL
    UNION ALL
    SELECT 'Variants', row_num, sku FROM t_var WHERE sku IS NOT NULL
  )
  INSERT INTO t_err
  SELECT MIN(sheet), MIN(row_num), sku, 'duplicate_sku',
         format('SKU "%s" appears %s times in the file', sku, COUNT(*))
    FROM all_skus GROUP BY sku HAVING COUNT(*) > 1;

  -- V3
  INSERT INTO t_err
  SELECT i.sheet, i.row_num, i.sku, 'unknown_category',
         format('category "%s" not found in file or database', i.category)
    FROM t_item i
   WHERE i.category IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_cat c WHERE c.name = i.category)
     AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = i.category AND c.deleted_at IS NULL);

  -- V4
  INSERT INTO t_err
  SELECT i.sheet, i.row_num, i.sku, 'sku_is_variant_in_db',
         format('SKU "%s" exists in the database as a variant — cannot import it as standalone', i.sku)
    FROM t_item i
    JOIN products p ON p.sku = i.sku AND p.deleted_at IS NULL
   WHERE p.parent_product_id IS NOT NULL;

  -- V5
  INSERT INTO t_err
  SELECT i.sheet, i.row_num, i.sku, 'unit_change_not_supported',
         format('SKU "%s": base unit cannot be changed by import (db=%s, file=%s)', i.sku, p.unit, i.unit)
    FROM t_item i
    JOIN products p ON p.sku = i.sku AND p.deleted_at IS NULL
   WHERE i.unit IS NOT NULL AND p.unit <> i.unit;

  -- V6/V7/V8/V9/V10
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

  -- V11/V12
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

  -- V13
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

  -- V14
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

  -- V15/V16
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

  -- V17
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

  -- V18
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
      'update', (SELECT COUNT(*) FROM t_var v WHERE v.sku IS NOT NULL
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
  -- W1
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

  -- W2
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

  -- W3 — upsert products/ingredients by SKU.
  -- FIX DEV-S41-T7-01: products.sku is a GLOBAL UNIQUE constraint (no partial
  -- predicate).  Soft-deleted rows (deleted_at IS NOT NULL) still occupy the
  -- uniqueness slot.  When the active-row lookup returns no row, we must check
  -- for a soft-deleted row first and UPDATE (restore) it; only INSERT when the
  -- SKU is truly absent from the table.
  FOR r IN SELECT * FROM t_item ORDER BY row_num LOOP
    SELECT id INTO v_cat_id FROM categories
     WHERE name = COALESCE(r.category, 'Ingredients') AND deleted_at IS NULL LIMIT 1;

    SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NULL LIMIT 1;
    IF v_pid IS NULL THEN
      -- Check for a soft-deleted product with the same SKU (global UNIQUE blocks INSERT).
      SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NOT NULL LIMIT 1;
    END IF;

    IF v_pid IS NOT NULL THEN
      -- Active or just-found soft-deleted row → restore + update fields.
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
        deleted_at               = NULL,
        updated_at               = now()
      WHERE id = v_pid;
    ELSE
      -- SKU is truly new (no active, no soft-deleted) → INSERT.
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
        COALESCE(r.min_stock_threshold, 0), r.shelf_life_hours
      ) RETURNING id INTO v_pid;

      INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
      VALUES (v_pid, r.eff_unit, r.eff_unit, r.eff_unit, r.eff_unit)
      ON CONFLICT (product_id) DO NOTHING;
    END IF;
  END LOOP;

  -- W4 — upsert variants by SKU.
  -- FIX DEV-S41-T7-01: same soft-deleted SKU issue as W3.
  FOR r IN SELECT * FROM t_var ORDER BY row_num LOOP
    SELECT p.id, p.name, p.category_id, p.unit, p.retail_price, p.image_url
      INTO v_parent
      FROM products p WHERE p.sku = r.parent_sku AND p.deleted_at IS NULL LIMIT 1;

    SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NULL LIMIT 1;
    IF v_pid IS NULL THEN
      -- Check for a soft-deleted variant with the same SKU.
      SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NOT NULL LIMIT 1;
    END IF;

    IF v_pid IS NOT NULL THEN
      -- Restore + update.
      UPDATE products SET
        variant_label      = r.variant_label,
        variant_axis       = r.variant_axis::variant_axis_type,
        variant_sort_order = r.sort_order,
        retail_price       = COALESCE(r.retail_price, retail_price),
        image_url          = COALESCE(r.image_url, image_url),
        parent_product_id  = v_parent.id,
        is_active          = TRUE,
        deleted_at         = NULL,
        updated_at         = now()
      WHERE id = v_pid;
    ELSE
      -- Truly new variant.
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
    END IF;
  END LOOP;

  -- W5
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

  -- W6
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

  -- W7
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

  -- W8
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
$function$;

-- REVOKE pair (S25 canonical) — re-asserted; CREATE OR REPLACE preserves ACL but
-- we keep it explicit for defense-in-depth and regression-grepping.
REVOKE ALL ON FUNCTION public.import_catalog_v1(JSONB, BOOLEAN, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_catalog_v1(JSONB, BOOLEAN, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_catalog_v1(JSONB, BOOLEAN, UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
