-- Corrections de revue : jours métier, support des soldes et journée durable des replays.
-- Corps de lecture et de masquage issus des définitions live DEV, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_stock_movements_v5(p_start text, p_end text, p_product_id uuid DEFAULT NULL::uuid, p_movement_type text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_start     TIMESTAMPTZ := p_start::date::timestamptz;
  v_end       TIMESTAMPTZ := (p_end::date + 1)::timestamptz;
  v_clamp     INT := LEAST(GREATEST(p_limit, 1), 200);
  v_cursor_ts TIMESTAMPTZ := NULL;
  v_cursor_id UUID := NULL;
  v_lines     JSONB;
  v_last_cur  TEXT;
  v_has_next  BOOLEAN;
  v_next      TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v1(COALESCE(NULLIF(p_start::text,''),current_date::text)::date,COALESCE(NULLIF(p_end::text,''),current_date::text)::date);

  IF NOT has_permission(v_caller_id, 'reports.inventory.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.inventory.read' USING ERRCODE = '42501';
  END IF;

  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
  END IF;

  WITH filtered AS (
    SELECT
      sm.id, sm.product_id, p.name AS product_name,
      sm.movement_type::text AS movement_type,
      sm.quantity, sm.unit_cost, sm.lot_id,
      sm.reference_type, sm.reference_id, sm.created_by, sm.created_at,
      ROW_NUMBER() OVER (ORDER BY sm.created_at DESC, sm.id DESC) AS rn
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.created_at >= v_start AND sm.created_at < v_end
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (v_cursor_ts     IS NULL OR (sm.created_at, sm.id) < (v_cursor_ts, v_cursor_id))
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT v_clamp + 1
  )
  SELECT
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id',              f.id,
        'product_id',      f.product_id,
        'product_name',    f.product_name,
        'movement_type',   f.movement_type,
        'quantity',        f.quantity,
        'unit_cost',       f.unit_cost,
        'value',           ABS(f.quantity) * COALESCE(f.unit_cost, 0),
        'lot_id',          f.lot_id,
        'reference_type',  f.reference_type,
        'reference_id',    f.reference_id,
        'created_by_name', up.full_name,
        'created_at',      f.created_at
      ) ORDER BY f.created_at DESC, f.id DESC)
      FILTER (WHERE f.rn <= v_clamp),
      '[]'::jsonb
    ),
    MAX(CASE WHEN f.rn = v_clamp
             THEN f.created_at::text || '|' || f.id::text END),
    bool_or(f.rn = v_clamp + 1)
  INTO v_lines, v_last_cur, v_has_next
  FROM filtered f
  LEFT JOIN user_profiles up ON up.id = f.created_by;

  v_next := CASE WHEN COALESCE(v_has_next, FALSE) THEN v_last_cur ELSE NULL END;

  RETURN jsonb_build_object('lines', v_lines, 'next_cursor', v_next);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_stock_movement_ledger_v3(p_start text, p_end text, p_product_id uuid DEFAULT NULL::uuid, p_movement_type text DEFAULT NULL::text, p_section_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID        := auth.uid();
  v_tz        TEXT        := current_setting('TimeZone');
  v_start     TIMESTAMPTZ := (p_start::date)::timestamp           AT TIME ZONE v_tz;
  v_end_excl  TIMESTAMPTZ := ((p_end::date + 1))::timestamp       AT TIME ZONE v_tz;
  v_limit     INT         := LEAST(GREATEST(p_limit, 1), 10000);
  v_lines     JSONB;
  v_count     INT;
  v_total     INT;
  v_activation date;
  v_opening_visible boolean;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v1(COALESCE(NULLIF(p_start::text,''),current_date::text)::date,COALESCE(NULLIF(p_end::text,''),current_date::text)::date);

  IF NOT (has_permission(v_caller_id, 'inventory.read')
          OR has_permission(v_caller_id, 'reports.inventory.read')) THEN
    RAISE EXCEPTION 'Permission denied: inventory.read' USING ERRCODE = '42501';
  END IF;

  SELECT activated_on INTO v_activation FROM business_day_visibility_config WHERE id;
  v_opening_visible := is_business_owner_v1() OR p_start::date <= v_activation OR
    (SELECT count(*) FROM business_day_releases WHERE day >= v_activation AND day < p_start::date)
      = p_start::date - v_activation;

  WITH opening AS (
    SELECT sm.product_id, SUM(sm.quantity) AS opening_qty
    FROM stock_movements sm
    WHERE sm.created_at < v_start
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_section_id    IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    GROUP BY sm.product_id
  ),
  in_range AS (
    SELECT
      sm.id,
      sm.product_id,
      p.name                    AS product_name,
      c.name                    AS product_group,
      sm.movement_type::text    AS movement_type,
      sm.quantity,
      sm.unit,
      COALESCE(p.cost_price, 0) AS price,
      sm.reference_type,
      sm.reference_id,
      sm.reason,
      ord.order_number          AS reference_label,
      sm.created_at,
      sm.created_by,
      COALESCE(o.opening_qty, 0)
        + SUM(sm.quantity) OVER (
            PARTITION BY sm.product_id
            ORDER BY sm.created_at, sm.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS balance_qty
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN orders ord ON sm.reference_type = 'orders' AND ord.id = sm.reference_id
    LEFT JOIN opening o ON o.product_id = sm.product_id
    WHERE sm.created_at >= v_start
      AND sm.created_at <  v_end_excl
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_section_id    IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    ORDER BY p.name, sm.created_at, sm.id
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT ir.*, ROW_NUMBER() OVER (ORDER BY ir.product_name, ir.created_at, ir.id) AS rn
    FROM in_range ir
  )
  SELECT
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id',              n.id,
        'movement_date',   (n.created_at AT TIME ZONE v_tz)::date,
        'created_time',    n.created_at,
        'movement_type',   n.movement_type,
        'product_id',      n.product_id,
        'product_name',    n.product_name,
        'product_group',   n.product_group,
        'unit',            n.unit,
        'incoming_qty',    GREATEST(n.quantity, 0),
        'outgoing_qty',    GREATEST(-n.quantity, 0),
        'beginning_qty',   CASE WHEN v_opening_visible THEN n.balance_qty - n.quantity ELSE NULL END,
        'balance_qty',     CASE WHEN v_opening_visible THEN n.balance_qty ELSE NULL END,
        'price',           n.price,
        'movement_amount', n.quantity * n.price,
        'reference_type',  n.reference_type,
        'reference_id',    n.reference_id,
        'reason',          n.reason,
        'reference_label', n.reference_label,
        'created_by_name', up.full_name
      ) ORDER BY n.product_name, n.created_at, n.id)
      FILTER (WHERE n.rn <= v_limit),
      '[]'::jsonb
    ),
    COUNT(*) FILTER (WHERE n.rn <= v_limit)::int,
    COUNT(*)::int
  INTO v_lines, v_count, v_total
  FROM numbered n
  LEFT JOIN user_profiles up ON up.id = n.created_by;

  RETURN jsonb_build_object(
    'lines',     v_lines,
    'truncated', v_total > v_limit,
    'row_count', v_count
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION stock_private.mask_stock_payload_for_day_v1(p_value jsonb, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_result jsonb; v_key text; v_value jsonb;
BEGIN
 IF public.can_view_business_day_v1(current_date) AND public.can_view_business_day_v1(p_day) THEN RETURN p_value; END IF;
 IF jsonb_typeof(p_value)='object' THEN
   v_result:='{}';
   FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_value) LOOP
     IF v_key IN ('current_stock','new_current_stock','new_bo_stock','new_display_stock',
       'available_after','material_stock','stock_before','stock_after','shortages') THEN
       v_result:=v_result||jsonb_build_object(v_key,NULL);
     ELSE v_result:=v_result||jsonb_build_object(v_key,stock_private.mask_stock_payload_for_day_v1(v_value,p_day)); END IF;
   END LOOP;
   RETURN v_result;
 ELSIF jsonb_typeof(p_value)='array' THEN
   SELECT COALESCE(jsonb_agg(stock_private.mask_stock_payload_for_day_v1(value,p_day) ORDER BY ord),'[]'::jsonb)
   INTO v_result FROM jsonb_array_elements(p_value) WITH ORDINALITY e(value,ord);
   RETURN v_result;
 END IF;
 RETURN p_value;
END $function$
;
CREATE FUNCTION public.record_incoming_stock_v4(p_product_id uuid,p_quantity numeric,p_supplier_id uuid DEFAULT NULL,p_unit_cost numeric DEFAULT NULL,p_reason text DEFAULT NULL,p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
DECLARE v_result jsonb; v_day date;
BEGIN
 v_result:=stock_private.record_incoming_stock_v2(p_product_id,p_quantity,p_supplier_id,p_unit_cost,p_reason,p_idempotency_key);
 IF p_idempotency_key IS NOT NULL THEN
  SELECT created_at::date INTO v_day FROM stock_private.mutation_requests
  WHERE idempotency_key=p_idempotency_key AND actor_uid=auth.uid() AND operation='incoming';
 ELSE v_day:=current_date; END IF;
 RETURN stock_private.mask_stock_payload_for_day_v1(v_result,v_day);
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
 AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;

DROP FUNCTION public.get_stock_movements_v4(text,text,uuid,text,integer,text);
DROP FUNCTION public.get_stock_movement_ledger_v2(text,text,uuid,text,uuid,integer);
DROP FUNCTION public.record_incoming_stock_v3(uuid,numeric,uuid,numeric,text,uuid);
REVOKE ALL ON FUNCTION stock_private.mask_stock_payload_for_day_v1(jsonb,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_stock_movements_v5(text,text,uuid,text,integer,text),
 public.get_stock_movement_ledger_v3(text,text,uuid,text,uuid,integer),
 public.record_incoming_stock_v4(uuid,numeric,uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stock_movements_v5(text,text,uuid,text,integer,text),
 public.get_stock_movement_ledger_v3(text,text,uuid,text,uuid,integer),
 public.record_incoming_stock_v4(uuid,numeric,uuid,numeric,text,uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
