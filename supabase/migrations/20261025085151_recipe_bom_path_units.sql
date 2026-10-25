-- Corps live ; conversions cohérentes et fermeture des appelants versionnés.
CREATE OR REPLACE FUNCTION public.recipe_bom_full_v3(p_product_id uuid, p_max_depth integer DEFAULT 5)
 RETURNS TABLE(material_id uuid, material_name text, material_unit text, recipe_unit text, qty_per_unit numeric, current_stock numeric, cost_price numeric, qty_in_base numeric, line_cost numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_depth IS NULL OR p_max_depth < 1 OR p_max_depth > 20 THEN
    RAISE EXCEPTION 'invalid_max_depth' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
    SELECT r.product_id    AS root_id,
           r.material_id,
           r.quantity::NUMERIC      AS qty,
           r.unit          AS line_unit,
           1               AS depth,
           ARRAY[r.product_id, r.material_id]::UUID[] AS path,
           COALESCE(m.track_inventory, TRUE) AS is_stocked
      FROM recipes r
      JOIN products m ON m.id = r.material_id
     WHERE r.product_id = p_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT w.root_id,
           r.material_id,
           (public.convert_quantity(w.qty, w.line_unit, parent.unit) * r.quantity::NUMERIC),
           r.unit,
           w.depth + 1,
           w.path || r.material_id,
           COALESCE(m.track_inventory, TRUE)
      FROM walk w
      JOIN products parent ON parent.id = w.material_id
      JOIN recipes r
        ON r.product_id = w.material_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
      JOIN products m ON m.id = r.material_id
     WHERE w.depth < p_max_depth
       AND w.is_stocked = FALSE
       AND NOT (r.material_id = ANY(w.path))
  ),
  leaf_paths AS (
    SELECT w.material_id, w.qty, w.line_unit, p.unit AS stock_unit,
           MIN(w.line_unit) OVER (PARTITION BY w.material_id) AS output_unit
      FROM walk w
      JOIN products p ON p.id = w.material_id
     WHERE w.is_stocked = TRUE
        OR NOT EXISTS (
             SELECT 1 FROM recipes c
              WHERE c.product_id = w.material_id
                AND c.is_active = TRUE
                AND c.deleted_at IS NULL
           )
  ),
  normalized AS (
    SELECT l.material_id, l.output_unit,
           public.convert_quantity(l.qty, l.line_unit, l.output_unit) AS qty_output,
           public.convert_quantity(l.qty, l.line_unit, l.stock_unit) AS qty_base
      FROM leaf_paths l
  ),
  leaves AS (
    SELECT n.material_id, n.output_unit AS recipe_unit,
           SUM(n.qty_output) AS qty_agg,
           SUM(n.qty_base) AS qty_base
      FROM normalized n
     GROUP BY n.material_id, n.output_unit
  )
  SELECT l.material_id,
         p.name,
         p.unit,
         l.recipe_unit,
         l.qty_agg,
         p.current_stock,
         p.cost_price,
         l.qty_base,
         l.qty_base * COALESCE(p.cost_price, 0) AS line_cost
    FROM leaves l
    JOIN products p ON p.id = l.material_id
   ORDER BY p.name;
END $function$
;
REVOKE ALL ON FUNCTION public.recipe_bom_full_v3(p_product_id uuid, p_max_depth integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recipe_bom_full_v3(p_product_id uuid, p_max_depth integer) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.recipe_bom_full_v2(p_product_id uuid, p_max_depth integer);
