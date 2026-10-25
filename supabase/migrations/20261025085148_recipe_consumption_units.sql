-- Corps live ; conversions cohérentes et fermeture des appelants versionnés.
CREATE OR REPLACE FUNCTION public._resolve_recipe_consumption_v2(p_product_id uuid, p_qty numeric, p_max_depth integer DEFAULT 5)
 RETURNS TABLE(product_id uuid, qty_base numeric, unit text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ligne  RECORD;
  v_converti NUMERIC;
  v_chemin RECORD;
BEGIN
  FOR v_ligne IN
    WITH RECURSIVE walk AS (
      SELECT r.material_id,
             (p_qty * r.quantity::NUMERIC) AS qty,
             r.unit AS line_unit,
             1 AS depth,
             ARRAY[r.product_id, r.material_id]::UUID[] AS path
        FROM recipes r
       WHERE r.product_id = p_product_id
         AND r.is_active = TRUE
         AND r.deleted_at IS NULL
      UNION ALL
      SELECT cr.material_id,
             (public.convert_quantity(w.qty, w.line_unit, wp.unit) * cr.quantity::NUMERIC),
             cr.unit,
             w.depth + 1,
             w.path || cr.material_id
        FROM walk w
        JOIN products wp ON wp.id = w.material_id
        JOIN recipes  cr ON cr.product_id = w.material_id
                         AND cr.is_active = TRUE
                         AND cr.deleted_at IS NULL
       WHERE wp.track_inventory = FALSE
         AND w.depth < p_max_depth
         AND NOT (cr.material_id = ANY(w.path))
    )
    SELECT w.material_id     AS materiau_id,
           jsonb_agg(jsonb_build_object('qty', w.qty, 'unit', w.line_unit)) AS chemins,
           p.unit            AS unite_stock,
           p.name            AS materiau_nom
      FROM walk w
      JOIN products p ON p.id = w.material_id
     WHERE p.track_inventory = TRUE
     GROUP BY w.material_id, p.unit, p.name
  LOOP
    -- Chaque chemin est normalisé avant la somme du matériau partagé.
    v_converti := 0;
    FOR v_chemin IN
      SELECT (chemin->>'qty')::numeric AS qty, chemin->>'unit' AS unit
      FROM jsonb_array_elements(v_ligne.chemins) AS chemin
    LOOP
      BEGIN
        v_converti := v_converti + public.convert_quantity(v_chemin.qty, v_chemin.unit, v_ligne.unite_stock);
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'unit_conversion_missing: % (% -> %)',
          v_ligne.materiau_nom, v_chemin.unit, v_ligne.unite_stock
          USING ERRCODE = 'P0002';
      END;
    END LOOP;

    IF v_converti > 0 THEN
      product_id := v_ligne.materiau_id;
      qty_base   := v_converti;
      unit       := v_ligne.unite_stock;
      RETURN NEXT;
    END IF;
  END LOOP;
END $function$
;
REVOKE ALL ON FUNCTION public._resolve_recipe_consumption_v2(p_product_id uuid, p_qty numeric, p_max_depth integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._resolve_recipe_consumption_v2(p_product_id uuid, p_qty numeric, p_max_depth integer) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public._resolve_recipe_consumption_v1(p_product_id uuid, p_qty numeric, p_max_depth integer);
