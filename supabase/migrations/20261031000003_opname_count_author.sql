CREATE OR REPLACE FUNCTION public.set_opname_count_v3(p_count_item_id uuid, p_counted_qty numeric, p_notes text DEFAULT NULL::text)
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
        counted_by = v_profile,
        notes       = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(btrim(p_notes), '') END,
        updated_at  = now()
    WHERE id = p_count_item_id;

  RETURN jsonb_build_object(
    'item_id',     p_count_item_id,
    'count_id',    v_count_id,
    'counted_qty', p_counted_qty
  );
END $function$;

DROP FUNCTION public.set_opname_count_v2(uuid,numeric,text);
REVOKE ALL ON FUNCTION public.set_opname_count_v3(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_opname_count_v3(uuid,numeric,text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

