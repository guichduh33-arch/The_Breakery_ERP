-- 20260710000147_get_pos_payment_breakdown_v1.sql
-- Reports POS refonte — Lot B : répartition de l'encaissé par mode de paiement
-- (Cash / Card / QRIS / EDC / Transfer / Store credit + « other » catch-all).
--
-- Source de vérité serveur, partageable avec le back-office. Le PÉRIMÈTRE DE
-- COMMANDES est STRICTEMENT IDENTIQUE à get_pos_sales_overview_v1 (Lot A) :
--   status IN ('paid','completed') · order_type <> 'b2b' · non-import historique ·
--   aucune ligne produit is_test · date métier = COALESCE(paid_at,created_at)
--   bucketée en timezone WITA. Ainsi Σ(encaissé) réconcilie avec le revenue de
--   l'Overview, À L'EXCEPTION des commandes `completed` non soldées (outstanding) :
--   pour elles, la somme des tenders < total commande. C'est voulu — ce rapport
--   montre l'ENCAISSÉ RÉEL (order_payments.amount), pas le CA reconnu.
--
-- `order_payments.amount` = montant appliqué à la commande (net de la monnaie
-- rendue), donc Σ amount d'une commande soldée = son total. On somme au niveau
-- tender (une commande peut avoir plusieurs paiements = split tender).
--
-- Gate reports.sales.read (perm opérateur POS, comme l'Overview) — le RPC BO
-- get_payments_by_method_v1 reste séparé (gate reports.financial.read, filtre UTC).
-- REVOKE trio + GRANT authenticated (doctrine S20).

CREATE OR REPLACE FUNCTION get_pos_payment_breakdown_v1(
  p_start_date date,
  p_end_date   date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tz     text;
  v_result jsonb;
BEGIN
  -- ── Gate ────────────────────────────────────────────────────────────────
  IF v_uid IS NULL OR NOT has_permission(v_uid, 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read' USING ERRCODE = '42501';
  END IF;

  -- ── Date-range guards ───────────────────────────────────────────────────
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range: start date is after end date' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(timezone, 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;
  v_tz := COALESCE(v_tz, 'Asia/Makassar');

  WITH scoped_orders AS (
    SELECT o.id, o.total
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz)::date)
          BETWEEN p_start_date AND p_end_date
  ),
  tenders AS (
    SELECT op.method::text AS method, op.amount
    FROM order_payments op
    JOIN scoped_orders so ON so.id = op.order_id
  ),
  grp AS (
    SELECT method, SUM(amount) AS amount, COUNT(*)::int AS tenders
    FROM tenders
    GROUP BY method
  ),
  tot AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS total_amount,
           COALESCE(SUM(tenders), 0)::int    AS total_tenders
    FROM grp
  ),
  ords AS (SELECT COUNT(*)::int AS c FROM scoped_orders)
  SELECT jsonb_build_object(
    'timezone',       v_tz,
    'total_amount',   (SELECT total_amount  FROM tot),
    'total_orders',   (SELECT c             FROM ords),
    'total_tenders',  (SELECT total_tenders FROM tot),
    'by_method', COALESCE((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.amount DESC)
      FROM (
        SELECT
          g.method,
          g.amount,
          g.tenders,
          CASE WHEN (SELECT total_amount FROM tot) = 0 THEN 0
               ELSE ROUND(g.amount / (SELECT total_amount FROM tot) * 100, 2)
          END AS share_pct
        FROM grp g
      ) x
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION get_pos_payment_breakdown_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_pos_payment_breakdown_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION get_pos_payment_breakdown_v1(date, date) IS
  'Reports POS Lot B — répartition de l''encaissé par mode de paiement (order_payments.amount) '
  'sur le même périmètre que get_pos_sales_overview_v1 (paid+completed, non-B2B, non-historique, '
  'sans produit is_test, date métier bucketée WITA). Gate reports.sales.read. Enveloppe '
  '{timezone,total_amount,total_orders,total_tenders,by_method[{method,amount,tenders,share_pct}]}.';
