-- Règlement B2B par avoir : solde, ledger, AR et JE dans la même transaction.
-- Fixtures propres, identité auth distincte du profil, aucune hypothèse RBAC.
BEGIN;
SELECT plan(21);

CREATE TEMP TABLE bsc_context(auth_id uuid, profile_id uuid, denied_auth_id uuid,
  denied_profile_id uuid, product_id uuid, replay_key uuid, first_result jsonb,
  baseline_2220 numeric, category_id uuid DEFAULT gen_random_uuid());
INSERT INTO bsc_context
SELECT gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), NULL,
  COALESCE(SUM(credit - debit), 0)
FROM journal_entry_lines WHERE account_id = resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT');
INSERT INTO auth.users(id) SELECT auth_id FROM bsc_context UNION ALL SELECT denied_auth_id FROM bsc_context;
INSERT INTO user_profiles(id, auth_user_id, role_code, employee_code, full_name, pin_hash, is_active)
SELECT profile_id, auth_id, 'MANAGER', 'BSC-' || left(profile_id::text, 8), 'B2B credit fixture', 'unused', true
FROM bsc_context UNION ALL
SELECT denied_profile_id, denied_auth_id, 'MANAGER', 'BSC-' || left(denied_profile_id::text, 8),
  'B2B denied fixture', 'unused', true FROM bsc_context;
INSERT INTO user_permission_overrides(user_profile_id, permission_code, is_granted, reason, granted_by)
SELECT profile_id, permission, true, 'B2B credit fixture', profile_id FROM bsc_context
CROSS JOIN unnest(ARRAY['b2b.payment.record','pos.sale.create','customers.store_credit.grant']) permission
UNION ALL SELECT denied_profile_id, 'b2b.payment.record', false, 'B2B denial fixture', profile_id FROM bsc_context;
SELECT set_config('request.jwt.claim.sub', auth_id::text, true) FROM bsc_context;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',auth_id,'role','authenticated')::text, true)
FROM bsc_context;
INSERT INTO customer_categories(id, name, slug, price_modifier_type)
SELECT category_id, 'B2B credit fixture category', 'bsc-' || category_id::text, 'retail'
FROM bsc_context;
INSERT INTO products(id, sku, name, category_id, retail_price, track_inventory, deduct_stock, is_display_item)
SELECT product_id, 'BSC-' || left(product_id::text, 8), 'B2B credit fixture',
  (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1), 100000, false, false, false FROM bsc_context;
CREATE TEMP TABLE bsc_customer(name text PRIMARY KEY, customer_id uuid, invoice_id uuid);
INSERT INTO bsc_customer SELECT name, gen_random_uuid(), NULL
FROM unnest(ARRAY['zero','insufficient','partial','cash','transfer','remainder']) name;
INSERT INTO customers(id, name, customer_type, category_id, b2b_credit_limit)
SELECT customer_id, 'BSC ' || name, 'b2b', (SELECT category_id FROM bsc_context), NULL FROM bsc_customer;
DO $$ DECLARE c record; r jsonb; nonce uuid; amount numeric; BEGIN
  FOR c IN SELECT * FROM bsc_customer LOOP
    r := create_b2b_order_v7(c.customer_id, jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM bsc_context), 'quantity', 1)), NULL, NULL, gen_random_uuid());
    UPDATE bsc_customer SET invoice_id = (r->>'order_id')::uuid WHERE name = c.name;
    amount := CASE c.name WHEN 'insufficient' THEN 10000 WHEN 'partial' THEN 100000
      WHEN 'remainder' THEN 200000 ELSE 0 END;
    IF amount > 0 THEN
      INSERT INTO discount_authorizations(manager_profile_id, scope)
      SELECT profile_id, 'store_credit_grant' FROM bsc_context RETURNING id INTO nonce;
      PERFORM grant_store_credit_v1(c.customer_id, amount, 'B2B credit fixture funding', nonce, gen_random_uuid());
    END IF;
  END LOOP;
  -- Cache volontairement corrompu : prouver le rollback après le débit d'avoir.
  UPDATE customers SET b2b_current_balance = 150000
  WHERE id = (SELECT customer_id FROM bsc_customer WHERE name = 'remainder');
