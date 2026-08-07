-- 20260806000001_dashboard_today_v2.sql
--
-- Dashboard « Today » (écran 1c du handoff design_handoff_backoffice_shell).
--
-- get_dashboard_overview_v1 rendait 5 KPI nus. L'écran 1c en demande 6, chacun
-- avec DEUX comparaisons, plus une série 30 j comparée, un profil horaire
-- comparé, les parts de revenu, les encaissements et le coût MTD par compte.
-- D'où un _v2 : la _v1 est DROPée dans cette même migration (versioning
-- monotone) et le front bascule dans le même commit.
--
-- L'agrégat est découpé en HELPERS PRIVÉS (`_dashboard_*`) plutôt qu'écrit en
-- un bloc : chaque bloc de l'écran se relit seul, et aucun n'est exposé comme
-- surface d'API — ils sont REVOKEd de PUBLIC et ne sont jamais GRANTés à
-- `authenticated`. Seule la fonction publique, qui porte la barrière de droit,
-- les appelle ; comme elle est SECURITY DEFINER, ils héritent de son contexte.
--
-- Trois RPC de panneau l'accompagnent, séparées parce qu'elles ont chacune leur
-- propre cadence ET leur propre droit :
--   · get_dashboard_open_orders_v1   — état du plancher, rafraîchi en realtime
--   · get_dashboard_action_queue_v1  — la file « Needs you », 5 sources
--   · get_display_stock_activity_v1  — vitrine + temps depuis la dernière vente
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEUX LIMITES DE SOURCE, ASSUMÉES ET ÉTIQUETÉES (arbitrages Mamat 2026-08-06)
--
-- 1. MARGE BRUTE. Le coût n'est figé nulle part : `order_items` n'a pas de
--    colonne de coût, aucun mouvement de stock `sale` ne porte d'`unit_cost`, et
--    la vente ne poste pas de COGS en compta. La marge est donc calculée au
--    `products.cost_price` COURANT. Pour aujourd'hui c'est quasi exact ; pour
--    J-1 et D-7 cela applique le coût d'aujourd'hui à des ventes passées, donc
--    l'écart ne reflète que le mix et les prix, jamais la dérive du coût.
--    Le bloc porte `basis = 'current_cost_price'` et un `cost_coverage_pct`
--    (part du CA dont le produit a un cost_price renseigné) pour que l'UI le
--    dise, au lieu de laisser croire à une marge historique.
--
-- 2. CASH ON HAND. Suit la définition comptable : undeposited funds (1110, qui
--    CONTIENT déjà le tiroir), petty cash (1111), small money (1117) — mêmes
--    comptes et même filtre `posted` que get_cash_wallet_balances_v2, qui reste
--    la définition canonique. On ne l'appelle pas : elle porte sa propre
--    barrière `accounting.cash.read` et ferait échouer tout le dashboard pour un
--    simple lecteur de rapports. Ici le bloc est restreint sans ce droit.
--    Le découpage « tiroir · coffre » est une DÉRIVATION (`is_derived`), pas une
--    mesure : un compte tiroir dédié virant vers 1110 à la clôture ferait des
--    deux des mesures — bon modèle, arbitré en chantier séparé (2026-08-06).
--    Ne JAMAIS additionner les sessions POS par-dessus les soldes : doublon.
--
-- Le « cash attendu en tiroir » de la carte encaissements reprend au contraire
-- la formule EXACTE de close_shift_v8 (opening + cash_sales + in - out), pour
-- qu'il ne puisse jamais contredire le Z-report.
-- ─────────────────────────────────────────────────────────────────────────────


-- Variation relative en %. Renvoie NULL — jamais 0, jamais +100 % — quand la
-- base est nulle ou absente : « +∞ % vs un jour à zéro » est un non-sens qui
-- s'affiche comme une performance. Le front rend un « — » dans ce cas.
CREATE OR REPLACE FUNCTION public._pct_change(p_current NUMERIC, p_previous NUMERIC)
 RETURNS NUMERIC
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
           WHEN p_previous IS NULL OR p_previous = 0 OR p_current IS NULL THEN NULL
           ELSE ROUND(((p_current - p_previous) / ABS(p_previous)) * 100, 1)
         END;
