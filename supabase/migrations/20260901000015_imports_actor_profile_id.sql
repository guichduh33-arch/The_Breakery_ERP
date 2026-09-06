-- 20260901000015_imports_actor_profile_id.sql
--
-- Lot « actor_id transverse », volet imports — 5 RPC (catalogue, fournisseurs,
-- achats, ventes, dépenses). Contexte et contrat du helper :
-- 20260901000013_current_profile_id_helper.sql.
--
-- Les cinq imports posaient v_caller (= auth.uid()) dans audit_logs.actor_id. Trois
-- d'entre eux l'écrivaient AUSSI dans des colonnes métier dont la FK cible
-- user_profiles(id) — c'est le même défaut, plus grave, parce qu'il ne touche pas
-- que la trace :
--   · import_expenses  : expenses.created_by / submitted_by / approved_by / paid_by ;
--   · import_purchases : purchase_orders.created_by / received_by ;
--   · import_sales     : orders.served_by.
-- Pour tout compte créé par le back-office (id <> auth_user_id), l'import historique
-- échouait en 23503 sur la première ligne insérée.
--
-- Transformation :
--   · DECLARE : v_actor_profile UUID := _current_profile_id();
--   · audit_logs.actor_id et les colonnes FK ci-dessus reçoivent v_actor_profile ;
--   · v_caller reste l'auth id pour has_permission(…) et pour
--     catalog_import_idempotency_keys.created_by / import_master_data_idempotency_keys.created_by,
--     colonnes SANS clé étrangère que import_customers_v2 (déjà résolue en profil)
--     remplit elle aussi avec l'auth id — on ne change pas ce contrat ici.
-- Rien d'autre ne bouge dans les corps.
--
-- Versioning monotone : _v2 créées, _v1 droppées dans ce fichier, signatures
-- inchangées. PROVENANCE DES CORPS : pg_get_functiondef sur la base live, relevé le
-- 2026-09-06 ; le garde ci-dessous refuse la migration si un corps a dérivé.
-- Note : import_expenses_v1 n'avait aucun fichier de migration dans le dépôt (corps
-- live seulement) — ce fichier en devient la première trace versionnée.
--
-- Grants : miroir des grants live (authenticated + service_role) + REVOKE PUBLIC/anon.
-- Types à régénérer (packages/supabase/src/types.generated.ts).

