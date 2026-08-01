-- 20260802000002_align_report_gates_stock_variance_and_cashier_variance.sql
--
-- Audit Reports 2026-08-01, lot C / decisions D2 et D2 bis.
--
-- D2 — aligner les RPC de rapport sur la famille reports.* : `reports.*`
-- gouverne les rapports, `inventory.*` le module operationnel. Un utilisateur
-- autorise sur le module inventaire ne doit pas heriter des rapports, et
-- reciproquement.
--
-- Perimetre reduit apres re-verification : le releve initial de l'audit ne
-- capturait que le PREMIER has_permission de chaque corps. En listant TOUTES les
-- occurrences, get_stock_movement_ledger_v1 accepte deja
-- `inventory.read OU reports.inventory.read` — elle n'a donc jamais eu d'ecart
-- avec sa route et n'est PAS bumpee. Seule get_stock_variance_v1, qui ne teste
-- que `inventory.read`, diverge reellement de sa route (reports.inventory.read).
--
-- D2 bis — get_cashier_variance_v1 etait gatee sur `reports.read`, le code le
-- plus faible de la famille, que tout porteur de rapport possede. Or elle expose
-- les ecarts de caisse par caissier (manquants, pires ecarts, matrice par jour
-- de semaine) : c'est de la donnee de controle financier. Elle monte a
-- reports.financial.read, et sa route suit.
--
-- Les deux corps sont repris verbatim de pg_get_functiondef ; seule la chaine de
-- permission change. Aucune logique metier modifiee.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_stock_variance_v2  (inventory.read -> reports.inventory.read)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stock_variance_v2(
  p_section_id UUID        DEFAULT NULL,
  p_date_start TIMESTAMPTZ DEFAULT NULL,
  p_date_end   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  product_id UUID, product_name TEXT, sku TEXT,
  opened NUMERIC, sold NUMERIC, adjusted NUMERIC,
  current_qty NUMERIC, expected NUMERIC, variance NUMERIC, variance_pct NUMERIC
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
  WITH window_bounds AS (
    SELECT COALESCE(p_date_start, now() - INTERVAL '30 days') AS ws,
           COALESCE(p_date_end,   now())                      AS we
  ),
  filtered AS (
    SELECT sm.*
    FROM stock_movements sm, window_bounds w
    WHERE sm.created_at BETWEEN w.ws AND w.we
      AND (p_section_id IS NULL
           OR sm.from_section_id = p_section_id
           OR sm.to_section_id   = p_section_id)
  ),
  agg AS (
    SELECT
      p.id   AS product_id,
      p.name AS product_name,
      p.sku  AS sku,
      p.current_stock AS current_qty,
      COALESCE(SUM(CASE WHEN sm.movement_type IN ('purchase','incoming','production_in')
                        THEN sm.quantity ELSE 0 END), 0) AS opened,
      COALESCE(SUM(CASE WHEN sm.movement_type IN ('sale','sale_void')
                        THEN sm.quantity ELSE 0 END), 0) AS sold,
      COALESCE(SUM(CASE WHEN sm.movement_type IN
                             ('adjustment','adjustment_in','adjustment_out',
                              'waste','opname_in','opname_out',
                              'production_out','purchase_return',
                              'transfer_in','transfer_out')
                        THEN sm.quantity ELSE 0 END), 0) AS adjusted,
      COALESCE(SUM(sm.quantity), 0) AS expected
    FROM products p
    LEFT JOIN filtered sm ON sm.product_id = p.id
    WHERE p.deleted_at IS NULL
    GROUP BY p.id, p.name, p.sku, p.current_stock
  )
  SELECT
    a.product_id,
    a.product_name,
    a.sku,
    a.opened::DECIMAL(12,3),
    a.sold::DECIMAL(12,3),
    a.adjusted::DECIMAL(12,3),
    a.current_qty::DECIMAL(12,3),
    a.expected::DECIMAL(12,3),
    (a.current_qty - a.expected)::DECIMAL(12,3) AS variance,
    CASE WHEN a.expected <> 0
         THEN (((a.current_qty - a.expected) / a.expected) * 100)::DECIMAL(10,3)
         ELSE 0::DECIMAL(10,3) END              AS variance_pct
  FROM agg a
  ORDER BY ABS(a.current_qty - a.expected) DESC, a.product_name ASC;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_cashier_variance_v2  (reports.read -> reports.financial.read)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cashier_variance_v2(
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz       TEXT;
  v_cashiers JSONB;
  v_totals   JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH sessions AS (
    SELECT
      ps.opened_by                                           AS cashier_id,
      ps.variance_total                                      AS cash_var,
      ps.counted_qris                                        AS counted_qris,
      ps.counted_card                                        AS counted_card,
      CASE WHEN ps.counted_qris IS NOT NULL
           THEN (sc.metadata->>'variance_qris')::numeric END AS qris_var,
      CASE WHEN ps.counted_card IS NOT NULL
           THEN (sc.metadata->>'variance_card')::numeric END AS card_var,
      EXTRACT(DOW FROM (ps.closed_at AT TIME ZONE v_tz))::int AS dow
    FROM pos_sessions ps
    LEFT JOIN LATERAL (
      SELECT al.metadata
        FROM audit_logs al
       WHERE al.action = 'shift.close'
         AND al.entity_type = 'pos_sessions'
         AND al.entity_id = ps.id
       ORDER BY al.created_at DESC
       LIMIT 1
    ) sc ON TRUE
    WHERE ps.status = 'closed'
      AND ps.closed_at IS NOT NULL
      AND ps.opened_by IS NOT NULL
      AND ((ps.closed_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  per_cashier AS (
    SELECT
      s.cashier_id,
      COUNT(*)                                                   AS sessions_count,
      COALESCE(SUM(s.cash_var), 0)                               AS cash_total,
      COALESCE(SUM(s.cash_var) FILTER (WHERE s.cash_var < 0), 0) AS cash_short,
      COUNT(*) FILTER (WHERE s.cash_var < 0)                     AS short_count,
      COUNT(*) FILTER (WHERE s.cash_var > 0)                     AS over_count,
      COALESCE(MIN(s.cash_var), 0)                               AS worst_var,
      COUNT(*) FILTER (WHERE s.counted_qris IS NOT NULL)         AS qris_sessions,
      COALESCE(SUM(s.qris_var), 0)                               AS qris_total,
      COUNT(*) FILTER (WHERE s.counted_card IS NOT NULL)         AS card_sessions,
      COALESCE(SUM(s.card_var), 0)                               AS card_total
    FROM sessions s
    GROUP BY s.cashier_id
  ),
  dow_by_cashier AS (
    SELECT d.cashier_id,
           jsonb_agg(jsonb_build_object(
             'dow', d.dow, 'sessions', d.sessions, 'total_variance', d.total_variance
           ) ORDER BY d.dow) AS dow_cash
    FROM (
      SELECT s.cashier_id, s.dow,
             COUNT(*) AS sessions,
             COALESCE(SUM(s.cash_var), 0) AS total_variance
        FROM sessions s
       GROUP BY s.cashier_id, s.dow
    ) d
    GROUP BY d.cashier_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'cashier_id',     pc.cashier_id,
      'cashier_name',   COALESCE(up.full_name, '—'),
      'sessions_count', pc.sessions_count,
      'cash', jsonb_build_object(
        'total_variance', pc.cash_total,
        'avg_variance',   ROUND(pc.cash_total / NULLIF(pc.sessions_count, 0), 2),
        'total_short',    pc.cash_short,
        'short_count',    pc.short_count,
        'over_count',     pc.over_count,
        'worst_variance', pc.worst_var
      ),
      'qris', jsonb_build_object('counted_sessions', pc.qris_sessions, 'total_variance', pc.qris_total),
      'card', jsonb_build_object('counted_sessions', pc.card_sessions, 'total_variance', pc.card_total),
      'dow_cash', COALESCE(dc.dow_cash, '[]'::jsonb)
    ) ORDER BY pc.cash_short ASC
  )
  INTO v_cashiers
  FROM per_cashier pc
  JOIN user_profiles up ON up.id = pc.cashier_id
  LEFT JOIN dow_by_cashier dc ON dc.cashier_id = pc.cashier_id;

  WITH sessions AS (
    SELECT ps.variance_total AS cash_var, ps.counted_qris, ps.counted_card,
           CASE WHEN ps.counted_qris IS NOT NULL THEN (sc.metadata->>'variance_qris')::numeric END AS qris_var,
           CASE WHEN ps.counted_card IS NOT NULL THEN (sc.metadata->>'variance_card')::numeric END AS card_var
      FROM pos_sessions ps
      LEFT JOIN LATERAL (
        SELECT al.metadata FROM audit_logs al
         WHERE al.action = 'shift.close' AND al.entity_type = 'pos_sessions' AND al.entity_id = ps.id
         ORDER BY al.created_at DESC LIMIT 1
      ) sc ON TRUE
     WHERE ps.status = 'closed' AND ps.closed_at IS NOT NULL AND ps.opened_by IS NOT NULL
       AND ((ps.closed_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  )
  SELECT jsonb_build_object(
    'sessions_count', COUNT(*),
    'cash', jsonb_build_object(
      'total_variance', COALESCE(SUM(cash_var), 0),
      'total_short',    COALESCE(SUM(cash_var) FILTER (WHERE cash_var < 0), 0),
      'short_count',    COUNT(*) FILTER (WHERE cash_var < 0),
      'over_count',     COUNT(*) FILTER (WHERE cash_var > 0)
    ),
    'qris', jsonb_build_object('counted_sessions', COUNT(*) FILTER (WHERE counted_qris IS NOT NULL), 'total_variance', COALESCE(SUM(qris_var), 0)),
    'card', jsonb_build_object('counted_sessions', COUNT(*) FILTER (WHERE counted_card IS NOT NULL), 'total_variance', COALESCE(SUM(card_var), 0))
  ) INTO v_totals
  FROM sessions;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'cashiers',     COALESCE(v_cashiers, '[]'::jsonb),
    'totals',       COALESCE(v_totals, jsonb_build_object('sessions_count', 0))
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Paires REVOKE (S25) : anon herite EXECUTE via PUBLIC.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_stock_variance_v2(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_cashier_variance_v2(DATE, DATE)                   FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_stock_variance_v2(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cashier_variance_v2(DATE, DATE)                   TO authenticated;

-- Versioning monotone.
DROP FUNCTION IF EXISTS public.get_stock_variance_v1(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.get_cashier_variance_v1(DATE, DATE);