$function$;


-- ── Helper : les 5 KPI de vente, chacun avec ses deux comparaisons ─────────
-- D-7 est le MÊME JOUR DE SEMAINE la semaine passée, pas une moyenne 7 j : le
-- trafic d'une boulangerie a une forme hebdomadaire, comparer un mercredi à une
-- moyenne lissée dirait n'importe quoi.
CREATE OR REPLACE FUNCTION public._dashboard_kpis_v1(p_tz TEXT, p_today DATE)
 RETURNS jsonb
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
    SELECT ((o.paid_at AT TIME ZONE p_tz))::date AS day, o.id, o.total
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
    SELECT slot, net, order_count, items,
           CASE WHEN order_count = 0 THEN 0 ELSE ROUND(gross / order_count, 2) END AS basket,
           CASE WHEN net <= 0 THEN NULL ELSE ROUND(((net - cogs) / net) * 100, 2) END AS margin,
           CASE WHEN line_rev <= 0 THEN NULL
                ELSE ROUND((costed_rev / line_rev) * 100, 2) END AS coverage
      FROM metrics
  ),
  p AS (
    SELECT
      (SELECT net         FROM s WHERE slot = 'today')     AS net_t,
      (SELECT net         FROM s WHERE slot = 'yesterday') AS net_y,
      (SELECT net         FROM s WHERE slot = 'd7')        AS net_7,
      (SELECT order_count FROM s WHERE slot = 'today')     AS ord_t,
      (SELECT order_count FROM s WHERE slot = 'yesterday') AS ord_y,
      (SELECT order_count FROM s WHERE slot = 'd7')        AS ord_7,
      (SELECT items       FROM s WHERE slot = 'today')     AS itm_t,
      (SELECT items       FROM s WHERE slot = 'yesterday') AS itm_y,
      (SELECT items       FROM s WHERE slot = 'd7')        AS itm_7,
      (SELECT basket      FROM s WHERE slot = 'today')     AS bkt_t,
      (SELECT basket      FROM s WHERE slot = 'yesterday') AS bkt_y,
      (SELECT basket      FROM s WHERE slot = 'd7')        AS bkt_7,
      (SELECT margin      FROM s WHERE slot = 'today')     AS mrg_t,
      (SELECT margin      FROM s WHERE slot = 'yesterday') AS mrg_y,
      (SELECT margin      FROM s WHERE slot = 'd7')        AS mrg_7,
      (SELECT coverage    FROM s WHERE slot = 'today')     AS cov_t
  )
  SELECT jsonb_build_object(
    'net_revenue', jsonb_build_object(
      'value', p.net_t, 'vs_yesterday', _pct_change(p.net_t, p.net_y),
      'vs_d7', _pct_change(p.net_t, p.net_7)),
    'orders', jsonb_build_object(
      'value', p.ord_t, 'vs_yesterday', _pct_change(p.ord_t, p.ord_y),
      'vs_d7', _pct_change(p.ord_t, p.ord_7)),
    'items_sold', jsonb_build_object(
      'value', p.itm_t, 'vs_yesterday', _pct_change(p.itm_t, p.itm_y),
      'vs_d7', _pct_change(p.itm_t, p.itm_7)),
    'avg_basket', jsonb_build_object(
      'value', p.bkt_t, 'vs_yesterday', _pct_change(p.bkt_t, p.bkt_y),
      'vs_d7', _pct_change(p.bkt_t, p.bkt_7)),
    'gross_margin', jsonb_build_object(
      'value', p.mrg_t,
      -- Écart en POINTS, pas en pourcentage : comparer deux pourcentages en
      -- relatif (« la marge a monté de 3 % ») est le classique du rapport faux.
      'vs_yesterday_pt', ROUND(p.mrg_t - p.mrg_y, 2),
      'vs_d7_pt',        ROUND(p.mrg_t - p.mrg_7, 2),
      'basis',             'current_cost_price',
      'cost_coverage_pct', p.cov_t)
  ) INTO v_out FROM p;

  RETURN v_out;
END;
$function$;


