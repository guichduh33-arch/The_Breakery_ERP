-- ADR-013 Lot 4 (D4 + D3b + résiduel Lot 1) — socle comptable de l'avoir client.
--
-- 1. Comptes : 2220 Customer Store Credit Payable (passif de contrôle),
--    6117 Store Credit Grant Expense (charge du grant manager, D6),
--    4920 Store Credit Breakage Income (produit des avoirs périmés, D7).
--    cash_flow_section explicite : les préfixes 22/61/49 ne matchent aucune
--    règle du backfill _020 et recevraient sinon le DEFAULT sans intention.
-- 2. Clés de mapping : SALE_PAYMENT_STORE_CREDIT -> 2220 (fin de l'imputation
--    Caisse), STORE_CREDIT_GRANT_EXPENSE -> 6117, STORE_CREDIT_EXPIRY_INCOME -> 4920.
-- 3. Helper partagé _sale_payment_mapping_key_v1 : LE mapping méthode->clé,
--    une seule source (D3 « vente et reversal partagent le même helper »).
--    Clôt le résiduel Lot 1 (ADR-013 addendum : factoriser au repoint 2220).
-- 4. Repoints : create_sale_journal_entry (2 CASE), fn_create_je_for_refund
--    (1 CASE), retry_sale_journal_entry_v3 -> v4 (RPC versionnée, bump).
--    Corps de départ = pg_get_functiondef live (2026-07-26).

-- ── 1. Comptes ──────────────────────────────────────────────────────────────

INSERT INTO accounts (code, name, account_class, account_type, balance_type,
                      is_postable, is_system, is_active, cash_flow_section)
VALUES
  ('2220', 'Customer Store Credit Payable (Avoir client)', 2, 'liability', 'credit',
   true, true, true, 'operating'),
  ('6117', 'Store Credit Grant Expense', 6, 'expense', 'debit',
   true, true, true, 'operating'),
  ('4920', 'Store Credit Breakage Income', 4, 'revenue', 'credit',
   true, true, true, 'operating')
ON CONFLICT (code) DO NOTHING;

-- ── 2. Clés de mapping ──────────────────────────────────────────────────────

INSERT INTO accounting_mappings (mapping_key, account_code, description, is_active)
VALUES
  ('SALE_PAYMENT_STORE_CREDIT', '2220',
   'Tender store_credit : DR = extinction de la dette d''avoir (vente), CR = émission (refund/void). ADR-013 D4.', true),
  ('STORE_CREDIT_GRANT_EXPENSE', '6117',
   'Contrepartie charge du grant manager d''avoir client. ADR-013 D6.', true),
  ('STORE_CREDIT_EXPIRY_INCOME', '4920',
   'Produit de reprise des avoirs périmés. ADR-013 D7.', true)
ON CONFLICT (mapping_key) DO NOTHING;

-- ── 3. Helper partagé méthode -> clé de mapping ─────────────────────────────