END $$;
CREATE FUNCTION pg_temp.bsc_pay(p_name text, p_amount numeric, p_method payment_method,
  p_key uuid DEFAULT NULL, p_date timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql AS $$
  SELECT record_b2b_payment_v4(customer_id, p_amount, p_method, NULL, p_date, NULL, p_key,
    ARRAY[invoice_id]) FROM bsc_customer WHERE name = p_name
$$;
CREATE FUNCTION pg_temp.bsc_state() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'customers', (SELECT jsonb_agg(jsonb_build_array(c.id,c.b2b_current_balance,c.store_credit_balance) ORDER BY c.id)
      FROM customers c JOIN bsc_customer f ON f.customer_id=c.id),
    'payments', (SELECT count(*) FROM b2b_payments WHERE customer_id IN (SELECT customer_id FROM bsc_customer)),
    'credits', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM customer_store_credit_ledger l
      WHERE customer_id IN (SELECT customer_id FROM bsc_customer)),
    'allocations', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM b2b_payment_allocations a
      WHERE invoice_id IN (SELECT invoice_id FROM bsc_customer)),
    'orders', (SELECT jsonb_agg(jsonb_build_array(o.id,o.status,o.paid_at) ORDER BY o.id)
      FROM orders o WHERE id IN (SELECT invoice_id FROM bsc_customer)),
    'journals', (SELECT count(*) FROM journal_entries WHERE created_by=(SELECT profile_id FROM bsc_context)),
    'lines', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM journal_entry_lines l JOIN journal_entries j
      ON j.id=l.journal_entry_id WHERE j.created_by=(SELECT profile_id FROM bsc_context)),
    'audit', (SELECT count(*) FROM audit_logs WHERE actor_id=(SELECT profile_id FROM bsc_context)))
$$;
CREATE TEMP TABLE bsc_before AS SELECT pg_temp.bsc_state() AS state;

SELECT ok(to_regprocedure('public.record_b2b_payment_v3(uuid,numeric,payment_method,text,timestamptz,text,uuid,uuid[])') IS NULL
  AND NOT has_function_privilege('anon', 'public.record_b2b_payment_v4(uuid,numeric,payment_method,text,timestamptz,text,uuid,uuid[])','EXECUTE')
  AND has_function_privilege('authenticated', 'public.record_b2b_payment_v4(uuid,numeric,payment_method,text,timestamptz,text,uuid,uuid[])','EXECUTE'),
  'old signature removed, authenticated granted and anon/PUBLIC inheritance closed');
SELECT throws_ok($$ SELECT pg_temp.bsc_pay('zero', 1000, 'store_credit') $$,
  'P0016', NULL, 'zero credit rejected');
SELECT is(pg_temp.bsc_state(), (SELECT state FROM bsc_before), 'zero credit rejection writes nothing');
SELECT throws_ok($$ SELECT pg_temp.bsc_pay('insufficient', 10001, 'store_credit') $$,
  'P0016', NULL, 'insufficient credit rejected');
SELECT is(pg_temp.bsc_state(), (SELECT state FROM bsc_before), 'insufficient credit rejection writes nothing');

UPDATE bsc_context SET first_result = pg_temp.bsc_pay('partial', 30000, 'store_credit', replay_key);
SELECT ok((SELECT c.store_credit_balance=70000 AND c.b2b_current_balance=70000
  AND o.status='b2b_pending' AND o.paid_at IS NULL FROM customers c JOIN bsc_customer f
  ON f.customer_id=c.id JOIN orders o ON o.id=f.invoice_id WHERE f.name='partial'),
  'partial credit payment reduces both balances without settling invoice');
SELECT ok((SELECT count(*)=1 AND sum(delta)=-30000 AND min(balance_after)=70000
  AND bool_and(source='spend' AND reference_type='b2b_payments' AND created_by=x.profile_id)
  FROM customer_store_credit_ledger l CROSS JOIN bsc_context x
  WHERE l.reference_id=(x.first_result->>'payment_id')::uuid), 'one spend ledger row linked to payment and profile');
SELECT ok((SELECT count(*)=2 AND sum(l.debit)=30000 AND sum(l.credit)=30000
  AND sum(l.debit) FILTER (WHERE a.code='2220')=30000
  AND sum(l.credit) FILTER (WHERE a.code='1132')=30000
  FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
  WHERE l.journal_entry_id=(SELECT (first_result->>'je_id')::uuid FROM bsc_context)),
  'credit settlement has exactly Dr2220 / Cr1132');
SELECT ok((SELECT count(*)=1 AND sum(amount_applied)=30000 FROM b2b_payment_allocations
  WHERE payment_id=(SELECT (first_result->>'payment_id')::uuid FROM bsc_context)),
  'AR allocation equals partial payment');
