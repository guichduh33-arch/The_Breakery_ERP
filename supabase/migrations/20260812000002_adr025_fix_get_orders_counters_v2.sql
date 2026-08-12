-- Review PR #367 — correctifs ADR-025 (findings 1, 3, 7, 12, 15).
--
-- 1) INDEX orders(created_at DESC) : la famille get_orders_list borne son
--    seq-scan par un LIMIT, la famille de compteurs n'a pas de LIMIT — sans
--    index de fenêtre, chaque appel agrège la table entière (finding 12).
--
-- 2) get_orders_counters_v2 (+ DROP v1) : la v1 définissait « payé » par le
--    seul EXISTS(order_payments). Or record_b2b_payment règle une facture par
--    UPDATE orders SET status='paid' SANS ligne order_payments (bug déjà
--    corrigé une fois dans get_pos_b2b_debts_v3). La v2 restaure la règle que
--    l'écran appliquait avant la refonte : RÉGLÉ = paiement enregistré OU
--    statut paid/completed. Les commandes annulées sortent des DEUX paniers
--    d'argent (l'argent d'un void n'est ni « à encaisser » ni « encaissé
--    net »), et une cellule `refunded` expose le total remboursé de la
--    fenêtre — les sommes paid/unpaid restent des totaux de commandes, le
--    remboursé se lit à côté au lieu d'être invisible (finding 7).
--
-- 3) get_orders_list_v3 (+ DROP v2) : le curseur v2 renvoyait le created_at
--    de la ligne de PEEK puis filtrait strictement created_at < cursor — la
--    ligne de peek n'était jamais renvoyée, une commande perdue par frontière
--    de page (finding 3). La v3 passe en keyset (created_at, id) : le curseur
--    est la DERNIÈRE ligne renvoyée, le prédicat départage les égalités par
--    id, aucune perte ni doublon même sur timestamps identiques.
--
-- CREATE OR REPLACE partout : un rejeu chronologique doit être idempotent
-- (runbook DR, leçon ADR-013 D14 — finding 15).

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);

-- ============================================================ counters v2 ==
CREATE OR REPLACE FUNCTION public.get_orders_counters_v2(
  p_start   text,
  p_end     text,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_result    JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  WITH filtered AS (
    SELECT o.id, o.status, o.total,
           -- RÉGLÉ (ADR-025 D5 amendée) : un paiement enregistré OU un statut
           -- qui porte l'argent — les règlements B2B n'écrivent jamais dans
           -- order_payments.
           (EXISTS (SELECT 1 FROM order_payments op WHERE op.order_id = o.id)
             OR o.status IN ('paid', 'completed')) AS settled,
           rf.amt AS refund_amt
    FROM orders o
    LEFT JOIN customers    c  ON c.id  = o.customer_id
    LEFT JOIN pos_sessions ps ON ps.id = o.session_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(r.total), 0) AS amt FROM refunds r WHERE r.order_id = o.id
    ) rf ON TRUE
    WHERE o.created_at BETWEEN v_start AND v_end
      AND (p_filters->>'order_type'     IS NULL OR o.order_type::text   = p_filters->>'order_type')
      AND (p_filters->>'customer_id'    IS NULL OR o.customer_id        = (p_filters->>'customer_id')::uuid)
      AND (p_filters->>'served_by'      IS NULL OR o.served_by          = (p_filters->>'served_by')::uuid)
      AND (p_filters->>'total_min'      IS NULL OR o.total >= (p_filters->>'total_min')::numeric)
      AND (p_filters->>'total_max'      IS NULL OR o.total <= (p_filters->>'total_max')::numeric)
      AND (p_filters->>'customer_type'  IS NULL OR c.customer_type::text = p_filters->>'customer_type')
      AND (p_filters->>'payment_method' IS NULL OR EXISTS (
        SELECT 1 FROM order_payments op
        WHERE op.order_id = o.id AND op.method::text = p_filters->>'payment_method'
      ))
      AND (p_filters->>'terminal_id'    IS NULL OR ps.terminal_id       = (p_filters->>'terminal_id')::uuid)
      AND (p_filters->>'hour'           IS NULL OR EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Makassar') = (p_filters->>'hour')::int)
      -- Branches STRICTEMENT identiques à la famille get_orders_list (parité
      -- D2/D4) — le LATERAL rf ne sert que la cellule `refunded`.
      AND (
        p_filters->>'refund_status' IS NULL
        OR (
          p_filters->>'refund_status' = 'none'
            AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)
        )
        OR (
          p_filters->>'refund_status' = 'partial'
            AND EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)
            AND COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) < o.total
        )
        OR (
          p_filters->>'refund_status' = 'full'
            AND COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) >= o.total
        )
      )
  ),
  by_status AS (
    SELECT f.status::text AS status,
           COUNT(*)::int  AS cnt,
           COALESCE(SUM(f.total), 0) AS amt
    FROM filtered f
    GROUP BY f.status
  )
  SELECT jsonb_build_object(
    'total', jsonb_build_object(
      'count',  COUNT(*)::int,
      'amount', COALESCE(SUM(f.total), 0)
    ),
    'paid', jsonb_build_object(
      'count',  (COUNT(*) FILTER (WHERE f.settled AND f.status::text <> 'voided'))::int,
      'amount', COALESCE(SUM(f.total) FILTER (WHERE f.settled AND f.status::text <> 'voided'), 0)
    ),
    'unpaid', jsonb_build_object(
      'count',  (COUNT(*) FILTER (WHERE NOT f.settled AND f.status::text <> 'voided'))::int,
      'amount', COALESCE(SUM(f.total) FILTER (WHERE NOT f.settled AND f.status::text <> 'voided'), 0)
    ),
    'refunded', jsonb_build_object(
      'count',  (COUNT(*) FILTER (WHERE f.refund_amt > 0))::int,
      'amount', COALESCE(SUM(f.refund_amt), 0)
    ),
    'by_status', (
      SELECT COALESCE(
        jsonb_object_agg(b.status, jsonb_build_object('count', b.cnt, 'amount', b.amt)),
        '{}'::jsonb
      )
      FROM by_status b
    )
  )
  INTO v_result
  FROM filtered f;

  RETURN v_result;
END;
$function$;

DROP FUNCTION IF EXISTS public.get_orders_counters_v1(text, text, jsonb);

REVOKE EXECUTE ON FUNCTION public.get_orders_counters_v2(text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_counters_v2(text, text, jsonb) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_counters_v2(text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_orders_counters_v2(text, text, jsonb) IS
  'ADR-025 (amendé, review PR #367) : compteurs de la liste des commandes BO. Réglé = paiement enregistré OU statut paid/completed (les règlements B2B n''écrivent pas dans order_payments) ; voided exclu des paniers paid/unpaid ; cellule refunded = total remboursé de la fenêtre. Applique les filtres serveur SAUF le statut (D2).';
