-- 20260813000008_bump_get_orders_list_v4_sort.sql
--
-- Lot 5 chantier 4 (brief /impeccable shape validé 2026-08-13) — tri serveur
-- de la liste des commandes. La v3 figeait ORDER BY created_at DESC ; l'écran
-- Orders ne pouvait trier aucune colonne (l'archétype List de Products le
-- fait). Arbitrage Mamat : tri serveur blanc-listé, PAS d'actions groupées.
--
-- v4 = corps LIVE de la v3 (pg_get_functiondef, jamais le fichier d'origine)
-- + p_sort/p_dir blanc-listés + curseur keyset GÉNÉRIQUE (valeur_de_tri, id)
-- transporté en texte. L'ORDER BY est injecté par format() depuis un mapping
-- fermé — aucune entrée utilisateur ne touche le SQL. Hors liste blanche :
-- rejet 22023.
--
-- Sortie : lines + next_cursor_val (texte, valeur de tri de la dernière ligne
-- servie) + next_cursor_id — le client les renvoie tels quels.

CREATE FUNCTION public.get_orders_list_v4(
  p_start      text,
  p_end        text,
  p_filters    jsonb DEFAULT '{}'::jsonb,
  p_limit      integer DEFAULT 50,
  p_sort       text DEFAULT 'created_at',
  p_dir        text DEFAULT 'desc',
  p_cursor_val text DEFAULT NULL,
  p_cursor_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_clamp     INT  := LEAST(GREATEST(p_limit, 1), 200);
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_expr      TEXT;  -- expression de tri (mapping fermé)
  v_cast      TEXT;  -- cast du curseur texte vers le type de l'expression
  v_dir       TEXT;
  v_op        TEXT;  -- comparateur keyset selon la direction
  v_sql       TEXT;
  v_lines     JSONB;
  v_next_val  TEXT;
  v_next_id   UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  -- Liste blanche du tri : toute autre valeur est un rejet franc. NULL
  -- explicite (call-sites positionnels historiques) = défaut created_at.
  CASE coalesce(p_sort, 'created_at')
    WHEN 'created_at' THEN v_expr := 'o.created_at';        v_cast := 'timestamptz';
    WHEN 'total'      THEN v_expr := 'o.total';             v_cast := 'numeric';
    WHEN 'status'     THEN v_expr := '(o.status)::text';     v_cast := 'text';
    WHEN 'order_type' THEN v_expr := '(o.order_type)::text'; v_cast := 'text';
    ELSE RAISE EXCEPTION 'invalid p_sort: %', p_sort USING ERRCODE = '22023';
  END CASE;
  CASE lower(coalesce(p_dir, 'desc'))
    WHEN 'desc' THEN v_dir := 'DESC'; v_op := '<';
    WHEN 'asc'  THEN v_dir := 'ASC';  v_op := '>';
    ELSE RAISE EXCEPTION 'invalid p_dir: %', p_dir USING ERRCODE = '22023';
  END CASE;

  v_sql := format($q$
  WITH filtered AS (
    SELECT
      o.id, o.order_number, o.order_type, o.status, o.total, o.created_at,
      o.customer_id, o.served_by, ps.terminal_id,
      c.customer_type, c.name AS customer_name,
      up.full_name AS served_by_name,
      (%1$s) AS _sort_val,
      CASE
        WHEN COALESCE(rsum.total, 0) = 0      THEN 'none'
        WHEN COALESCE(rsum.total, 0) >= o.total THEN 'full'
        ELSE 'partial'
      END AS refund_status,
      EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.modifiers IS NOT NULL
          AND jsonb_array_length(oi.modifiers) > 0
      ) AS has_modifiers,
      (
        SELECT CASE WHEN COUNT(DISTINCT op.method) > 1 THEN 'mixed'
                    ELSE MIN(op.method)::text END
        FROM order_payments op WHERE op.order_id = o.id
      ) AS payment_method_primary,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::INT AS items_count,
      ROW_NUMBER() OVER (ORDER BY %1$s %2$s, o.id %2$s) AS rn
    FROM orders o
    LEFT JOIN customers     c   ON c.id  = o.customer_id
    LEFT JOIN user_profiles up  ON up.id = o.served_by
    LEFT JOIN pos_sessions  ps  ON ps.id = o.session_id
    LEFT JOIN LATERAL (
      SELECT SUM(r.total) AS total FROM refunds r WHERE r.order_id = o.id
    ) rsum ON TRUE
    WHERE o.created_at BETWEEN $1 AND $2
      -- Keyset (valeur_de_tri, id) : le curseur est la DERNIÈRE ligne servie ;
      -- l'égalité de valeur se départage par id, aucune ligne perdue.
      AND (
        $5::text IS NULL
        OR ((%1$s), o.id) %3$s (($5)::%4$s, $6)
      )
      AND ($3->>'status'         IS NULL OR o.status::text       = $3->>'status')
      AND ($3->>'order_type'     IS NULL OR o.order_type::text   = $3->>'order_type')
      AND ($3->>'customer_id'    IS NULL OR o.customer_id        = ($3->>'customer_id')::uuid)
      AND ($3->>'served_by'      IS NULL OR o.served_by          = ($3->>'served_by')::uuid)
      AND ($3->>'total_min'      IS NULL OR o.total >= ($3->>'total_min')::numeric)
      AND ($3->>'total_max'      IS NULL OR o.total <= ($3->>'total_max')::numeric)
      AND ($3->>'customer_type'  IS NULL OR c.customer_type::text = $3->>'customer_type')
      AND ($3->>'payment_method' IS NULL OR EXISTS (
        SELECT 1 FROM order_payments op
        WHERE op.order_id = o.id AND op.method::text = $3->>'payment_method'
      ))
      AND ($3->>'terminal_id'    IS NULL OR ps.terminal_id       = ($3->>'terminal_id')::uuid)
      AND ($3->>'hour'           IS NULL OR EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Makassar') = ($3->>'hour')::int)
      AND (
        $3->>'refund_status' IS NULL
        OR (
          $3->>'refund_status' = 'none'
            AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)
        )
        OR (
          $3->>'refund_status' = 'partial'
            AND EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)
            AND COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) < o.total
        )
        OR (
          $3->>'refund_status' = 'full'
            AND COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) >= o.total
        )
      )
    ORDER BY %1$s %2$s, o.id %2$s
    LIMIT $4 + 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',                     f.id,
      'order_number',           f.order_number,
      'order_type',             f.order_type,
      'status',                 f.status,
      'total',                  f.total,
      'created_at',             f.created_at,
      'customer_id',            f.customer_id,
      'customer_name',          f.customer_name,
      'customer_type',          f.customer_type,
      'served_by',              f.served_by,
      'served_by_name',         f.served_by_name,
      'terminal_id',            f.terminal_id,
      'refund_status',          f.refund_status,
      'has_modifiers',          f.has_modifiers,
      'payment_method_primary', f.payment_method_primary,
      'items_count',            f.items_count
    ) ORDER BY f.rn) FILTER (WHERE f.rn <= $4), '[]'::jsonb),
    CASE WHEN COUNT(*) FILTER (WHERE f.rn > $4) > 0
         THEN (array_agg((f._sort_val)::text) FILTER (WHERE f.rn = $4))[1] END,
    CASE WHEN COUNT(*) FILTER (WHERE f.rn > $4) > 0
         THEN (array_agg(f.id) FILTER (WHERE f.rn = $4))[1] END
  FROM filtered f
  $q$, v_expr, v_dir, v_op, v_cast);

  EXECUTE v_sql
    INTO v_lines, v_next_val, v_next_id
    USING v_start, v_end, p_filters, v_clamp, p_cursor_val, p_cursor_id;

  RETURN jsonb_build_object(
    'lines', v_lines,
    'next_cursor_val', v_next_val,
    'next_cursor_id',  v_next_id,
    'sort', coalesce(p_sort, 'created_at'), 'dir', lower(coalesce(p_dir, 'desc'))
  );
END;
$function$;

COMMENT ON FUNCTION public.get_orders_list_v4(text, text, jsonb, integer, text, text, text, uuid) IS
  'Liste des commandes v4 (lot 5.4, 2026-08-13) — tri serveur blanc-listé + curseur keyset générique.';

-- Versioning monotone : la v3 meurt dans la même migration.
DROP FUNCTION public.get_orders_list_v3(text, text, jsonb, integer, timestamp with time zone, uuid);

-- Défense en profondeur anon + accès client authentifié (CLAUDE.md § Grants).
REVOKE EXECUTE ON FUNCTION public.get_orders_list_v4(text, text, jsonb, integer, text, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_list_v4(text, text, jsonb, integer, text, text, text, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_list_v4(text, text, jsonb, integer, text, text, text, uuid) TO authenticated;
