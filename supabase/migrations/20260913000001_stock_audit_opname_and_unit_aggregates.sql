-- Audit stock : figer le comptage en revue, valider les bornes et isoler les unités.
-- Corps de départ lus sur V3 dev le 2026-09-13 via pg_get_functiondef.

CREATE OR REPLACE FUNCTION public.set_opname_count_v2(p_count_item_id uuid, p_counted_qty numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_count_id UUID;
  v_status  TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.opname.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_counted_qty IS NULL OR p_counted_qty::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_counted_qty < 0 OR p_counted_qty > 9999999.999
     OR p_counted_qty <> round(p_counted_qty, 3) THEN
    RAISE EXCEPTION 'counted_qty_invalid';
  END IF;

  SELECT count_id INTO v_count_id
    FROM inventory_count_items WHERE id = p_count_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'count_item_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT status INTO v_status
    FROM inventory_counts WHERE id = v_count_id FOR UPDATE;

  IF v_status NOT IN ('draft','counting') THEN
    RAISE EXCEPTION 'set_count_not_allowed_in_status';
  END IF;

  UPDATE inventory_count_items
    SET counted_qty = p_counted_qty,
        notes       = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(btrim(p_notes), '') END,
        updated_at  = now()
    WHERE id = p_count_item_id;

  RETURN jsonb_build_object(
    'item_id',     p_count_item_id,
    'count_id',    v_count_id,
    'counted_qty', p_counted_qty
  );
END $function$
;

CREATE OR REPLACE FUNCTION public.validate_opname_v2(p_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_status  TEXT;
  v_missing INT;
  v_total INT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.opname.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT status INTO v_status FROM inventory_counts
    WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'count_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_status NOT IN ('draft','counting') THEN
    RAISE EXCEPTION 'validate_not_allowed_in_status';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE counted_qty IS NULL)
    INTO v_total, v_missing FROM inventory_count_items WHERE count_id = p_count_id;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'empty_count';
  END IF;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'missing_counts' USING DETAIL=format('%s row(s) missing counted_qty', v_missing);
  END IF;

  UPDATE inventory_counts
    SET status = 'review'
    WHERE id = p_count_id;

  RETURN jsonb_build_object(
    'count_id', p_count_id,
    'status',   'review'
  );
END $function$
;

-- p_date_end est désormais une borne exclusive (minuit du lendemain).
CREATE OR REPLACE FUNCTION public.get_movement_aggregates_v3(p_section_id uuid DEFAULT NULL::uuid, p_product_id uuid DEFAULT NULL::uuid, p_date_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_movement_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::JSONB) INTO v_result
  FROM (
    SELECT
      sm.movement_type::TEXT AS movement_type,
      sm.unit AS unit,
      sign(sm.quantity)::integer AS direction,
      COUNT(*)::BIGINT       AS count,
      SUM(ABS(sm.quantity))  AS qty_total,
      SUM(sm.quantity * COALESCE(p.cost_price, 0)) AS value_total
    FROM stock_movements sm
    LEFT JOIN products p ON p.id = sm.product_id
    WHERE (p_section_id IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
      AND (p_product_id IS NULL OR sm.product_id = p_product_id)
      AND (p_date_start IS NULL OR sm.created_at >= p_date_start)
      AND (p_date_end   IS NULL OR sm.created_at < p_date_end)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
    GROUP BY sm.movement_type, sm.unit, sign(sm.quantity)
    ORDER BY sm.movement_type::TEXT, sm.unit, sign(sm.quantity)
  ) t;

  RETURN v_result;
END $function$
;

REVOKE ALL ON FUNCTION public.set_opname_count_v2(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_opname_count_v2(uuid, numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_opname_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_opname_v2(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_movement_aggregates_v3(uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_movement_aggregates_v3(uuid, uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DROP FUNCTION public.set_opname_count_v1(uuid, numeric, text);
DROP FUNCTION public.validate_opname_v1(uuid);
DROP FUNCTION public.get_movement_aggregates_v2(uuid, uuid, timestamptz, timestamptz);
