-- Encaissements importés visibles par ADMIN, shift ouvert toujours masqué.
-- Tout disparaît avec le ROLLBACK : import, acteurs, shift et écritures.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
\ir helpers/historical_import.sql
-- Import financier seul, comme l'import Olsera d'octobre : paiement hors shift.
UPDATE products SET current_stock=0,is_display_item=true WHERE id=(SELECT product FROM historical_fixture);
INSERT INTO display_stock(product_id,quantity) SELECT product,0 FROM historical_fixture
 ON CONFLICT(product_id) DO UPDATE SET quantity=0;
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(payload,'{stock_mode}','"financial_only"'),
 '{documents,0,stock_mode}','"financial_only"');
UPDATE historical_fixture SET payload=(payload #- '{documents,0,stock_reconciled}') #- '{documents,0,stock_basis}';
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v4(payload);
UPDATE historical_fixture SET result=apply_historical_import_v5(payload,preview->>'preview_hash',client_key);
RESET ROLE;

CREATE TEMP TABLE hist_ids AS SELECT
 (SELECT j.id FROM journal_entries j WHERE j.reference_type='pos_outstanding_payment'
   AND j.metadata->>'financial_import_run_id'=f.result->>'run_id') hist_je,
 gen_random_uuid() admin_id,gen_random_uuid() admin_auth,gen_random_uuid() session_id,gen_random_uuid() order_id,
 gen_random_uuid() open_sale_je,gen_random_uuid() open_receipt_je,gen_random_uuid() receipt_key,gen_random_uuid() forged_je
 FROM historical_fixture f;
CREATE TEMP TABLE hist_balances(viewer text PRIMARY KEY,balance numeric);
GRANT SELECT ON hist_ids TO authenticated;
GRANT SELECT,INSERT ON hist_balances TO authenticated;
INSERT INTO historical_tap(result) SELECT ok((SELECT hist_je FROM hist_ids) IS NOT NULL,'import creates a receipt JE');
INSERT INTO historical_tap(result) SELECT ok(NOT EXISTS(SELECT 1 FROM pos_payment_attempt_keys k JOIN journal_entries j ON j.reference_id=k.key
 WHERE j.id=(SELECT hist_je FROM hist_ids)),'imported receipt has no POS attempt key, like the October import');
-- Le coffre débité dépend du mapping de la base (1110 en production) : on suit celui-ci.
ALTER TABLE hist_ids ADD COLUMN cash_code text;
UPDATE hist_ids SET cash_code=(SELECT a.code FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 WHERE l.journal_entry_id=hist_ids.hist_je AND l.debit>0);
INSERT INTO historical_tap(result) SELECT ok(cash_code IN('1110','1111','1117','1118','1119'),
 'imported cash receipt debits a Cash Treasury wallet') FROM hist_ids;

-- ADMIN non propriétaire, avec tous les droits applicatifs.
INSERT INTO auth.users(id,email) SELECT admin_auth,admin_auth||'@visibility.invalid' FROM hist_ids;
INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT admin_id,admin_auth,'HVIS-'||left(admin_id::text,8),'Historical visibility fixture','invalid-test-hash','ADMIN',true FROM hist_ids;
INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT (SELECT admin_id FROM hist_ids),p.code,true,'Transactional historical visibility coverage' FROM permissions p
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;

-- Un seul shift ouvert dans cette transaction : vente et encaissement en espèces.
UPDATE pos_sessions SET status='closed',closed_at=coalesce(closed_at,now()) WHERE status<>'closed';
INSERT INTO pos_sessions(id,opened_by,opened_at,opening_cash,status)
 SELECT session_id,admin_id,now(),0,'open' FROM hist_ids;
INSERT INTO orders(id,order_number,session_id,status,subtotal,tax_amount,total,paid_at)
 SELECT order_id,'HVIS-'||order_id,session_id,'completed',10000,0,10000,now() FROM hist_ids;
INSERT INTO journal_entries(id,entry_number,entry_date,description,reference_type,reference_id,status,total_debit,total_credit)
 SELECT open_sale_je,next_journal_entry_number(current_date),current_date,'Open sale fixture','sale',order_id,'posted',10000,10000 FROM hist_ids;
INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit,description)
 SELECT open_sale_je,(SELECT a.id FROM accounts a JOIN hist_ids i ON a.code=i.cash_code),10000,0,'Fixture cash' FROM hist_ids UNION ALL
 SELECT open_sale_je,resolve_mapping_account('SALE_POS_REVENUE'),0,10000,'Fixture revenue' FROM hist_ids;
