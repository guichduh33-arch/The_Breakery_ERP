CREATE OR REPLACE FUNCTION public.pay_expense_v4(p_expense_id uuid, p_payment_method text DEFAULT NULL::text)
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
  v_method         TEXT;
  v_credit_key     TEXT;
  v_was_credit     BOOLEAN;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'pay_expense_v4: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.pay')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'pay_expense_v4: missing permission expenses.pay' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'pay_expense_v4: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_expense_v4: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'pay_expense_v4: expense % is not approved (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  v_was_credit := (v_row.payment_method = 'credit');
  v_method := v_row.payment_method;
  IF NOT v_was_credit AND p_payment_method IS NOT NULL
     AND p_payment_method IS DISTINCT FROM v_row.payment_method THEN
    RAISE EXCEPTION 'payment_method_locked' USING ERRCODE = '22023';
  END IF;

  IF v_was_credit THEN
    PERFORM check_fiscal_period_open(CURRENT_DATE);

    -- 2026-09-09 (audit finding n°4) : le compte crédité suit le moyen de règlement.
    v_method     := COALESCE(p_payment_method, 'cash');
    IF lower(v_method) = 'credit' THEN
      RAISE EXCEPTION 'pay_expense_v4: cannot settle expense % with method credit', p_expense_id
        USING ERRCODE = '22023';
    END IF;
    v_credit_key := _expense_settlement_mapping_key(v_method);
    IF v_credit_key IS NULL THEN
      RAISE EXCEPTION 'pay_expense_v4: unknown payment method %', v_method USING ERRCODE = '22023';
    END IF;

    v_ap_acc   := resolve_mapping_account('EXPENSE_AP');
    v_cash_acc := resolve_mapping_account(v_credit_key);
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
      (v_je_id, v_cash_acc, 0,            v_row.amount, 'Settled by ' || lower(v_method));

    UPDATE expenses
       SET status = 'paid',
           paid_by = v_caller_profile,
           paid_at = now(),
           payment_je_id = v_je_id,
           payment_method = v_method
     WHERE id = p_expense_id;
  ELSE
    UPDATE expenses
       SET status = 'paid',
           paid_by = v_caller_profile,
           paid_at = now(),
           payment_method = v_method
     WHERE id = p_expense_id;
  END IF;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_profile, 'expense.pay', 'expense', p_expense_id,
          jsonb_build_object('payment_je_id', v_je_id, 'was_credit', v_was_credit,
                             'payment_method', v_method));

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'payment_je_id', v_je_id,
    'status', 'paid',
    'was_credit', v_was_credit
  );
END $function$
;
REVOKE ALL ON FUNCTION public.pay_expense_v4(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pay_expense_v4(uuid,text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.pay_expense_v3(uuid,text);
