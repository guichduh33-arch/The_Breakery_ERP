-- 20260807000001_dashboard_kpis_customers.sql
--
-- Le compteur « customers today » revient dans le dashboard, et l'écran cesse
-- de lever une erreur à chaque chargement.
--
-- DEUX défauts de la refonte 1c (20260806000001) sont corrigés ici.
--
-- (A) `_dashboard_share_payments_v1` ne pouvait PAS s'exécuter : ses deux blocs
--     imbriquaient un `SUM(...) OVER ()` dans un `jsonb_agg(...)`, que Postgres
--     refuse (42803, « aggregate function calls cannot contain window function
--     calls »). L'agrégat n'échouait pas sur un cas limite : il échouait
--     toujours, donc `get_dashboard_overview_v2` levait pour tout appelant et
--     le dashboard n'a jamais pu s'afficher. Le total sort désormais dans une
--     CTE croisée, sans fenêtre imbriquée. Le `SUM() OVER ()` du helper horaire
--     est licite (hors agrégat) et n'est pas touché.
--
-- (B) Le compteur de clients distincts, perdu en silence par la refonte.
--
-- La refonte 1c (20260806000001) a restructuré les KPI de scalaires plats en
-- objets `{value, vs_yesterday, vs_d7}`, et a perdu au passage le compteur de
-- clients distincts que la v1 exposait sous `kpis.customers_today`. La perte
-- était silencieuse : aucun test front ne le lisait, et les deux fichiers pgTAP
-- qui l'épinglaient tombaient déjà en erreur dure sur la disparition de
-- `get_dashboard_overview_v1`.
--
-- Sémantique reprise à l'identique de la v1 (20260710000116) :
--   COUNT(DISTINCT customer_id) sur les commandes valides du jour, clients
--   anonymes exclus. `COUNT(DISTINCT ...)` ignore les NULL, le filtre explicite
--   de la v1 est donc redondant et n'est pas reconduit.
--
-- Le KPI adopte la forme v2 — valeur ET comparaisons — parce qu'un compteur
-- seul, dans une rangée où tous les autres portent leur écart, se lit comme
-- une donnée qu'on n'a pas su comparer.
--
-- Versioning monotone : `_dashboard_kpis_v2`, `_dashboard_share_payments_v2` et
-- `get_dashboard_overview_v3` sont créées ; `_dashboard_kpis_v1`,
-- `_dashboard_share_payments_v1` et `get_dashboard_overview_v2` droppées dans la
-- même migration. Les corps partent du live (`pg_get_functiondef`), pas du
-- fichier d'origine.

