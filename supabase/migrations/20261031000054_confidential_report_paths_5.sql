CREATE OR REPLACE FUNCTION public.get_stock_config_issues_v3()
 RETURNS TABLE(product_id uuid, sku text, name text, category_name text, issue_type text, severity text, track_inventory boolean, deduct_stock boolean, recipe_lines integer, current_stock numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v1(current_date,current_date);


  RETURN QUERY
  WITH base AS (
    SELECT
      p.id, p.sku, p.name, c.name AS category_name,
      p.track_inventory, p.deduct_stock, p.is_display_item,
      p.visible_on_pos, p.is_active, p.product_type, p.current_stock,
      (SELECT count(*)::int FROM recipes r
        WHERE r.product_id = p.id AND r.is_active AND r.deleted_at IS NULL) AS recipe_lines,
      EXISTS (SELECT 1 FROM recipes r2
        WHERE r2.material_id = p.id AND r2.is_active AND r2.deleted_at IS NULL) AS used_as_ingredient
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.deleted_at IS NULL
  ),
  issues AS (
    SELECT b.id, b.sku, b.name, b.category_name,
           'negative_stock'::text AS issue_type, 'critical'::text AS severity,
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.track_inventory = true AND b.current_stock < 0
    UNION ALL
    -- v2 (F1) : paire d unites inconvertible entre la ligne de recette et le stock de
    -- la matiere. La vente ECHOUE desormais sur cette ligne — l anomalie doit se voir
    -- avant l encaissement. Predicat = miroir exact du corps de convert_quantity.
    SELECT b.id, b.sku, b.name, b.category_name,
           'unconvertible_recipe_unit', 'critical',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE EXISTS (
       SELECT 1
         FROM recipes r
         JOIN products m ON m.id = r.material_id
        WHERE r.product_id = b.id
          AND r.is_active AND r.deleted_at IS NULL
          AND m.track_inventory = true
          AND r.unit <> m.unit
          AND NOT EXISTS (
                SELECT 1 FROM unit_conversions uc
                 WHERE uc.from_unit = r.unit AND uc.to_unit = m.unit)
          AND NOT EXISTS (
                SELECT 1
                  FROM units uf
                  JOIN units ut ON ut.dimension = uf.dimension
                 WHERE uf.code = r.unit AND ut.code = m.unit
                   AND uf.factor_to_canonical IS NOT NULL
                   AND ut.factor_to_canonical IS NOT NULL)
     )
    UNION ALL
    SELECT b.id, b.sku, b.name, b.category_name,
           'sale_deduct_no_recipe', 'warning',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.is_active = true AND b.visible_on_pos = true
       AND b.product_type <> 'combo' AND b.is_display_item = false
       AND b.track_inventory = false AND b.deduct_stock = true
       AND b.recipe_lines = 0
    UNION ALL
    SELECT b.id, b.sku, b.name, b.category_name,
           'orphan_recipe', 'warning',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.deduct_stock = false AND b.recipe_lines > 0
    UNION ALL
    SELECT b.id, b.sku, b.name, b.category_name,
           'tracked_recipe_at_prod', 'info',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.is_active = true AND b.visible_on_pos = true
       AND b.product_type <> 'combo' AND b.is_display_item = false
       AND b.track_inventory = true AND b.deduct_stock = true
       AND b.recipe_lines > 0 AND b.used_as_ingredient = false
  )
  SELECT i.id, i.sku, i.name, i.category_name, i.issue_type, i.severity,
         i.track_inventory, i.deduct_stock, i.recipe_lines, i.current_stock
    FROM issues i
   ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
            i.category_name, i.name;
END $function$
;
DROP FUNCTION public.get_stock_config_issues_v2();
REVOKE ALL ON FUNCTION public.get_stock_config_issues_v3() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stock_config_issues_v3() TO authenticated;