-- ── Helper : cash on hand, définition comptable + dérivation tiroir/coffre ──
CREATE OR REPLACE FUNCTION public._dashboard_cash_on_hand_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  WITH wallets AS (
    SELECT a.code, a.name,
           COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je
             ON je.id = jel.journal_entry_id AND je.status = 'posted'
     WHERE a.code IN ('1110', '1111', '1117')
     GROUP BY a.code, a.name
  ),
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
           'value',      COALESCE((SELECT SUM(balance) FROM wallets), 0),
           'drawer',     (SELECT expected FROM drawer),
           'safe',       COALESCE((SELECT SUM(balance) FROM wallets), 0)
                           - (SELECT expected FROM drawer),
           'is_derived', TRUE,
           'wallets',    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'code', code, 'name', name, 'balance', balance
                          ) ORDER BY code) FROM wallets), '[]'::jsonb))
    INTO v_out;

  RETURN v_out;
END;
$function$;


-- ── Helper : série 30 j + les 30 j PRÉCÉDENTS, alignés par rang ────────────
CREATE OR REPLACE FUNCTION public._dashboard_revenue_series_v1(p_tz TEXT, p_today DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_series  JSONB;
  v_summary JSONB;
BEGIN
  WITH days AS (
    SELECT d::date AS day, ROW_NUMBER() OVER (ORDER BY d) AS idx
      FROM generate_series(p_today - 59, p_today, interval '1 day') d
  ),
  valid AS (
    SELECT ((o.paid_at AT TIME ZONE p_tz))::date AS day, o.total
      FROM orders o
     WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE p_tz))::date BETWEEN p_today - 59 AND p_today
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE p_tz))::date AS day, SUM(r.total) AS refunds
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE p_tz))::date BETWEEN p_today - 59 AND p_today
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  series AS (
    SELECT d.day, d.idx,
           (COALESCE(SUM(v.total), 0) - COALESCE(MAX(dr.refunds), 0))::NUMERIC(14,2) AS net
      FROM days d
      LEFT JOIN valid       v  ON v.day  = d.day
      LEFT JOIN day_refunds dr ON dr.day = d.day
     GROUP BY d.day, d.idx
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', cur.day, 'net', cur.net, 'prev_net', prev.net
         ) ORDER BY cur.day), '[]'::jsonb),
         jsonb_build_object(
           'total',      COALESCE(SUM(cur.net), 0),
           'prev_total', COALESCE(SUM(prev.net), 0),
           'delta_pct',  _pct_change(COALESCE(SUM(cur.net), 0),
                                     COALESCE(SUM(prev.net), 0)))
    INTO v_series, v_summary
    FROM series cur
    LEFT JOIN series prev ON prev.idx = cur.idx - 30
   WHERE cur.idx > 30;

  RETURN jsonb_build_object('series', v_series, 'summary', v_summary);
END;
$function$;


-- ── Helper : profil horaire aujourd'hui vs même jour la semaine passée ─────
-- 12 tranches 06:00→17:00. Les heures sans vente valent 0 et RESTENT dans la
-- série : un trou dans un graphe horaire se lit comme une fermeture.
CREATE OR REPLACE FUNCTION public._dashboard_hourly_v1(p_tz TEXT, p_today DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_series JSONB;
  v_peak   JSONB;
BEGIN
  WITH hours AS (SELECT generate_series(6, 17) AS hour),
  sales AS (
    SELECT EXTRACT(HOUR FROM (o.paid_at AT TIME ZONE p_tz))::INT AS hour,
           ((o.paid_at AT TIME ZONE p_tz))::date                 AS day,
           o.total
      FROM orders o
     WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 7)
  ),
  buckets AS (
    SELECT h.hour,
           COALESCE(SUM(s.total) FILTER (WHERE s.day = p_today), 0)::NUMERIC(14,2)     AS today,
           COALESCE(SUM(s.total) FILTER (WHERE s.day = p_today - 7), 0)::NUMERIC(14,2) AS last_week
      FROM hours h
      LEFT JOIN sales s ON s.hour = h.hour
     GROUP BY h.hour
  ),
  windows AS (
    SELECT hour,
           SUM(today) OVER (ORDER BY hour ROWS BETWEEN CURRENT ROW AND 2 FOLLOWING) AS win_total,
           COUNT(*)   OVER (ORDER BY hour ROWS BETWEEN CURRENT ROW AND 2 FOLLOWING) AS win_size,
           SUM(today) OVER ()                                                       AS day_total
      FROM buckets
  )
  SELECT (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'hour', b.hour, 'today', b.today, 'last_week', b.last_week
                 ) ORDER BY b.hour), '[]'::jsonb) FROM buckets b),
         (SELECT jsonb_build_object(
                   'from_hour', w.hour,
                   'to_hour',   w.hour + 3,
                   'share_pct', ROUND((w.win_total / w.day_total) * 100, 1))
            FROM windows w
           WHERE w.win_size = 3 AND w.day_total > 0
           ORDER BY w.win_total DESC, w.hour
           LIMIT 1)
    INTO v_series, v_peak;

  RETURN jsonb_build_object('series', v_series, 'peak', v_peak);