-- ---------------------------------------------------------------------------
-- 1. Le calcul des KPI, augmenté du compteur de clients.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dashboard_kpis_v2(p_tz TEXT, p_today DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  WITH ref_days AS (
    SELECT p_today AS day, 'today' AS slot
    UNION ALL SELECT p_today - 1, 'yesterday'
    UNION ALL SELECT p_today - 7, 'd7'
  ),
  valid AS (
    SELECT ((o.paid_at AT TIME ZONE p_tz))::date AS day, o.id, o.total, o.customer_id
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 1, p_today - 7)
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE p_tz))::date AS day, SUM(r.total) AS refunds
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 1, p_today - 7)
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  day_items AS (
    SELECT v.day,
           SUM(oi.quantity)                             AS qty,
           SUM(oi.quantity * COALESCE(p.cost_price, 0)) AS cogs,
           SUM(oi.line_total)                           AS line_rev,
           SUM(oi.line_total) FILTER (
             WHERE p.cost_price IS NOT NULL AND p.cost_price > 0)  AS costed_rev
      FROM order_items oi
      JOIN valid v         ON v.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE NOT oi.is_cancelled
     GROUP BY v.day
  ),
  metrics AS (
    SELECT rd.slot,
           COALESCE(SUM(v.total), 0)                                AS gross,
           COALESCE(SUM(v.total), 0) - COALESCE(MAX(dr.refunds), 0) AS net,
           COUNT(v.id)                                              AS order_count,
           COUNT(DISTINCT v.customer_id)                            AS customer_count,
           COALESCE(MAX(di.qty), 0)                                 AS items,
           COALESCE(MAX(di.cogs), 0)                                AS cogs,
           COALESCE(MAX(di.line_rev), 0)                            AS line_rev,
           COALESCE(MAX(di.costed_rev), 0)                          AS costed_rev
      FROM ref_days rd
      LEFT JOIN valid       v  ON v.day  = rd.day
      LEFT JOIN day_refunds dr ON dr.day = rd.day
      LEFT JOIN day_items   di ON di.day = rd.day
     GROUP BY rd.slot
  ),
  s AS (
    SELECT slot, net, order_count, customer_count, items,
           CASE WHEN order_count = 0 THEN 0 ELSE ROUND(gross / order_count, 2) END AS basket,
           CASE WHEN net <= 0 THEN NULL ELSE ROUND(((net - cogs) / net) * 100, 2) END AS margin,
           CASE WHEN line_rev <= 0 THEN NULL
                ELSE ROUND((costed_rev / line_rev) * 100, 2) END AS coverage
      FROM metrics
  ),
  p AS (
    SELECT
      (SELECT net            FROM s WHERE slot = 'today')     AS net_t,
      (SELECT net            FROM s WHERE slot = 'yesterday') AS net_y,
      (SELECT net            FROM s WHERE slot = 'd7')        AS net_7,
      (SELECT order_count    FROM s WHERE slot = 'today')     AS ord_t,
      (SELECT order_count    FROM s WHERE slot = 'yesterday') AS ord_y,
      (SELECT order_count    FROM s WHERE slot = 'd7')        AS ord_7,
      (SELECT customer_count FROM s WHERE slot = 'today')     AS cst_t,
      (SELECT customer_count FROM s WHERE slot = 'yesterday') AS cst_y,
      (SELECT customer_count FROM s WHERE slot = 'd7')        AS cst_7,
      (SELECT items          FROM s WHERE slot = 'today')     AS itm_t,
      (SELECT items          FROM s WHERE slot = 'yesterday') AS itm_y,
      (SELECT items          FROM s WHERE slot = 'd7')        AS itm_7,
      (SELECT basket         FROM s WHERE slot = 'today')     AS bkt_t,
      (SELECT basket         FROM s WHERE slot = 'yesterday') AS bkt_y,
      (SELECT basket         FROM s WHERE slot = 'd7')        AS bkt_7,
      (SELECT margin         FROM s WHERE slot = 'today')     AS mrg_t,
      (SELECT margin         FROM s WHERE slot = 'yesterday') AS mrg_y,
      (SELECT margin         FROM s WHERE slot = 'd7')        AS mrg_7,
      (SELECT coverage       FROM s WHERE slot = 'today')     AS cov_t
  )
  SELECT jsonb_build_object(
    'net_revenue', jsonb_build_object(
      'value', p.net_t, 'vs_yesterday', _pct_change(p.net_t, p.net_y),
      'vs_d7', _pct_change(p.net_t, p.net_7)),
    'orders', jsonb_build_object(
      'value', p.ord_t, 'vs_yesterday', _pct_change(p.ord_t, p.ord_y),
      'vs_d7', _pct_change(p.ord_t, p.ord_7)),
    'customers', jsonb_build_object(
      'value', p.cst_t, 'vs_yesterday', _pct_change(p.cst_t, p.cst_y),
      'vs_d7', _pct_change(p.cst_t, p.cst_7)),
    'items_sold', jsonb_build_object(
      'value', p.itm_t, 'vs_yesterday', _pct_change(p.itm_t, p.itm_y),
      'vs_d7', _pct_change(p.itm_t, p.itm_7)),
    'avg_basket', jsonb_build_object(
      'value', p.bkt_t, 'vs_yesterday', _pct_change(p.bkt_t, p.bkt_y),
      'vs_d7', _pct_change(p.bkt_t, p.bkt_7)),
    'gross_margin', jsonb_build_object(
      'value', p.mrg_t,
      'vs_yesterday_pt', ROUND(p.mrg_t - p.mrg_y, 2),
      'vs_d7_pt',        ROUND(p.mrg_t - p.mrg_7, 2),
      'basis',             'current_cost_price',
      'cost_coverage_pct', p.cov_t)
  ) INTO v_out FROM p;

  RETURN v_out;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Répartition par type et par moyen de paiement — sans fenêtre imbriquée.
--
-- Seul le calcul de `share_pct` change : le dénominateur, qui était un
-- `SUM(...) OVER ()` DANS le `jsonb_agg`, devient une CTE `tot` croisée. Le
-- reste du corps est celui du live, à l'identique.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dashboard_share_payments_v2(p_tz TEXT, p_today DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_share    JSONB;
  v_payments JSONB;
