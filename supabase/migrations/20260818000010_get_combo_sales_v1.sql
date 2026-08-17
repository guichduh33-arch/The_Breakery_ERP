-- 20260818000010_get_combo_sales_v1.sql
--
-- Rapport « Ventes de combos » (famille Sales). Répond à : « mes combos se
-- vendent-ils, lesquels — et tirent-ils le panier vers le haut ? » (maquette +
-- arbitrages validés par Mamat le 2026-08-17 : prix effectif TOTAL seul — pas
-- de ventilation base/surcharges —, cannibalisation en v2).
--
-- UNE LIGNE COMBO = order_items.combo_components IS NOT NULL : la colonne
-- n'est posée QUE pour un produit de type combo (money-path v26+, pricing
-- serveur _resolve_combo_price_v1 — ADR-017). Le format est un array
-- [{product_id, quantity, …}] des composants choisis — les picks s'en
-- extraient par jsonb_array_elements, pondérés par la quantité de ligne.
--
-- PÉRIMÈTRE ventes canonique (paid|completed, non annulées, hors import
-- historique, hors produits de test), lignes combo hors annulées et hors
-- cadeaux promo (un cadeau à 0 fausserait le prix moyen effectif). L'UPLIFT
-- compare le panier moyen des commandes AVEC ≥1 combo à celui des commandes
-- SANS — même fenêtre, même périmètre. Le nom du combo vient de
-- name_snapshot (le plus récent), robuste au renommage ou à la suppression.

CREATE OR REPLACE FUNCTION public.get_combo_sales_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz         text;
  v_start      date;
  v_end        date;
  v_prev_start date;
  v_prev_end   date;
  v_result     jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  -- Clamp 366 jours (pattern S30/S40) : on rogne le DÉBUT.
  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT o.id, o.total,
           ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  combo_lines AS (
    SELECT oi.id, oi.order_id, oi.product_id, oi.name_snapshot, oi.quantity,
           oi.line_total, oi.combo_components, oi.created_at, s.bd
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.combo_components IS NOT NULL
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  cur_orders  AS (SELECT * FROM scoped      WHERE bd BETWEEN v_start AND v_end),
  cur_lines   AS (SELECT * FROM combo_lines WHERE bd BETWEEN v_start AND v_end),
  prev_lines  AS (SELECT * FROM combo_lines WHERE bd <  v_start),
  with_combo  AS (SELECT DISTINCT order_id FROM cur_lines),
  tickets AS (
    SELECT
      ROUND(AVG(o.total) FILTER (WHERE w.order_id IS NOT NULL), 0) AS avg_with,
      ROUND(AVG(o.total) FILTER (WHERE w.order_id IS NULL), 0)     AS avg_without
    FROM cur_orders o
    LEFT JOIN with_combo w ON w.order_id = o.id
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'combo_revenue',      COALESCE((SELECT SUM(line_total) FROM cur_lines), 0),
      'combo_revenue_prev', COALESCE((SELECT SUM(line_total) FROM prev_lines), 0),
      'combo_qty',          COALESCE((SELECT SUM(quantity) FROM cur_lines), 0),
      'combo_qty_prev',     COALESCE((SELECT SUM(quantity) FROM prev_lines), 0),
      'combo_orders',       (SELECT COUNT(*) FROM with_combo),
      'gross_sales',        COALESCE((SELECT SUM(total) FROM cur_orders), 0),
      'avg_ticket_with',    (SELECT avg_with FROM tickets),
      'avg_ticket_without', (SELECT avg_without FROM tickets)
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', d.bd, 'revenue', d.revenue, 'qty', d.qty
      ) ORDER BY d.bd ASC)
      FROM (
        SELECT bd, SUM(line_total) AS revenue, SUM(quantity) AS qty
        FROM cur_lines GROUP BY bd
      ) d
    ), '[]'::jsonb),
    'by_combo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', bc.product_id,
        'name',       bc.name,
        'qty',        bc.qty,
        'revenue',    bc.revenue,
        -- Prix effectif TOTAL (arbitrage) : ce qui a été payé, ligne ramenée
        -- à l''unité — base + surcharges + modificateurs confondus.
        'avg_price',  bc.avg_price
      ) ORDER BY bc.revenue DESC)
      FROM (
        SELECT product_id,
               (ARRAY_AGG(name_snapshot ORDER BY created_at DESC))[1] AS name,
               SUM(quantity)   AS qty,
               SUM(line_total) AS revenue,
               ROUND(SUM(line_total) / NULLIF(SUM(quantity), 0), 0) AS avg_price
        FROM cur_lines
        GROUP BY product_id
      ) bc
    ), '[]'::jsonb),
    -- Composants les plus choisis — quantités pondérées par la ligne. Le nom
    -- vient du produit vivant (un composant supprimé sort en 'deleted').
    'component_picks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', cp.product_id,
        'name',       cp.name,
        'qty',        cp.qty
      ) ORDER BY cp.qty DESC)
      FROM (
        SELECT (comp->>'product_id')::uuid AS product_id,
               COALESCE(MAX(p.name), 'deleted') AS name,
               SUM(COALESCE((comp->>'quantity')::numeric, 1) * cl.quantity) AS qty
        FROM cur_lines cl
        CROSS JOIN LATERAL jsonb_array_elements(cl.combo_components) comp
        LEFT JOIN products p ON p.id = (comp->>'product_id')::uuid
        GROUP BY (comp->>'product_id')::uuid
      ) cp
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_combo_sales_v1(date, date) IS
  'Ventes de combos — une ligne combo = order_items.combo_components non NULL '
  '(pricing serveur ADR-017). CA/volumes par combo (name_snapshot, prix '
  'effectif total — arbitrage 2026-08-17), uplift panier avec vs sans combo, '
  'composants les plus choisis (picks pondérés par la quantité de ligne). '
  'Périmètre ventes canonique, lignes hors annulées et cadeaux promo, jour '
  'métier, clamp 366 j, fenêtre précédente. Gate reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_combo_sales_v1(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_combo_sales_v1(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_combo_sales_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
