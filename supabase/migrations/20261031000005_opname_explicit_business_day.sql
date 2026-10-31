CREATE OR REPLACE FUNCTION public.create_opname_v3(p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_business_day date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      UUID;
  v_count_id     UUID;
  v_count_number TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.opname.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_business_day IS NULL OR p_business_day>current_date THEN
    RAISE EXCEPTION 'invalid_business_day' USING ERRCODE='22023';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('opname-create:'||p_idempotency_key::text,0));
    SELECT id, count_number INTO v_count_id, v_count_number
      FROM inventory_counts WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF EXISTS(SELECT 1 FROM inventory_counts WHERE id=v_count_id AND business_day IS DISTINCT FROM p_business_day) THEN
        RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023';
      END IF;
      RETURN jsonb_build_object(
        'count_id',          v_count_id,
        'count_number',      v_count_number,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  v_count_number := next_count_number();

  INSERT INTO inventory_counts (
    count_number, section_id, status, created_by, notes, idempotency_key, business_day
  ) VALUES (
    v_count_number, NULL, 'draft', v_profile, p_notes, p_idempotency_key, p_business_day
  ) RETURNING id INTO v_count_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'opname.create', 'inventory_counts', v_count_id,
    jsonb_build_object(
      'count_number',    v_count_number,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'count_id',          v_count_id,
    'count_number',      v_count_number,
    'status',            'draft',
    'idempotent_replay', false
  );
END $function$
;
DROP FUNCTION public.create_opname_v2(text,uuid);
REVOKE ALL ON FUNCTION public.create_opname_v3(text,uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_opname_v3(text,uuid,date) TO authenticated;