BEGIN
  WITH t AS (
    SELECT o.order_type::text AS order_type,
           SUM(o.total)::NUMERIC(14,2) AS gross,
           COUNT(*)::INT AS cnt
      FROM orders o
     WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE p_tz))::date = p_today
     GROUP BY o.order_type
  ),
  tot AS (SELECT COALESCE(SUM(gross), 0) AS g FROM t)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_type', t.order_type, 'gross', t.gross, 'order_count', t.cnt,
           'share_pct', ROUND((t.gross / NULLIF(tot.g, 0)) * 100, 1)
         ) ORDER BY t.gross DESC), '[]'::jsonb)
    INTO v_share FROM t CROSS JOIN tot;

  WITH pm AS (
    SELECT op.method::text AS method,
           SUM(op.amount)::NUMERIC(14,2) AS amount,
           COUNT(*)::INT AS cnt
      FROM order_payments op
      JOIN orders o ON o.id = op.order_id
     WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
       AND ((op.paid_at AT TIME ZONE p_tz))::date = p_today
     GROUP BY op.method
  ),
  pm_tot AS (SELECT COALESCE(SUM(amount), 0) AS a FROM pm),
  drawer AS (
    SELECT COALESCE(SUM(
             s.opening_cash + s.cash_in_total - s.cash_out_total
             + COALESCE((SELECT SUM(op.amount)
                           FROM order_payments op
                           JOIN orders o ON o.id = op.order_id
                          WHERE o.session_id = s.id
                            AND o.status IN ('paid', 'completed')
                            AND op.method = 'cash'), 0)
           ), 0) AS expected
      FROM pos_sessions s
     WHERE s.status = 'open'
  )
  SELECT jsonb_build_object(
           'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'method', pm.method, 'amount', pm.amount, 'count', pm.cnt,
                        'share_pct', ROUND((pm.amount / NULLIF(pm_tot.a, 0)) * 100, 1)
                      ) ORDER BY pm.amount DESC) FROM pm CROSS JOIN pm_tot), '[]'::jsonb),
           'total', COALESCE((SELECT SUM(amount) FROM pm), 0),
           'cash_expected_drawer', (SELECT expected FROM drawer))
    INTO v_payments;

  RETURN jsonb_build_object('revenue_share', v_share, 'payments', v_payments);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. L'orchestrateur, identique à la v2 hormis l'appel aux helpers bumpés.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v3()
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     TEXT;
  v_today  DATE;
  v_kpis   JSONB;
  v_rev    JSONB;
  v_hourly JSONB;
  v_sp     JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  v_kpis   := _dashboard_kpis_v2(v_tz, v_today);
  v_rev    := _dashboard_revenue_series_v1(v_tz, v_today);
  v_hourly := _dashboard_hourly_v1(v_tz, v_today);
  v_sp     := _dashboard_share_payments_v2(v_tz, v_today);

  IF has_permission(auth.uid(), 'accounting.cash.read') THEN
    v_kpis := jsonb_set(v_kpis, '{cash_on_hand}', _dashboard_cash_on_hand_v1());
  ELSE
    v_kpis := jsonb_set(v_kpis, '{cash_on_hand}',
                jsonb_build_object('value', NULL, 'restricted', TRUE,
                                   'wallets', '[]'::jsonb));
  END IF;

  RETURN jsonb_build_object(
    'kpis',                v_kpis,
    'revenue_30d',         v_rev    -> 'series',
    'revenue_30d_summary', v_rev    -> 'summary',
    'hourly_sales',        v_hourly -> 'series',
    'hourly_peak',         v_hourly -> 'peak',
    'revenue_share',       v_sp     -> 'revenue_share',
    'payments',            v_sp     -> 'payments',
    'cost_mtd',            _dashboard_cost_mtd_v1(v_tz, v_today),
    'generated_at',        now()
  );
END;
$function$;

COMMENT ON FUNCTION public.get_dashboard_overview_v3() IS
  'Dashboard d''accueil BO. Identique a la v2, plus le compteur kpis.customers '
  '(clients distincts du jour, anonymes exclus) restitue apres sa perte '
  'silencieuse dans la refonte 1c. Gatee sur reports.read ; cash_on_hand reste '
  'gate separement sur accounting.cash.read.';

-- ---------------------------------------------------------------------------
-- 4. Grants.
-- ---------------------------------------------------------------------------
-- ⚠ `REVOKE ... FROM PUBLIC` NE SUFFIT PAS ICI. Le projet a un
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO authenticated` :
-- toute fonction neuve naît donc exécutable par `authenticated` nominativement,
-- ce que le REVOKE sur PUBLIC ne touche pas. D'où la révocation nominative.
REVOKE ALL ON FUNCTION public._dashboard_kpis_v2(TEXT, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._dashboard_kpis_v2(TEXT, DATE) FROM authenticated, anon;

REVOKE ALL ON FUNCTION public._dashboard_share_payments_v2(TEXT, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._dashboard_share_payments_v2(TEXT, DATE) FROM authenticated, anon;

REVOKE ALL ON FUNCTION public.get_dashboard_overview_v3() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_overview_v3() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview_v3() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Les versions précédentes disparaissent dans la même migration.
--    L'orchestrateur d'abord : il référence les deux helpers.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_dashboard_overview_v2();
DROP FUNCTION IF EXISTS public._dashboard_kpis_v1(TEXT, DATE);
DROP FUNCTION IF EXISTS public._dashboard_share_payments_v1(TEXT, DATE);
