-- 20260901000005_fix_expense_actor_profile_id.sql
--
-- Audit lot 1 du 2026-08-31, P0 n°7 et n°8 (docs/audits/2026-08-31-audit-expense-governance.md).
--
-- Les huit écrivains du module dépenses posaient `auth.uid()` dans deux colonnes
-- dont la clé étrangère référence `user_profiles(id)` :
--   · `audit_logs.actor_id`        (audit_logs_actor_id_fkey)        — les sept RPC ;
--   · `journal_entries.created_by` (journal_entries_created_by_fkey) — `_emit_expense_je`
--     et `pay_expense_v1` (chemin de l'argent).
-- Or `auth.uid()` vaut `user_profiles.auth_user_id`, pas `user_profiles.id`.
-- `create_user_v*` (20260517000200_create_user_rpcs.sql) insère sans fixer `id`,
-- qui prend `gen_random_uuid()` : TOUT compte créé par le back-office a
-- `id <> auth_user_id`, et pour lui chaque geste du module échouait en 23503 —
-- création, soumission, approbation, rejet, paiement, seuils. Le module n'était
-- vivant que pour les comptes seed, où les deux identifiants coïncident, ce qui
-- explique que ni la base dev ni les pgTAP (fixtures `id = auth_user_id`) ne
-- l'aient vu.
--
-- Correction (même geste que 20260810000005_fix_kds_audit_actor_id.sql) :
-- résoudre le profil acteur par `auth_user_id = auth.uid() AND deleted_at IS NULL`
-- avant d'écrire, et poser ce profil dans les deux colonnes. Cinq des sept RPC
-- résolvaient déjà `v_caller_profile` sans s'en servir pour `actor_id` ; les deux
-- RPC de seuils et `_emit_expense_je` ne le résolvaient pas du tout. Un profil
-- introuvable lève 28000, comme submit_expense_v2 le faisait déjà.
--
-- Versioning monotone : les sept RPC publiées passent en _vN+1, l'ancienne est
-- droppée dans cette même migration. `_emit_expense_je` est un helper INTERNE
-- (EXECUTE postgres + service_role seulement, aucun appel client, signature
-- inchangée) : remplacé en place, régime des helpers arbitré le 2026-07-30
-- (20260731000001). Les messages d'erreur portent le nouveau nom ; rien d'autre
-- ne bouge dans les corps.
--
-- PROVENANCE DES CORPS : `pg_get_functiondef` sur la base live, relevé le
-- 2026-09-05. Le garde ci-dessous refuse la migration si un corps a dérivé
-- depuis — retransformer depuis le live, ne jamais forcer.
--
-- Grants : miroir exact des grants live (authenticated + service_role sur les
-- sept RPC ; service_role seul sur le helper) + REVOKE PUBLIC/anon (anon hérite
-- EXECUTE via PUBLIC). Types à régénérer (packages/supabase/src/types.generated.ts).

DO $$
DECLARE
  v_expected CONSTANT jsonb := jsonb_build_object(
    'create_expense_v1',           'e17bc12b02e2170d9f351fa313488c3b',
    'submit_expense_v2',           '2afb8901f969aa60586dfe46efe06d96',
    'approve_expense_v3',          'e28d1cfcead5a505dfce9b867f178938',
    'reject_expense_v1',           '3c82dac8feeae956d421ede26e314bc8',
    'pay_expense_v1',              'd05a7e6f6fc73100f4c20e1509ba7089',
    'set_expense_threshold_v1',    '61e1b28de249a533db1d415f84998dbc',
    'delete_expense_threshold_v1', '2096f162ba48667dd609d4bc3f7978c6',
    '_emit_expense_je',            '647862fc9aac482d1d03eded0b0f86ea'
  );
  v_name TEXT;
  v_md5  TEXT;
BEGIN
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_md5 IS DISTINCT FROM (v_expected ->> v_name) THEN
      RAISE EXCEPTION 'corps live de % inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-05, retransformer depuis pg_get_functiondef', v_name, v_md5;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- _emit_expense_je — helper interne, remplacé en place
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._emit_expense_je(p_expense_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_expense        expenses%ROWTYPE;
  v_cat_account    UUID;
  v_credit_acc     UUID;
  v_je_id          UUID;
  v_entry_no       TEXT;
BEGIN
  -- Fix 2 (pré-existant): guard against NULL auth context (pg_cron / background caller)
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION '_emit_expense_je: no auth context' USING ERRCODE = '28000';
  END IF;

  -- journal_entries.created_by référence user_profiles(id), pas auth.users(id).
  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION '_emit_expense_je: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '_emit_expense_je: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  -- Resolve debit account: category-specific or fallback to EXPENSE_DEFAULT
  SELECT account_id INTO v_cat_account FROM expense_categories WHERE id = v_expense.category_id;
  IF v_cat_account IS NULL THEN
    v_cat_account := resolve_mapping_account('EXPENSE_DEFAULT');
  END IF;

  -- Resolve credit account: AP (credit terms) or Cash/Bank
  IF v_expense.payment_method = 'credit' THEN
    v_credit_acc := resolve_mapping_account('EXPENSE_AP');
  ELSE
    v_credit_acc := resolve_mapping_account('EXPENSE_CASH_OUT');
  END IF;

  -- ADR-003 (NON-PKP) sanity check : vat_amount ne peut pas être négatif ni excéder le
  -- montant total (le montant est déjà TTC — vat_amount y est inclus, jamais ajouté).
  IF COALESCE(v_expense.vat_amount, 0) < 0 OR COALESCE(v_expense.vat_amount, 0) > v_expense.amount THEN
    RAISE EXCEPTION '_emit_expense_je: vat_amount % is invalid for amount %',
      v_expense.vat_amount, v_expense.amount USING ERRCODE = '22023';
  END IF;

  v_entry_no := next_journal_entry_number(v_expense.expense_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    v_expense.expense_date,
    'Expense ' || v_expense.expense_number || ' - ' || left(v_expense.description, 60),
    'expense',
    v_expense.id,
    'posted',
    v_expense.amount,
    v_expense.amount,
    v_caller_profile
  )
  RETURNING id INTO v_je_id;

  -- DR category : montant total (le PPN non récupérable est foldé dans la charge,
  -- ADR-003 NON-PKP — plus de ligne séparée vers EXPENSE_VAT_INPUT / compte 1151).
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cat_account, v_expense.amount, 0, 'Expense - category (incl. non-recoverable VAT)');

  -- CR credit account (full amount)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_credit_acc, 0, v_expense.amount,
          CASE WHEN v_expense.payment_method = 'credit' THEN 'Expense - AP' ELSE 'Expense - Cash' END);

  -- Stamp je_id on the expense row
  UPDATE expenses SET je_id = v_je_id WHERE id = p_expense_id;

  RETURN v_je_id;
