-- ADR-025 D1/D2/D5 -- get_orders_counters_v1 : les compteurs de la liste des
-- commandes quittent le client.
--
-- Compte total, comptes+sommes par statut, et sommes payé/impayé pour la
-- fenêtre et les filtres en cours. Les prédicats de sélection sont copiés du
-- corps LIVE de get_orders_list_v2 (pg_get_functiondef, relevé 2026-08-12),
-- MOINS le statut : décision 2 — les compteurs n'appliquent jamais le panier
-- actif, même si l'appelant le passe dans p_filters (l'invariant est tenu ici,
-- pas par la discipline du client). Pas de curseur ni de limite : un compteur
-- mesure la population, pas une page.
--
-- Sémantiques (ADR-025 D5) :
--   payé   = la commande a au moins un paiement enregistré ;
--   impayé = aucun paiement et la commande n'est pas annulée (voided).
--
-- Parité compteurs/lignes tenue par pgTAP (ADR-025 D4).

CREATE FUNCTION public.get_orders_counters_v1(
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
           EXISTS (
             SELECT 1 FROM order_payments op WHERE op.order_id = o.id
           ) AS has_payment
    FROM orders o
    LEFT JOIN customers    c  ON c.id  = o.customer_id
    LEFT JOIN pos_sessions ps ON ps.id = o.session_id
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
      'count',  (COUNT(*) FILTER (WHERE f.has_payment))::int,
      'amount', COALESCE(SUM(f.total) FILTER (WHERE f.has_payment), 0)
    ),
    'unpaid', jsonb_build_object(
      'count',  (COUNT(*) FILTER (WHERE NOT f.has_payment AND f.status::text <> 'voided'))::int,
      'amount', COALESCE(SUM(f.total) FILTER (WHERE NOT f.has_payment AND f.status::text <> 'voided'), 0)
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

-- ACL defense-en-profondeur (anon hérite EXECUTE via PUBLIC).
REVOKE EXECUTE ON FUNCTION public.get_orders_counters_v1(text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_counters_v1(text, text, jsonb) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_counters_v1(text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_orders_counters_v1(text, text, jsonb) IS
  'ADR-025 : compteurs de la liste des commandes BO — total, par statut (comptes + sommes), payé/impayé. Applique les filtres serveur SAUF le statut (D2). Parité avec get_orders_list tenue par pgTAP (D4).';
