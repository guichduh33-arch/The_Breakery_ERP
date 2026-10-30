BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
DO $$ DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid; BEGIN
 INSERT INTO auth.users(id) VALUES(u);
 INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(p,u,'CMCP-'||left(p::text,8),'Cash counterpart fixture','SUPER_ADMIN',hash_pin('285741'),true);
 PERFORM pg_temp.authenticate_pin(u);
 PERFORM set_config('cmcp.profile',p::text,true);
 INSERT INTO fiscal_periods(period_start,period_end,status)
 VALUES(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month - 1 day')::date,'open')
 ON CONFLICT DO NOTHING;
 UPDATE fiscal_periods SET status='open' WHERE current_date BETWEEN period_start AND period_end;
 INSERT INTO business_config DEFAULT VALUES ON CONFLICT DO NOTHING;
 UPDATE business_config SET shift_denomination_count_enabled=false WHERE id=1;
 INSERT INTO pos_sessions(opened_by,opening_cash,status) VALUES(p,500000,'open') RETURNING id INTO s;
 PERFORM set_config('cmcp.session',s::text,true);
 PERFORM set_config('cmcp.key',gen_random_uuid()::text,true);
END $$;
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''in'',100000,''Top up'',%L,''misc'')',
 current_setting('cmcp.session'),gen_random_uuid()),'22023','counterparty_account_required','misc requires an account');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''in'',100000,''Top up'',%L,''replenishment'',''6114'')',
 current_setting('cmcp.session'),gen_random_uuid()),'22023','transfer_requires_cash_counterparty','float transfers require cash counterpart');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''in'',100000,''Top up'',%L,''misc'',''1119'')',
 current_setting('cmcp.session'),gen_random_uuid()),'22023','counterparty_account_required','drawer cannot be its own counterpart');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''in'',100000,''Top up'',NULL,''misc'',''1110'')',
 current_setting('cmcp.session')),'22023','idempotency_key_required','a durable key is required');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''in'',''NaN''::numeric,''Top up'',%L,''misc'',''1110'')',
 current_setting('cmcp.session'),gen_random_uuid()),'P0001','amount_must_be_positive','NaN rejected');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''out'',10000,''Owner out'',%L,''apport_owner'')',
 current_setting('cmcp.session'),gen_random_uuid()),'22023','owner_injection_must_be_cash_in','cash injection cannot mean cash out');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''out'',10000,''Purchase'',%L,''misc'',''6114'')',
 current_setting('cmcp.session'),gen_random_uuid()),'22023','transfer_requires_cash_counterparty','even an admin cannot pay expenses from Cash Drawer');
SELECT is((SELECT count(*) FROM cash_movements WHERE session_id=current_setting('cmcp.session')::uuid),0::bigint,'rejections have no movement');
SELECT lives_ok(format('SELECT record_cash_movement_v4(%L,''in'',100000,''Top up'',%L,''replenishment'',''1110'')',
 current_setting('cmcp.session'),current_setting('cmcp.key')),'cash replenishment posts');
SELECT is((SELECT cash_in_total FROM pos_sessions WHERE id=current_setting('cmcp.session')::uuid),100000::numeric,'cash expectation increases');
SELECT is((SELECT count(*) FROM journal_entries j JOIN cash_movements m ON m.id=j.reference_id
 WHERE j.reference_type='cash_movement' AND m.session_id=current_setting('cmcp.session')::uuid),1::bigint,'one movement one journal');
SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id JOIN cash_movements m ON m.id=j.reference_id
 WHERE m.session_id=current_setting('cmcp.session')::uuid AND a.code='1119'),100000::numeric,'drawer receives replenishment');
SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id JOIN cash_movements m ON m.id=j.reference_id
 WHERE m.session_id=current_setting('cmcp.session')::uuid AND a.code='1110'),(-100000)::numeric,'safe funds the transfer');
SELECT is((record_cash_movement_v4(current_setting('cmcp.session')::uuid,'in',100000,'Top up',
 current_setting('cmcp.key')::uuid,'replenishment','1110')->>'idempotent_replay')::boolean,true,'replay returns saved outcome');
SELECT is((SELECT count(*) FROM cash_movements WHERE session_id=current_setting('cmcp.session')::uuid),1::bigint,'replay does not duplicate');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''in'',100001,''Top up'',%L,''replenishment'',''1110'')',
 current_setting('cmcp.session'),current_setting('cmcp.key')),'22023','idempotency_key_conflict','changed amount rejected');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''in'',100000,''Top up'',%L,''replenishment'',''1111'')',
 current_setting('cmcp.session'),current_setting('cmcp.key')),'22023','idempotency_key_conflict','changed counterparty rejected');
SELECT lives_ok(format('SELECT record_cash_movement_v4(%L,''out'',25000,''Office petty cash'',%L,''misc'',''1111'')',
 current_setting('cmcp.session'),gen_random_uuid()),'cash can move to office Petty Cash');
SELECT is((SELECT cash_out_total FROM pos_sessions WHERE id=current_setting('cmcp.session')::uuid),25000::numeric,'cash transfer reduces expectation');
SELECT lives_ok(format('SELECT close_shift_v10(%L,575000,''Matched cash with classified movements'')',
 current_setting('cmcp.session')),'shift closes with actual movements');
SELECT is((SELECT returned_float FROM shift_cash_treasury WHERE session_id=current_setting('cmcp.session')::uuid),500000::numeric,'float returned in full');
SELECT is((SELECT safe_deposit FROM shift_cash_treasury WHERE session_id=current_setting('cmcp.session')::uuid),75000::numeric,'remaining cash deposited');
SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 JOIN journal_entries j ON j.id=l.journal_entry_id
 WHERE a.code='1119' AND (j.reference_id=current_setting('cmcp.session')::uuid OR j.reference_id IN
 (SELECT id FROM cash_movements WHERE session_id=current_setting('cmcp.session')::uuid))),0::numeric,'drawer is zero after real movement RPC and close');
SELECT ok(NOT has_function_privilege('anon','public.record_cash_movement_v4(uuid,text,numeric,text,uuid,text,text)','EXECUTE'),'anon cannot record movement');
SELECT ok(NOT has_function_privilege('anon','public.get_cash_movement_counterparties_v2()','EXECUTE'),'anon cannot read counterparties');
SELECT ok(NOT EXISTS(SELECT 1 FROM get_cash_movement_counterparties_v2() WHERE code='1119'),'drawer excluded from choices');
UPDATE user_profiles SET role_code='MANAGER' WHERE id=current_setting('cmcp.profile')::uuid;
SELECT ok(NOT EXISTS(SELECT 1 FROM get_cash_movement_counterparties_v2() WHERE NOT is_cash),'manager without manual accounting sees only cash accounts');
SELECT throws_ok(format('SELECT record_cash_movement_v4(%L,''out'',10000,''Supplies'',%L,''misc'',''6114'')',
 current_setting('cmcp.session'),gen_random_uuid()),'22023','transfer_requires_cash_counterparty','manager cannot post an expense from the drawer');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SELECT throws_ok('SELECT * FROM get_cash_movement_counterparties_v2()','42501','permission_denied','anonymous caller cannot list accounts');
SELECT * FROM finish();
ROLLBACK;
