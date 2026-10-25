-- Frontière de calcul conservée par commande ; aucune reclassification historique.
ALTER TABLE public.orders ADD COLUMN recipe_consumption_revision smallint
  CONSTRAINT orders_recipe_consumption_revision_check CHECK (recipe_consumption_revision = 2);
COMMENT ON COLUMN public.orders.recipe_consumption_revision IS
  'NULL: calcul historique ; 2: consommation normalisée par chemin. Écrit uniquement lors de la consommation réussie.';

CREATE OR REPLACE FUNCTION public._resolve_recipe_consumption_legacy_v1(p_product_id uuid, p_qty numeric, p_max_depth integer DEFAULT 5)
 RETURNS TABLE(product_id uuid, qty_base numeric, unit text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ligne  RECORD;
  v_converti NUMERIC;
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
             (w.qty * cr.quantity::NUMERIC),
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
           SUM(w.qty)        AS qty_ligne,
           MIN(w.line_unit)  AS unite_ligne,
           p.unit            AS unite_stock,
           p.name            AS materiau_nom
      FROM walk w
      JOIN products p ON p.id = w.material_id
     WHERE p.track_inventory = TRUE
     GROUP BY w.material_id, p.unit, p.name
  LOOP
    -- Strict (F1) : une paire inconvertible echoue, elle ne se rabat plus sur la
    -- quantite brute. Le message nomme la matiere.
    BEGIN
      v_converti := public.convert_quantity(v_ligne.qty_ligne, v_ligne.unite_ligne, v_ligne.unite_stock);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'unit_conversion_missing: % (% -> %)',
        v_ligne.materiau_nom, v_ligne.unite_ligne, v_ligne.unite_stock
        USING ERRCODE = 'P0002';
    END;

    IF v_converti > 0 THEN
      product_id := v_ligne.materiau_id;
      qty_base   := v_converti;
      unit       := v_ligne.unite_stock;
      RETURN NEXT;
    END IF;
  END LOOP;
END $function$
;
REVOKE ALL ON FUNCTION public._resolve_recipe_consumption_legacy_v1(uuid,numeric,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._resolve_recipe_consumption_legacy_v1(uuid,numeric,integer) TO service_role;

CREATE FUNCTION public._resolve_order_recipe_restoration_v1(p_order_id uuid, p_product_id uuid, p_qty numeric, p_max_depth integer DEFAULT 5)
RETURNS TABLE(product_id uuid, qty_base numeric, unit text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public
AS $function$
DECLARE v_revision smallint;
BEGIN
  SELECT o.recipe_consumption_revision INTO v_revision FROM public.orders o WHERE o.id=p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_revision IS NULL THEN
    RETURN QUERY SELECT * FROM public._resolve_recipe_consumption_legacy_v1(p_product_id,p_qty,p_max_depth);
  ELSIF v_revision=2 THEN
    RETURN QUERY SELECT * FROM public._resolve_recipe_consumption_v2(p_product_id,p_qty,p_max_depth);
  ELSE
    RAISE EXCEPTION 'recipe_consumption_revision_unknown' USING ERRCODE='P0002';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public._resolve_order_recipe_restoration_v1(uuid,uuid,numeric,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._resolve_order_recipe_restoration_v1(uuid,uuid,numeric,integer) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
