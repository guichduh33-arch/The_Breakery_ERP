-- Audit UX/UI 2026-08-13, lot 5 — tri par colonne de la liste Inventory.
-- get_stock_levels_v3 n'exposait aucun paramètre de tri : la page paginait
-- serveur (limit/offset) sans pouvoir trier. v4 ajoute p_sort/p_sort_dir en
-- ALLOWLIST stricte (aucun SQL dynamique) ; p_sort NULL conserve l'ordre
-- historique (déficit de stock d'abord, puis nom). Corps de départ =
-- pg_get_functiondef live de v3 (gate inventory.read inchangé).
-- Call-sites repointés dans le même commit : useStockLevels (Inventory) et
-- usePaletteSearch (palette lot 4).

CREATE OR REPLACE FUNCTION public.get_stock_levels_v4(
  p_category_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_bucket stock_bucket DEFAULT 'all'::stock_bucket,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_sort text DEFAULT NULL,
  p_sort_dir text DEFAULT 'asc'
)
 RETURNS TABLE(product_id uuid, sku text, name text, category_id uuid, category_name text, current_stock numeric, min_stock_threshold numeric, track_inventory boolean, unit text, stock_value numeric, last_movement_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dir text := lower(COALESCE(p_sort_dir, 'asc'));
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_sort IS NOT NULL AND p_sort NOT IN ('name', 'sku', 'category', 'stock', 'min', 'value', 'last_movement') THEN
    RAISE EXCEPTION 'invalid p_sort: %', p_sort USING ERRCODE='22023';
  END IF;
  IF v_dir NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'invalid p_sort_dir: %', p_sort_dir USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT sub.product_id, sub.sku, sub.name, sub.category_id, sub.category_name,
         sub.current_stock, sub.min_stock_threshold, sub.track_inventory,
         sub.unit, sub.stock_value, sub.last_movement_at
  FROM (
    SELECT p.id AS product_id, p.sku, p.name, p.category_id, c.name AS category_name,
           p.current_stock, p.min_stock_threshold, p.track_inventory,
           p.unit, (p.current_stock * p.cost_price)::numeric AS stock_value,
           (SELECT max(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id) AS last_movement_at,
           CASE WHEN p.track_inventory AND p.min_stock_threshold > 0
                THEN p.min_stock_threshold - p.current_stock
           END AS shortfall
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.deleted_at IS NULL
       AND (p_category_id IS NULL OR p.category_id = p_category_id)
       AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%')
       AND CASE COALESCE(p_bucket, 'all'::public.stock_bucket)
             WHEN 'all'       THEN TRUE
             WHEN 'low'       THEN p.track_inventory AND p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold
             WHEN 'zero'      THEN p.track_inventory AND p.current_stock = 0
             WHEN 'negative'  THEN p.track_inventory AND p.current_stock < 0
             WHEN 'untracked' THEN NOT p.track_inventory
           END
  ) sub
  ORDER BY
    CASE WHEN p_sort IS NULL THEN sub.shortfall END DESC NULLS LAST,
    CASE WHEN v_dir = 'asc' THEN
      CASE p_sort WHEN 'name' THEN sub.name WHEN 'sku' THEN sub.sku WHEN 'category' THEN sub.category_name END
    END ASC NULLS LAST,
    CASE WHEN v_dir = 'desc' THEN
      CASE p_sort WHEN 'name' THEN sub.name WHEN 'sku' THEN sub.sku WHEN 'category' THEN sub.category_name END
    END DESC NULLS LAST,
    CASE WHEN v_dir = 'asc' THEN
      CASE p_sort WHEN 'stock' THEN sub.current_stock WHEN 'min' THEN sub.min_stock_threshold WHEN 'value' THEN sub.stock_value END
    END ASC NULLS LAST,
    CASE WHEN v_dir = 'desc' THEN
      CASE p_sort WHEN 'stock' THEN sub.current_stock WHEN 'min' THEN sub.min_stock_threshold WHEN 'value' THEN sub.stock_value END
    END DESC NULLS LAST,
    CASE WHEN v_dir = 'asc' AND p_sort = 'last_movement' THEN sub.last_movement_at END ASC NULLS LAST,
    CASE WHEN v_dir = 'desc' AND p_sort = 'last_movement' THEN sub.last_movement_at END DESC NULLS LAST,
    sub.name
  LIMIT p_limit OFFSET p_offset;
END $function$;

DROP FUNCTION public.get_stock_levels_v3(uuid, text, public.stock_bucket, integer, integer);

REVOKE EXECUTE ON FUNCTION public.get_stock_levels_v4(uuid, text, public.stock_bucket, integer, integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stock_levels_v4(uuid, text, public.stock_bucket, integer, integer, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_stock_levels_v4(uuid, text, public.stock_bucket, integer, integer, text, text) TO authenticated;

COMMENT ON FUNCTION public.get_stock_levels_v4(uuid, text, public.stock_bucket, integer, integer, text, text) IS
  'Niveaux de stock paginés (Inventory + palette). Gate: inventory.read. '
  'v4 (audit UX/UI lot 5): + p_sort allowlist (name|sku|category|stock|min|value|last_movement) '
  'et p_sort_dir (asc|desc) ; p_sort NULL = ordre historique deficit-first. anon-callable: no';

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
