-- 20260601000021_create_adjust_b2b_balance_v1.sql
-- Session 24 / Phase 1.A.2 / migration 10
--
-- adjust_b2b_balance_v1 : ajustement admin du customers.b2b_current_balance
-- (hors comptabilité — manager assumes the audit responsibility).
--
-- Use cases :
--   - Reconciliation manuelle après migration / drift S14-S23
--   - Correction d'erreur de saisie d'un paiement
--   - Adjustment commercial (geste commercial, dispute)
--
-- Décision (spec §4.1.7) : PAS de JE émis. La trace audit_logs avec reason
-- est suffisante pour la responsabilité comptable. Si un manager décide
-- d'effacer un AR, il doit créer manuellement un JE d'expense de son côté
-- (bad debt write-off — backlog S26+ pour automation).

CREATE OR REPLACE FUNCTION adjust_b2b_balance_v1(
  p_customer_id    UUID,
  p_delta          NUMERIC,
  p_reason         TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid             UUID := auth.uid();
  v_profile_id      UUID;
  v_customer_type   customer_type;
  v_balance_before  NUMERIC(14,2);
  v_balance_after   NUMERIC(14,2);
  v_existing_log_id BIGINT;
  v_existing_meta   JSONB;
  v_audit_id        BIGINT;
BEGIN
  -- 1) Auth + profile + permission
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_uid, 'customers.update') THEN
    RAISE EXCEPTION 'permission_denied: customers.update' USING ERRCODE = 'P0003';
  END IF;

  -- 2) Validate inputs
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'invalid_delta' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  -- 3) Idempotency : on stocke le replay marker dans audit_logs.metadata
  --    (pas de table dédiée — adjust_b2b_balance reste une admin-action rare).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, metadata INTO v_existing_log_id, v_existing_meta
      FROM audit_logs
     WHERE action = 'b2b.balance.adjusted'
       AND metadata ? 'idempotency_key'
       AND metadata->>'idempotency_key' = p_idempotency_key::text
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'customer_id',       (v_existing_meta->>'customer_id')::uuid,
        'balance_before',    (v_existing_meta->>'balance_before')::numeric,
        'balance_after',     (v_existing_meta->>'balance_after')::numeric,
        'delta',             (v_existing_meta->>'delta')::numeric,
        'audit_log_id',      v_existing_log_id,
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  -- 4) Validate customer + lock row
  SELECT customer_type, b2b_current_balance
    INTO v_customer_type, v_balance_before
    FROM customers
   WHERE id = p_customer_id AND deleted_at IS NULL
   FOR UPDATE;

  IF v_customer_type IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_type <> 'b2b' THEN
    RAISE EXCEPTION 'customer_not_b2b' USING ERRCODE = 'P0001';
  END IF;

  v_balance_before := COALESCE(v_balance_before, 0);
  v_balance_after  := v_balance_before + p_delta;

  -- 5) Underflow guard — la CHECK constraint customers_b2b_current_balance_nonneg
  --    raise déjà 23514, mais on raise un message clair en amont.
  IF v_balance_after < 0 THEN
    RAISE EXCEPTION 'balance_underflow (before: %, delta: %, after: %)',
      v_balance_before, p_delta, v_balance_after
      USING ERRCODE = 'P0011';
  END IF;

  -- 6) Apply update (SECURITY DEFINER postgres bypass REVOKE)
  UPDATE customers
     SET b2b_current_balance = v_balance_after,
         updated_at = now()
   WHERE id = p_customer_id;

  -- 7) Audit log avec idempotency_key dans metadata (pour replay)
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile_id, 'b2b.balance.adjusted', 'customers', p_customer_id,
    jsonb_build_object(
      'customer_id',     p_customer_id,
      'delta',           p_delta,
      'reason',          p_reason,
      'balance_before',  v_balance_before,
      'balance_after',   v_balance_after,
      'idempotency_key', p_idempotency_key,
      'rpc_version',     'v1'
    )
  ) RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'customer_id',       p_customer_id,
    'balance_before',    v_balance_before,
    'balance_after',     v_balance_after,
    'delta',             p_delta,
    'audit_log_id',      v_audit_id,
    'idempotent_replay', FALSE
  );
END $func$;

REVOKE EXECUTE ON FUNCTION adjust_b2b_balance_v1(UUID, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION adjust_b2b_balance_v1(UUID, NUMERIC, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION adjust_b2b_balance_v1(UUID, NUMERIC, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION adjust_b2b_balance_v1(UUID, NUMERIC, TEXT, UUID) IS
  'S24 — Ajustement admin du customers.b2b_current_balance avec reason '
  'obligatoire (>= 3 chars). PAS de JE émis (decision spec §4.1.7) — la trace '
  'audit_logs est suffisante. Idempotent via p_idempotency_key (stocké dans '
  'audit_logs.metadata). Errors : P0001 not_authenticated/invalid_delta/'
  'reason_required/customer_not_b2b, P0002 customer_not_found, P0003 '
  'permission_denied, P0011 balance_underflow.';