CREATE OR REPLACE FUNCTION public._sale_payment_mapping_key_v1(p_method text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_method
    WHEN 'cash'         THEN 'SALE_PAYMENT_CASH'
    WHEN 'qris'         THEN 'SALE_PAYMENT_QRIS'
    WHEN 'card'         THEN 'SALE_PAYMENT_DEBIT'
    WHEN 'edc'          THEN 'SALE_PAYMENT_DEBIT'
    WHEN 'transfer'     THEN 'SALE_PAYMENT_TRANSFER'
    WHEN 'store_credit' THEN 'SALE_PAYMENT_STORE_CREDIT'  -- ADR-013 D4/D3b
    -- e-wallets réglés comme QRIS (décision 2026-07-23)
    WHEN 'gopay'        THEN 'SALE_PAYMENT_QRIS'
    WHEN 'ovo'          THEN 'SALE_PAYMENT_QRIS'
    WHEN 'dana'         THEN 'SALE_PAYMENT_QRIS'
    ELSE 'SALE_PAYMENT_CASH'
  END
$$;

REVOKE EXECUTE ON FUNCTION public._sale_payment_mapping_key_v1(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sale_payment_mapping_key_v1(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._sale_payment_mapping_key_v1(text) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._sale_payment_mapping_key_v1(text) IS
  'Source unique du mapping payment_method -> accounting_mappings.mapping_key, '
  'partagée vente/void/refund/retry (ADR-013 D3). Appelée uniquement depuis des '
  'fonctions SECURITY DEFINER.';

-- ── 4a. create_sale_journal_entry — les deux CASE passent par le helper ─────

CREATE OR REPLACE FUNCTION public.create_sale_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rate      NUMERIC;
  v_vat       DECIMAL(14,2);
  v_net       DECIMAL(14,2);
  v_je_id     UUID;
  v_existing  UUID;
  v_entry_no  TEXT;
  v_sales_id  UUID;
  v_pb1_id    UUID;
  v_pay       RECORD;
  v_acc_id    UUID;
BEGIN
  IF NEW.is_historical_import THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('paid', 'voided') THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_rate     := current_pb1_rate();
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := COALESCE(NEW.tax_amount, 0);
    v_net := NEW.total - v_vat;

    v_entry_no := next_journal_entry_number(NEW.created_at::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date,
      'Sale ' || NEW.order_number, 'sale', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, 0, v_net, 'Sales revenue (net of PB1)');

    IF v_vat > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_pb1_id, 0, v_vat, 'PB1 payable (rate=' || (v_rate * 100)::TEXT || '%)');
    END IF;

    FOR v_pay IN
      SELECT method::TEXT AS method, amount
        FROM order_payments
        WHERE order_id = NEW.id
        ORDER BY paid_at ASC
    LOOP
      v_acc_id := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method));

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, v_pay.amount, 0,
          'Payment receipt (' || v_pay.method || ')');
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = NEW.id) THEN
      v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, NEW.total, 0,
          'Payment receipt (no order_payments rows — fallback to cash)');
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (NEW.served_by, 'je.payment_fallback_cash', 'orders', NEW.id,
                jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total,
                                   'direction', 'sale'));
    END IF;

  ELSIF NEW.status = 'voided' AND OLD.status IN ('paid', 'completed') THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale_void' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := COALESCE(NEW.tax_amount, 0);
    v_net := NEW.total - v_vat;

    v_entry_no := next_journal_entry_number(NEW.created_at::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date,
      'REVERSAL ' || NEW.order_number, 'sale_void', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, v_net, 0, 'Sales revenue (reversal)');

    IF v_vat > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_pb1_id, v_vat, 0, 'PB1 payable (reversal)');
    END IF;

    FOR v_pay IN
      SELECT method::TEXT AS method, amount
        FROM order_payments
        WHERE order_id = NEW.id
        ORDER BY paid_at ASC
    LOOP
      v_acc_id := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method));

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, 0, v_pay.amount,
          'Payment reversal (' || v_pay.method || ')');
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = NEW.id) THEN
      v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, 0, NEW.total,
          'Payment reversal (no order_payments rows — fallback to cash)');
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (NEW.served_by, 'je.payment_fallback_cash', 'orders', NEW.id,
                jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total,
                                   'direction', 'reversal'));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 4b. fn_create_je_for_refund — CASE -> helper (trigger DEFERRED intouché) ─

CREATE OR REPLACE FUNCTION public.fn_create_je_for_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_je_id        UUID;
  v_existing     UUID;
  v_entry_no     TEXT;
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_net          DECIMAL(14,2);
  v_pay          RECORD;
  v_order_number TEXT;
  v_tender_acc   UUID;
BEGIN
  -- D2 : refund de void -> la contre-passation est le JE 'sale_void' emis par
  -- create_sale_journal_entry. Ne pas produire de second JE 'sale_refund'.
  IF NEW.is_full_void THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'sale_refund' AND reference_id = NEW.id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_net := NEW.total - NEW.tax_refunded;
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  SELECT order_number INTO v_order_number FROM orders WHERE id = NEW.order_id;

  v_entry_no := next_journal_entry_number(NEW.created_at::date);

  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)
  VALUES (v_entry_no, NEW.created_at::date,
          'Refund ' || NEW.refund_number || ' (order ' || COALESCE(v_order_number, '?') || ')',
          'sale_refund', NEW.id, 'posted', NEW.total, NEW.total, NEW.refunded_by)
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_sales_id, v_net,            0, 'Sales revenue (refund)'),
    (v_je_id, v_pb1_id,   NEW.tax_refunded, 0, 'PB1 payable (refund)');

  FOR v_pay IN SELECT method, amount FROM refund_payments WHERE refund_id = NEW.id LOOP
    -- D3 : mapping partagé vente/reversal (store_credit -> 2220 depuis le Lot 4).
    v_tender_acc := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method::TEXT));
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_tender_acc, 0, v_pay.amount,
      CASE WHEN v_pay.method = 'store_credit'
           THEN 'Store credit issued (refund)'
           ELSE 'Cash refund (' || v_pay.method::TEXT || ')' END);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM refund_payments WHERE refund_id = NEW.id) THEN
    v_tender_acc := resolve_mapping_account('SALE_PAYMENT_CASH');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_tender_acc, 0, NEW.total, 'Cash refund (fallback -- no tender recorded)');
  END IF;

  RETURN NEW;
