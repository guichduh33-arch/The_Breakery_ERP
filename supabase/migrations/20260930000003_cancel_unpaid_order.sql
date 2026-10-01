-- Préparation locale : ADR-009/010/013. Corps cancel/close/waste lus live le 2026-09-30.
-- Le flux payé reste séparé. Toutes les lignes, pertes et la clôture partagent une TX.
CREATE TABLE public.unpaid_order_cancel_keys (
  key uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.unpaid_order_cancel_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unpaid_order_cancel_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.unpaid_order_cancel_keys TO service_role;

CREATE FUNCTION public.cancel_unpaid_order_v1(
  p_order_id uuid, p_expected_updated_at timestamptz, p_expected_items jsonb,
  p_losses jsonb, p_reason text, p_authorized_by uuid,
  p_acting_auth_user_id uuid, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_order public.orders%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_existing public.unpaid_order_cancel_keys%ROWTYPE;
  v_snapshot jsonb;
  v_expected jsonb;
  v_loss numeric;
  v_count integer := 0;
  v_result jsonb;
BEGIN
  SELECT id INTO v_actor FROM user_profiles
    WHERE auth_user_id = p_acting_auth_user_id AND deleted_at IS NULL AND is_active;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
  IF NOT has_permission_for_profile(v_actor, 'payments.process') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0003';
  END IF;
  IF p_authorized_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = p_authorized_by AND deleted_at IS NULL AND is_active
  ) OR NOT has_permission_for_profile(p_authorized_by, 'pos.sale.cancel_item') THEN
    RAISE EXCEPTION 'manager_permission_denied' USING ERRCODE = 'P0003';
  END IF;
  IF p_idempotency_key IS NULL OR p_order_id IS NULL OR p_expected_updated_at IS NULL
     OR length(btrim(coalesce(p_reason, ''))) < 3
     OR jsonb_typeof(p_expected_items) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_losses) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  -- Une course sur la clé attend la première transaction ; son résultat est immuable.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM unpaid_order_cancel_keys WHERE key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.order_id <> p_order_id OR v_existing.actor_id <> v_actor THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.result;
  END IF;

  -- Les RPC fire/add/tablet relisent le statut sous verrou parent avant insertion.
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_order.status NOT IN ('draft', 'pending_payment')
     OR v_order.created_via NOT IN ('pos', 'tablet')
     OR EXISTS (SELECT 1 FROM order_payments WHERE order_id = p_order_id)
     OR EXISTS (SELECT 1 FROM refunds WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'unpaid_order_required' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = p_order_id AND is_locked) THEN
    RAISE EXCEPTION 'kitchen_sent_order_required' USING ERRCODE = '23514';
  END IF;
  PERFORM id FROM order_items WHERE order_id = p_order_id ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb)
    INTO v_snapshot FROM order_items i WHERE order_id = p_order_id;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'id')::uuid), '[]'::jsonb)
    INTO v_expected FROM jsonb_array_elements(p_expected_items) x;
  IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at
     OR v_snapshot IS DISTINCT FROM v_expected OR jsonb_array_length(v_snapshot) = 0 THEN
    RAISE EXCEPTION 'order_changed' USING ERRCODE = 'P0014';
  END IF;
  IF EXISTS (SELECT 1 FROM order_items WHERE order_id = p_order_id AND NOT is_cancelled AND kitchen_status = 'served') THEN
    RAISE EXCEPTION 'served_item_cannot_be_cancelled' USING ERRCODE = '23514';
  END IF;
  -- Exactement une déclaration par ligne active, aucun doublon ou UUID étranger.
  IF jsonb_array_length(p_losses) <> (SELECT count(*) FROM order_items WHERE order_id = p_order_id AND NOT is_cancelled)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_losses) x
       LEFT JOIN order_items i ON i.id = (x->>'id')::uuid AND i.order_id = p_order_id AND NOT i.is_cancelled
       WHERE i.id IS NULL OR jsonb_typeof(x->'waste_qty') IS DISTINCT FROM 'number'
     ) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_losses) x) <> jsonb_array_length(p_losses) THEN
    RAISE EXCEPTION 'invalid_losses' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id AND NOT is_cancelled ORDER BY id LOOP
    SELECT (x->>'waste_qty')::numeric INTO v_loss FROM jsonb_array_elements(p_losses) x WHERE (x->>'id')::uuid = v_item.id;
    IF v_loss IS NULL OR v_loss < 0 OR v_loss > v_item.quantity OR (NOT v_item.is_locked AND v_loss <> 0) THEN
      RAISE EXCEPTION 'invalid_waste_qty' USING ERRCODE = '22023';
    END IF;
    -- Le helper existant porte perte recette-aware, annulation et audit par ligne.
    -- La clé globale couvre l'ensemble ; aucune nouvelle clé publiée de ligne.
    PERFORM cancel_order_item_rpc_v6(v_item.id, btrim(p_reason), p_authorized_by,
      p_acting_auth_user_id, NULL, CASE WHEN v_item.is_locked THEN v_loss ELSE NULL END);
    v_count := v_count + 1;
  END LOOP;
  UPDATE orders SET status = 'voided', is_held = false, voided_at = now(),
    voided_by = p_authorized_by, void_reason = btrim(p_reason),
    subtotal = 0, tax_amount = 0, total = 0, updated_at = now()
    WHERE id = p_order_id;
  -- L'extourne du trigger vente exige OLD.status paid/completed : aucun refund ici.
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'order.cancel_unpaid', 'orders', p_order_id,
    jsonb_build_object('authorized_by', p_authorized_by, 'acting_cashier_id', v_actor,
      'reason', btrim(p_reason), 'losses', p_losses, 'idempotency_key', p_idempotency_key));
  v_result := jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number,
    'status', 'voided', 'cancelled_lines', v_count);
  BEGIN
    INSERT INTO unpaid_order_cancel_keys(key, order_id, actor_id, result)
      VALUES (p_idempotency_key, p_order_id, v_actor, v_result);
  EXCEPTION WHEN unique_violation THEN
    -- Défense complémentaire au verrou, contrat de rejeu à enveloppe stable.
    SELECT * INTO v_existing FROM unpaid_order_cancel_keys WHERE key = p_idempotency_key;
    IF v_existing.order_id <> p_order_id OR v_existing.actor_id <> v_actor THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.result;
  END;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.cancel_unpaid_order_v1(uuid,timestamptz,jsonb,jsonb,text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_order_v1(uuid,timestamptz,jsonb,jsonb,text,uuid,uuid,uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
