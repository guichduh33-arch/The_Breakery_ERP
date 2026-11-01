-- Tickets existants transférés après clôture, sans règlement ni ligne dupliqués.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE transfer_cases(label text PRIMARY KEY, id uuid, original jsonb, items jsonb);
DO $fixture$
DECLARE
  v_actor uuid; v_auth uuid; v_other uuid; v_origin uuid; v_receiving uuid;
  v_other_session uuid; v_product uuid; v_order uuid; v_label text;
BEGIN
  SELECT id, auth_user_id INTO v_actor, v_auth FROM public.user_profiles
    WHERE deleted_at IS NULL AND is_active AND role_code = 'SUPER_ADMIN'
      AND auth_user_id IS NOT NULL LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'fixture: active SUPER_ADMIN required'; END IF;
  SELECT id INTO v_other FROM public.user_profiles
    WHERE deleted_at IS NULL AND is_active AND id <> v_actor LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_auth)::text, true);
  UPDATE public.pos_sessions SET status = 'closed', closed_at = now(),
    closed_by = v_actor, closing_cash = 0 WHERE opened_by = v_actor AND status = 'open';
  INSERT INTO public.pos_sessions(opened_by, opening_cash, status, closed_at, closed_by, closing_cash)
    VALUES(v_actor, 0, 'closed', now(), v_actor, 0) RETURNING id INTO v_origin;
  INSERT INTO public.pos_sessions(opened_by, opening_cash, status)
    VALUES(v_actor, 0, 'open') RETURNING id INTO v_receiving;
  SELECT id INTO v_other_session FROM public.pos_sessions WHERE opened_by = v_other AND status = 'open';
  IF v_other_session IS NULL THEN
    INSERT INTO public.pos_sessions(opened_by, opening_cash, status)
      VALUES(v_other, 0, 'open') RETURNING id INTO v_other_session;
  END IF;
  PERFORM set_config('transfer.origin', v_origin::text, true);
  PERFORM set_config('transfer.receiving', v_receiving::text, true);
  PERFORM set_config('transfer.other', v_other_session::text, true);
  INSERT INTO public.products(sku, name, category_id, retail_price, unit, cost_price, current_stock)
    VALUES('SHIFT-' || gen_random_uuid(), 'Cross-shift fixture',
      (SELECT id FROM public.categories LIMIT 1), 100, 'pcs', 0, 100)
    RETURNING id INTO v_product;
  FOREACH v_label IN ARRAY ARRAY['pos', 'tablet', 'partial', 'unfired', 'active_origin', 'paid', 'voided'] LOOP
    INSERT INTO public.orders(order_number, order_type, status, created_via, session_id,
      served_by, is_held, sent_to_kitchen_at, subtotal, tax_amount, total, notes, table_number)
    VALUES('SHIFT-' || gen_random_uuid(), 'dine_in',
      CASE WHEN v_label IN ('tablet', 'partial', 'unfired') THEN 'draft'::public.order_status
        ELSE 'pending_payment'::public.order_status END,
      CASE WHEN v_label IN ('tablet', 'partial', 'unfired') THEN 'tablet' ELSE 'pos' END,
      CASE WHEN v_label = 'active_origin' THEN v_other_session ELSE v_origin END,
      v_actor, true, CASE WHEN v_label = 'unfired' THEN NULL ELSE now() END,
      100, 0, 100, 'Keep this note', '77') RETURNING id INTO v_order;
    INSERT INTO public.order_items(order_id, product_id, name_snapshot, unit_price, quantity,
      line_total, kitchen_status, is_locked, sent_to_kitchen_at)
    VALUES(v_order, v_product, 'Cross-shift fixture', 100, 1, 100, 'pending', true, now());
    IF v_label IN ('partial', 'paid') THEN
      INSERT INTO public.order_payments(order_id, method, amount)
        VALUES(v_order, 'cash', CASE WHEN v_label = 'paid' THEN 100 ELSE 1 END);
    END IF;
    IF v_label = 'paid' THEN
      UPDATE public.orders SET status = 'paid' WHERE id = v_order;
    ELSIF v_label = 'voided' THEN
      UPDATE public.orders SET status = 'voided', voided_at = now(), voided_by = v_actor,
        void_reason = 'Cross-shift fixture' WHERE id = v_order;
    END IF;
    INSERT INTO transfer_cases SELECT v_label, v_order, to_jsonb(o),
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id = v_order)
      FROM public.orders o WHERE id = v_order;
  END LOOP;
END;
$fixture$;

SELECT ok(NOT has_function_privilege('anon', 'public.reopen_held_order_v9(uuid,uuid)', 'EXECUTE'), 'anonymous access refused');
SELECT ok(has_function_privilege('authenticated', 'public.reopen_held_order_v9(uuid,uuid)', 'EXECUTE'), 'authenticated access preserved');
SELECT throws_ok(format('SELECT public.reopen_held_order_v9(%L,NULL)', id),
  'P0001', 'no_open_shift', 'receiving shift required') FROM transfer_cases WHERE label = 'pos';
SELECT throws_ok(format('SELECT public.reopen_held_order_v9(%L,%L)', id, current_setting('transfer.origin')),
  'P0001', 'no_open_shift', 'closed receiving shift refused') FROM transfer_cases WHERE label = 'pos';
