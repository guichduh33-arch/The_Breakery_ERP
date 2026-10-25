-- Reprise fidélité : résultat immuable lié à la clé, à l'acteur et au payload.
CREATE TABLE public.loyalty_operation_results (
  idempotency_key uuid PRIMARY KEY,
  operation text NOT NULL CHECK (operation IN ('loyalty_conversion', 'loyalty_adjustment')),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.loyalty_operation_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loyalty_operation_results FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Helper privé : aucun nouvel accès Data API, aucune réécriture historique.
CREATE FUNCTION public._read_loyalty_operation_v1(
  p_operation text, p_key uuid, p_actor uuid, p_customer uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_attempt public.loyalty_operation_results%ROWTYPE;
  v_legacy public.customer_store_credit_ledger%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.loyalty_operation_results WHERE idempotency_key = p_key;
  IF FOUND THEN
    IF v_attempt.operation IS DISTINCT FROM p_operation
      OR v_attempt.actor_id IS DISTINCT FROM p_actor
      OR v_attempt.customer_id IS DISTINCT FROM p_customer
      OR v_attempt.payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0012';
    END IF;
    RETURN v_attempt.result || jsonb_build_object('idempotent_replay', true);
  END IF;

  -- Compatibilité des conversions déjà émises : prouver la provenance avant replay.
  SELECT * INTO v_legacy FROM public.customer_store_credit_ledger WHERE idempotency_key = p_key;
  IF FOUND THEN
    IF p_operation <> 'loyalty_conversion'
      OR v_legacy.customer_id IS DISTINCT FROM p_customer
      OR v_legacy.created_by IS DISTINCT FROM p_actor
      OR v_legacy.source IS DISTINCT FROM 'loyalty_conversion'
      OR v_legacy.reference_type IS DISTINCT FROM 'loyalty_transactions'
      OR v_legacy.delta IS DISTINCT FROM (p_payload->>'points')::numeric * 10
      OR NOT EXISTS (
        SELECT 1 FROM public.loyalty_transactions lt
        WHERE lt.id = v_legacy.reference_id AND lt.customer_id = p_customer
          AND lt.created_by = p_actor AND lt.transaction_type = 'redeem'
          AND lt.points = -(p_payload->>'points')::integer
      ) THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = 'P0012';
    END IF;
    RETURN jsonb_build_object(
      'ledger_id', v_legacy.id, 'customer_id', p_customer,
      'points_converted', (p_payload->>'points')::integer,
      'amount', v_legacy.delta, 'balance_after', v_legacy.balance_after,
      'expires_at', v_legacy.expires_at, 'actor_id', p_actor,
      'idempotency_key', p_key, 'idempotent_replay', true);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._read_loyalty_operation_v1(text,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.convert_loyalty_to_store_credit_v2(p_customer_id uuid, p_points integer, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid             uuid;
  v_profile_id      uuid;
  v_loyalty_balance integer;
  v_amount          numeric(14,2);
  v_months          integer;
  v_expires         timestamptz;
  v_payload jsonb;
  v_result jsonb;
  v_lt_id           uuid;
  v_ledger_id       uuid;
  v_balance_after   numeric;
  v_loyalty_liab_id uuid;
  v_sc_liability_id uuid;
  v_entry_no        text;
  v_je_id           uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile_id FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'No user profile for caller' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'customers.store_credit.convert') THEN
    RAISE EXCEPTION 'Permission denied: customers.store_credit.convert required'
      USING ERRCODE = 'P0003';
  END IF;

  IF p_points IS NULL OR p_points <= 0 OR p_points % 100 <> 0 THEN
    RAISE EXCEPTION 'Points to convert must be a positive multiple of 100'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '23514';
  END IF;
  v_payload := jsonb_build_object('points', p_points);
  PERFORM pg_advisory_xact_lock(hashtextextended('loyalty-operation:' || p_idempotency_key::text, 0));
  v_result := _read_loyalty_operation_v1('loyalty_conversion', p_idempotency_key, v_profile_id, p_customer_id, v_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;

  -- Le sous-bloc couvre tous les débits, ledgers, JE et résultat de la tentative.
  BEGIN
  PERFORM check_fiscal_period_open(now()::date);

  -- Lock-then-check.
  SELECT loyalty_points INTO v_loyalty_balance
    FROM customers WHERE id = p_customer_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id USING ERRCODE = 'P0002';
  END IF;
  IF v_loyalty_balance < p_points THEN
    RAISE EXCEPTION 'Insufficient loyalty points (balance: %)', v_loyalty_balance
      USING ERRCODE = 'P0010';
  END IF;

  -- REDEMPTION_RATE : même constante que complete_order (x10, cf. domain constants.ts).
  v_amount := p_points::numeric * 10;

  SELECT store_credit_expiry_months INTO v_months FROM business_config WHERE id = 1;
  IF COALESCE(v_months, 0) > 0 THEN
    v_expires := now() + make_interval(months => v_months);
  END IF;

  UPDATE customers
     SET loyalty_points = loyalty_points - p_points,
         updated_at     = now()
   WHERE id = p_customer_id;

  INSERT INTO loyalty_transactions (
    customer_id, transaction_type, points, points_balance_after, description, created_by
  ) VALUES (
    p_customer_id, 'redeem', -p_points, v_loyalty_balance - p_points,
    'Converted to store credit', v_profile_id
  ) RETURNING id INTO v_lt_id;

  SELECT a.ledger_id, a.balance_after INTO v_ledger_id, v_balance_after
    FROM _apply_store_credit_v1(p_customer_id, v_amount, 'loyalty_conversion',
           'loyalty_transactions', v_lt_id, v_expires,
           v_profile_id, p_idempotency_key) a;

  -- JE D6 : transfert entre deux dettes clients — DR 2210 / CR 2220.
  v_loyalty_liab_id := resolve_mapping_account('LOYALTY_LIABILITY');
  v_sc_liability_id := resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT');
  v_entry_no        := next_journal_entry_number(now()::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, now()::date,
    'Loyalty to store credit conversion (' || p_points || ' pts)',
    'store_credit_conversion', v_ledger_id,
    'posted', v_amount, v_amount, v_profile_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_loyalty_liab_id, v_amount, 0,        'Loyalty conversion -- DR liability 2210'),
    (v_je_id, v_sc_liability_id, 0,        v_amount, 'Loyalty conversion -- CR liability 2220');

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'customer.loyalty_converted_to_store_credit', 'customers', p_customer_id,
          jsonb_build_object(
            'points', p_points, 'amount', v_amount,
            'loyalty_transaction_id', v_lt_id, 'ledger_id', v_ledger_id,
            'balance_after', v_balance_after, 'expires_at', v_expires,
            'journal_entry_id', v_je_id, 'rpc_version', 'v2'));

  v_result := jsonb_build_object(
    'ledger_id', v_ledger_id, 'customer_id', p_customer_id,
    'points_converted', p_points, 'amount', v_amount,
    'balance_after', v_balance_after, 'expires_at', v_expires,
    'actor_id', v_profile_id, 'idempotency_key', p_idempotency_key,
    'idempotent_replay', false);
  INSERT INTO public.loyalty_operation_results(idempotency_key, operation, actor_id, customer_id, payload, result)
    VALUES (p_idempotency_key, 'loyalty_conversion', v_profile_id, p_customer_id, v_payload, v_result);
  RETURN v_result;
  EXCEPTION WHEN unique_violation THEN
    v_result := _read_loyalty_operation_v1('loyalty_conversion', p_idempotency_key, v_profile_id, p_customer_id, v_payload);
    IF v_result IS NOT NULL THEN RETURN v_result; END IF;
    RAISE;
  END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_loyalty_points_v3(p_customer_id uuid, p_delta integer, p_reason text, p_idempotency_key uuid)
 RETURNS jsonb
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
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (
    v_profile_id, 'loyalty.adjust', 'customers', p_customer_id,
    jsonb_build_object('reason', v_trimmed_reason, 'loyalty_txn_id', v_txn_id),
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
END $function$
;

DROP FUNCTION public.convert_loyalty_to_store_credit_v1(uuid,integer,uuid);
DROP FUNCTION public.adjust_loyalty_points_v2(uuid,integer,text);
REVOKE ALL ON FUNCTION public.convert_loyalty_to_store_credit_v2(uuid,integer,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adjust_loyalty_points_v3(uuid,integer,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_loyalty_to_store_credit_v2(uuid,integer,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty_points_v3(uuid,integer,text,uuid) TO authenticated, service_role;
