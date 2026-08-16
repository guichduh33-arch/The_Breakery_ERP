-- 20260817000006_adr027_lot3_stock_variance_v3.sql
--
-- ADR-027 lot 3/3 (3/4) — le rapport variance devient un état de DÉMARQUE
-- CONSTATÉE. L'ancienne v2 comparait le stock instantané à un flux net de
-- fenêtre sans stock d'ouverture : dans un système où toute variation passe
-- par le ledger, current = ouverture + flux par construction, et la « variance »
-- v2 ne mesurait que l'ouverture. La v3 sert l'identité complète :
--
--   opening  = current_stock − Σ mouvements depuis le début de fenêtre
--   closing  = current_stock − Σ mouvements après la fin de fenêtre
--   closing == opening + stock_in + sold + consumed + wasted + corrected + other
--
-- La démarque significative est portée par `corrected` (opname_* + adjustment*)
-- et `wasted` : depuis l'opname global (20260817000002), ce sont les seuls
-- canaux par lesquels la réalité de l'étagère corrige la théorie du ledger.
-- Plus de filtre section. Gate reports.inventory.read (aligné D2, 20260802000002).

CREATE OR REPLACE FUNCTION public.get_stock_variance_v3(
  p_date_start TIMESTAMPTZ DEFAULT NULL,
  p_date_end   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid, product_name text, sku text,
  opening numeric, stock_in numeric, sold numeric, consumed numeric,
  wasted numeric, corrected numeric, other numeric,
  closing numeric, current_qty numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH bounds AS (
    SELECT COALESCE(p_date_start, now() - INTERVAL '30 days') AS ws,
           COALESCE(p_date_end,   now())                      AS we
  ),
  tail AS (
    -- Reconstruction à rebours depuis le stock présent : tout mouvement depuis
    -- le début de fenêtre (pour l'ouverture), et après la fin (pour la clôture).
    SELECT sm.product_id AS pid,
           SUM(sm.quantity)                                    AS sum_since_start,
           SUM(sm.quantity) FILTER (WHERE sm.created_at > b.we) AS sum_after_end
    FROM stock_movements sm, bounds b
    WHERE sm.created_at >= b.ws
    GROUP BY sm.product_id
  ),
  win AS (
    SELECT sm.product_id AS pid,
      SUM(CASE WHEN sm.movement_type IN ('purchase','incoming','production_in')
               THEN sm.quantity ELSE 0 END) AS w_stock_in,
      SUM(CASE WHEN sm.movement_type IN ('sale','sale_void')
               THEN sm.quantity ELSE 0 END) AS w_sold,
      SUM(CASE WHEN sm.movement_type = 'production_out'
               THEN sm.quantity ELSE 0 END) AS w_consumed,
      SUM(CASE WHEN sm.movement_type = 'waste'
               THEN sm.quantity ELSE 0 END) AS w_wasted,
      SUM(CASE WHEN sm.movement_type IN ('opname_in','opname_out',
                                         'adjustment','adjustment_in','adjustment_out')
               THEN sm.quantity ELSE 0 END) AS w_corrected,
      SUM(CASE WHEN sm.movement_type NOT IN ('purchase','incoming','production_in',
                                             'sale','sale_void','production_out','waste',
                                             'opname_in','opname_out',
                                             'adjustment','adjustment_in','adjustment_out')
               THEN sm.quantity ELSE 0 END) AS w_other
    FROM stock_movements sm, bounds b
    WHERE sm.created_at BETWEEN b.ws AND b.we
    GROUP BY sm.product_id
  )
  SELECT
    p.id, p.name, p.sku,
    (p.current_stock - COALESCE(t.sum_since_start, 0))::DECIMAL(12,3) AS opening,
    COALESCE(w.w_stock_in, 0)::DECIMAL(12,3),
    COALESCE(w.w_sold, 0)::DECIMAL(12,3),
    COALESCE(w.w_consumed, 0)::DECIMAL(12,3),
    COALESCE(w.w_wasted, 0)::DECIMAL(12,3),
    COALESCE(w.w_corrected, 0)::DECIMAL(12,3),
    COALESCE(w.w_other, 0)::DECIMAL(12,3),
    (p.current_stock - COALESCE(t.sum_after_end, 0))::DECIMAL(12,3)   AS closing,
    p.current_stock::DECIMAL(12,3)
  FROM products p
  LEFT JOIN tail t ON t.pid = p.id
  LEFT JOIN win  w ON w.pid = p.id
  WHERE p.deleted_at IS NULL
    AND p.track_inventory = true
    AND (w.pid IS NOT NULL OR p.current_stock <> 0)
  ORDER BY (ABS(COALESCE(w.w_corrected, 0)) + ABS(COALESCE(w.w_wasted, 0))) DESC, p.name ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_stock_variance_v3(timestamptz, timestamptz) IS
  'ADR-027 : démarque constatée par produit — ouverture reconstruite, flux de '
  'fenêtre ventilés, corrections d''inventaire et pertes en évidence. '
  'reports.inventory.read.';

DROP FUNCTION IF EXISTS public.get_stock_variance_v2(uuid, timestamptz, timestamptz);

REVOKE EXECUTE ON FUNCTION public.get_stock_variance_v3(timestamptz, timestamptz) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stock_variance_v3(timestamptz, timestamptz) TO authenticated;
