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