END;
$function$;


-- ── Helper : parts de revenu par type + encaissements + cash attendu ───────
CREATE OR REPLACE FUNCTION public._dashboard_share_payments_v1(p_tz TEXT, p_today DATE)
 RETURNS jsonb
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
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_type', t.order_type, 'gross', t.gross, 'order_count', t.cnt,
           'share_pct', ROUND((t.gross / NULLIF(SUM(t.gross) OVER (), 0)) * 100, 1)
         ) ORDER BY t.gross DESC), '[]'::jsonb)
    INTO v_share FROM t;

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
  -- Formule reprise TELLE QUELLE de close_shift_v8 : opening + cash_sales +
  -- in - out. Toute divergence ici se lirait comme une erreur de caisse.
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
                        'share_pct', ROUND((pm.amount / NULLIF(SUM(pm.amount) OVER (), 0)) * 100, 1)
                      ) ORDER BY pm.amount DESC) FROM pm), '[]'::jsonb),
           'total', COALESCE((SELECT SUM(amount) FROM pm), 0),
           'cash_expected_drawer', (SELECT expected FROM drawer))
    INTO v_payments;

  RETURN jsonb_build_object('revenue_share', v_share, 'payments', v_payments);
END;
$function$;


-- ── Helper : coût MTD par compte — classe 5 = COGS, classe 6 = OpEx ────────
CREATE OR REPLACE FUNCTION public._dashboard_cost_mtd_v1(p_tz TEXT, p_today DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  WITH bounds AS (
    SELECT date_trunc('month', p_today)::date                        AS m_start,
           (date_trunc('month', p_today) - interval '1 month')::date AS p_start,
           (date_trunc('month', p_today) - interval '1 day')::date   AS p_end
  ),
  lines AS (
    SELECT a.code, a.name, a.account_class,
           SUM(l.debit - l.credit) FILTER (WHERE j.entry_date >= b.m_start) AS mtd,
           SUM(l.debit - l.credit) FILTER (
             WHERE j.entry_date BETWEEN b.p_start AND b.p_end)              AS prev
      FROM journal_entry_lines l
      JOIN accounts a        ON a.id = l.account_id
      JOIN journal_entries j ON j.id = l.journal_entry_id AND j.status = 'posted'
      CROSS JOIN bounds b
     WHERE a.account_type = 'expense'
       AND j.entry_date >= b.p_start
     GROUP BY a.code, a.name, a.account_class
  ),
  scoped AS (
    SELECT code, name,
           CASE WHEN account_class = 5 THEN 'cogs' ELSE 'opex' END AS family,
           COALESCE(mtd, 0) AS mtd, COALESCE(prev, 0) AS prev
      FROM lines
     WHERE COALESCE(mtd, 0) <> 0 OR COALESCE(prev, 0) <> 0
  ),
  sales_mtd AS (
    SELECT COALESCE(SUM(o.total), 0) AS net, COUNT(*) AS orders
      FROM orders o CROSS JOIN bounds b
     WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE p_tz))::date >= b.m_start
  ),
  totals AS (
    SELECT COALESCE((SELECT SUM(mtd) FROM scoped WHERE family = 'cogs'), 0) AS cogs,
           COALESCE((SELECT SUM(mtd) FROM scoped WHERE family = 'opex'), 0) AS opex,
           COALESCE((SELECT SUM(mtd) FROM scoped), 0)                       AS all_cost,
           (SELECT net FROM sales_mtd)                                      AS sales,
           (SELECT orders FROM sales_mtd)                                   AS orders
  )
  SELECT jsonb_build_object(
    'cogs_total',        t.cogs,
    'opex_total',        t.opex,
    'sales_mtd',         t.sales,
    'cogs_pct_of_sales', ROUND((t.cogs / NULLIF(t.sales, 0)) * 100, 1),
    'opex_pct_of_sales', ROUND((t.opex / NULLIF(t.sales, 0)) * 100, 1),
    'total',             t.all_cost,
    'cost_per_basket',   CASE WHEN t.orders = 0 THEN NULL
                              ELSE ROUND(t.all_cost / t.orders, 0) END,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'account_code', code, 'account_name', name, 'family', family,
                 'amount', ROUND(mtd), 'mom_delta_pct', _pct_change(mtd, prev)
               ) ORDER BY mtd DESC) FROM scoped), '[]'::jsonb)
  ) INTO v_out FROM totals t;

  RETURN v_out;