SELECT ok((SELECT count(*)=1 AND bool_and(a.actor_id=x.profile_id AND a.actor_id<>x.auth_id
  AND a.metadata->'result'=x.first_result AND a.metadata->>'store_credit_ledger_id' IS NOT NULL)
  FROM audit_logs a CROSS JOIN bsc_context x WHERE a.entity_id=(x.first_result->>'payment_id')::uuid
  AND a.action='b2b.payment.recorded'), 'audit stores original result and profile identity');

SELECT lives_ok($$ SELECT pg_temp.bsc_pay('partial', 70000, 'store_credit', gen_random_uuid()) $$,
  'remaining invoice can be fully paid by credit');
SELECT ok((SELECT c.store_credit_balance=0 AND c.b2b_current_balance=0
  AND o.status='paid' AND o.paid_at IS NOT NULL FROM customers c JOIN bsc_customer f
  ON f.customer_id=c.id JOIN orders o ON o.id=f.invoice_id WHERE f.name='partial'),
  'full settlement exhausts credit and AR, marks invoice paid');
UPDATE bsc_before SET state=pg_temp.bsc_state();
SELECT is((SELECT pg_temp.bsc_pay('partial',30000,'store_credit',replay_key)
  FROM bsc_context), (SELECT first_result || '{"idempotent_replay":true}'::jsonb FROM bsc_context),
  'replay after another payment returns original balance and allocation envelope');
SELECT is(pg_temp.bsc_state(), (SELECT state FROM bsc_before), 'replay creates no debit, JE, allocation or audit');
SELECT ok((SELECT sum(c.store_credit_balance) FROM customers c JOIN bsc_customer f ON f.customer_id=c.id)
  = (SELECT sum(delta) FROM customer_store_credit_ledger WHERE customer_id IN (SELECT customer_id FROM bsc_customer))
  AND (SELECT sum(c.store_credit_balance) FROM customers c JOIN bsc_customer f ON f.customer_id=c.id)
  = (SELECT COALESCE(sum(credit-debit),0) FROM journal_entry_lines
    WHERE account_id=resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT'))
    - (SELECT baseline_2220 FROM bsc_context), 'customer balances = credit ledger = GL2220 delta');

SELECT throws_ok($$ SELECT pg_temp.bsc_pay('remainder',150000,'store_credit',gen_random_uuid()) $$,
  'P0011', NULL, 'unallocatable remainder rejected after credit debit');
SELECT is(pg_temp.bsc_state(), (SELECT state FROM bsc_before), 'remainder refusal rolls back credit, ledger, JE and AR');
DO $$ DECLARE m payment_method; r jsonb; BEGIN
  FOREACH m IN ARRAY ARRAY['cash','transfer']::payment_method[] LOOP
    r:=pg_temp.bsc_pay(m::text,100000,m,gen_random_uuid());
    IF NOT EXISTS (SELECT 1 FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
      WHERE l.journal_entry_id=(r->>'je_id')::uuid AND l.debit=100000
      AND a.code=CASE m WHEN 'cash' THEN '1110' ELSE '1112' END)
      OR EXISTS (SELECT 1 FROM customer_store_credit_ledger WHERE reference_id=(r->>'payment_id')::uuid)
    THEN RAISE EXCEPTION 'cash/bank settlement regression'; END IF;
  END LOOP;
END $$;
SELECT ok((SELECT count(*)=2 FROM b2b_payments WHERE customer_id IN
  (SELECT customer_id FROM bsc_customer WHERE name IN ('cash','transfer'))),
  'cash/transfer preserve mappings and do not create a credit spend');
UPDATE bsc_before SET state=pg_temp.bsc_state();
INSERT INTO fiscal_periods(period_start,period_end,status) VALUES ('2098-10-01','2098-10-31','closed');
SELECT throws_ok($$ SELECT pg_temp.bsc_pay('insufficient',1,'store_credit',gen_random_uuid(),'2098-10-05') $$,
  'P0004', NULL, 'closed fiscal period rejects credit settlement');
SELECT is(pg_temp.bsc_state(), (SELECT state FROM bsc_before), 'fiscal refusal writes nothing');
SELECT set_config('request.jwt.claim.sub',denied_auth_id::text,true) FROM bsc_context;
SELECT throws_ok($$ SELECT pg_temp.bsc_pay('insufficient',1,'store_credit') $$,
  'P0003','permission_denied: b2b.payment.record','dedicated permission required');
-- Les triggers différés doivent également valider toutes les allocations réelles.
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
