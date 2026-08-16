-- 20260818000001_get_purchase_price_trends_v1.sql
--
-- Rapport « Purchase Price Trends » (famille Achats) — l'évolution des prix
-- d'achat par article et la concentration fournisseur. Répond à la question :
-- « ce fournisseur me coûte-t-il plus cher qu'avant — renégocier ou basculer ? »
-- Trou constaté le 2026-08-16 : get_purchase_by_date/by_supplier/purchase_items
-- disent COMBIEN on achète, jamais si le prix UNITAIRE d'un même article bouge.
--
-- PÉRIMÈTRE — celui de la famille achats (get_purchase_by_date_v1, S40) :
--   * POs `status NOT IN ('draft','cancelled')`, `deleted_at IS NULL` —
--     un brouillon n'est pas un achat, deux écrans qui comptent le même PO
--     doivent afficher le même chiffre ;
--   * imports historiques INCLUS (arbitrage Mamat 2026-08-16) : l'historique
--     de prix est précisément ce que l'import est venu apporter ;
--   * axe temporel = `order_date` (arbitrage Mamat 2026-08-16) : le prix se
--     négocie à la commande, pas à la réception ; `order_date` est une DATE,
--     aucun recalage de fuseau à faire.
--
-- PRIX COMPARABLE — un même article s'achète en unités d'achat différentes
-- (sac de 25 kg, carton de 12) : tout prix est ramené à l'UNITÉ DE BASE du
-- produit via `unit_factor_to_base` (prix base = unit_cost ÷ factor ; un
-- factor NULL ou ≤ 0 vaut 1 — lignes legacy d'avant la colonne). Le prix moyen
-- est PONDÉRÉ par la quantité base : Σ(subtotal) ÷ Σ(qty × factor) — acheter
-- 100 kg à 10k et 1 kg à 20k fait une moyenne à ~10,1k, pas 15k.
--
-- La CLASSIFICATION hausse/baisse (seuil ±2 %) et l'inflation pondérée du
-- panier sont calculées CÔTÉ CLIENT depuis by_product : la constante métier
-- vit dans packages/domain (jamais en DB), et un KPI recalculé depuis les
-- lignes affichées ne peut pas diverger de la table.
--
-- La période de comparaison est la fenêtre de même longueur immédiatement
-- antérieure ; `delta_pct` est NULL pour un article sans achat en période
-- précédente (nouveau référencement — un delta contre rien n'existe pas).

CREATE OR REPLACE FUNCTION public.get_purchase_price_trends_v1(
  p_start_date  date,
  p_end_date    date,
  p_supplier_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start      date;
  v_end        date;
  v_prev_start date;
  v_prev_end   date;
  v_result     jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  -- Clamp 366 jours (pattern S30/S40) : on rogne le DÉBUT, la fin demandée est
  -- ce que le lecteur regarde.
  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  WITH lines AS (
    SELECT
      (po.order_date >= v_start)  AS is_current,
      po.id                       AS po_id,
      po.order_date,
      po.supplier_id,
      s.name                      AS supplier_name,
      poi.product_id,
      p.name                      AS product_name,
      p.unit                      AS base_unit,
      poi.quantity,
      CASE WHEN COALESCE(poi.unit_factor_to_base, 0) > 0
           THEN poi.unit_factor_to_base ELSE 1 END          AS factor,
      poi.unit_cost,
      COALESCE(poi.subtotal, poi.quantity * poi.unit_cost)  AS spend,
      poi.created_at
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    JOIN products p         ON p.id  = poi.product_id
    LEFT JOIN suppliers s   ON s.id  = po.supplier_id
    WHERE po.status NOT IN ('draft', 'cancelled')
      AND po.deleted_at IS NULL
      AND po.order_date BETWEEN v_prev_start AND v_end
      AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
  ),
  cur  AS (SELECT * FROM lines WHERE is_current),
  prev AS (SELECT * FROM lines WHERE NOT is_current),
  per_product AS (
    SELECT
      product_id,
      product_name                                   AS name,
      base_unit,
      COUNT(DISTINCT po_id)                          AS po_count,
      SUM(spend)                                     AS spend,
      SUM(quantity * factor)                         AS qty_base,
      SUM(spend) / NULLIF(SUM(quantity * factor), 0) AS wavg_price,
      MIN(unit_cost / factor)                        AS min_price,
      MAX(unit_cost / factor)                        AS max_price
    FROM cur
    GROUP BY product_id, product_name, base_unit
  ),
  per_product_prev AS (
    SELECT
      product_id,
      SUM(spend) / NULLIF(SUM(quantity * factor), 0) AS wavg_price_prev
    FROM prev
    GROUP BY product_id
  ),
  -- Dernier prix payé + fournisseur du dernier achat : la ligne la plus
  -- récente par (order_date, created_at) — created_at départage deux POs du
  -- même jour.
  last_line AS (
    SELECT DISTINCT ON (product_id)
      product_id,
      unit_cost / factor AS last_price,
      supplier_id        AS last_supplier_id,
      supplier_name      AS last_supplier_name,
      order_date         AS last_order_date
    FROM cur
    ORDER BY product_id, order_date DESC, created_at DESC
  ),
  per_supplier AS (
    SELECT
      supplier_id,
      COALESCE(supplier_name, '—') AS name,
      SUM(spend)                   AS spend,
      COUNT(DISTINCT po_id)        AS po_count
    FROM cur
    GROUP BY supplier_id, supplier_name
  ),
  tot AS (
    SELECT
      COALESCE(SUM(spend), 0)         AS spend,
      COUNT(DISTINCT po_id)           AS po_count,
      COUNT(DISTINCT product_id)      AS product_count,
      COUNT(DISTINCT supplier_id)     AS supplier_count
    FROM cur
  ),
  tot_prev AS (
    SELECT COALESCE(SUM(spend), 0) AS spend FROM prev
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'generated_at', now(),
    'summary', jsonb_build_object(
      'spend',          t.spend,
      'spend_prev',     tp.spend,
      'po_count',       t.po_count,
      'product_count',  t.product_count,
      'supplier_count', t.supplier_count
    ),
    'by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id',      pp.product_id,
          'name',            pp.name,
          'base_unit',       pp.base_unit,
          'po_count',        pp.po_count,
          'spend',           ROUND(pp.spend, 2),
          'qty_base',        ROUND(pp.qty_base, 3),
          'wavg_price',      ROUND(pp.wavg_price, 2),
          'wavg_price_prev', ROUND(ppp.wavg_price_prev, 2),
          'delta_pct',       CASE WHEN ppp.wavg_price_prev IS NULL OR ppp.wavg_price_prev = 0
                                  THEN NULL
                                  ELSE ROUND(100 * (pp.wavg_price - ppp.wavg_price_prev)
                                                 / ppp.wavg_price_prev, 2) END,
          'min_price',       ROUND(pp.min_price, 2),
          'max_price',       ROUND(pp.max_price, 2),
          'last_price',      ROUND(ll.last_price, 2),
          'last_order_date', ll.last_order_date,
          'last_supplier',   jsonb_build_object(
                               'id',   ll.last_supplier_id,
                               'name', ll.last_supplier_name
                             )
        ) ORDER BY pp.spend DESC, pp.name ASC
      )
      FROM per_product pp
      LEFT JOIN per_product_prev ppp ON ppp.product_id = pp.product_id
      LEFT JOIN last_line        ll  ON ll.product_id  = pp.product_id
    ), '[]'::jsonb),
    'by_supplier', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'supplier_id', ps.supplier_id,
          'name',        ps.name,
          'po_count',    ps.po_count,
          'spend',       ROUND(ps.spend, 2),
          'share_pct',   COALESCE(ROUND(100 * ps.spend / NULLIF(t.spend, 0), 2), 0)
        ) ORDER BY ps.spend DESC, ps.name ASC
      ) FROM per_supplier ps
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, tot_prev tp;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_purchase_price_trends_v1(date, date, uuid) IS
  'Évolution des prix d''achat par article (unité de base, moyenne pondérée par la '
  'quantité) + Pareto fournisseur, période vs fenêtre précédente de même longueur. '
  'Périmètre famille achats S40 : POs hors draft/cancelled, deleted_at IS NULL, axe '
  'order_date, imports historiques inclus. prix base = unit_cost ÷ unit_factor_to_base '
  '(factor NULL/≤0 → 1). delta_pct NULL si article absent de la période précédente. '
  'Classification hausse/baisse et inflation pondérée = côté client (constante domain). '
  'Clamp 366 jours. Gate reports.inventory.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_purchase_price_trends_v1(date, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_purchase_price_trends_v1(date, date, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_purchase_price_trends_v1(date, date, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