END $function$;

REVOKE ALL ON FUNCTION public._emit_expense_je(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._emit_expense_je(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._emit_expense_je(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._emit_expense_je(uuid) TO service_role;

COMMENT ON FUNCTION public._emit_expense_je(uuid) IS
  'S28 internal helper : emits a balanced JE for an expense. DR category (VAT folded, ADR-003 NON-PKP) / CR AP or Cash. Stamps expenses.je_id. Called by submit_expense_v3 (auto-approve path) and approve_expense_v4. 2026-09-05 : created_by = user_profiles.id resolved from auth.uid() (wrote auth.uid() before, violating journal_entries_created_by_fkey for every back-office-created account). REVOKEd from authenticated.';

-- ---------------------------------------------------------------------------
-- create_expense_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_expense_v2(p_category_id uuid, p_amount numeric, p_payment_method text, p_description text, p_expense_date date, p_vat_amount numeric DEFAULT 0, p_vendor_name text DEFAULT NULL::text, p_receipt_url text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_existing_id    UUID;
  v_new_id         UUID;
  v_expense_no     TEXT;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'create_expense_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.create')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'create_expense_v2: missing permission expenses.create' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'create_expense_v2: amount must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_vat_amount < 0 THEN
    RAISE EXCEPTION 'create_expense_v2: vat_amount must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method NOT IN ('cash','transfer','card','credit') THEN
    RAISE EXCEPTION 'create_expense_v2: invalid payment_method %', p_payment_method USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM expenses
      WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'create_expense_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  v_expense_no := next_expense_number(p_expense_date);

  INSERT INTO expenses (
    expense_number, category_id, amount, vat_amount, payment_method,
    description, vendor_name, expense_date, receipt_url, status,
    created_by, idempotency_key
  ) VALUES (
    v_expense_no, p_category_id, p_amount, p_vat_amount, p_payment_method,
    p_description, p_vendor_name, p_expense_date, p_receipt_url, 'draft',
    v_caller_profile, p_idempotency_key
  )
  RETURNING id INTO v_new_id;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_profile, 'expense.create', 'expense', v_new_id,
          jsonb_build_object('expense_number', v_expense_no, 'amount', p_amount));

  RETURN v_new_id;
END $function$;

REVOKE ALL ON FUNCTION public.create_expense_v2(uuid, numeric, text, text, date, numeric, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_expense_v2(uuid, numeric, text, text, date, numeric, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_expense_v2(uuid, numeric, text, text, date, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense_v2(uuid, numeric, text, text, date, numeric, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.create_expense_v2(uuid, numeric, text, text, date, numeric, text, text, uuid) IS
  'Phase 3.B : creates a draft expense. Idempotency_key dedupes replays. Returns expense id. v2 (2026-09-05) : audit actor_id = user_profiles.id (v1 wrote auth.uid(), violating audit_logs_actor_id_fkey for every back-office-created account).';

DROP FUNCTION IF EXISTS public.create_expense_v1(uuid, numeric, text, text, date, numeric, text, text, uuid);

-- ---------------------------------------------------------------------------
-- submit_expense_v2 -> v3
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_expense_v3(p_expense_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_expense        expenses%ROWTYPE;
  v_replay         expenses%ROWTYPE;
  v_resolved_steps JSONB;
  v_step_count     INT;
  v_je_id          UUID;
BEGIN
  -- Fix 1: auth check FIRST — before idempotency replay (prevents info-disclosure to unauthenticated callers)
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v3: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Idempotency replay: if key already used, return cached result (auth-gated above)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_replay FROM expenses WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'expense_id',        v_replay.id,
        'status',            v_replay.status,
        'auto_approved',     v_replay.auto_approved,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v3: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- Permission gate: expenses.create (own submission) OR expenses.manage (admin override)
  IF NOT (
    has_permission(v_caller_uid, 'expenses.create')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'submit_expense_v3: missing permission expenses.create' USING ERRCODE = '42501';
  END IF;

  -- Lock row for atomic state transition
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_expense_v3: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_expense.status <> 'draft' THEN
    RAISE EXCEPTION 'submit_expense_v3: expense % is not draft (current=%)',
      p_expense_id, v_expense.status USING ERRCODE = 'P0001';
  END IF;

  -- Resolve threshold: category-specific first, then NULL (global default)
  -- Range: amount_min <= amount < amount_max
  SELECT steps INTO v_resolved_steps
  FROM expense_approval_thresholds
  WHERE (category_id = v_expense.category_id OR category_id IS NULL)
    AND v_expense.amount >= amount_min
    AND v_expense.amount <  amount_max
  ORDER BY category_id NULLS LAST
  LIMIT 1;

  IF v_resolved_steps IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v3: no threshold matches amount=% category=%',
      v_expense.amount, v_expense.category_id USING ERRCODE = 'P0002';
  END IF;

  v_step_count := jsonb_array_length(v_resolved_steps);

  IF v_step_count = 0 THEN
    -- Auto-approve path: freeze snapshot, set status=approved, emit JE
    -- Fiscal period guard (mirrors approve_expense_v1)
    PERFORM check_fiscal_period_open(v_expense.expense_date);

    UPDATE expenses SET
      required_approval_steps_snapshot = v_resolved_steps,
      auto_approved                    = true,
      status                           = 'approved',
      submitted_at                     = now(),
      submitted_by                     = v_caller_profile,
      approved_at                      = now(),
      approved_by                      = v_caller_profile,
      idempotency_key                  = COALESCE(p_idempotency_key, idempotency_key)
    WHERE id = p_expense_id;

    -- Emit balanced JE via helper (stamps je_id on expense row)
    v_je_id := _emit_expense_je(p_expense_id);

    -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_caller_profile, 'expense.auto_approved', 'expense', p_expense_id,
            jsonb_build_object('amount', v_expense.amount, 'je_id', v_je_id));

    RETURN jsonb_build_object(
      'expense_id',     p_expense_id,
      'status',         'approved',
      'auto_approved',  true,
      'steps_required', 0
    );
  ELSE
    -- Multi-step path: freeze snapshot, set status=submitted
    UPDATE expenses SET
      required_approval_steps_snapshot = v_resolved_steps,
      auto_approved                    = false,
      status                           = 'submitted',
      submitted_at                     = now(),
      submitted_by                     = v_caller_profile,
      idempotency_key                  = COALESCE(p_idempotency_key, idempotency_key)
    WHERE id = p_expense_id;

    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_caller_profile, 'expense.submitted', 'expense', p_expense_id,
            jsonb_build_object('amount', v_expense.amount, 'steps_required', v_step_count));

    RETURN jsonb_build_object(
      'expense_id',     p_expense_id,
      'status',         'submitted',
      'auto_approved',  false,
      'steps_required', v_step_count
    );
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.submit_expense_v3(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_expense_v3(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_expense_v3(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_expense_v3(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.submit_expense_v3(uuid, uuid) IS
  'S28 : submit draft expense — resolves approval threshold, freezes step snapshot, auto-approves + emits JE if steps=[]. Idempotent via p_idempotency_key. v3 (2026-09-05) : audit actor_id = user_profiles.id (v2 wrote auth.uid(), violating audit_logs_actor_id_fkey for every back-office-created account). Replaces submit_expense_v2 (dropped same migration).';

DROP FUNCTION IF EXISTS public.submit_expense_v2(uuid, uuid);

-- ---------------------------------------------------------------------------
-- approve_expense_v3 -> v4
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_expense_v4(p_expense_id uuid, p_manager_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_caller_role    TEXT;
  v_expense        expenses%ROWTYPE;
  v_snapshot       JSONB;
  v_step_count     INT;
  v_next_step_idx  INT;
  v_required_roles TEXT[];
  v_step_label     TEXT;
  v_self_approval  BOOLEAN := false;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v4: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id, role_code
    INTO v_caller_profile, v_caller_role
    FROM user_profiles
   WHERE auth_user_id = v_caller_uid
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v4: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'expenses.approve') THEN
    RAISE EXCEPTION 'approve_expense_v4: missing permission expenses.approve' USING ERRCODE = '42501';
  END IF;

  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'approve_expense_v4: pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_caller_profile, p_manager_pin) THEN
    RAISE EXCEPTION 'approve_expense_v4: invalid_pin' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_expense_v4: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF v_expense.status != 'submitted' THEN
    RAISE EXCEPTION 'approve_expense_v4: expense % is not submitted (current=%)',
      p_expense_id, v_expense.status USING ERRCODE = 'P0001';
  END IF;

  -- SOD block 1: creator cannot approve own expense — EXCEPT SUPER_ADMIN (single-operator policy).
  IF v_expense.created_by = v_caller_profile THEN
    IF v_caller_role <> 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'approve_expense_v4: sod_creator_block — creator cannot approve own expense'
        USING ERRCODE = 'P0001';
    END IF;
    v_self_approval := true;
  END IF;

  v_snapshot := v_expense.required_approval_steps_snapshot;

  IF v_snapshot IS NULL THEN
    v_snapshot := '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"}]'::jsonb;
  END IF;

  v_step_count    := jsonb_array_length(v_snapshot);
  v_next_step_idx := COALESCE(v_expense.current_approval_step, 0);

  IF v_next_step_idx >= v_step_count THEN
    RAISE EXCEPTION 'approve_expense_v4: all steps already approved (step %/%)',
      v_next_step_idx, v_step_count USING ERRCODE = 'P0001';
  END IF;

  SELECT
    ARRAY(SELECT jsonb_array_elements_text(v_snapshot -> v_next_step_idx -> 'role_codes')),
    v_snapshot -> v_next_step_idx ->> 'label'
  INTO v_required_roles, v_step_label;

  IF NOT (v_caller_role = ANY(v_required_roles)) THEN
    RAISE EXCEPTION 'approve_expense_v4: missing_role — step % requires one of %',
      v_next_step_idx + 1, v_required_roles USING ERRCODE = 'P0003';
  END IF;

  BEGIN
    INSERT INTO expense_approvals (expense_id, approver_user_id, step)
    VALUES (p_expense_id, v_caller_profile, v_next_step_idx + 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'approve_expense_v4: sod_already_approved — caller already approved this expense'
      USING ERRCODE = 'P0001';
  END;

  UPDATE expenses
     SET current_approval_step = v_next_step_idx + 1
   WHERE id = p_expense_id;

  IF v_next_step_idx + 1 = v_step_count THEN
    PERFORM check_fiscal_period_open(v_expense.expense_date);

    UPDATE expenses
       SET status      = 'approved',
           approved_at = now(),
           approved_by = v_caller_profile
     WHERE id = p_expense_id;

    PERFORM _emit_expense_je(p_expense_id);
  END IF;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile,
    'expense.approved_step',
    'expense',
    p_expense_id,
    jsonb_build_object(
      'step',          v_next_step_idx + 1,
      'of_total',      v_step_count,
      'final',         (v_next_step_idx + 1 = v_step_count),
      'label',         v_step_label,
      'self_approval', v_self_approval
    )
  );

  IF v_self_approval THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_caller_profile,
      'expense.self_approved',
      'expense',
      p_expense_id,
      jsonb_build_object(
        'role',     v_caller_role,
        'step',     v_next_step_idx + 1,
        'of_total', v_step_count
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'step',       v_next_step_idx + 1,
    'of_total',   v_step_count,
    'status',     CASE WHEN v_next_step_idx + 1 = v_step_count THEN 'approved' ELSE 'submitted' END
  );
END $function$;

REVOKE ALL ON FUNCTION public.approve_expense_v4(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_expense_v4(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_expense_v4(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_expense_v4(uuid, text) TO service_role;

COMMENT ON FUNCTION public.approve_expense_v4(uuid, text) IS
  'S28 + H1 (2026-06-01 PIN re-auth) + S38 lockout + 2026-06-23 policy: SUPER_ADMIN may self-approve own expense (audited via expense.self_approved). SOD block 2 still applies to all. PIN verified server-side via _verify_pin_with_lockout. v4 (2026-09-05) : audit actor_id = user_profiles.id (v3 wrote auth.uid(), violating audit_logs_actor_id_fkey for every back-office-created account).';

DROP FUNCTION IF EXISTS public.approve_expense_v3(uuid, text);

-- ---------------------------------------------------------------------------
-- reject_expense_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_expense_v2(p_expense_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_row            expenses%ROWTYPE;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'reject_expense_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reject_expense_v2: reason is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.approve')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'reject_expense_v2: missing permission expenses.approve' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'reject_expense_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reject_expense_v2: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'submitted' THEN
    RAISE EXCEPTION 'reject_expense_v2: expense % is not submitted (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE expenses
     SET status = 'rejected',
         rejected_reason = p_reason,
         approved_by = v_caller_profile,
         rejected_at = now()
   WHERE id = p_expense_id;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_profile, 'expense.reject', 'expense', p_expense_id,
          jsonb_build_object('reason', p_reason));
END $function$;

REVOKE ALL ON FUNCTION public.reject_expense_v2(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_expense_v2(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_expense_v2(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_expense_v2(uuid, text) TO service_role;

COMMENT ON FUNCTION public.reject_expense_v2(uuid, text) IS
  'Phase 3.B : reject a submitted expense with mandatory reason. v2 (2026-09-05) : audit actor_id = user_profiles.id (v1 wrote auth.uid(), violating audit_logs_actor_id_fkey for every back-office-created account).';

DROP FUNCTION IF EXISTS public.reject_expense_v1(uuid, text);

-- ---------------------------------------------------------------------------
-- pay_expense_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_expense_v2(p_expense_id uuid, p_payment_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_row            expenses%ROWTYPE;
  v_je_id          UUID;
  v_entry_no       TEXT;
  v_ap_acc         UUID;
  v_cash_acc       UUID;
  v_was_credit     BOOLEAN;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'pay_expense_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.pay')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'pay_expense_v2: missing permission expenses.pay' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'pay_expense_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_expense_v2: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'pay_expense_v2: expense % is not approved (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  v_was_credit := (v_row.payment_method = 'credit');

  IF v_was_credit THEN
    PERFORM check_fiscal_period_open(CURRENT_DATE);

    v_ap_acc   := resolve_mapping_account('EXPENSE_AP');
    v_cash_acc := resolve_mapping_account('EXPENSE_CASH_OUT');
    v_entry_no := next_journal_entry_number(CURRENT_DATE);

    -- journal_entries.created_by référence user_profiles(id), pas auth.users(id).
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, CURRENT_DATE,
      'Expense payment ' || v_row.expense_number,
      'expense_payment', v_row.id,
      'posted', v_row.amount, v_row.amount, v_caller_profile
    )
    RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_ap_acc,   v_row.amount, 0,            'Clear AP'),
      (v_je_id, v_cash_acc, 0,            v_row.amount, 'Cash payment');

    UPDATE expenses
       SET status = 'paid',
           paid_by = v_caller_profile,
           paid_at = now(),
           payment_je_id = v_je_id,
           payment_method = COALESCE(p_payment_method, v_row.payment_method)
     WHERE id = p_expense_id;
  ELSE
    UPDATE expenses
       SET status = 'paid',
           paid_by = v_caller_profile,
           paid_at = now(),
           payment_method = COALESCE(p_payment_method, v_row.payment_method)
     WHERE id = p_expense_id;
  END IF;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_profile, 'expense.pay', 'expense', p_expense_id,
          jsonb_build_object('payment_je_id', v_je_id, 'was_credit', v_was_credit));

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'payment_je_id', v_je_id,
    'status', 'paid',
    'was_credit', v_was_credit
  );
END $function$;

REVOKE ALL ON FUNCTION public.pay_expense_v2(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_expense_v2(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.pay_expense_v2(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_expense_v2(uuid, text) TO service_role;

COMMENT ON FUNCTION public.pay_expense_v2(uuid, text) IS
  'Phase 3.B : mark expense as paid. If was credit, emits payment JE. v2 (2026-09-05) : journal_entries.created_by and audit actor_id = user_profiles.id (v1 wrote auth.uid(), violating both FKs for every back-office-created account).';

DROP FUNCTION IF EXISTS public.pay_expense_v1(uuid, text);

-- ---------------------------------------------------------------------------
-- set_expense_threshold_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_expense_threshold_v2(p_threshold_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_amount_min numeric DEFAULT 0, p_amount_max numeric DEFAULT NULL::numeric, p_steps jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_result_id      UUID;
  v_overlap        INT;
  v_step           JSONB;
BEGIN
  -- 1. Auth check
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v2: caller not authenticated'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Permission gate (expenses.thresholds.write — seeded in Task 3.A)
  IF NOT has_permission(v_caller_uid, 'expenses.thresholds.write') THEN
    RAISE EXCEPTION 'set_expense_threshold_v2: missing permission expenses.thresholds.write'
      USING ERRCODE = '42501';
  END IF;

  -- 2b. Résolution du profil acteur — audit_logs.actor_id référence user_profiles(id).
  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- 3. Validate p_steps is a JSONB array
  IF jsonb_typeof(p_steps) != 'array' THEN
    RAISE EXCEPTION 'set_expense_threshold_v2: p_steps must be a JSONB array'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate each step shape: { role_codes: TEXT[] non-empty, label: TEXT non-empty }
  FOR v_step IN SELECT jsonb_array_elements(p_steps) LOOP
    IF jsonb_typeof(v_step -> 'role_codes') != 'array'
       OR jsonb_array_length(v_step -> 'role_codes') = 0
       OR jsonb_typeof(v_step -> 'label') != 'string'
       OR length(v_step ->> 'label') = 0
    THEN
      RAISE EXCEPTION 'set_expense_threshold_v2: invalid step shape — each step needs non-empty role_codes array + non-empty label'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 5. Validate p_amount_max not NULL
  IF p_amount_max IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v2: p_amount_max must not be NULL'
      USING ERRCODE = '22023';
  END IF;

  -- 6. Validate range: p_amount_max > p_amount_min
  IF p_amount_max <= p_amount_min THEN
    RAISE EXCEPTION 'set_expense_threshold_v2: p_amount_max must be > p_amount_min'
      USING ERRCODE = '22023';
  END IF;

  -- 7. Overlap check: no other row for same category_id covering any part of [p_amount_min, p_amount_max)
  SELECT COUNT(*) INTO v_overlap
  FROM expense_approval_thresholds
  WHERE id IS DISTINCT FROM p_threshold_id          -- exclude self on UPDATE
    AND category_id IS NOT DISTINCT FROM p_category_id
    AND p_amount_min < amount_max
    AND p_amount_max > amount_min;

  IF v_overlap > 0 THEN
    RAISE EXCEPTION 'set_expense_threshold_v2: threshold_overlap — another row covers part of [%, %) for this category',
      p_amount_min, p_amount_max
      USING ERRCODE = 'P0002';
  END IF;

  -- 8. INSERT or UPDATE
  IF p_threshold_id IS NULL THEN
    INSERT INTO expense_approval_thresholds (category_id, amount_min, amount_max, steps)
    VALUES (p_category_id, p_amount_min, p_amount_max, p_steps)
    RETURNING id INTO v_result_id;
  ELSE
    UPDATE expense_approval_thresholds
    SET category_id = p_category_id,
        amount_min  = p_amount_min,
        amount_max  = p_amount_max,
        steps       = p_steps
    WHERE id = p_threshold_id
    RETURNING id INTO v_result_id;

    IF v_result_id IS NULL THEN
      RAISE EXCEPTION 'set_expense_threshold_v2: threshold % not found', p_threshold_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 9. Audit log (canonical columns: actor_id, action, entity_type, entity_id, metadata)
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile,
    CASE WHEN p_threshold_id IS NULL
         THEN 'expense_threshold.created'
         ELSE 'expense_threshold.updated'
    END,
    'expense_approval_thresholds',
    v_result_id,
    jsonb_build_object(
      'category_id', p_category_id,
      'amount_min',  p_amount_min,
      'amount_max',  p_amount_max,
      'steps',       p_steps
    )
  );

  -- 10. Return the threshold UUID
  RETURN v_result_id;
END $function$;

REVOKE ALL ON FUNCTION public.set_expense_threshold_v2(uuid, uuid, numeric, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_expense_threshold_v2(uuid, uuid, numeric, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_expense_threshold_v2(uuid, uuid, numeric, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_expense_threshold_v2(uuid, uuid, numeric, numeric, jsonb) TO service_role;

COMMENT ON FUNCTION public.set_expense_threshold_v2(uuid, uuid, numeric, numeric, jsonb) IS
  'S28: UPSERT expense approval threshold (admin-gated via expenses.thresholds.write). Validates step shape + range + overlap. Returns threshold UUID. NULL p_threshold_id = INSERT, non-NULL = UPDATE. v2 (2026-09-05) : audit actor_id = user_profiles.id (v1 wrote auth.uid(), violating audit_logs_actor_id_fkey for every back-office-created account).';

DROP FUNCTION IF EXISTS public.set_expense_threshold_v1(uuid, uuid, numeric, numeric, jsonb);

-- ---------------------------------------------------------------------------
-- delete_expense_threshold_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_expense_threshold_v2(p_threshold_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_deleted        INT;
BEGIN
  -- Auth-first gate
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'delete_expense_threshold_v2: caller not authenticated'
      USING ERRCODE = '28000';
  END IF;

  -- Permission gate
  IF NOT has_permission(v_caller_uid, 'expenses.thresholds.write') THEN
    RAISE EXCEPTION 'delete_expense_threshold_v2: missing permission expenses.thresholds.write'
      USING ERRCODE = '42501';
  END IF;

  -- Résolution du profil acteur — audit_logs.actor_id référence user_profiles(id).
  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'delete_expense_threshold_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- Delete the threshold row
  DELETE FROM expense_approval_thresholds WHERE id = p_threshold_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Not-found guard
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'delete_expense_threshold_v2: threshold % not found', p_threshold_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Audit log using canonical columns: actor_id, action, entity_type, entity_id, metadata
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile,
    'expense_threshold.deleted',
    'expense_approval_thresholds',
    p_threshold_id,
    '{}'::jsonb
  );

  RETURN true;
END $function$;

REVOKE ALL ON FUNCTION public.delete_expense_threshold_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_expense_threshold_v2(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_expense_threshold_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_expense_threshold_v2(uuid) TO service_role;

COMMENT ON FUNCTION public.delete_expense_threshold_v2(uuid) IS
  'S28: hard-delete an expense approval threshold. Gate: expenses.thresholds.write. Emits audit_log expense_threshold.deleted. v2 (2026-09-05) : audit actor_id = user_profiles.id (v1 wrote auth.uid(), violating audit_logs_actor_id_fkey for every back-office-created account).';

DROP FUNCTION IF EXISTS public.delete_expense_threshold_v1(uuid);

-- Défense en profondeur : anon hérite EXECUTE via PUBLIC sur toute fonction future.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
