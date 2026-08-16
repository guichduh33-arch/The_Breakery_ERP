-- 20260818000002_get_purchase_price_points_v1.sql
--
-- Compagnon de get_purchase_price_trends_v1 (même migration-lot) : la série de
-- POINTS de prix d'un article — un point par ligne de PO, une série par
-- fournisseur — pour le graphe de tendance du rapport Purchase Price Trends.
-- Même périmètre, mêmes conversions : voir 20260818000001.

CREATE OR REPLACE FUNCTION public.get_purchase_price_points_v1(
  p_product_id  uuid,
  p_start_date  date,
  p_end_date    date,
  p_supplier_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start   date;
  v_end     date;
  v_product jsonb;
  v_points  jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product id is required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 366);

  -- Le produit peut être soft-deleted : son historique d'achat reste lisible.
  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'base_unit', p.unit)
    INTO v_product
    FROM products p
   WHERE p.id = p_product_id;
  IF v_product IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'order_date',     pt.order_date,
      'po_id',          pt.po_id,
      'po_number',      pt.po_number,
      'supplier_id',    pt.supplier_id,
      'supplier_name',  pt.supplier_name,
      'unit_price',     pt.unit_price,
      'qty_base',       pt.qty_base
    ) ORDER BY pt.order_date ASC, pt.created_at ASC
  ), '[]'::jsonb)
  INTO v_points
  FROM (
    SELECT
      po.order_date,
      po.id                          AS po_id,
      po.po_number,
      po.supplier_id,
      COALESCE(s.name, '—')          AS supplier_name,
      ROUND(poi.unit_cost
        / CASE WHEN COALESCE(poi.unit_factor_to_base, 0) > 0
               THEN poi.unit_factor_to_base ELSE 1 END, 2)   AS unit_price,
      ROUND(poi.quantity
        * CASE WHEN COALESCE(poi.unit_factor_to_base, 0) > 0
               THEN poi.unit_factor_to_base ELSE 1 END, 3)   AS qty_base,
      poi.created_at
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    LEFT JOIN suppliers s   ON s.id = po.supplier_id
    WHERE poi.product_id = p_product_id
      AND po.status NOT IN ('draft', 'cancelled')
      AND po.deleted_at IS NULL
      AND po.order_date BETWEEN v_start AND v_end
      AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
  ) pt;

  RETURN jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'generated_at', now(),
    'product',      v_product,
    'points',       v_points
  );
END;
$function$;

COMMENT ON FUNCTION public.get_purchase_price_points_v1(uuid, date, date, uuid) IS
  'Points de prix d''achat d''un article (un point par ligne de PO, prix ramené à '
  'l''unité de base via unit_factor_to_base, factor NULL/≤0 → 1) pour le graphe de '
  'tendance de Purchase Price Trends. Périmètre famille achats S40 : hors '
  'draft/cancelled, deleted_at IS NULL, axe order_date, imports historiques inclus. '
  'Produit soft-deleted lisible. Clamp 366 jours. Gate reports.inventory.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_purchase_price_points_v1(uuid, date, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_purchase_price_points_v1(uuid, date, date, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_purchase_price_points_v1(uuid, date, date, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
