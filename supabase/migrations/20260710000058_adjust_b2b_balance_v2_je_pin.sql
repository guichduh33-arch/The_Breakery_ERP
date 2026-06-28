-- S50 Vague 2a-i · T2 — adjust_b2b_balance → v2 : JE de contrepartie + PIN manager + perm dédiée
--
-- adjust_b2b_balance_v1 modifiait customers.b2b_current_balance (ledger auxiliaire AR)
-- + audit_logs SANS aucune écriture comptable → désync 1132 (AR-B2B) ↔ grand livre, et
-- gate sur le générique customers.update sans PIN manager.
--
-- v2 : (1) JE de contrepartie sur 1132 ⇄ 6520 (Bad Debt / AR Write-off, créé ici) pour
-- garder le subsidiary ledger en phase avec le GL ; (2) PIN manager vérifié serveur via
-- _verify_pin_with_lockout (mirror create_manual_je_v1) ; (3) permission dédiée
-- b2b.balance.adjust (SUPER_ADMIN/ADMIN/MANAGER). DROP v1 + REVOKE pair.
--
-- Décision compta (owner, 2026-06-27) : compte de contrepartie = 6520 dédié.
-- delta>0 (AR augmente) : Dr 1132 / Cr 6520 ; delta<0 (write-off) : Dr 6520 / Cr 1132.

-- 1) Compte 6520 (modèle 6190 : expense / debit / operating / is_system)
INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active, cash_flow_section)
VALUES ('6520', 'Bad Debt / AR Write-off', 6, 'expense', 'debit', true, true, true, 'operating')
ON CONFLICT (code) DO NOTHING;

-- 2) Mapping key
INSERT INTO accounting_mappings (mapping_key, account_code, description, is_active)
VALUES ('B2B_AR_ADJUSTMENT', '6520', 'B2B AR balance adjustment (write-off / recovery) contra account', true)
ON CONFLICT (mapping_key) DO NOTHING;

-- 3) Permission dédiée + grants (mirror customers.update : SUPER_ADMIN/ADMIN/MANAGER)
INSERT INTO permissions (code, module, action, description)
VALUES ('b2b.balance.adjust', 'b2b', 'balance_adjust', 'Manually adjust a B2B customer AR balance (write-off / recovery) — posts a counter JE, requires manager PIN')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted, granted_at)
VALUES
 ('SUPER_ADMIN', 'b2b.balance.adjust', true, now()),
 ('ADMIN',       'b2b.balance.adjust', true, now()),
 ('MANAGER',     'b2b.balance.adjust', true, now())
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- 4) v2
CREATE OR REPLACE FUNCTION public.adjust_b2b_balance_v2(
  p_customer_id uuid,
  p_delta numeric,
  p_reason text,
  p_manager_pin text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             UUID := auth.uid();
  v_profile_id      UUID;
  v_customer_type   customer_type;
  v_balance_before  NUMERIC(14,2);
  v_balance_after   NUMERIC(14,2);
  v_existing_log_id BIGINT;
  v_existing_meta   JSONB;
  v_audit_id        BIGINT;
  v_amt             NUMERIC(14,2);
  v_ar_id           UUID;
  v_adj_id          UUID;
  v_je_id           UUID;
  v_entry_no        TEXT;
  v_now             TIMESTAMPTZ := now();
BEGIN
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

  -- Gate dédiée (S50 V2a-i) — plus le générique customers.update
  IF NOT has_permission(v_uid, 'b2b.balance.adjust') THEN
    RAISE EXCEPTION 'permission_denied: b2b.balance.adjust' USING ERRCODE = 'P0003';
  END IF;

  -- PIN manager (mirror create_manual_je_v1)
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_profile_id, p_manager_pin) THEN
    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
  END IF;

  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'invalid_delta' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  -- Replay idempotent (retourne le résultat de la 1re exécution, sans re-poster de JE)
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
        'je_id',             NULLIF(v_existing_meta->>'je_id','')::uuid,
        'audit_log_id',      v_existing_log_id,
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

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

  IF v_balance_after < 0 THEN
    RAISE EXCEPTION 'balance_underflow (before: %, delta: %, after: %)',
      v_balance_before, p_delta, v_balance_after
      USING ERRCODE = 'P0011';
  END IF;

  -- JE de contrepartie : 1132 (AR-B2B) ⇄ 6520 (Bad Debt / AR Write-off).
  v_amt    := abs(p_delta);
  v_ar_id  := resolve_mapping_account('B2B_AR');
  v_adj_id := resolve_mapping_account('B2B_AR_ADJUSTMENT');

  PERFORM check_fiscal_period_open(v_now::date);
  v_entry_no := next_journal_entry_number(v_now::date);

  -- reference_id = NULL (mirror record_b2b_payment_v1) : chaque ajustement est un événement
  -- distinct ; l'idempotence métier passe par p_idempotency_key/audit_logs, pas par la
  -- contrainte journal_entries_je_idempotency_uniq (reference_type, reference_id) qui
  -- collisionnerait sur le 2e ajustement d'un même client. Le lien client est conservé
  -- dans audit_logs.metadata.customer_id + la description.
  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, v_now::date,
    'B2B AR adjustment (cust ' || p_customer_id::text || ') — ' || left(p_reason, 160),
    'b2b_adjustment', NULL,
    'posted', v_amt, v_amt, v_profile_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_ar_id,  GREATEST(p_delta, 0::numeric),  GREATEST(-p_delta, 0::numeric), 'AR B2B adjustment'),
    (v_je_id, v_adj_id, GREATEST(-p_delta, 0::numeric), GREATEST(p_delta, 0::numeric),  'AR B2B write-off / recovery');

  UPDATE customers
     SET b2b_current_balance = v_balance_after,
         updated_at = now()
   WHERE id = p_customer_id;

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
      'je_id',           v_je_id,
      'rpc_version',     'v2'
    )
  ) RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'customer_id',       p_customer_id,
    'balance_before',    v_balance_before,
    'balance_after',     v_balance_after,
    'delta',             p_delta,
    'je_id',             v_je_id,
    'audit_log_id',      v_audit_id,
    'idempotent_replay', FALSE
  );
END $function$;

-- 5) DROP v1 (signature d'origine) + REVOKE pair sur v2
DROP FUNCTION IF EXISTS public.adjust_b2b_balance_v1(uuid, numeric, text, uuid);

REVOKE ALL ON FUNCTION public.adjust_b2b_balance_v2(uuid, numeric, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_b2b_balance_v2(uuid, numeric, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_b2b_balance_v2(uuid, numeric, text, text, uuid) TO authenticated;
