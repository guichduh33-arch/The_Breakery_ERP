-- 20260723000209_retry_sale_je_v3_ewallets.sql
-- ADR-006 déc. 9 (lot B) — retry_sale_journal_entry_v3 : le CASE de mapping
-- gagne les branches gopay/ovo/dana → SALE_PAYMENT_QRIS (parité avec le
-- trigger create_sale_journal_entry, migration _208).
-- Versioning monotone : v3 créée depuis le corps live de v2
-- (pg_get_functiondef, 2026-07-23), v2 droppée dans la même migration.

CREATE OR REPLACE FUNCTION public.retry_sale_journal_entry_v3(p_order_id uuid)
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
  v_mapping      TEXT;
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
    v_mapping := CASE v_pay.method
      WHEN 'cash'         THEN 'SALE_PAYMENT_CASH'
      WHEN 'qris'         THEN 'SALE_PAYMENT_QRIS'
      WHEN 'card'         THEN 'SALE_PAYMENT_DEBIT'
      WHEN 'edc'          THEN 'SALE_PAYMENT_DEBIT'
      WHEN 'transfer'     THEN 'SALE_PAYMENT_TRANSFER'
      WHEN 'store_credit' THEN 'SALE_PAYMENT_CASH'
      -- lot B : e-wallets réglés comme QRIS (décision 2026-07-23)
      WHEN 'gopay'        THEN 'SALE_PAYMENT_QRIS'
      WHEN 'ovo'          THEN 'SALE_PAYMENT_QRIS'
      WHEN 'dana'         THEN 'SALE_PAYMENT_QRIS'
      ELSE 'SALE_PAYMENT_CASH'
    END;
    v_acc_id := resolve_mapping_account(v_mapping);

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

-- Versioning monotone : v2 droppée dans la même migration.
DROP FUNCTION public.retry_sale_journal_entry_v2(uuid);

-- Grants — miroir de v2 (_190) : REVOKE trio + authenticated seul.
REVOKE EXECUTE ON FUNCTION public.retry_sale_journal_entry_v3(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retry_sale_journal_entry_v3(uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_sale_journal_entry_v3(uuid) TO authenticated;

COMMENT ON FUNCTION public.retry_sale_journal_entry_v3(uuid) IS
  'Bump of retry_sale_journal_entry_v2 (lot B ADR-006 déc. 9): the payment '
  'mapping CASE gains gopay/ovo/dana -> SALE_PAYMENT_QRIS. Behaviour otherwise '
  'identical (idempotent retry of the sale JE for paid/completed orders).';
