-- Résolution de l'identité locale sans faire confiance à un identifiant serveur LAN.
CREATE FUNCTION public.resolve_kds_offline_order_v1(p_client_uuid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_orders uuid[];
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE auth_user_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'permission_denied: active profile required' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT order_id) INTO v_orders FROM (
    SELECT order_id FROM public.counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid
    UNION ALL
    SELECT order_id FROM public.tablet_order_idempotency_keys WHERE client_uuid = p_client_uuid
  ) mapped;
  IF COALESCE(cardinality(v_orders), 0) = 0 THEN RETURN NULL; END IF;
  IF cardinality(v_orders) <> 1 THEN
    RAISE EXCEPTION 'ambiguous_offline_order' USING ERRCODE = 'P0011';
  END IF;
  SELECT jsonb_build_object(
    'order_id', o.id, 'order_number', o.order_number, 'order_status', o.status,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'client_line_id', i.client_line_id, 'kitchen_status', i.kitchen_status,
      'is_cancelled', COALESCE(i.is_cancelled, false), 'prep_started_at', i.prep_started_at,
      'ready_at', i.ready_at, 'served_at', i.served_at
    ) ORDER BY i.id) FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb)
  ) INTO v_result FROM public.orders o WHERE o.id = v_orders[1];
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_kds_offline_order_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_kds_offline_order_v1(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.resolve_kds_offline_order_v1(uuid) IS 'Résout une racine hors ligne pour la cuisine autorisée ; aucune mutation ni donnée de paiement.';