END $function$;

-- ── 4c. retry_sale_journal_entry_v3 -> v4 (bump, CASE -> helper) ────────────

CREATE OR REPLACE FUNCTION public.retry_sale_journal_entry_v4(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID;
  v_profile_id   UUID;
  v_order        orders;
  v_existing_je  UUID;
  v_rate         NUMERIC;
  v_vat          DECIMAL(14,2);
  v_net          DECIMAL(14,2);
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_entry_no     TEXT;
  v_je_id        UUID;
  v_pay          RECORD;
  v_acc_id       UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_user_id LIMIT 1;
  END IF;

  IF v_profile_id IS NOT NULL AND NOT has_permission(v_profile_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'permission_denied: pos.sale.create required';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found: %', p_order_id;
  END IF;

  -- ADR-009 déc. 4 : le retry couvre paid ET completed (transition _189).
  IF v_order.status NOT IN ('paid', 'completed') THEN
    RAISE EXCEPTION 'invalid_state: order status is %, expected paid or completed', v_order.status;
  END IF;

  -- Parité trigger : les imports historiques n'émettent jamais de JE vente —
  -- une JE manquante y est intentionnelle, pas un échec à rattraper.
  IF v_order.is_historical_import THEN
    RAISE EXCEPTION 'invalid_state: historical import orders have no sale JE';
  END IF;

  SELECT id INTO v_existing_je FROM journal_entries
    WHERE reference_type = 'sale' AND reference_id = p_order_id
    LIMIT 1;
  IF v_existing_je IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id',          p_order_id,
      'journal_entry_id',  v_existing_je,
      'created',           false,
      'idempotent_replay', true
    );
  END IF;

  PERFORM check_fiscal_period_open(v_order.created_at::date);

  v_rate     := current_pb1_rate();
  v_vat      := COALESCE(v_order.tax_amount, 0);
  v_net      := v_order.total - v_vat;
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  v_entry_no := next_journal_entry_number(v_order.created_at::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, v_order.created_at::date,
    'Sale ' || v_order.order_number || ' (retry)', 'sale', v_order.id,
    'posted', v_order.total, v_order.total, v_order.served_by
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_sales_id, 0, v_net, 'Sales revenue (net of PB1)');

  IF v_vat > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_pb1_id, 0, v_vat, 'PB1 payable (rate=' || (v_rate * 100)::TEXT || '%)');
  END IF;

  FOR v_pay IN
    SELECT method::TEXT AS method, amount
      FROM order_payments
      WHERE order_id = v_order.id
      ORDER BY paid_at ASC
  LOOP
    v_acc_id := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method));

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_je_id, v_acc_id, v_pay.amount, 0,
        'Payment receipt (' || v_pay.method || ')');
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = v_order.id) THEN
    v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_je_id, v_acc_id, v_order.total, 0,
        'Payment receipt (no order_payments rows — fallback to cash)');
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_order.served_by, 'je.payment_fallback_cash', 'orders', v_order.id,
              jsonb_build_object('order_number', v_order.order_number, 'total', v_order.total,
                                 'direction', 'sale_retry'));
  END IF;

  RETURN jsonb_build_object(
    'order_id',          p_order_id,
    'journal_entry_id',  v_je_id,
    'created',           true,
    'idempotent_replay', false
  );
END;
$function$;

-- Versioning monotone : v3 droppée dans la même migration.
DROP FUNCTION public.retry_sale_journal_entry_v3(uuid);

-- Grants — miroir de v3 (_209) : REVOKE trio + authenticated seul.
REVOKE EXECUTE ON FUNCTION public.retry_sale_journal_entry_v4(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retry_sale_journal_entry_v4(uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_sale_journal_entry_v4(uuid) TO authenticated;

COMMENT ON FUNCTION public.retry_sale_journal_entry_v4(uuid) IS
  'Bump of retry_sale_journal_entry_v3 (ADR-013 Lot 4): the payment mapping CASE '
  'is replaced by the shared helper _sale_payment_mapping_key_v1 — store_credit '
  'now maps to 2220 Customer Store Credit Payable. Behaviour otherwise identical.';
