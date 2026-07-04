-- Session 59 — Task 2 — Fix F-4 (P1, S58) : _emit_expense_je référençait le mapping-key
-- EXPENSE_VAT_INPUT -> compte 1151, désactivé par l'ADR-003 (NON-PKP : la TVA d'achat
-- payée à un fournisseur PKP n'est pas récupérable). Toute approbation de dépense avec
-- vat_amount > 0 levait mapping_key_unknown (P0002) et crashait.
--
-- Fix (décision tranchée docs/workplan/plans/2026-07-04-session-59-vague1-lot1-plan.md
-- Task 2, miroir du pattern achats 20260603000012_bump_create_purchase_journal_entry_
-- fold_vat_into_inventory.sql) : le PPN est foldé dans le débit du compte de charge —
-- la ligne DR EXPENSE_VAT_INPUT disparaît. Le crédit (AP / cash) reste sur le montant
-- total, inchangé. In-place : signature et comportement identiques hors correction du bug
-- (DEV-S57-02 : corps repris du live via pg_get_functiondef avant édition).
CREATE OR REPLACE FUNCTION public._emit_expense_je(p_expense_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid    UUID := auth.uid();
  v_expense       expenses%ROWTYPE;
  v_cat_account   UUID;
  v_credit_acc    UUID;
  v_je_id         UUID;
  v_entry_no      TEXT;
BEGIN
  -- Fix 2 (pré-existant): guard against NULL auth context (pg_cron / background caller)
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION '_emit_expense_je: no auth context' USING ERRCODE = '28000';
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
    v_caller_uid
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