END;
$function$;


-- ── La fonction publique : barrière de droit + orchestration ───────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v2()
 RETURNS jsonb
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

  v_kpis   := _dashboard_kpis_v1(v_tz, v_today);
  v_rev    := _dashboard_revenue_series_v1(v_tz, v_today);
  v_hourly := _dashboard_hourly_v1(v_tz, v_today);
  v_sp     := _dashboard_share_payments_v1(v_tz, v_today);

  -- La trésorerie a sa propre barrière : un lecteur de rapports voit le CA,
  -- pas le cash. Le bloc est neutralisé, le reste du dashboard vit.
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

COMMENT ON FUNCTION public.get_dashboard_overview_v2() IS
  'Dashboard « Today » (écran 1c). 6 KPI avec comparaisons J-1 / D-7 (même jour '
  'de semaine), série 30 j vs 30 j précédents, profil horaire vs semaine passée, '
  'parts de revenu, encaissements, coût MTD par compte. Gate reports.read ; le '
  'bloc cash_on_hand exige en plus accounting.cash.read, sinon il est restreint. '
  'Marge brute calculée au products.cost_price COURANT (basis=current_cost_price) '
  '— aucun coût n''est figé à la vente dans le schéma.';

-- Les helpers ne sont PAS une surface d'API. Seule la fonction publique, qui
-- porte les barrières de droit, les appelle ; comme elle est SECURITY DEFINER,
-- ils s'exécutent dans son contexte sans avoir besoin d'aucun grant.
--
-- ⚠ `REVOKE ... FROM PUBLIC` NE SUFFIT PAS ICI. Le projet a un
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO authenticated` :
-- toute fonction neuve naît donc avec un grant EXPLICITE à `authenticated`, que
-- le REVOKE sur PUBLIC ne touche pas. Sans la révocation nominative ci-dessous,
-- n'importe quelle session authentifiée pourrait appeler
-- `_dashboard_cash_on_hand_v1()` en DIRECT et lire la trésorerie sans passer par
-- la barrière `accounting.cash.read`. C'est le pendant, côté `authenticated`, de
-- la règle de defense-in-depth que CLAUDE.md énonce pour `anon`.
REVOKE ALL ON FUNCTION public._pct_change(NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._dashboard_kpis_v1(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._dashboard_cash_on_hand_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._dashboard_revenue_series_v1(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._dashboard_hourly_v1(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._dashboard_share_payments_v1(TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._dashboard_cost_mtd_v1(TEXT, DATE) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public._pct_change(NUMERIC, NUMERIC) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._dashboard_kpis_v1(TEXT, DATE) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._dashboard_cash_on_hand_v1() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._dashboard_revenue_series_v1(TEXT, DATE) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._dashboard_hourly_v1(TEXT, DATE) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._dashboard_share_payments_v1(TEXT, DATE) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public._dashboard_cost_mtd_v1(TEXT, DATE) FROM authenticated, anon;

REVOKE ALL ON FUNCTION public.get_dashboard_overview_v2() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_overview_v2() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview_v2() TO authenticated;

-- Versioning monotone : la _v1 disparaît dans la migration qui publie la _v2.
DROP FUNCTION IF EXISTS public.get_dashboard_overview_v1();
