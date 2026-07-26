-- ADR-013 Lot 4 (D6) — alimentation manuelle de l'avoir client :
--   grant_store_credit_v1               (grant manager : nonce PIN + motif)
--   convert_loyalty_to_store_credit_v1  (conversion points -> avoir, BO)
--
-- Le PIN manager du grant transite par l'EF verify-manager-pin (header
-- x-manager-pin, mint_scope 'store_credit_grant') qui mint un nonce
-- discount_authorizations à usage unique (TTL 60 s) — jamais de PIN en arg SQL.
-- Idempotence flavor 2 : clé UNIQUE sur customer_store_credit_ledger
-- (pré-check + wrap unique_violation -> re-read, D12).

-- ── 1. Permissions ──────────────────────────────────────────────────────────

INSERT INTO permissions (code, module, action, description) VALUES
  ('customers.store_credit.grant',   'customers', 'store_credit_grant',
   'Grant manual store credit to a customer (manager PIN nonce + reason, ADR-013 D6)'),
  ('customers.store_credit.convert', 'customers', 'store_credit_convert',
   'Convert customer loyalty points into store credit (ADR-013 D6)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted, granted_at) VALUES
  ('SUPER_ADMIN', 'customers.store_credit.grant',   true, now()),
  ('ADMIN',       'customers.store_credit.grant',   true, now()),
  ('MANAGER',     'customers.store_credit.grant',   true, now()),
  ('SUPER_ADMIN', 'customers.store_credit.convert', true, now()),
  ('ADMIN',       'customers.store_credit.convert', true, now()),
  ('MANAGER',     'customers.store_credit.convert', true, now())
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- ── 2. Nouveau scope de nonce (pattern _191) ────────────────────────────────

ALTER TABLE public.discount_authorizations
  DROP CONSTRAINT discount_authorizations_scope_check;
ALTER TABLE public.discount_authorizations
  ADD CONSTRAINT discount_authorizations_scope_check
  CHECK (scope IN ('discount', 'order_item_edit', 'store_credit_grant'));

-- ── 3. grant_store_credit_v1 ────────────────────────────────────────────────

CREATE FUNCTION public.grant_store_credit_v1(
  p_customer_id      uuid,
  p_amount           numeric,
  p_reason           text,
  p_authorization_id uuid,
  p_idempotency_key  uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid                uuid;
  v_profile_id         uuid;
  v_manager_profile_id uuid;
  v_manager_uid        uuid;
  v_months             integer;
  v_expires            timestamptz;
  v_replay             customer_store_credit_ledger%ROWTYPE;
  v_ledger_id          uuid;
  v_balance_after      numeric;
  v_grant_exp_id       uuid;
  v_sc_liability_id    uuid;
  v_entry_no           text;
  v_je_id              uuid;
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

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Grant amount must be positive' USING ERRCODE = 'check_violation';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 OR length(trim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'Grant reason required (3-500 chars)' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotence D12 : pré-check (chemin rapide).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_replay FROM customer_store_credit_ledger
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ledger_id', v_replay.id, 'customer_id', v_replay.customer_id,
        'amount', v_replay.delta, 'balance_after', v_replay.balance_after,
        'expires_at', v_replay.expires_at, 'idempotent_replay', true);
    END IF;
  END IF;

  -- D6 : consommation atomique du nonce PIN manager (single-use, TTL 60 s).
  UPDATE discount_authorizations
     SET consumed_at = now()
   WHERE id = p_authorization_id
     AND consumed_at IS NULL
     AND expires_at  > now()
     AND scope       = 'store_credit_grant'
  RETURNING manager_profile_id INTO v_manager_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired manager authorization for store credit grant'
      USING ERRCODE = 'P0003';
  END IF;

  -- Defense-in-depth : l'autorisateur porte bien la permission.
  SELECT auth_user_id INTO v_manager_uid FROM user_profiles
   WHERE id = v_manager_profile_id AND deleted_at IS NULL;
  IF v_manager_uid IS NULL OR NOT has_permission(v_manager_uid, 'customers.store_credit.grant') THEN
    RAISE EXCEPTION 'Authorizing manager lacks customers.store_credit.grant'
      USING ERRCODE = 'P0003';
  END IF;

  PERFORM check_fiscal_period_open(now()::date);

  -- Lock-then-check (patron create_b2b_order_v5).
  PERFORM 1 FROM customers WHERE id = p_customer_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  SELECT store_credit_expiry_months INTO v_months FROM business_config WHERE id = 1;
  IF COALESCE(v_months, 0) > 0 THEN
    v_expires := now() + make_interval(months => v_months);
  END IF;

  BEGIN
    SELECT a.ledger_id, a.balance_after INTO v_ledger_id, v_balance_after
      FROM _apply_store_credit_v1(p_customer_id, p_amount, 'manager_grant',
             'discount_authorizations', p_authorization_id, v_expires,
             v_profile_id, p_idempotency_key) a;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_replay FROM customer_store_credit_ledger
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ledger_id', v_replay.id, 'customer_id', v_replay.customer_id,
        'amount', v_replay.delta, 'balance_after', v_replay.balance_after,
        'expires_at', v_replay.expires_at, 'idempotent_replay', true);
    END IF;
    RAISE;
  END;

  -- JE D6 : DR charge commerciale / CR 2220 (émission de dette d'avoir).
  v_grant_exp_id    := resolve_mapping_account('STORE_CREDIT_GRANT_EXPENSE');
  v_sc_liability_id := resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT');
  v_entry_no        := next_journal_entry_number(now()::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, now()::date,
    'Store credit grant (' || trim(p_reason) || ')', 'store_credit_grant', v_ledger_id,
    'posted', p_amount, p_amount, v_profile_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_grant_exp_id,    p_amount, 0,        'Store credit grant -- DR expense'),
    (v_je_id, v_sc_liability_id, 0,        p_amount, 'Store credit grant -- CR liability 2220');

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'customer.store_credit_granted', 'customers', p_customer_id,
          jsonb_build_object(
            'amount', p_amount, 'reason', trim(p_reason),
            'manager_profile_id', v_manager_profile_id,
            'authorization_id', p_authorization_id,
            'ledger_id', v_ledger_id, 'balance_after', v_balance_after,
            'expires_at', v_expires, 'journal_entry_id', v_je_id,
            'rpc_version', 'v1'));

  RETURN jsonb_build_object(
    'ledger_id', v_ledger_id, 'customer_id', p_customer_id,
    'amount', p_amount, 'balance_after', v_balance_after,
    'expires_at', v_expires, 'idempotent_replay', false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_store_credit_v1(uuid, numeric, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_store_credit_v1(uuid, numeric, text, uuid, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_store_credit_v1(uuid, numeric, text, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.grant_store_credit_v1(uuid, numeric, text, uuid, uuid) IS
  'ADR-013 Lot 4 (D6) : grant manuel d''avoir client. Nonce PIN manager '
  '(scope store_credit_grant, minté par l''EF verify-manager-pin), motif '
  'obligatoire, JE DR 6117 / CR 2220, ledger + cache via _apply_store_credit_v1.';

-- ── 4. convert_loyalty_to_store_credit_v1 ───────────────────────────────────

CREATE FUNCTION public.convert_loyalty_to_store_credit_v1(
  p_customer_id     uuid,
  p_points          integer,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
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
  v_replay          customer_store_credit_ledger%ROWTYPE;
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

  -- Idempotence D12 : pré-check.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_replay FROM customer_store_credit_ledger
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ledger_id', v_replay.id, 'customer_id', v_replay.customer_id,
        'points_converted', (v_replay.delta / 10)::integer,
        'amount', v_replay.delta, 'balance_after', v_replay.balance_after,
        'expires_at', v_replay.expires_at, 'idempotent_replay', true);
    END IF;
  END IF;

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
  v_amount := p_points * 10;

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

  BEGIN
    SELECT a.ledger_id, a.balance_after INTO v_ledger_id, v_balance_after
      FROM _apply_store_credit_v1(p_customer_id, v_amount, 'loyalty_conversion',
             'loyalty_transactions', v_lt_id, v_expires,
             v_profile_id, p_idempotency_key) a;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_replay FROM customer_store_credit_ledger
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ledger_id', v_replay.id, 'customer_id', v_replay.customer_id,
        'points_converted', (v_replay.delta / 10)::integer,
        'amount', v_replay.delta, 'balance_after', v_replay.balance_after,
        'expires_at', v_replay.expires_at, 'idempotent_replay', true);
    END IF;
    RAISE;
  END;

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
            'journal_entry_id', v_je_id, 'rpc_version', 'v1'));

  RETURN jsonb_build_object(
    'ledger_id', v_ledger_id, 'customer_id', p_customer_id,
    'points_converted', p_points, 'amount', v_amount,
    'balance_after', v_balance_after, 'expires_at', v_expires,
    'idempotent_replay', false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.convert_loyalty_to_store_credit_v1(uuid, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.convert_loyalty_to_store_credit_v1(uuid, integer, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_loyalty_to_store_credit_v1(uuid, integer, uuid) TO authenticated;

COMMENT ON FUNCTION public.convert_loyalty_to_store_credit_v1(uuid, integer, uuid) IS
  'ADR-013 Lot 4 (D6) : conversion points fidélité -> avoir client (x10, '
  'multiple de 100). JE DR 2210 / CR 2220, ledger + cache via '
  '_apply_store_credit_v1. Gate customers.store_credit.convert (BO).';