SELECT throws_ok(format('SELECT public.reopen_held_order_v9(%L,%L)', id, current_setting('transfer.other')),
  'P0001', 'no_open_shift', 'another cashier receiving shift refused') FROM transfer_cases WHERE label = 'pos';
SELECT throws_ok(format('SELECT public.reopen_held_order_v9(%L,%L)', id, current_setting('transfer.receiving')),
  'P0002', 'order_shift_still_open', 'another active shift is not taken over') FROM transfer_cases WHERE label = 'active_origin';
SELECT throws_ok(format('SELECT public.reopen_held_order_v9(%L,%L)', id, current_setting('transfer.receiving')),
  'P0002', 'order_already_has_payments', 'partial payment cannot move') FROM transfer_cases WHERE label = 'partial';
SELECT throws_ok(format('SELECT public.reopen_held_order_v9(%L,%L)', id, current_setting('transfer.receiving')),
  'P0002', 'order_not_available_for_reopen', 'unavailable ticket refused: ' || label)
  FROM transfer_cases WHERE label IN ('unfired', 'paid', 'voided');
SELECT lives_ok(format('SELECT public.reopen_held_order_v9(%L,%L)', id, current_setting('transfer.receiving')),
  'previous shift ticket resumed: ' || label) FROM transfer_cases WHERE label IN ('pos', 'tablet');
SELECT is(o.session_id, current_setting('transfer.receiving')::uuid, 'ticket assigned to receiving shift: ' || c.label)
  FROM transfer_cases c JOIN public.orders o ON o.id = c.id WHERE c.label IN ('pos', 'tablet');
SELECT is(to_jsonb(o) - ARRAY['session_id', 'is_held', 'updated_at'],
  c.original - ARRAY['session_id', 'is_held', 'updated_at'], 'all other order facts preserved: ' || c.label)
  FROM transfer_cases c JOIN public.orders o ON o.id = c.id WHERE c.label IN ('pos', 'tablet');
SELECT is((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id = c.id),
  c.items, 'item identities and kitchen state preserved: ' || c.label)
  FROM transfer_cases c WHERE c.label IN ('pos', 'tablet');
SELECT is((SELECT count(*)::int FROM public.order_payments p WHERE p.order_id = c.id), 0,
  'resuming does not charge: ' || c.label) FROM transfer_cases c WHERE c.label IN ('pos', 'tablet');
SELECT ok(EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_id = c.id AND a.action = 'order.reopened'
  AND a.metadata->>'origin_session_id' = current_setting('transfer.origin')
  AND a.metadata->>'receiving_session_id' = current_setting('transfer.receiving')
  AND (a.metadata->>'shift_transferred')::boolean), 'origin and receiving shifts audited: ' || c.label)
  FROM transfer_cases c WHERE c.label IN ('pos', 'tablet');
SELECT is(public.reopen_held_order_v9(id, current_setting('transfer.receiving')::uuid),
  public.reopen_held_order_v9(id, current_setting('transfer.receiving')::uuid), 'repeat resume preserves snapshot')
  FROM transfer_cases WHERE label = 'tablet';

DO $payment$
DECLARE v_order uuid; v_session uuid := current_setting('transfer.receiving')::uuid;
BEGIN
  SELECT id INTO v_order FROM transfer_cases WHERE label = 'tablet';
  -- La production et le développement ont des money-path différents.
  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'pay_existing_order_v24') THEN
    EXECUTE 'SELECT public.pay_existing_order_v24(p_order_id := $1, p_payment := $2,
      p_idempotency_key := $3, p_session_id := $4)'
      USING v_order, '{"method":"cash","amount":100,"cash_received":100}'::jsonb, gen_random_uuid(), v_session;
  ELSE
    EXECUTE 'SELECT public.pay_existing_order_v22(p_order_id := $1, p_payment := $2, p_idempotency_key := $3)'
      USING v_order, '{"method":"cash","amount":100,"cash_received":100}'::jsonb, gen_random_uuid();
  END IF;
END;
$payment$;
SELECT is((SELECT count(*)::int FROM public.order_payments p WHERE p.order_id = c.id), 1,
  'receiving shift can charge the original ticket once') FROM transfer_cases c WHERE label = 'tablet';
SELECT ok(o.status IN ('paid', 'completed') AND o.session_id = current_setting('transfer.receiving')::uuid,
  'paid ticket belongs to receiving shift') FROM transfer_cases c JOIN public.orders o ON o.id = c.id WHERE c.label = 'tablet';
SELECT is((SELECT coalesce(sum(p.amount), 0) FROM public.order_payments p JOIN public.orders o ON o.id = p.order_id
  WHERE o.id IN (SELECT id FROM transfer_cases) AND o.session_id = current_setting('transfer.receiving')::uuid),
  100::numeric, 'receiving drawer includes the payment');
SELECT is((SELECT count(*)::int FROM public.order_payments p JOIN public.orders o ON o.id = p.order_id
  WHERE o.id = (SELECT id FROM transfer_cases WHERE label = 'tablet') AND o.session_id = current_setting('transfer.origin')::uuid),
  0, 'closed drawer receives no new payment');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);
SELECT throws_ok(format('SELECT public.reopen_held_order_v9(%L,%L)', id, current_setting('transfer.receiving')),
  'P0001', 'Not authenticated', 'unauthenticated resume refused') FROM transfer_cases WHERE label = 'pos';
SELECT * FROM finish();
ROLLBACK;