INSERT INTO pos_payment_attempt_keys(key,order_id,actor_id,request,result)
 SELECT receipt_key,order_id,admin_id,jsonb_build_object('operation','settle','session',session_id),
 jsonb_build_object('session_id',session_id) FROM hist_ids;
INSERT INTO journal_entries(id,entry_number,entry_date,description,reference_type,reference_id,status,total_debit,total_credit)
 SELECT open_receipt_je,next_journal_entry_number(current_date),current_date,'Open receipt fixture','pos_outstanding_payment',receipt_key,'posted',500,500 FROM hist_ids;
INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit,description)
 SELECT open_receipt_je,(SELECT a.id FROM accounts a JOIN hist_ids i ON a.code=i.cash_code),500,0,'Fixture cash' FROM hist_ids UNION ALL
 SELECT open_receipt_je,resolve_mapping_account('SALE_POS_REVENUE'),0,500,'Fixture revenue' FROM hist_ids;
-- Écriture forgée : libellé et run d'import réels, sans paiement importé derrière.
INSERT INTO journal_entries(id,entry_number,entry_date,description,reference_type,reference_id,status,total_debit,total_credit,metadata)
 SELECT i.forged_je,next_journal_entry_number(current_date),current_date,'Historical payment: forged','pos_outstanding_payment',
 gen_random_uuid(),'posted',0,0,jsonb_build_object('financial_import_run_id',f.result->>'run_id')
 FROM hist_ids i CROSS JOIN historical_fixture f;

SELECT pg_temp.authenticate_pin((SELECT auth_id FROM historical_fixture));
SET LOCAL ROLE authenticated;
INSERT INTO historical_tap(result) SELECT ok(is_business_owner_v1(),'import actor is the business owner');
INSERT INTO hist_balances SELECT 'owner',balance FROM get_cash_wallet_balances_v4() WHERE account_code=(SELECT cash_code FROM hist_ids);
RESET ROLE;

SELECT pg_temp.authenticate_pin((SELECT admin_auth FROM hist_ids));
SET LOCAL ROLE authenticated;
INSERT INTO historical_tap(result) SELECT ok(NOT is_business_owner_v1(),'ADMIN is not the business owner');
INSERT INTO historical_tap(result) SELECT ok(can_view_financial_entry_v2(hist_je,false),'ADMIN sees the imported receipt in reports') FROM hist_ids;
INSERT INTO historical_tap(result) SELECT ok(can_view_financial_entry_v2(hist_je,true),'ADMIN sees the imported receipt detail') FROM hist_ids;
INSERT INTO historical_tap(result) SELECT is((SELECT count(*) FROM journal_entry_lines WHERE journal_entry_id=(SELECT hist_je FROM hist_ids)),2::bigint,'RLS releases the imported receipt lines');
INSERT INTO historical_tap(result) SELECT ok(NOT can_view_financial_entry_v2(open_sale_je),'open-shift sale stays hidden') FROM hist_ids;
INSERT INTO historical_tap(result) SELECT ok(NOT can_view_financial_entry_v2(open_receipt_je),'open-shift receipt stays hidden') FROM hist_ids;
INSERT INTO historical_tap(result) SELECT ok(NOT can_view_financial_entry_v2(forged_je),'receipt without an imported payment stays hidden') FROM hist_ids;
INSERT INTO hist_balances SELECT 'admin',balance FROM get_cash_wallet_balances_v4() WHERE account_code=(SELECT cash_code FROM hist_ids);
RESET ROLE;

INSERT INTO historical_tap(result) SELECT is(
 (SELECT balance FROM hist_balances WHERE viewer='admin'),
 (SELECT balance FROM hist_balances WHERE viewer='owner')-(SELECT sum(l.debit-l.credit) FROM journal_entry_lines l
  JOIN accounts a ON a.id=l.account_id JOIN journal_entries j ON j.id=l.journal_entry_id
  WHERE a.code=(SELECT cash_code FROM hist_ids) AND j.status='posted' AND j.id IN (SELECT open_sale_je FROM hist_ids UNION ALL SELECT open_receipt_je FROM hist_ids)),
 'ADMIN wallet balance equals owner balance minus the open shift only');
INSERT INTO historical_tap(result) SELECT ok(NOT has_function_privilege('anon','public.can_view_financial_entry_v2(uuid,boolean)','EXECUTE'),'anon cannot call the visibility helper');
INSERT INTO historical_tap(result) SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname='can_view_financial_entry_v1'),'v1 helper is dropped');
SELECT jsonb_build_object('tap',(SELECT jsonb_agg(result ORDER BY id) FROM historical_tap),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
