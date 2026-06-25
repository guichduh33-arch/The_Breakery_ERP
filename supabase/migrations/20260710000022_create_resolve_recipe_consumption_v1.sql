-- 20260710000022_create_resolve_recipe_consumption_v1.sql
-- Helper interne : résout la consommation de recette d'un produit fait-à-la-
-- commande (track_inventory=false) à la VENTE, avec la règle "arrêt aux nœuds
-- suivis" : on descend uniquement à travers les composants NON suivis et on
-- émet uniquement les nœuds suivis (track_inventory=true). Mêmes hypothèses de
-- conversion d'unité que recipe_bom_full_v1 (_try_convert_quantity, fallback raw).

CREATE OR REPLACE FUNCTION public._resolve_recipe_consumption_v1(
  p_product_id UUID,
  p_qty        NUMERIC,
  p_max_depth  INT DEFAULT 5
) RETURNS TABLE(product_id UUID, qty_base NUMERIC, unit TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
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
           (w.qty * cr.quantity::NUMERIC),
           cr.unit,
           w.depth + 1,
           w.path || cr.material_id
      FROM walk w
      JOIN products wp ON wp.id = w.material_id
      JOIN recipes  cr ON cr.product_id = w.material_id
                       AND cr.is_active = TRUE
                       AND cr.deleted_at IS NULL
     WHERE wp.track_inventory = FALSE          -- descendre uniquement sous les non-suivis
       AND w.depth < p_max_depth
       AND NOT (cr.material_id = ANY(w.path))   -- garde-cycle
  )
  SELECT w.material_id,
         public._try_convert_quantity(SUM(w.qty), MIN(w.line_unit), p.unit) AS qty_base,
         p.unit
    FROM walk w
    JOIN products p ON p.id = w.material_id
   WHERE p.track_inventory = TRUE               -- émettre uniquement les nœuds suivis
   GROUP BY w.material_id, p.unit
  HAVING public._try_convert_quantity(SUM(w.qty), MIN(w.line_unit), p.unit) > 0;
END $$;

-- INTERNAL helper : appelé uniquement depuis les RPC SECURITY DEFINER (complete_order).
-- Comme record_stock_movement_v1 et _resolve_modifier_ingredients_v1, on révoque
-- AUSSI authenticated (REVOKE FROM PUBLIC seul laisse authenticated exécuter via
-- son grant direct par défaut).
REVOKE ALL ON FUNCTION public._resolve_recipe_consumption_v1(UUID, NUMERIC, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_recipe_consumption_v1(UUID, NUMERIC, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._resolve_recipe_consumption_v1(UUID, NUMERIC, INT) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._resolve_recipe_consumption_v1(UUID, NUMERIC, INT) IS
  'INTERNAL. Cascade de consommation à la vente d''un produit fait-à-la-commande. '
  'Descend à travers les composants non suivis, s''arrête et émet les nœuds suivis '
  '(track_inventory=true). Quantités converties dans l''unité stock du nœud. '
  'Appelé par complete_order_with_payment_v14 (SECURITY DEFINER).';
