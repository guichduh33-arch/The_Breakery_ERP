-- 20260724000219_get_off_hours_sales_v1.sql
-- ADR-006 déc. 9 (business hours) — rapport « ventes hors-horaire » (signal
-- fraude) : chaque paiement encaissé hors du créneau d'ouverture du jour
-- (business_hours, heure locale business_config.timezone).
--
-- Sémantique : jour à `null` = fermé → tout paiement du jour est marqué ;
-- clé de jour ABSENTE de business_hours = jour non configuré → jamais marqué
-- (config vide {} ⇒ rapport vide, pas de faux positifs avant configuration).
-- Conventions get_payments_by_method_v3 : bornes calendaires locales
-- convertie en instants absolus, orders non voided, RETURNS jsonb.

CREATE FUNCTION public.get_off_hours_sales_v1(p_date_start text, p_date_end text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_tz        TEXT;
  v_hours     JSONB;
  v_start     TIMESTAMPTZ;
  v_end       TIMESTAMPTZ;
  v_rows      JSONB;
  v_summary   JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.audit.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.audit.read' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  SELECT business_hours INTO v_hours
    FROM business_config WHERE id = 1;
  v_hours := COALESCE(v_hours, '{}'::jsonb);

  -- Bornes calendaires locales → plage d'instants absolus (index paid_at).
  v_start := (p_date_start || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_end   := ((p_date_end::date + 1) || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  WITH sale_payments AS (
    SELECT op.order_id, op.method, op.amount, op.paid_at,
           (op.paid_at AT TIME ZONE v_tz) AS local_ts
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE op.paid_at >= v_start AND op.paid_at < v_end
      AND o.status NOT IN ('voided')
  ),
  keyed AS (
    SELECT sp.*,
           (ARRAY['mon','tue','wed','thu','fri','sat','sun'])
             [EXTRACT(ISODOW FROM sp.local_ts)::int] AS day_key,
           to_char(sp.local_ts, 'HH24:MI') AS local_hhmm
    FROM sale_payments sp
  ),
  off_hours AS (
    SELECT k.*, v_hours -> k.day_key AS day_cfg
    FROM keyed k
    WHERE v_hours ? k.day_key
      AND (
        jsonb_typeof(v_hours -> k.day_key) = 'null'
        OR k.local_hhmm <  (v_hours -> k.day_key ->> 'open')
        OR k.local_hhmm >= (v_hours -> k.day_key ->> 'close')
      )
  )
  SELECT
    jsonb_build_object(
      'payment_count', COUNT(*),
      'order_count',   COUNT(DISTINCT oh.order_id),
      'total_amount',  COALESCE(SUM(oh.amount), 0)
    ),
    COALESCE(jsonb_agg(jsonb_build_object(
      'order_id',     oh.order_id,
      'order_number', o.order_number,
      'method',       oh.method,
      'amount',       oh.amount,
      'paid_at',      oh.paid_at,
      'local_time',   to_char(oh.local_ts, 'YYYY-MM-DD HH24:MI'),
      'day_key',      oh.day_key,
      'window_open',  oh.day_cfg ->> 'open',
      'window_close', oh.day_cfg ->> 'close',
      'cashier',      up.full_name
    ) ORDER BY oh.paid_at), '[]'::jsonb)
  INTO v_summary, v_rows
  FROM off_hours oh
  JOIN orders o ON o.id = oh.order_id
  LEFT JOIN user_profiles up ON up.id = o.served_by;

  RETURN jsonb_build_object('summary', v_summary, 'rows', v_rows);
END;
$function$;

-- Grants — defense-in-depth (REVOKE PUBLIC + anon + ADP, puis grant explicite).
REVOKE EXECUTE ON FUNCTION public.get_off_hours_sales_v1(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_off_hours_sales_v1(text, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_off_hours_sales_v1(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_off_hours_sales_v1(text, text) IS
  'ADR-006 dec. 9 business hours: payments taken outside the configured '
  'opening window of their local weekday (null day = closed, absent day = '
  'unconfigured, never flagged). Gate: reports.audit.read.';
