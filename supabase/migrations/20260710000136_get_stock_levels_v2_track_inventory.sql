-- 20260710000136_get_stock_levels_v2_track_inventory.sql
-- Audit 2026-07-08 — la liste Inventory (get_stock_levels_v1) affichait un
-- current_stock pour TOUS les produits, y compris les non-suivis
-- (track_inventory=false = illimités, sans stock propre) → chiffre trompeur.
-- v2 ajoute la colonne track_inventory pour que le BO rende "Non suivi".
-- Bump monotone : DROP v1 + CREATE v2 (RETURNS TABLE change → pas de CREATE OR REPLACE).
-- Corps repris du live (20260516000010) + colonne p.track_inventory.

DROP FUNCTION IF EXISTS public.get_stock_levels_v1(uuid, text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.get_stock_levels_v2(
  p_category_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_low_stock_only boolean DEFAULT false,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  product_id uuid, sku text, name text, category_id uuid, category_name text,
  current_stock numeric, min_stock_threshold numeric, track_inventory boolean,
  last_movement_at timestamp with time zone, total_count bigint
)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT p.id, p.sku, p.name, p.category_id, c.name AS cat_name,
           p.current_stock, p.min_stock_threshold, p.track_inventory,
           (SELECT max(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id) AS last_mvt
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.deleted_at IS NULL
       AND (p_category_id IS NULL OR p.category_id = p_category_id)
       AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%')
       AND (NOT p_low_stock_only
            OR (p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold))
  ), counted AS (SELECT COUNT(*) AS total FROM filtered)
  SELECT f.id, f.sku, f.name, f.category_id, f.cat_name,
         f.current_stock, f.min_stock_threshold, f.track_inventory, f.last_mvt,
         (SELECT total FROM counted)
    FROM filtered f
   ORDER BY f.name
   LIMIT p_limit OFFSET p_offset;
END $function$;

REVOKE EXECUTE ON FUNCTION public.get_stock_levels_v2(uuid, text, boolean, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stock_levels_v2(uuid, text, boolean, integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stock_levels_v2(uuid, text, boolean, integer, integer) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_stock_levels_v2(uuid, text, boolean, integer, integer) IS
  'Audit 2026-07-08 (v1->v2). inventory.read. +track_inventory pour rendre "Non suivi" '
  'les produits non-suivis (illimités) dans la liste Inventory BO.';
