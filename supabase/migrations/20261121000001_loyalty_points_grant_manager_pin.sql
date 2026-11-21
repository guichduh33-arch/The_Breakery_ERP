-- Décision de Mamat (2026-11-21) : AJOUTER des points de fidélité exige un PIN
-- manager, comme le grant d'avoir (points + conversion en avoir = avoir sans PIN).
-- Retirer des points (delta < 0) ne change pas.
--
-- Même vehicule que grant_store_credit_v1 : l'EF verify-manager-pin (header
-- x-manager-pin, mint_scope 'loyalty_points_grant', permission loyalty.adjust)
-- mint un nonce discount_authorizations à usage unique (TTL 60 s), consommé ici
-- par UPDATE atomique. Le rejeu idempotent est lu AVANT la consommation : un
-- replay ne reconsomme jamais de nonce et renvoie le résultat de la 1re exécution.
-- La consommation vit dans le sous-bloc : une erreur ultérieure ou un
-- unique_violation annule aussi la consommation du nonce.

-- ── 1. Nouveau scope de nonce ───────────────────────────────────────────────

ALTER TABLE public.discount_authorizations
  DROP CONSTRAINT discount_authorizations_scope_check;
ALTER TABLE public.discount_authorizations
  ADD CONSTRAINT discount_authorizations_scope_check
  CHECK (scope IN ('discount', 'order_item_edit', 'store_credit_grant', 'loyalty_points_grant'));

-- ── 2. adjust_loyalty_points_v4 (corps live de v3 + nonce si delta > 0) ─────

CREATE FUNCTION public.adjust_loyalty_points_v4(
  p_customer_id      uuid,
  p_delta            integer,
  p_reason           text,
  p_idempotency_key  uuid,
  p_authorization_id uuid DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile_id       UUID;
  v_current_balance  INT;
  v_current_lifetime INT;
  v_new_balance      INT;
  v_new_lifetime     INT;
  v_txn_id           UUID;
  v_trimmed_reason   TEXT;
  v_payload jsonb;
  v_result jsonb;
  v_manager_profile_id uuid;
  v_manager_uid        uuid;
  v_audit_meta         jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT has_permission(v_uid, 'loyalty.adjust') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_customer_id IS NULL OR p_delta IS NULL OR p_delta = 0 OR p_reason IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF p_delta NOT BETWEEN -1000000 AND 1000000 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  v_trimmed_reason := trim(p_reason);
  IF length(v_trimmed_reason) < 5 OR length(v_trimmed_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '23514';
  END IF;
  v_payload := jsonb_build_object('delta', p_delta, 'reason', v_trimmed_reason);
  PERFORM pg_advisory_xact_lock(hashtextextended('loyalty-operation:' || p_idempotency_key::text, 0));
  v_result := _read_loyalty_operation_v1('loyalty_adjustment', p_idempotency_key, v_profile_id, p_customer_id, v_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;

  BEGIN
  -- Décision 2026-11-21 : un crédit de points exige le nonce PIN manager
  -- (single-use, TTL 60 s). Un débit ignore p_authorization_id.
  IF p_delta > 0 THEN
    UPDATE discount_authorizations
       SET consumed_at = now()
     WHERE id = p_authorization_id
       AND consumed_at IS NULL
       AND expires_at  > now()
       AND scope       = 'loyalty_points_grant'
    RETURNING manager_profile_id INTO v_manager_profile_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid or expired manager authorization for loyalty points grant'
        USING ERRCODE = 'P0003';
    END IF;

    -- Defense-in-depth : l'autorisateur porte bien la permission.
    SELECT auth_user_id INTO v_manager_uid FROM user_profiles
     WHERE id = v_manager_profile_id AND deleted_at IS NULL;
    IF v_manager_uid IS NULL OR NOT has_permission(v_manager_uid, 'loyalty.adjust') THEN
      RAISE EXCEPTION 'Authorizing manager lacks loyalty.adjust'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  SELECT loyalty_points, lifetime_points
    INTO v_current_balance, v_current_lifetime
    FROM customers
    WHERE id = p_customer_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_deleted';
  END IF;

  v_new_balance  := v_current_balance + p_delta;
  v_new_lifetime := v_current_lifetime + GREATEST(p_delta, 0);
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  INSERT INTO loyalty_transactions (
    customer_id, order_id, transaction_type, points,
    points_balance_after, description, created_by
  ) VALUES (
    p_customer_id, NULL, 'adjust', p_delta,
    v_new_balance, v_trimmed_reason, v_profile_id
  ) RETURNING id INTO v_txn_id;

  UPDATE customers
     SET loyalty_points  = v_new_balance,
         lifetime_points = v_new_lifetime
   WHERE id = p_customer_id;

  -- ADR-020 déc. 6 — les points se convertissent en avoir monétaire : le geste
  -- laisse une trace d'audit, pas seulement une ligne de ledger.
  v_audit_meta := jsonb_build_object('reason', v_trimmed_reason, 'loyalty_txn_id', v_txn_id, 'rpc_version', 'v4');
  IF p_delta > 0 THEN
    v_audit_meta := v_audit_meta || jsonb_build_object(
      'manager_profile_id', v_manager_profile_id,
      'authorization_id',   p_authorization_id);
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (
    v_profile_id, 'loyalty.adjust', 'customers', p_customer_id,
    v_audit_meta,
    jsonb_build_object(
      'delta',           p_delta,
      'balance_before',  v_current_balance,
      'balance_after',   v_new_balance,
      'lifetime_before', v_current_lifetime,
      'lifetime_after',  v_new_lifetime
    )
  );

  v_result := jsonb_build_object(
    'txn_id', v_txn_id, 'new_balance', v_new_balance, 'new_lifetime', v_new_lifetime,
    'customer_id', p_customer_id, 'delta', p_delta, 'reason', v_trimmed_reason,
    'actor_id', v_profile_id, 'idempotency_key', p_idempotency_key, 'idempotent_replay', false);
  INSERT INTO public.loyalty_operation_results(idempotency_key, operation, actor_id, customer_id, payload, result)
    VALUES (p_idempotency_key, 'loyalty_adjustment', v_profile_id, p_customer_id, v_payload, v_result);
  RETURN v_result;
  EXCEPTION WHEN unique_violation THEN
    v_result := _read_loyalty_operation_v1('loyalty_adjustment', p_idempotency_key, v_profile_id, p_customer_id, v_payload);
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
    RAISE;
  END;
END $function$;

-- ── 3. Retrait de v3 (même migration) + grants ──────────────────────────────

DROP FUNCTION public.adjust_loyalty_points_v3(uuid, integer, text, uuid);

REVOKE EXECUTE ON FUNCTION public.adjust_loyalty_points_v4(uuid, integer, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_loyalty_points_v4(uuid, integer, text, uuid, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty_points_v4(uuid, integer, text, uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.adjust_loyalty_points_v4(uuid, integer, text, uuid, uuid) IS
  'Ajustement manuel de points fidélité. Gate loyalty.adjust ; un delta positif '
  'exige un nonce PIN manager (scope loyalty_points_grant, minté par l''EF '
  'verify-manager-pin, p_authorization_id), un delta négatif l''ignore. '
  'Idempotent via loyalty_operation_results.';