DO $$
DECLARE
  v_expected CONSTANT jsonb := jsonb_build_object(
    'import_catalog_v1',   '4b6620a98505700171a14ad3e701e51b',
    'import_suppliers_v1', 'f442e91ebda98b49b12e2dae12fadfa4',
    'import_purchases_v1', 'b375d200b220909b69ecd3558604a563',
    'import_sales_v1',     '982653894c4d8259a1ba556abb65db15',
    'import_expenses_v1',  '887852e7c0509e2b843dddf4138f21f8'
  );
  v_name TEXT;
  v_md5  TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = '_current_profile_id') THEN
    RAISE EXCEPTION '_current_profile_id absent — appliquer 20260901000013 d''abord';
  END IF;
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_md5 IS DISTINCT FROM (v_expected ->> v_name) THEN
      RAISE EXCEPTION 'corps live de % inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-06, retransformer depuis pg_get_functiondef', v_name, v_md5;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- import_catalog_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_catalog_v2(p_payload jsonb, p_dry_run boolean DEFAULT true, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
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
    SELECT report INTO v_existing FROM catalog_import_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_cat, t_item, t_var, t_unit, t_rec, t_eff_codes, t_err;

  CREATE TEMP TABLE t_cat ON COMMIT DROP AS
  SELECT ord::INT AS row_num, NULLIF(trim(elt->>'name'), '') AS name,
         COALESCE(NULLIF(trim(elt->>'dispatch_station'), ''), 'none') AS dispatch_station,
         (elt->>'sort_order')::INT AS sort_order
    FROM jsonb_array_elements(COALESCE(p_payload->'categories', '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_item ON COMMIT DROP AS
  SELECT 'Ingredients'::TEXT AS sheet, ord::INT AS row_num, 'ingredient'::TEXT AS kind,
         NULLIF(trim(elt->>'sku'), '') AS sku, NULLIF(trim(elt->>'name'), '') AS name,
         NULLIF(trim(elt->>'unit'), '') AS unit, (elt->>'cost_price')::NUMERIC AS cost_price,
         NULLIF(trim(elt->>'category'), '') AS category, NULL::NUMERIC AS retail_price,
         NULL::NUMERIC AS wholesale_price, NULL::TEXT AS description, NULL::TEXT AS image_url,
         NULL::BOOLEAN AS visible_on_pos, NULL::BOOLEAN AS is_favorite,
         (elt->>'min_stock_threshold')::NUMERIC AS min_stock_threshold,
         (elt->>'shelf_life_hours')::INT AS shelf_life_hours,
         NULLIF(trim(elt->>'purchase_unit'), '') AS purchase_unit, NULLIF(trim(elt->>'recipe_unit'), '') AS recipe_unit,
         NULLIF(trim(elt->>'opname_unit'), '') AS opname_unit, NULLIF(trim(elt->>'sales_unit'), '') AS sales_unit
    FROM jsonb_array_elements(COALESCE(p_payload->'ingredients', '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord)
  UNION ALL
  SELECT 'Products', ord::INT, 'product', NULLIF(trim(elt->>'sku'), ''), NULLIF(trim(elt->>'name'), ''),
         NULLIF(trim(elt->>'unit'), ''), NULL, NULLIF(trim(elt->>'category'), ''),
         (elt->>'retail_price')::NUMERIC, (elt->>'wholesale_price')::NUMERIC,
         NULLIF(elt->>'description', ''), NULLIF(trim(elt->>'image_url'), ''),
         COALESCE((elt->>'visible_on_pos')::BOOLEAN, TRUE), COALESCE((elt->>'is_favorite')::BOOLEAN, FALSE),
         NULL, (elt->>'shelf_life_hours')::INT,
         NULLIF(trim(elt->>'purchase_unit'), ''), NULLIF(trim(elt->>'recipe_unit'), ''),
         NULLIF(trim(elt->>'opname_unit'), ''), NULLIF(trim(elt->>'sales_unit'), '')
    FROM jsonb_array_elements(COALESCE(p_payload->'products', '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  ALTER TABLE t_item ADD COLUMN eff_unit TEXT;
  UPDATE t_item i SET eff_unit = COALESCE(i.unit,
       (SELECT p.unit FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL), 'pcs') WHERE 1 = 1;

  CREATE TEMP TABLE t_var ON COMMIT DROP AS
  SELECT ord::INT AS row_num, NULLIF(trim(elt->>'parent_sku'), '') AS parent_sku,
         NULLIF(trim(elt->>'variant_axis'), '') AS variant_axis, NULLIF(trim(elt->>'variant_label'), '') AS variant_label,
         NULLIF(trim(elt->>'sku'), '') AS sku, (elt->>'retail_price')::NUMERIC AS retail_price,
         NULLIF(trim(elt->>'image_url'), '') AS image_url,
         (row_number() OVER (PARTITION BY NULLIF(trim(elt->>'parent_sku'), '') ORDER BY ord) * 10)::INT AS sort_order
    FROM jsonb_array_elements(COALESCE(p_payload->'variants', '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_unit ON COMMIT DROP AS
  SELECT ord::INT AS row_num, NULLIF(trim(elt->>'product_sku'), '') AS product_sku,
         NULLIF(trim(elt->>'code'), '') AS code, (elt->>'factor_to_base')::NUMERIC AS factor_to_base,
         CASE WHEN elt->'tags' IS NULL OR jsonb_typeof(elt->'tags') <> 'array'
              THEN ARRAY['purchase','recipe','sales'] ELSE ARRAY(SELECT jsonb_array_elements_text(elt->'tags')) END AS tags,
         (row_number() OVER (PARTITION BY NULLIF(trim(elt->>'product_sku'), '') ORDER BY ord) * 10)::INT AS display_order
    FROM jsonb_array_elements(COALESCE(p_payload->'units', '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_rec ON COMMIT DROP AS
  SELECT ord::INT AS row_num, NULLIF(trim(elt->>'product_sku'), '') AS product_sku,
         NULLIF(trim(elt->>'material_sku'), '') AS material_sku, (elt->>'quantity')::NUMERIC AS quantity,
         NULLIF(trim(elt->>'unit'), '') AS unit, NULLIF(elt->>'notes', '') AS notes
    FROM jsonb_array_elements(COALESCE(p_payload->'recipes', '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  CREATE TEMP TABLE t_eff_codes ON COMMIT DROP AS
  SELECT u.product_sku AS sku, u.code FROM t_unit u WHERE u.product_sku IS NOT NULL AND u.code IS NOT NULL
  UNION
  SELECT p.sku, a.code FROM product_unit_alternatives a
    JOIN products p ON p.id = a.product_id AND p.deleted_at IS NULL
   WHERE a.deleted_at IS NULL
     AND p.sku NOT IN (SELECT DISTINCT product_sku FROM t_unit WHERE product_sku IS NOT NULL);

  INSERT INTO t_err SELECT 'Categories', row_num, NULL, 'missing_name', 'name is required' FROM t_cat WHERE name IS NULL;
  INSERT INTO t_err SELECT 'Categories', row_num, NULL, 'invalid_dispatch_station',
         format('dispatch_station "%s" must be kitchen|barista|display|none', dispatch_station)
    FROM t_cat WHERE dispatch_station NOT IN ('kitchen','barista','display','none');
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

  -- V19 magnitude (all NUMERIC columns the import writes)
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
    FROM t_var v WHERE v.retail_price IS NOT NULL AND abs(round(v.retail_price, 2)) >= 10000000000::NUMERIC;
  INSERT INTO t_err
  SELECT 'Recipes', rr.row_num, rr.product_sku, 'value_out_of_range',
         format('quantity value %s exceeds the maximum allowed for this field (9,999,999.999)', rr.quantity)
    FROM t_rec rr WHERE rr.quantity IS NOT NULL AND abs(round(rr.quantity, 3)) >= 10000000::NUMERIC;
  INSERT INTO t_err
  SELECT 'Units', u.row_num, u.product_sku, 'value_out_of_range',
         format('factor_to_base value %s exceeds the maximum allowed for this field (9,999,999,999.9999999999)', u.factor_to_base)
    FROM t_unit u WHERE u.factor_to_base IS NOT NULL AND abs(round(u.factor_to_base, 10)) >= 10000000000::NUMERIC;

  WITH all_skus AS (
    SELECT sheet, row_num, sku FROM t_item WHERE sku IS NOT NULL
    UNION ALL SELECT 'Variants', row_num, sku FROM t_var WHERE sku IS NOT NULL)
  INSERT INTO t_err SELECT MIN(sheet), MIN(row_num), sku, 'duplicate_sku',
         format('SKU "%s" appears %s times in the file', sku, COUNT(*))
    FROM all_skus GROUP BY sku HAVING COUNT(*) > 1;

  INSERT INTO t_err SELECT i.sheet, i.row_num, i.sku, 'unknown_category',
         format('category "%s" not found in file or database', i.category)
    FROM t_item i WHERE i.category IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_cat c WHERE c.name = i.category)
     AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = i.category AND c.deleted_at IS NULL);

  INSERT INTO t_err SELECT i.sheet, i.row_num, i.sku, 'sku_is_variant_in_db',
         format('SKU "%s" exists in the database as a variant — cannot import it as standalone', i.sku)
    FROM t_item i JOIN products p ON p.sku = i.sku AND p.deleted_at IS NULL WHERE p.parent_product_id IS NOT NULL;

  INSERT INTO t_err SELECT i.sheet, i.row_num, i.sku, 'unit_change_not_supported',
         format('SKU "%s": base unit cannot be changed by import (db=%s, file=%s)', i.sku, p.unit, i.unit)
    FROM t_item i JOIN products p ON p.sku = i.sku AND p.deleted_at IS NULL
   WHERE i.unit IS NOT NULL AND p.unit <> i.unit;

  INSERT INTO t_err SELECT 'Variants', row_num, sku, 'missing_required',
         'parent_sku, variant_axis, variant_label and sku are required'
    FROM t_var WHERE parent_sku IS NULL OR variant_axis IS NULL OR variant_label IS NULL OR sku IS NULL;
  INSERT INTO t_err SELECT 'Variants', row_num, sku, 'invalid_variant_axis',
         format('variant_axis "%s" must be flavor|size|format', variant_axis)
    FROM t_var WHERE variant_axis IS NOT NULL AND variant_axis NOT IN ('flavor','size','format');
  INSERT INTO t_err SELECT 'Variants', v.row_num, v.sku, 'unknown_parent',
         format('parent_sku "%s" not found in Products sheet or database', v.parent_sku)
    FROM t_var v WHERE v.parent_sku IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = v.parent_sku AND i.kind = 'product')
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = v.parent_sku AND p.deleted_at IS NULL AND p.parent_product_id IS NULL);
  INSERT INTO t_err SELECT 'Variants', v.row_num, v.sku, 'parent_is_variant',
         format('parent_sku "%s" is itself a variant — nesting is not allowed', v.parent_sku)
    FROM t_var v JOIN products p ON p.sku = v.parent_sku AND p.deleted_at IS NULL WHERE p.parent_product_id IS NOT NULL;
  INSERT INTO t_err SELECT 'Variants', MIN(row_num), parent_sku, 'mixed_axes',
         format('parent "%s" has more than one variant_axis in the file', parent_sku)
    FROM t_var WHERE parent_sku IS NOT NULL AND variant_axis IS NOT NULL
   GROUP BY parent_sku HAVING COUNT(DISTINCT variant_axis) > 1;
  INSERT INTO t_err SELECT 'Variants', v.row_num, v.sku, 'axis_conflict_db',
         format('parent "%s" already has variants with axis "%s" in the database', v.parent_sku, dbv.axis)
    FROM t_var v JOIN products parent ON parent.sku = v.parent_sku AND parent.deleted_at IS NULL
    JOIN LATERAL (SELECT c.variant_axis::TEXT AS axis FROM products c
       WHERE c.parent_product_id = parent.id AND c.deleted_at IS NULL AND c.is_active = TRUE LIMIT 1) dbv ON TRUE
   WHERE v.variant_axis IS NOT NULL AND dbv.axis <> v.variant_axis;
  INSERT INTO t_err SELECT 'Variants', v.row_num, v.sku, 'sku_is_standalone_in_db',
         format('SKU "%s" exists in the database as a standalone product — converting via import is not supported', v.sku)
    FROM t_var v JOIN products p ON p.sku = v.sku AND p.deleted_at IS NULL WHERE p.parent_product_id IS NULL;
  INSERT INTO t_err SELECT 'Variants', v.row_num, v.sku, 'variant_parent_mismatch',
         format('SKU "%s" is already a variant of another parent in the database', v.sku)
    FROM t_var v JOIN products p ON p.sku = v.sku AND p.deleted_at IS NULL
    JOIN products pp ON pp.id = p.parent_product_id WHERE pp.sku <> v.parent_sku;

  INSERT INTO t_err SELECT 'Units', row_num, product_sku, 'missing_required',
         'product_sku, code and factor_to_base are required'
    FROM t_unit WHERE product_sku IS NULL OR code IS NULL OR factor_to_base IS NULL;
  INSERT INTO t_err SELECT 'Units', row_num, product_sku, 'invalid_factor', 'factor_to_base must be > 0'
    FROM t_unit WHERE factor_to_base IS NOT NULL AND factor_to_base <= 0;
  INSERT INTO t_err SELECT 'Units', row_num, product_sku, 'invalid_tags',
         'tags must be a subset of {purchase,recipe,sales}'
    FROM t_unit WHERE NOT (tags <@ ARRAY['purchase','recipe','sales']);
  INSERT INTO t_err SELECT 'Units', u.row_num, u.product_sku, 'unknown_product',
         format('product_sku "%s" not found in file or database', u.product_sku)
    FROM t_unit u WHERE u.product_sku IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = u.product_sku)
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = u.product_sku AND p.deleted_at IS NULL);
  INSERT INTO t_err SELECT 'Units', MIN(row_num), product_sku, 'duplicate_unit_code',
         format('unit code "%s" declared twice for product "%s"', code, product_sku)
    FROM t_unit WHERE product_sku IS NOT NULL AND code IS NOT NULL
   GROUP BY product_sku, code HAVING COUNT(*) > 1;
  INSERT INTO t_err SELECT 'Units', u.row_num, u.product_sku, 'code_is_base_unit',
         format('unit code "%s" equals the base unit of product "%s"', u.code, u.product_sku)
    FROM t_unit u JOIN t_item i ON i.sku = u.product_sku WHERE u.code = i.eff_unit;
  INSERT INTO t_err SELECT 'Units', u.row_num, u.product_sku, 'code_is_base_unit',
         format('unit code "%s" equals the base unit of product "%s"', u.code, u.product_sku)
    FROM t_unit u JOIN products p ON p.sku = u.product_sku AND p.deleted_at IS NULL
   WHERE u.code = p.unit AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = u.product_sku);

  INSERT INTO t_err SELECT i.sheet, i.row_num, i.sku, 'invalid_context_unit',
         format('context %s = "%s" is neither the base unit nor a declared alternative', ctx.k, ctx.v)
    FROM t_item i, LATERAL (VALUES ('purchase_unit', i.purchase_unit), ('recipe_unit', i.recipe_unit),
                         ('opname_unit', i.opname_unit), ('sales_unit', i.sales_unit)) AS ctx(k, v)
   WHERE ctx.v IS NOT NULL AND ctx.v <> i.eff_unit
     AND NOT EXISTS (SELECT 1 FROM t_eff_codes e WHERE e.sku = i.sku AND e.code = ctx.v);

  INSERT INTO t_err SELECT 'Units', MIN(u.row_num), p.sku, 'context_orphaned_by_units_replace',
         format('existing context %s = "%s" on product "%s" would no longer reference a declared unit', ctx.k, ctx.v, p.sku)
    FROM (SELECT DISTINCT product_sku FROM t_unit WHERE product_sku IS NOT NULL) fu
    JOIN products p ON p.sku = fu.product_sku AND p.deleted_at IS NULL
    JOIN product_unit_contexts c ON c.product_id = p.id
    JOIN t_unit u ON u.product_sku = fu.product_sku,
         LATERAL (VALUES ('stock_opname_unit', c.stock_opname_unit), ('recipe_unit', c.recipe_unit),
                         ('purchase_unit', c.purchase_unit), ('sales_unit', c.sales_unit)) AS ctx(k, v)
   WHERE ctx.v IS NOT NULL AND ctx.v <> p.unit
     AND NOT EXISTS (SELECT 1 FROM t_eff_codes e WHERE e.sku = p.sku AND e.code = ctx.v)
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = p.sku
          AND CASE ctx.k WHEN 'stock_opname_unit' THEN i.opname_unit WHEN 'recipe_unit' THEN i.recipe_unit
                WHEN 'purchase_unit' THEN i.purchase_unit WHEN 'sales_unit' THEN i.sales_unit END IS NOT NULL)
   GROUP BY p.sku, ctx.k, ctx.v;

  INSERT INTO t_err SELECT 'Recipes', row_num, product_sku, 'missing_required',
         'product_sku, material_sku and quantity are required'
    FROM t_rec WHERE product_sku IS NULL OR material_sku IS NULL OR quantity IS NULL;
  INSERT INTO t_err SELECT 'Recipes', row_num, product_sku, 'invalid_quantity', 'quantity must be > 0'
    FROM t_rec WHERE quantity IS NOT NULL AND quantity <= 0;
  INSERT INTO t_err SELECT 'Recipes', row_num, product_sku, 'self_reference',
         'a product cannot be its own material' FROM t_rec WHERE product_sku = material_sku;
  INSERT INTO t_err SELECT 'Recipes', MIN(row_num), product_sku, 'duplicate_recipe_line',
         format('material "%s" appears twice for product "%s"', material_sku, product_sku)
    FROM t_rec WHERE product_sku IS NOT NULL AND material_sku IS NOT NULL
   GROUP BY product_sku, material_sku HAVING COUNT(*) > 1;
  INSERT INTO t_err SELECT 'Recipes', r2.row_num, r2.product_sku, 'unknown_product',
         format('product_sku "%s" not found in file or database', r2.product_sku)
    FROM t_rec r2 WHERE r2.product_sku IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = r2.product_sku)
     AND NOT EXISTS (SELECT 1 FROM t_var v WHERE v.sku = r2.product_sku)
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = r2.product_sku AND p.deleted_at IS NULL);
  INSERT INTO t_err SELECT 'Recipes', r2.row_num, r2.product_sku, 'unknown_material',
         format('material_sku "%s" not found in file or database', r2.material_sku)
    FROM t_rec r2 WHERE r2.material_sku IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM t_item i WHERE i.sku = r2.material_sku)
     AND NOT EXISTS (SELECT 1 FROM t_var v WHERE v.sku = r2.material_sku)
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = r2.material_sku AND p.deleted_at IS NULL);

  FOR r IN
    SELECT DISTINCT rr.unit AS from_unit, COALESCE(i.eff_unit, p.unit) AS to_unit, rr.material_sku
      FROM t_rec rr LEFT JOIN t_item i ON i.sku = rr.material_sku
      LEFT JOIN products p ON p.sku = rr.material_sku AND p.deleted_at IS NULL
     WHERE rr.unit IS NOT NULL AND COALESCE(i.eff_unit, p.unit) IS NOT NULL
       AND rr.unit <> COALESCE(i.eff_unit, p.unit)
       AND NOT EXISTS (SELECT 1 FROM t_eff_codes e WHERE e.sku = rr.material_sku AND e.code = rr.unit)
  LOOP
    BEGIN
      v_probe := convert_quantity(1, r.from_unit, r.to_unit);
      IF v_probe IS NULL THEN RAISE EXCEPTION 'no_conversion'; END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO t_err SELECT 'Recipes', rr.row_num, rr.product_sku, 'unit_not_convertible',
             format('unit "%s" cannot be converted to material base unit "%s"', r.from_unit, r.to_unit)
        FROM t_rec rr WHERE rr.material_sku = r.material_sku AND rr.unit = r.from_unit;
    END;
  END LOOP;

  WITH RECURSIVE eff_edges AS (
    SELECT rr.product_sku, rr.material_sku FROM t_rec rr WHERE rr.product_sku IS NOT NULL AND rr.material_sku IS NOT NULL
    UNION ALL
    SELECT p.sku, m.sku FROM recipes rec JOIN products p ON p.id = rec.product_id AND p.deleted_at IS NULL
      JOIN products m ON m.id = rec.material_id AND m.deleted_at IS NULL
     WHERE rec.is_active = TRUE AND rec.deleted_at IS NULL
       AND p.sku NOT IN (SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL)),
  walk(start_sku, cur_sku, depth, path) AS (
    SELECT e.product_sku, e.material_sku, 1, ARRAY[e.product_sku, e.material_sku] FROM eff_edges e
     WHERE e.product_sku IN (SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL)
    UNION ALL
    SELECT w.start_sku, e.material_sku, w.depth + 1, w.path || e.material_sku FROM walk w
      JOIN eff_edges e ON e.product_sku = w.cur_sku WHERE w.depth < 7 AND NOT (e.material_sku = ANY(w.path))),
  cycles AS (SELECT DISTINCT w.start_sku FROM walk w JOIN eff_edges e ON e.product_sku = w.cur_sku WHERE e.material_sku = w.start_sku),
  too_deep AS (SELECT DISTINCT start_sku FROM walk WHERE depth > 5)
  INSERT INTO t_err SELECT 'Recipes', MIN(rr.row_num), c.start_sku, 'recipe_cycle',
         format('recipe of "%s" creates a cycle in the BOM graph', c.start_sku)
    FROM cycles c JOIN t_rec rr ON rr.product_sku = c.start_sku GROUP BY c.start_sku;

  WITH RECURSIVE eff_edges AS (
    SELECT rr.product_sku, rr.material_sku FROM t_rec rr WHERE rr.product_sku IS NOT NULL AND rr.material_sku IS NOT NULL
    UNION ALL
    SELECT p.sku, m.sku FROM recipes rec JOIN products p ON p.id = rec.product_id AND p.deleted_at IS NULL
      JOIN products m ON m.id = rec.material_id AND m.deleted_at IS NULL
     WHERE rec.is_active = TRUE AND rec.deleted_at IS NULL
       AND p.sku NOT IN (SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL)),
  walk(start_sku, cur_sku, depth, path) AS (
    SELECT e.product_sku, e.material_sku, 1, ARRAY[e.product_sku, e.material_sku] FROM eff_edges e
     WHERE e.product_sku IN (SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL)
    UNION ALL
    SELECT w.start_sku, e.material_sku, w.depth + 1, w.path || e.material_sku FROM walk w
      JOIN eff_edges e ON e.product_sku = w.cur_sku WHERE w.depth < 7 AND NOT (e.material_sku = ANY(w.path)))
  INSERT INTO t_err SELECT 'Recipes', MIN(rr.row_num), w.start_sku, 'recipe_depth_exceeded',
         format('recipe of "%s" exceeds the maximum BOM depth of 5', w.start_sku)
    FROM walk w JOIN t_rec rr ON rr.product_sku = w.start_sku WHERE w.depth > 5
     AND NOT EXISTS (SELECT 1 FROM t_err e WHERE e.code = 'recipe_cycle' AND e.sku = w.start_sku)
   GROUP BY w.start_sku;

  SELECT jsonb_build_object(
    'categories', jsonb_build_object(
      'create', (SELECT COUNT(*) FROM t_cat c WHERE c.name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.name = c.name AND x.deleted_at IS NULL)),
      'update', (SELECT COUNT(*) FROM t_cat c WHERE c.name IS NOT NULL AND EXISTS (SELECT 1 FROM categories x WHERE x.name = c.name AND x.deleted_at IS NULL))),
    'ingredients', jsonb_build_object(
      'create', (SELECT COUNT(*) FROM t_item i WHERE i.kind = 'ingredient' AND i.sku IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL)),
      'update', (SELECT COUNT(*) FROM t_item i WHERE i.kind = 'ingredient' AND EXISTS (SELECT 1 FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL))),
    'products', jsonb_build_object(
      'create', (SELECT COUNT(*) FROM t_item i WHERE i.kind = 'product' AND i.sku IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL)),
      'update', (SELECT COUNT(*) FROM t_item i WHERE i.kind = 'product' AND EXISTS (SELECT 1 FROM products p WHERE p.sku = i.sku AND p.deleted_at IS NULL))),
    'units', jsonb_build_object('replace_products', (SELECT COUNT(DISTINCT product_sku) FROM t_unit WHERE product_sku IS NOT NULL)),
    'variants', jsonb_build_object(
      'create', (SELECT COUNT(*) FROM t_var v WHERE v.sku IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = v.sku AND p.deleted_at IS NULL)),
      'update', (SELECT COUNT(*) FROM t_var v WHERE v.sku IS NOT NULL AND EXISTS (SELECT 1 FROM products p WHERE p.sku = v.sku AND p.deleted_at IS NULL))),
    'recipes', jsonb_build_object('products_replaced', (SELECT COUNT(DISTINCT product_sku) FROM t_rec WHERE product_sku IS NOT NULL))
  ) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object('sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY sheet, row_num), '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors, 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN RETURN v_report; END IF;

  IF EXISTS (SELECT 1 FROM t_item WHERE kind = 'ingredient' AND category IS NULL)
     AND NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Ingredients' AND deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM t_cat WHERE name = 'Ingredients') THEN
    v_slug_base := 'ingredients'; v_slug := v_slug_base; v_i := 1;
    WHILE EXISTS (SELECT 1 FROM categories WHERE slug = v_slug) LOOP v_i := v_i + 1; v_slug := v_slug_base || '-' || v_i; END LOOP;
    INSERT INTO categories (name, slug, sort_order, is_active, dispatch_station)
    VALUES ('Ingredients', v_slug, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories), TRUE, 'none');
  END IF;

  FOR r IN SELECT * FROM t_cat WHERE name IS NOT NULL ORDER BY row_num LOOP
    SELECT id INTO v_cat_id FROM categories WHERE name = r.name AND deleted_at IS NULL LIMIT 1;
    IF v_cat_id IS NOT NULL THEN
      UPDATE categories SET dispatch_station = r.dispatch_station, sort_order = COALESCE(r.sort_order, sort_order), is_active = TRUE WHERE id = v_cat_id;
    ELSE
      v_slug_base := trim(BOTH '-' FROM regexp_replace(lower(trim(r.name)), '[^a-z0-9]+', '-', 'g'));
      IF v_slug_base = '' THEN v_slug_base := 'category'; END IF;
      v_slug := v_slug_base; v_i := 1;
      WHILE EXISTS (SELECT 1 FROM categories WHERE slug = v_slug) LOOP v_i := v_i + 1; v_slug := v_slug_base || '-' || v_i; END LOOP;
      INSERT INTO categories (name, slug, sort_order, is_active, dispatch_station)
      VALUES (r.name, v_slug, COALESCE(r.sort_order, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories)), TRUE, r.dispatch_station);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM t_item ORDER BY row_num LOOP
    SELECT id INTO v_cat_id FROM categories WHERE name = COALESCE(r.category, 'Ingredients') AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NULL LIMIT 1;
    IF v_pid IS NULL THEN SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NOT NULL LIMIT 1; END IF;
    IF v_pid IS NOT NULL THEN
      UPDATE products SET name = r.name, category_id = COALESCE(v_cat_id, category_id),
        retail_price = COALESCE(r.retail_price, retail_price), wholesale_price = COALESCE(r.wholesale_price, wholesale_price),
        cost_price = COALESCE(r.cost_price, cost_price), description = COALESCE(r.description, description),
        image_url = COALESCE(r.image_url, image_url),
        visible_on_pos = CASE WHEN r.kind = 'ingredient' THEN visible_on_pos ELSE COALESCE(r.visible_on_pos, visible_on_pos) END,
        is_favorite = COALESCE(r.is_favorite, is_favorite), min_stock_threshold = COALESCE(r.min_stock_threshold, min_stock_threshold),
        default_shelf_life_hours = COALESCE(r.shelf_life_hours, default_shelf_life_hours),
        is_active = TRUE, deleted_at = NULL, updated_at = now() WHERE id = v_pid;
    ELSE
      INSERT INTO products (sku, name, category_id, unit, retail_price, wholesale_price, cost_price, description, image_url,
        visible_on_pos, available_for_sale, track_inventory, deduct_stock, is_active, is_favorite, min_stock_threshold, default_shelf_life_hours)
      VALUES (r.sku, r.name, v_cat_id, r.eff_unit, COALESCE(r.retail_price, 0), r.wholesale_price, COALESCE(r.cost_price, 0),
        r.description, r.image_url, CASE WHEN r.kind = 'ingredient' THEN FALSE ELSE COALESCE(r.visible_on_pos, TRUE) END,
        CASE WHEN r.kind = 'ingredient' THEN FALSE ELSE TRUE END, TRUE, TRUE, TRUE, COALESCE(r.is_favorite, FALSE),
        COALESCE(r.min_stock_threshold, 0), r.shelf_life_hours) RETURNING id INTO v_pid;
      INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
      VALUES (v_pid, r.eff_unit, r.eff_unit, r.eff_unit, r.eff_unit) ON CONFLICT (product_id) DO NOTHING;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM t_var ORDER BY row_num LOOP
    SELECT p.id, p.name, p.category_id, p.unit, p.retail_price, p.image_url INTO v_parent
      FROM products p WHERE p.sku = r.parent_sku AND p.deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NULL LIMIT 1;
    IF v_pid IS NULL THEN SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NOT NULL LIMIT 1; END IF;
    IF v_pid IS NOT NULL THEN
      UPDATE products SET variant_label = r.variant_label, variant_axis = r.variant_axis::variant_axis_type,
        variant_sort_order = r.sort_order, retail_price = COALESCE(r.retail_price, retail_price),
        image_url = COALESCE(r.image_url, image_url), parent_product_id = v_parent.id,
        is_active = TRUE, deleted_at = NULL, updated_at = now() WHERE id = v_pid;
    ELSE
      INSERT INTO products (sku, name, category_id, unit, retail_price, cost_price, image_url,
        visible_on_pos, available_for_sale, track_inventory, deduct_stock, is_active,
        parent_product_id, variant_label, variant_axis, variant_sort_order)
      VALUES (r.sku, v_parent.name || ' — ' || r.variant_label, v_parent.category_id, v_parent.unit,
        COALESCE(r.retail_price, v_parent.retail_price), 0, COALESCE(r.image_url, v_parent.image_url),
        TRUE, TRUE, TRUE, TRUE, TRUE, v_parent.id, r.variant_label, r.variant_axis::variant_axis_type, r.sort_order)
      RETURNING id INTO v_pid;
      INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
      VALUES (v_pid, v_parent.unit, v_parent.unit, v_parent.unit, v_parent.unit) ON CONFLICT (product_id) DO NOTHING;
    END IF;
  END LOOP;

  FOR r IN SELECT DISTINCT product_sku FROM t_unit WHERE product_sku IS NOT NULL LOOP
    SELECT id INTO v_pid FROM products WHERE sku = r.product_sku AND deleted_at IS NULL LIMIT 1;
    UPDATE product_unit_alternatives SET deleted_at = now(), updated_at = now()
     WHERE product_id = v_pid AND deleted_at IS NULL AND code NOT IN (SELECT code FROM t_unit WHERE product_sku = r.product_sku);
    INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, tags, display_order)
    SELECT v_pid, u.code, u.factor_to_base, u.tags, u.display_order FROM t_unit u WHERE u.product_sku = r.product_sku
    ON CONFLICT (product_id, code) WHERE deleted_at IS NULL
    DO UPDATE SET factor_to_base = EXCLUDED.factor_to_base, tags = EXCLUDED.tags, display_order = EXCLUDED.display_order, updated_at = now();
  END LOOP;

  FOR r IN SELECT * FROM t_item WHERE purchase_unit IS NOT NULL OR recipe_unit IS NOT NULL OR opname_unit IS NOT NULL OR sales_unit IS NOT NULL LOOP
    SELECT id INTO v_pid FROM products WHERE sku = r.sku AND deleted_at IS NULL LIMIT 1;
    INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
    VALUES (v_pid, COALESCE(r.opname_unit, r.eff_unit), COALESCE(r.recipe_unit, r.eff_unit),
            COALESCE(r.purchase_unit, r.eff_unit), COALESCE(r.sales_unit, r.eff_unit))
    ON CONFLICT (product_id) DO UPDATE SET
      stock_opname_unit = COALESCE(r.opname_unit, product_unit_contexts.stock_opname_unit),
      recipe_unit = COALESCE(r.recipe_unit, product_unit_contexts.recipe_unit),
      purchase_unit = COALESCE(r.purchase_unit, product_unit_contexts.purchase_unit),
      sales_unit = COALESCE(r.sales_unit, product_unit_contexts.sales_unit), updated_at = now();
  END LOOP;

  FOR r IN SELECT DISTINCT product_sku FROM t_rec WHERE product_sku IS NOT NULL LOOP
    SELECT id INTO v_pid FROM products WHERE sku = r.product_sku AND deleted_at IS NULL LIMIT 1;
    UPDATE recipes SET is_active = FALSE, deleted_at = now(), updated_at = now()
     WHERE product_id = v_pid AND is_active = TRUE AND deleted_at IS NULL;
    INSERT INTO recipes (product_id, material_id, quantity, unit, notes, is_active)
    SELECT v_pid, m.id, rr.quantity, COALESCE(rr.unit, m.unit), rr.notes, TRUE
      FROM t_rec rr JOIN products m ON m.sku = rr.material_sku AND m.deleted_at IS NULL WHERE rr.product_sku = r.product_sku;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'catalog.imported', 'catalog', NULL, v_summary);

  BEGIN
    INSERT INTO catalog_import_idempotency_keys (key, report, created_by) VALUES (p_idempotency_key, v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM catalog_import_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_catalog_v2(jsonb, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_catalog_v2(jsonb, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_catalog_v2(jsonb, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_catalog_v2(jsonb, boolean, uuid) TO service_role;
COMMENT ON FUNCTION public.import_catalog_v2(jsonb, boolean, uuid) IS
  'Import catalogue en masse (6 feuilles) : rapport de validation en dry-run, commit atomique upsert-par-SKU (produits/variantes soft-deleted restaurés). Porte catalog.import. Idempotence S25 saveur 2. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- import_suppliers_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_suppliers_v2(p_payload jsonb, p_dry_run boolean DEFAULT true, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  r           RECORD;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'suppliers.create') THEN
    RAISE EXCEPTION 'permission denied: suppliers.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_sup, t_err;

  CREATE TEMP TABLE t_sup ON COMMIT DROP AS
  SELECT ord::INT                                AS row_num,
         NULLIF(trim(elt->>'code'), '')          AS code,
         NULLIF(trim(elt->>'name'), '')          AS name,
         NULLIF(trim(elt->>'contact_phone'), '') AS contact_phone,
         NULLIF(trim(elt->>'contact_email'), '') AS contact_email,
         NULLIF(trim(elt->>'address'), '')       AS address,
         (elt->>'payment_terms_days')::NUMERIC   AS payment_terms_days,
         NULLIF(elt->>'notes', '')               AS notes,
         (elt->>'is_active')::BOOLEAN            AS is_active
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'missing_required', 'code and name are required'
    FROM t_sup WHERE code IS NULL OR name IS NULL;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'too_long', 'code must be <= 32 chars'
    FROM t_sup WHERE code IS NOT NULL AND char_length(code) > 32;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'too_long', 'name must be <= 120 chars'
    FROM t_sup WHERE name IS NOT NULL AND char_length(name) > 120;
  INSERT INTO t_err SELECT 'Suppliers', row_num, code, 'invalid_payment_terms',
         'payment_terms_days must be an integer between 0 and 365'
    FROM t_sup WHERE payment_terms_days IS NOT NULL
       AND (payment_terms_days <> floor(payment_terms_days) OR payment_terms_days < 0 OR payment_terms_days > 365);
  INSERT INTO t_err SELECT 'Suppliers', MIN(row_num), code, 'duplicate_code',
         format('code "%s" appears %s times in the file', code, COUNT(*))
    FROM t_sup WHERE code IS NOT NULL GROUP BY code HAVING COUNT(*) > 1;

  SELECT jsonb_build_object('Suppliers', jsonb_build_object(
    'create', (SELECT COUNT(*) FROM t_sup s WHERE s.code IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM suppliers x WHERE x.code = s.code AND x.deleted_at IS NULL)),
    'update', (SELECT COUNT(*) FROM t_sup s WHERE s.code IS NOT NULL
                 AND EXISTS (SELECT 1 FROM suppliers x WHERE x.code = s.code AND x.deleted_at IS NULL))
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  FOR r IN SELECT * FROM t_sup ORDER BY row_num LOOP
    IF EXISTS (SELECT 1 FROM suppliers WHERE code = r.code AND deleted_at IS NULL) THEN
      UPDATE suppliers SET
        name               = r.name,
        contact_phone      = r.contact_phone,
        contact_email      = r.contact_email,
        address            = r.address,
        payment_terms_days = COALESCE(r.payment_terms_days::INT, payment_terms_days),
        notes              = r.notes,
        is_active          = COALESCE(r.is_active, is_active),
        updated_at         = now()
      WHERE code = r.code AND deleted_at IS NULL;
    ELSE
      INSERT INTO suppliers (code, name, contact_phone, contact_email, address, payment_terms_days, notes, is_active)
      VALUES (r.code, r.name, r.contact_phone, r.contact_email, r.address,
              COALESCE(r.payment_terms_days::INT, 30), r.notes, COALESCE(r.is_active, TRUE));
    END IF;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'suppliers.imported', 'supplier', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'suppliers', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_suppliers_v2(jsonb, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_suppliers_v2(jsonb, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_suppliers_v2(jsonb, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_suppliers_v2(jsonb, boolean, uuid) TO service_role;
COMMENT ON FUNCTION public.import_suppliers_v2(jsonb, boolean, uuid) IS
  'Import fournisseurs en masse (upsert par code), rapport dry-run + commit atomique. Porte suppliers.create. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- import_purchases_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_purchases_v2(p_payload jsonb, p_dry_run boolean DEFAULT true, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  g           RECORD;
  v_po_id     UUID;
  v_po_number TEXT;
  v_supplier  UUID;
  v_subtotal  NUMERIC;
  v_terms     TEXT;
  v_date      DATE;
  v_notes     TEXT;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'purchasing.po.create') THEN
    RAISE EXCEPTION 'permission denied: purchasing.po.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_line, t_err;

  CREATE TEMP TABLE t_line ON COMMIT DROP AS
  SELECT ord::INT                                       AS row_num,
         NULLIF(trim(elt->>'po_reference'), '')         AS po_reference,
         NULLIF(trim(elt->>'supplier_code'), '')        AS supplier_code,
         NULLIF(trim(elt->>'order_date'), '')           AS order_date,
         COALESCE(NULLIF(trim(elt->>'payment_terms'),''),'credit') AS payment_terms,
         NULLIF(elt->>'notes', '')                      AS notes,
         NULLIF(trim(elt->>'product_sku'), '')          AS product_sku,
         (elt->>'quantity')::NUMERIC                    AS quantity,
         (elt->>'unit_cost')::NUMERIC                   AS unit_cost,
         NULLIF(trim(elt->>'unit'), '')                 AS unit
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'missing_required',
         'po_reference, supplier_code, order_date, product_sku, quantity, unit_cost, unit are required'
    FROM t_line WHERE po_reference IS NULL OR supplier_code IS NULL OR order_date IS NULL
       OR product_sku IS NULL OR quantity IS NULL OR unit_cost IS NULL OR unit IS NULL;
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_amount',
         'quantity and unit_cost must be greater than 0'
    FROM t_line WHERE (quantity IS NOT NULL AND quantity <= 0) OR (unit_cost IS NOT NULL AND unit_cost <= 0);
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_date',
         format('order_date "%s" must be YYYY-MM-DD', order_date)
    FROM t_line WHERE order_date IS NOT NULL AND order_date !~ '^\d{4}-\d{2}-\d{2}$';
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_payment_terms',
         format('payment_terms "%s" must be cash or credit', payment_terms)
    FROM t_line WHERE payment_terms NOT IN ('cash', 'credit');
  INSERT INTO t_err SELECT 'Purchases', row_num, product_sku, 'invalid_unit',
         'unit must be 1..16 characters'
    FROM t_line WHERE unit IS NOT NULL AND char_length(unit) NOT BETWEEN 1 AND 16;
  INSERT INTO t_err SELECT 'Purchases', l.row_num, l.supplier_code, 'unknown_supplier',
         format('supplier_code "%s" not found', l.supplier_code)
    FROM t_line l WHERE l.supplier_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.code = l.supplier_code AND s.deleted_at IS NULL);
  INSERT INTO t_err SELECT 'Purchases', l.row_num, l.product_sku, 'unknown_product',
         format('product_sku "%s" not found', l.product_sku)
    FROM t_line l WHERE l.product_sku IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = l.product_sku AND p.deleted_at IS NULL);
  INSERT INTO t_err SELECT 'Purchases', MIN(row_num), po_reference, 'inconsistent_header',
         format('po_reference "%s" has inconsistent supplier_code/order_date/payment_terms across its rows', po_reference)
    FROM t_line WHERE po_reference IS NOT NULL
    GROUP BY po_reference
    HAVING COUNT(DISTINCT supplier_code) > 1 OR COUNT(DISTINCT order_date) > 1
        OR COUNT(DISTINCT payment_terms) > 1;

  SELECT jsonb_build_object('Purchases', jsonb_build_object(
    'purchase_orders_created', (SELECT COUNT(DISTINCT po_reference) FROM t_line WHERE po_reference IS NOT NULL),
    'line_items_created',      (SELECT COUNT(*) FROM t_line WHERE po_reference IS NOT NULL)
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  FOR g IN SELECT po_reference, MIN(row_num) AS first_row
             FROM t_line GROUP BY po_reference ORDER BY MIN(row_num) LOOP
    SELECT s.id INTO v_supplier
      FROM t_line l JOIN suppliers s ON s.code = l.supplier_code AND s.deleted_at IS NULL
     WHERE l.po_reference = g.po_reference LIMIT 1;
    SELECT (SELECT payment_terms FROM t_line WHERE po_reference = g.po_reference LIMIT 1),
           (SELECT order_date::DATE FROM t_line WHERE po_reference = g.po_reference LIMIT 1),
           (SELECT notes FROM t_line WHERE po_reference = g.po_reference AND notes IS NOT NULL LIMIT 1),
           (SELECT SUM(quantity * unit_cost) FROM t_line WHERE po_reference = g.po_reference)
      INTO v_terms, v_date, v_notes, v_subtotal;

    v_po_number := 'PO-' || to_char(v_date, 'YYYYMMDD') || '-'
                || lpad(nextval('purchase_orders_seq')::TEXT, 4, '0');

    INSERT INTO purchase_orders (
      po_number, supplier_id, status, payment_terms, subtotal, vat_amount, total_amount,
      order_date, received_date, notes, is_historical_import, import_reference,
      created_by, received_by
    ) VALUES (
      v_po_number, v_supplier, 'received', v_terms, v_subtotal, 0, v_subtotal,
      v_date, v_date, v_notes, TRUE, g.po_reference, v_actor_profile, v_actor_profile
    ) RETURNING id INTO v_po_id;

    INSERT INTO purchase_order_items (
      po_id, product_id, quantity, received_quantity, unit, unit_cost, unit_factor_to_base
    )
    SELECT v_po_id, p.id, l.quantity, l.quantity, l.unit, l.unit_cost, 1
      FROM t_line l JOIN products p ON p.sku = l.product_sku AND p.deleted_at IS NULL
     WHERE l.po_reference = g.po_reference;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'purchases.imported', 'purchase_order', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'purchases', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_purchases_v2(jsonb, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_purchases_v2(jsonb, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_purchases_v2(jsonb, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_purchases_v2(jsonb, boolean, uuid) TO service_role;
COMMENT ON FUNCTION public.import_purchases_v2(jsonb, boolean, uuid) IS
  'Import achats historiques (groupés par po_reference, PO reçus sans GRN/stock/JE, reporting seul). Porte purchasing.po.create. v2 (2026-09-06) : audit_logs.actor_id, purchase_orders.created_by et received_by = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid(), 23503 pour tout compte créé par le back-office).';

-- ---------------------------------------------------------------------------
-- import_sales_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_sales_v2(p_payload jsonb, p_dry_run boolean DEFAULT true, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  g           RECORD;
  v_order_id  UUID;
  v_customer  UUID;
  v_type      order_type;
  v_method    payment_method;
  v_date      DATE;
  v_notes     TEXT;
  v_total     NUMERIC;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'sales.create') THEN
    RAISE EXCEPTION 'permission denied: sales.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_line, t_err;

  CREATE TEMP TABLE t_line ON COMMIT DROP AS
  SELECT ord::INT                                              AS row_num,
         NULLIF(trim(elt->>'sale_reference'), '')              AS sale_reference,
         NULLIF(trim(elt->>'sale_date'), '')                   AS sale_date,
         COALESCE(NULLIF(trim(elt->>'order_type'),''),'take_out')   AS order_type,
         COALESCE(NULLIF(trim(elt->>'payment_method'),''),'cash')   AS payment_method,
         NULLIF(trim(elt->>'customer_phone'), '')              AS customer_phone,
         NULLIF(elt->>'notes', '')                             AS notes,
         NULLIF(trim(elt->>'product_sku'), '')                 AS product_sku,
         (elt->>'quantity')::NUMERIC                           AS quantity,
         (elt->>'unit_price')::NUMERIC                         AS unit_price
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  INSERT INTO t_err SELECT 'Sales', row_num, product_sku, 'missing_required',
         'sale_reference, sale_date, product_sku, quantity, unit_price are required'
    FROM t_line WHERE sale_reference IS NULL OR sale_date IS NULL
       OR product_sku IS NULL OR quantity IS NULL OR unit_price IS NULL;
  INSERT INTO t_err SELECT 'Sales', row_num, product_sku, 'invalid_amount',
         'quantity and unit_price must be greater than 0'
    FROM t_line WHERE (quantity IS NOT NULL AND quantity <= 0) OR (unit_price IS NOT NULL AND unit_price <= 0);
  INSERT INTO t_err SELECT 'Sales', row_num, product_sku, 'invalid_date',
         format('sale_date "%s" must be YYYY-MM-DD', sale_date)
    FROM t_line WHERE sale_date IS NOT NULL AND sale_date !~ '^\d{4}-\d{2}-\d{2}$';
  INSERT INTO t_err SELECT 'Sales', row_num, product_sku, 'invalid_order_type',
         format('order_type "%s" must be one of dine_in, take_out, delivery, b2b', order_type)
    FROM t_line WHERE order_type NOT IN ('dine_in','take_out','delivery','b2b');
  INSERT INTO t_err SELECT 'Sales', row_num, product_sku, 'invalid_payment_method',
         format('payment_method "%s" must be one of cash, card, qris, edc, transfer, store_credit', payment_method)
    FROM t_line WHERE payment_method NOT IN ('cash','card','qris','edc','transfer','store_credit');
  INSERT INTO t_err SELECT 'Sales', l.row_num, l.product_sku, 'unknown_product',
         format('product_sku "%s" not found', l.product_sku)
    FROM t_line l WHERE l.product_sku IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.sku = l.product_sku AND p.deleted_at IS NULL);
  INSERT INTO t_err SELECT 'Sales', l.row_num, l.customer_phone, 'unknown_customer',
         format('customer_phone "%s" not found', l.customer_phone)
    FROM t_line l WHERE l.customer_phone IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.phone = l.customer_phone AND c.deleted_at IS NULL);
  INSERT INTO t_err SELECT 'Sales', MIN(row_num), sale_reference, 'inconsistent_header',
         format('sale_reference "%s" has inconsistent sale_date/order_type/payment_method/customer_phone across its rows', sale_reference)
    FROM t_line WHERE sale_reference IS NOT NULL
    GROUP BY sale_reference
    HAVING COUNT(DISTINCT sale_date) > 1 OR COUNT(DISTINCT order_type) > 1
        OR COUNT(DISTINCT payment_method) > 1 OR COUNT(DISTINCT COALESCE(customer_phone,'')) > 1;
  INSERT INTO t_err SELECT 'Sales', MIN(l.row_num), l.sale_reference, 'duplicate_reference',
         format('sale_reference "%s" was already imported', l.sale_reference)
    FROM t_line l WHERE l.sale_reference IS NOT NULL
       AND EXISTS (SELECT 1 FROM orders o WHERE o.import_reference = l.sale_reference AND o.is_historical_import)
    GROUP BY l.sale_reference;

  SELECT jsonb_build_object('Sales', jsonb_build_object(
    'orders_created',    (SELECT COUNT(DISTINCT sale_reference) FROM t_line WHERE sale_reference IS NOT NULL),
    'line_items_created',(SELECT COUNT(*) FROM t_line WHERE sale_reference IS NOT NULL)
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  FOR g IN SELECT sale_reference, MIN(row_num) AS first_row
             FROM t_line GROUP BY sale_reference ORDER BY MIN(row_num) LOOP
    SELECT (SELECT order_type::order_type   FROM t_line WHERE sale_reference = g.sale_reference LIMIT 1),
           (SELECT payment_method::payment_method FROM t_line WHERE sale_reference = g.sale_reference LIMIT 1),
           (SELECT sale_date::DATE          FROM t_line WHERE sale_reference = g.sale_reference LIMIT 1),
           (SELECT notes FROM t_line WHERE sale_reference = g.sale_reference AND notes IS NOT NULL LIMIT 1),
           (SELECT SUM(quantity * unit_price) FROM t_line WHERE sale_reference = g.sale_reference)
      INTO v_type, v_method, v_date, v_notes, v_total;

    SELECT c.id INTO v_customer
      FROM t_line l JOIN customers c ON c.phone = l.customer_phone AND c.deleted_at IS NULL
     WHERE l.sale_reference = g.sale_reference AND l.customer_phone IS NOT NULL LIMIT 1;

    INSERT INTO orders (
      order_number, order_type, status, subtotal, tax_amount, total,
      created_at, paid_at, created_via, customer_id, served_by,
      is_historical_import, import_reference, notes
    ) VALUES (
      'IMP-' || g.sale_reference, v_type, 'paid', v_total, 0, v_total,
      v_date::timestamptz, v_date::timestamptz, 'import', v_customer, v_actor_profile,
      TRUE, g.sale_reference, v_notes
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total
    )
    SELECT v_order_id, p.id, p.name, l.unit_price, l.quantity, l.quantity * l.unit_price
      FROM t_line l JOIN products p ON p.sku = l.product_sku AND p.deleted_at IS NULL
     WHERE l.sale_reference = g.sale_reference;

    INSERT INTO order_payments (order_id, method, amount, paid_at)
    VALUES (v_order_id, v_method, v_total, v_date::timestamptz);
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'sales.imported', 'orders', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'sales', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_sales_v2(jsonb, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_sales_v2(jsonb, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_sales_v2(jsonb, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_sales_v2(jsonb, boolean, uuid) TO service_role;
COMMENT ON FUNCTION public.import_sales_v2(jsonb, boolean, uuid) IS
  'Import ventes historiques (groupées par sale_reference, commandes payées + lignes + un paiement, sans JE/stock/fidélité, reporting seul). Porte sales.create. v2 (2026-09-06) : audit_logs.actor_id et orders.served_by = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid(), 23503 pour tout compte créé par le back-office).';

-- ---------------------------------------------------------------------------
-- import_expenses_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_expenses_v2(p_payload jsonb, p_dry_run boolean DEFAULT true, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller    UUID := auth.uid();
  v_existing  JSONB;
  v_errors    JSONB;
  v_summary   JSONB;
  v_report    JSONB;
  v_err_count INT;
  r           RECORD;
  v_cat       UUID;
  v_expno     TEXT;
BEGIN
  IF v_caller IS NULL OR NOT has_permission(v_caller, 'expenses.create') THEN
    RAISE EXCEPTION 'permission denied: expenses.create required' USING ERRCODE = '42501';
  END IF;

  IF NOT p_dry_run THEN
    IF p_idempotency_key IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
    END IF;
    SELECT report INTO v_existing
      FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS t_exp, t_err;

  CREATE TEMP TABLE t_exp ON COMMIT DROP AS
  SELECT ord::INT                                          AS row_num,
         NULLIF(trim(elt->>'expense_date'), '')            AS expense_date,
         NULLIF(trim(elt->>'category'), '')                AS category,
         NULLIF(elt->>'description', '')                   AS description,
         (elt->>'amount')::NUMERIC                         AS amount,
         COALESCE((elt->>'vat_amount')::NUMERIC, 0)        AS vat_amount,
         COALESCE(NULLIF(trim(elt->>'payment_method'),''),'cash') AS payment_method,
         NULLIF(trim(elt->>'vendor_name'), '')             AS vendor_name
    FROM jsonb_array_elements(COALESCE(p_payload, '[]'::jsonb)) WITH ORDINALITY AS t(elt, ord);

  CREATE TEMP TABLE t_err (sheet TEXT, row_num INT, sku TEXT, code TEXT, message TEXT) ON COMMIT DROP;

  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'missing_required',
         'expense_date, category, description, amount are required'
    FROM t_exp WHERE expense_date IS NULL OR category IS NULL OR description IS NULL OR amount IS NULL;
  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'invalid_amount',
         'amount must be greater than 0'
    FROM t_exp WHERE amount IS NOT NULL AND amount <= 0;
  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'invalid_vat',
         'vat_amount must be 0 or greater'
    FROM t_exp WHERE vat_amount IS NOT NULL AND vat_amount < 0;
  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'invalid_date',
         format('expense_date "%s" must be YYYY-MM-DD', expense_date)
    FROM t_exp WHERE expense_date IS NOT NULL AND expense_date !~ '^\d{4}-\d{2}-\d{2}$';
  INSERT INTO t_err SELECT 'Expenses', row_num, category, 'invalid_payment_method',
         format('payment_method "%s" must be one of cash, transfer, card, credit', payment_method)
    FROM t_exp WHERE payment_method NOT IN ('cash','transfer','card','credit');
  INSERT INTO t_err SELECT 'Expenses', e.row_num, e.category, 'unknown_category',
         format('category "%s" not found (expense category code or name)', e.category)
    FROM t_exp e WHERE e.category IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM expense_categories ec
                        WHERE ec.code = e.category OR lower(ec.name) = lower(e.category));

  SELECT jsonb_build_object('Expenses', jsonb_build_object(
    'expenses_created', (SELECT COUNT(*) FROM t_exp)
  )) INTO v_summary;

  SELECT COUNT(*), COALESCE(jsonb_agg(jsonb_build_object(
           'sheet', sheet, 'row', row_num, 'sku', sku, 'code', code, 'message', message) ORDER BY row_num),
         '[]'::jsonb)
    INTO v_err_count, v_errors FROM t_err;

  v_report := jsonb_build_object('valid', v_err_count = 0, 'errors', v_errors,
                                 'summary', v_summary, 'idempotent_replay', false);

  IF p_dry_run OR v_err_count > 0 THEN
    RETURN v_report;
  END IF;

  FOR r IN SELECT * FROM t_exp ORDER BY row_num LOOP
    SELECT ec.id INTO v_cat FROM expense_categories ec
      WHERE ec.code = r.category OR lower(ec.name) = lower(r.category)
      ORDER BY (ec.code = r.category) DESC LIMIT 1;

    v_expno := 'IMP-EXP-' || lpad(nextval('historical_expenses_seq')::TEXT, 6, '0');

    INSERT INTO expenses (
      expense_number, category_id, amount, vat_amount, payment_method, description,
      vendor_name, expense_date, status, is_historical_import,
      created_by, submitted_by, approved_by, paid_by,
      submitted_at, approved_at, paid_at
    ) VALUES (
      v_expno, v_cat, r.amount, r.vat_amount, r.payment_method, r.description,
      r.vendor_name, r.expense_date::DATE, 'paid', TRUE,
      v_actor_profile, v_actor_profile, v_actor_profile, v_actor_profile,
      r.expense_date::timestamptz, r.expense_date::timestamptz, r.expense_date::timestamptz
    );
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'expenses.imported', 'expenses', NULL, v_summary);

  BEGIN
    INSERT INTO import_master_data_idempotency_keys (key, entity, report, created_by)
    VALUES (p_idempotency_key, 'expenses', v_report, v_caller);
  EXCEPTION WHEN unique_violation THEN
    SELECT report INTO v_existing FROM import_master_data_idempotency_keys WHERE key = p_idempotency_key;
    RETURN v_existing || jsonb_build_object('idempotent_replay', true);
  END;

  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_expenses_v2(jsonb, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_expenses_v2(jsonb, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_expenses_v2(jsonb, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_expenses_v2(jsonb, boolean, uuid) TO service_role;
COMMENT ON FUNCTION public.import_expenses_v2(jsonb, boolean, uuid) IS
  'Import dépenses historiques (insérées payées, sans JE, reporting seul). Porte expenses.create. v2 (2026-09-06) : audit_logs.actor_id et expenses.created_by / submitted_by / approved_by / paid_by = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid(), 23503 pour tout compte créé par le back-office).';

-- ---------------------------------------------------------------------------
-- Anciennes versions droppées (versioning monotone)
-- ---------------------------------------------------------------------------
DROP FUNCTION public.import_catalog_v1(jsonb, boolean, uuid);
DROP FUNCTION public.import_suppliers_v1(jsonb, boolean, uuid);
DROP FUNCTION public.import_purchases_v1(jsonb, boolean, uuid);
DROP FUNCTION public.import_sales_v1(jsonb, boolean, uuid);
DROP FUNCTION public.import_expenses_v1(jsonb, boolean, uuid);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
