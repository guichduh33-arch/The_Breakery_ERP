-- 20260909000001_expense_payment_account_routing.sql
-- Audit expense-governance 2026-08-31, finding n°4 (P1) — le compte crédité d'une dépense
-- était TOUJOURS `EXPENSE_CASH_OUT`, quel que soit le moyen de règlement.
--
-- Depuis le remap du 2026-07-06, `EXPENSE_CASH_OUT` = 1111 Petty Cash. Un règlement par
-- VIREMENT vidait donc la petite caisse dans les livres, et `1112 Bank - Operating` n'était
-- jamais touché. Relevé sur dev au 2026-08-31 : 12 écritures `expense_payment`,
-- 6 600 000 IDR, `payment_method='transfer'`, créditées sur 1111.
--
-- Deux fonctions portaient le défaut :
--   · `_emit_expense_je`  — branche ELSE du test `payment_method = 'credit'` ;
--   · `pay_expense_v2`    — `resolve_mapping_account('EXPENSE_CASH_OUT')` en dur alors que
--                            l'écran propose Cash / Bank transfer / Card et que le choix
--                            est bien transmis en argument.
--
-- Arbitrages Mamat (2026-09-09) :
--   · une dépense par CARTE se crédite sur 1112 Bank - Operating — une carte d'entreprise
--     tire sur le compte bancaire. Elle reçoit tout de même sa PROPRE clé de mapping
--     (`EXPENSE_CARD_OUT`), pour pouvoir être repointée plus tard par
--     `update_accounting_mapping`, donc sans migration.
--   · les 12 écritures historiques ne sont PAS réécrites (règle forward-only du module).
--     Le montant et la période sont signalés au comptable dans la PR.

-- 1. Les deux mappings manquants ----------------------------------------------------------
INSERT INTO accounting_mappings (mapping_key, account_code, description, is_active) VALUES
  ('EXPENSE_BANK_OUT', '1112', 'Expense settled by bank transfer — credits Bank Operating', true),
  ('EXPENSE_CARD_OUT', '1112', 'Expense settled by company card — credits Bank Operating (repointable)', true)
ON CONFLICT (mapping_key) DO NOTHING;

-- 2. Le seul endroit qui connaît la correspondance moyen → clé ----------------------------
-- Même doctrine que le helper de mapping des paiements de vente : une seule fonction sait,
-- les émetteurs l'appellent. Helper INTERNE (préfixe `_`, aucun appel applicatif) : il se
-- remplace en place, sans cascade de versions.
--
-- `expenses.payment_method` est du TEXTE, pas un enum : une valeur inconnue est possible.
-- Elle lève une exception au lieu de retomber en silence sur la petite caisse — c'est
-- exactement le silence qui a produit ce finding. Relevé avant bascule : les seules valeurs
-- présentes sur dev sont `cash` et `transfer`, donc personne n'est bloqué par ce durcissement.
CREATE OR REPLACE FUNCTION public._expense_settlement_mapping_key(p_method text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE lower(coalesce(p_method, 'cash'))
           WHEN 'cash'     THEN 'EXPENSE_CASH_OUT'
           WHEN 'transfer' THEN 'EXPENSE_BANK_OUT'
           WHEN 'card'     THEN 'EXPENSE_CARD_OUT'
         END;
$$;

REVOKE ALL ON FUNCTION public._expense_settlement_mapping_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._expense_settlement_mapping_key(text) FROM anon;

COMMENT ON FUNCTION public._expense_settlement_mapping_key(text) IS
  'Moyen de règlement d''une dépense -> clé de mapping du compte CRÉDITÉ. Seul endroit qui '
  'connaît cette correspondance : les émetteurs de JE l''appellent, ils ne la recopient pas. '
  'Rend NULL sur une valeur inconnue — l''appelant DOIT lever, jamais retomber sur la caisse '
  '(audit expense-governance finding 4). Le règlement `credit` ne passe pas par ici : il '
  'crédite EXPENSE_AP.';

-- 3. `_emit_expense_je` — helper interne, remplacé EN PLACE --------------------------------
-- Corps repris de `pg_get_functiondef` live au 2026-09-09 ; seule la résolution du compte
-- crédité change.
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
  v_credit_key     TEXT;
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

  -- Resolve credit account: AP (credit terms) or the settlement account of the METHOD.
  -- 2026-09-09 (audit finding n°4) : ce n'était plus EXPENSE_CASH_OUT en dur.
  IF v_expense.payment_method = 'credit' THEN
    v_credit_acc := resolve_mapping_account('EXPENSE_AP');
  ELSE
    v_credit_key := _expense_settlement_mapping_key(v_expense.payment_method);
    IF v_credit_key IS NULL THEN
      RAISE EXCEPTION '_emit_expense_je: unknown payment_method % for expense %',
        v_expense.payment_method, p_expense_id USING ERRCODE = '22023';
    END IF;
    v_credit_acc := resolve_mapping_account(v_credit_key);
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
          CASE WHEN v_expense.payment_method = 'credit' THEN 'Expense - AP'
               ELSE 'Expense - settled by ' || lower(coalesce(v_expense.payment_method,'cash')) END);

  -- Stamp je_id on the expense row
  UPDATE expenses SET je_id = v_je_id WHERE id = p_expense_id;

  RETURN v_je_id;
