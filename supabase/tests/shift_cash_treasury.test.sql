BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
DO $$ DECLARE a uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid; BEGIN
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
    VALUES(p,a,'SHTRE-'||left(p::text,8),'Shift treasury fixture','SUPER_ADMIN',hash_pin('285741'),true);
  PERFORM pg_temp.authenticate_pin(a);
  PERFORM set_config('sht.profile',p::text,true);
  INSERT INTO fiscal_periods(period_start,period_end,status)
    VALUES(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month - 1 day')::date,'open')
    ON CONFLICT DO NOTHING;
  UPDATE fiscal_periods SET status='open' WHERE current_date BETWEEN period_start AND period_end;
  INSERT INTO business_config DEFAULT VALUES ON CONFLICT DO NOTHING;
  UPDATE business_config SET shift_denomination_count_enabled=false WHERE id=1;
  INSERT INTO pos_sessions(opened_by,opening_cash,cash_in_total,status) VALUES(p,500000,100000,'open') RETURNING id INTO s;
  PERFORM set_config('sht.session',s::text,true);
  -- Simulation comptable d'un cash-in : même compte de tiroir que les ventes cash.
  PERFORM create_manual_je_v2('Cash in fixture',current_date,jsonb_build_array(
    jsonb_build_object('account_id',resolve_mapping_account('SALE_PAYMENT_CASH'),'debit',100000,'credit',0),
    jsonb_build_object('account_id',(SELECT id FROM accounts WHERE code='3100'),'debit',0,'credit',100000)),'285741');
END $$;
SELECT is((SELECT account_code FROM accounting_mappings WHERE mapping_key='SALE_PAYMENT_CASH'),'1119','cash receipts route to drawer');
SELECT is((SELECT account_code FROM accounting_mappings WHERE mapping_key='CASH_WALLET_UNDEPOSITED'),'1110','safe remains distinct');
SELECT ok(NOT has_function_privilege('authenticated','_emit_shift_cash_transfer_v1(uuid,text,date,uuid,jsonb)','EXECUTE'),'internal emitter not exposed');
SELECT ok(NOT has_table_privilege('authenticated','shift_cash_treasury','UPDATE'),'settlement tracking cannot be edited directly');
SELECT is((SELECT opening_float FROM shift_cash_treasury WHERE session_id=current_setting('sht.session')::uuid),500000::numeric,'500k float tracked');
SELECT is((SELECT l.debit FROM journal_entry_lines l JOIN shift_cash_treasury t ON t.issued_je_id=l.journal_entry_id
  JOIN accounts a ON a.id=l.account_id WHERE t.session_id=current_setting('sht.session')::uuid AND a.code='1119'),500000::numeric,'drawer receives opening float');
SELECT is((SELECT l.credit FROM journal_entry_lines l JOIN shift_cash_treasury t ON t.issued_je_id=l.journal_entry_id
  JOIN accounts a ON a.id=l.account_id WHERE t.session_id=current_setting('sht.session')::uuid AND a.code='1117'),500000::numeric,'Small Money issues opening float');
SELECT throws_ok($q$ UPDATE pos_sessions SET opening_cash=900000 WHERE id=current_setting('sht.session')::uuid $q$,
  'P0001','issued_shift_float_is_immutable','issued float cannot be changed');
CREATE TEMP TABLE shift_result(value jsonb);
INSERT INTO shift_result SELECT close_shift_v10(current_setting('sht.session')::uuid,610000,'Counted 10k overage',gen_random_uuid());
SELECT is((SELECT (value->>'expected_cash')::numeric FROM shift_result),600000::numeric,'expected includes float and net cash movement');
SELECT is((SELECT (value->>'variance')::numeric FROM shift_result),10000::numeric,'overage stays separate');
SELECT is((SELECT returned_float FROM shift_cash_treasury WHERE session_id=current_setting('sht.session')::uuid),500000::numeric,'500k returned to Small Money');
SELECT is((SELECT safe_deposit FROM shift_cash_treasury WHERE session_id=current_setting('sht.session')::uuid),110000::numeric,'counted remainder reaches safe');
SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
  JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='1119' AND
    (j.reference_id=current_setting('sht.session')::uuid OR j.description='Cash in fixture')),0::numeric,'closed drawer is zero');
SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
  JOIN journal_entries j ON j.id=l.journal_entry_id WHERE a.code='1117' AND j.reference_id=current_setting('sht.session')::uuid),
  0::numeric,'opening float fully returns');
SELECT is((close_shift_v10(current_setting('sht.session')::uuid,610000,NULL,NULL)->>'idempotent_replay')::boolean,true,'close replay is safe');
SELECT is((SELECT count(*)::int FROM journal_entries WHERE reference_id=current_setting('sht.session')::uuid AND reference_type='cash_movement'),
  2,'only one issue and one settlement');
SELECT throws_ok($q$ UPDATE pos_sessions SET closing_cash=999999 WHERE id=current_setting('sht.session')::uuid $q$,
  'P0001','settled_shift_is_immutable','settled cash cannot change');
-- Un refus PIN ne transfère rien : la session et le fonds restent ouverts.
DO $$ DECLARE s uuid; BEGIN
  INSERT INTO pos_sessions(opened_by,opening_cash,status) VALUES(current_setting('sht.profile')::uuid,500000,'open') RETURNING id INTO s;
  PERFORM set_config('sht.second',s::text,true);
END $$;
SELECT is(close_shift_v10(current_setting('sht.second')::uuid,900000,'Large variance',gen_random_uuid(),
  current_setting('sht.profile')::uuid,'999999')->>'error','invalid_pin','bad manager PIN refused');
SELECT ok((SELECT settled_at IS NULL FROM shift_cash_treasury WHERE session_id=current_setting('sht.second')::uuid),'no settlement after PIN refusal');
SELECT is((SELECT status::text FROM pos_sessions WHERE id=current_setting('sht.second')::uuid),'open','refused shift remains open');
SELECT lives_ok($q$ SELECT close_shift_v10(current_setting('sht.second')::uuid,500000,NULL,gen_random_uuid()) $q$,'matching count closes without variance');
SELECT is((SELECT safe_deposit FROM shift_cash_treasury WHERE session_id=current_setting('sht.second')::uuid),0::numeric,'no sale means no safe deposit');
-- En cas de perte dépassant les recettes, on retourne uniquement les espèces réelles.
DO $$ DECLARE s uuid; BEGIN
  INSERT INTO pos_sessions(opened_by,opening_cash,status) VALUES(current_setting('sht.profile')::uuid,500000,'open') RETURNING id INTO s;
  PERFORM set_config('sht.third',s::text,true);
  PERFORM close_shift_v10(s,490000,'Float shortage',gen_random_uuid(),current_setting('sht.profile')::uuid,'285741');
END $$;
SELECT is((SELECT returned_float FROM shift_cash_treasury WHERE session_id=current_setting('sht.third')::uuid),490000::numeric,'short float returns only actual cash');
SELECT is((SELECT safe_deposit FROM shift_cash_treasury WHERE session_id=current_setting('sht.third')::uuid),0::numeric,'shortage does not invent a negative deposit');
SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
  JOIN accounts a ON a.id=l.account_id WHERE j.reference_id=current_setting('sht.third')::uuid AND a.code='1119'),0::numeric,'drawer clears even with shortage');
SELECT ok(EXISTS(SELECT 1 FROM get_cash_wallet_balances_v3() WHERE account_code='1118'),'reserve visible in treasury');
SELECT ok(EXISTS(SELECT 1 FROM get_cash_wallet_balances_v3() WHERE account_code='1119'),'drawer visible in treasury');
DO $$ DECLARE je uuid; BEGIN
  PERFORM set_config('sht.safe_before',(SELECT balance::text FROM get_cash_wallet_balances_v3() WHERE account_code='1110'),true);
  INSERT INTO journal_entries(entry_number,entry_date,description,reference_type,status,total_debit,total_credit,created_by)
    VALUES(next_journal_entry_number(current_date),current_date,'Draft is not cash','manual','draft',777,777,current_setting('sht.profile')::uuid)
    RETURNING id INTO je;
  INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit) VALUES
    (je,(SELECT id FROM accounts WHERE code='1110'),777,0),
    (je,(SELECT id FROM accounts WHERE code='3100'),0,777);
END $$;
SELECT is((SELECT balance FROM get_cash_wallet_balances_v3() WHERE account_code='1110'),
  current_setting('sht.safe_before')::numeric,'draft journal lines never increase available cash');
SELECT * FROM finish();
ROLLBACK;
