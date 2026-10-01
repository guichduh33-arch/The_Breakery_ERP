-- Le rejeu cuisine est atomique et ne dispose d'aucun droit de vente.
CREATE FUNCTION public.replay_kds_offline_status_v1(
  p_client_uuid uuid, p_client_line_id text, p_status text,
  p_idempotency_key uuid, p_actor_id uuid, p_observed_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_snapshot jsonb;
  v_order public.orders%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_previous public.audit_logs%ROWTYPE;
  v_rank integer;
  v_target integer;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_actor FROM public.user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
  IF v_actor IS NULL OR p_actor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'offline_actor_mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR p_client_uuid IS NULL OR
     COALESCE(p_client_line_id, '') = '' OR p_status NOT IN ('preparing', 'ready', 'served') OR p_status IS NULL THEN
    RAISE EXCEPTION 'invalid_offline_kitchen_intent' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kds-offline:' || p_idempotency_key::text, 0));
  SELECT * INTO v_previous FROM public.audit_logs
    WHERE action = 'kds.offline_replayed' AND metadata->>'idempotency_key' = p_idempotency_key::text LIMIT 1;
  IF FOUND THEN
    IF v_previous.actor_id IS DISTINCT FROM v_actor OR
       v_previous.metadata->>'root_id' IS DISTINCT FROM p_client_uuid::text OR
       v_previous.metadata->>'client_line_id' IS DISTINCT FROM p_client_line_id OR
       v_previous.metadata->>'target' IS DISTINCT FROM p_status THEN
      RAISE EXCEPTION 'offline_idempotency_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_previous.payload;
  END IF;
  v_snapshot := public.resolve_kds_offline_order_v1(p_client_uuid);
  IF v_snapshot IS NULL THEN RETURN jsonb_build_object('outcome', 'waiting'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = (v_snapshot->>'order_id')::uuid FOR UPDATE;
  SELECT * INTO v_item FROM public.order_items
    WHERE order_id = v_order.id AND client_line_id = p_client_line_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'unresolved'); END IF;
  IF v_item.is_cancelled OR v_order.status::text IN ('voided', 'cancelled', 'refunded') THEN
    v_result := jsonb_build_object('outcome', 'cancelled', 'item_id', v_item.id);
  ELSE
    v_rank := CASE v_item.kitchen_status WHEN 'pending' THEN 0 WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'served' THEN 3 ELSE -1 END;
    v_target := CASE p_status WHEN 'preparing' THEN 1 WHEN 'ready' THEN 2 WHEN 'served' THEN 3 END;
    IF v_rank < 0 THEN RAISE EXCEPTION 'unknown_kitchen_status' USING ERRCODE = 'P0011'; END IF;
    IF v_rank < v_target THEN
      UPDATE public.order_items SET kitchen_status = p_status,
        prep_started_at = COALESCE(prep_started_at, now()),
        ready_at = CASE WHEN v_target >= 2 THEN COALESCE(ready_at, now()) ELSE ready_at END,
        bumped_at = CASE WHEN v_target >= 2 THEN COALESCE(bumped_at, now()) ELSE bumped_at END,
        served_at = CASE WHEN v_target = 3 THEN COALESCE(served_at, now()) ELSE served_at END,
        served_by = CASE WHEN v_target = 3 THEN v_actor ELSE served_by END
      WHERE id = v_item.id;
    END IF;
    v_result := jsonb_build_object('outcome', 'applied', 'item_id', v_item.id);
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (v_actor, 'kds.offline_replayed', 'order_item', v_item.id,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'root_id', p_client_uuid,
      'client_line_id', p_client_line_id, 'target', p_status, 'observed_at', p_observed_at), v_result);
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.replay_kds_offline_status_v1(uuid,text,text,uuid,uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replay_kds_offline_status_v1(uuid,text,text,uuid,uuid,timestamptz) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.replay_kds_offline_status_v1(uuid,text,text,uuid,uuid,timestamptz) IS 'Progression cuisine hors ligne, acteur authentifié identique, identité canonique et idempotence atomiques.';