END $function$;

-- 4. `pay_expense_v3` — le règlement d'une dépense à crédit crédite le BON compte ----------
-- Corps repris de `pg_get_functiondef('pay_expense_v2')` live au 2026-09-09 ; seule la
-- résolution du compte crédité change. Le moyen retenu est celui choisi À L'ÉCRAN DE
-- PAIEMENT (`p_payment_method`), qui est aussi celui écrit sur la dépense juste après.
CREATE OR REPLACE FUNCTION public.pay_expense_v3(
  p_expense_id uuid,
  p_payment_method text DEFAULT NULL
)
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
    RAISE EXCEPTION 'pay_expense_v3: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.pay')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'pay_expense_v3: missing permission expenses.pay' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'pay_expense_v3: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_expense_v3: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'pay_expense_v3: expense % is not approved (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  v_was_credit := (v_row.payment_method = 'credit');

  IF v_was_credit THEN
    PERFORM check_fiscal_period_open(CURRENT_DATE);

    -- 2026-09-09 (audit finding n°4) : le compte crédité suit le moyen de règlement.
    -- `p_payment_method` NULL signifie « pas de choix à l'écran » : on règle en caisse,
    -- comportement historique. Une valeur inconnue lève au lieu de vider la petite caisse.
    v_method     := COALESCE(p_payment_method, 'cash');
    IF lower(v_method) = 'credit' THEN
      RAISE EXCEPTION 'pay_expense_v3: cannot settle expense % with method credit', p_expense_id
        USING ERRCODE = '22023';
    END IF;
    v_credit_key := _expense_settlement_mapping_key(v_method);
    IF v_credit_key IS NULL THEN
      RAISE EXCEPTION 'pay_expense_v3: unknown payment method %', v_method USING ERRCODE = '22023';
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
          jsonb_build_object('payment_je_id', v_je_id, 'was_credit', v_was_credit,
                             'payment_method', COALESCE(p_payment_method, v_row.payment_method)));

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'payment_je_id', v_je_id,
    'status', 'paid',
    'was_credit', v_was_credit
  );
END $function$;

-- Paire REVOKE canonique sur la NOUVELLE signature
REVOKE ALL ON FUNCTION public.pay_expense_v3(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_expense_v3(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.pay_expense_v3(uuid, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.pay_expense_v3(uuid, text) IS
  'Règle une dépense approuvée. Pour une dépense à crédit : DR EXPENSE_AP / CR le compte du '
  'MOYEN de règlement, résolu par _expense_settlement_mapping_key (audit expense-governance '
  'finding 4 — la v2 créditait toujours la petite caisse). Une méthode inconnue lève 22023.';

DROP FUNCTION IF EXISTS public.pay_expense_v2(uuid, text);
