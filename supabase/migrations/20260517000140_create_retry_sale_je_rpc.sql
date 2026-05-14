-- 20260517000140_create_retry_sale_je_rpc.sql
-- Session 13 / Phase 4.A / migration 04A-001 :
--   RPC `retry_sale_journal_entry_v1(p_order_id)` — one-click repair for
--   paid orders whose `create_sale_journal_entry` trigger failed (e.g. the
--   `accounting_mappings` row was missing at completion time, fiscal period
--   flipped, or a transient deadlock). The repair invokes the existing
--   `create_sale_journal_entry()` trigger body in a fresh transaction.
--
-- Deviation D-W4-4A-02 — Phase 4.A spec said "no migrations" but the
-- OrderRetryBanner one-click DoD requires a server-side fix path. The RPC is
-- intentionally minimal (single function, no schema change) so the deviation
-- is small.
--
-- Idempotency: `create_sale_journal_entry()` already SELECTs for an existing
-- JE row with `reference_type='sale' AND reference_id=p_order_id` and
-- returns NEW unchanged if found ; calling this RPC twice is safe.
--
-- Authz: gated via `pos.sale.create` (cashier role can trigger their own
-- repair) — same as the order completion flow.

CREATE OR REPLACE FUNCTION public.retry_sale_journal_entry_v1(
  p_order_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id      UUID;
  v_profile_id   UUID;
  v_order        orders;
  v_existing_je  UUID;
  v_vat          DECIMAL(14,2);
  v_net          DECIMAL(14,2);
  v_cash_id      UUID;
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_entry_no     TEXT;
  v_je_id        UUID;
BEGIN
  -- Resolve caller (auth.uid() is NULL for the SECURITY DEFINER context until
  -- we explicitly look it up). Stays NULL for the PIN-auth kiosk path —
  -- has_permission() handles that.
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_user_id LIMIT 1;
  END IF;

  -- Authz : cashier+ can retry. Reuse `pos.sale.create` which is granted to
  -- the cashier role (same role that completes orders), so no new perm needed.
  IF v_profile_id IS NOT NULL AND NOT has_permission(v_profile_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'permission_denied: pos.sale.create required';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found: %', p_order_id;
  END IF;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'invalid_state: order status is %, expected paid', v_order.status;
  END IF;

  -- Idempotency : if a sale JE already exists, return it (no new write).
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

  -- Fiscal period guard — RAISE P0004 if entry_date falls in closed period.
  PERFORM check_fiscal_period_open(v_order.created_at::date);

  v_vat := round_idr(v_order.total * 10 / 110);
  v_net := v_order.total - v_vat;

  v_cash_id  := resolve_mapping_account('SALE_PAYMENT_CASH');
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
    (v_je_id, v_cash_id,  v_order.total, 0, 'Cash receipt'),
    (v_je_id, v_sales_id, 0, v_net,         'Sales revenue (net of PB1)'),
    (v_je_id, v_pb1_id,   0, v_vat,         'PB1 payable (10%)');

  RETURN jsonb_build_object(
    'order_id',          p_order_id,
    'journal_entry_id',  v_je_id,
    'created',           true,
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION public.retry_sale_journal_entry_v1(UUID) IS
  'Phase 4.A — one-click repair for paid orders whose sale JE trigger failed. '
  'Idempotent (returns existing JE if present). Auth: pos.sale.create.';

GRANT EXECUTE ON FUNCTION public.retry_sale_journal_entry_v1(UUID) TO authenticated;
