-- Compatibilité des anciennes attentes et refus sans effet de bord.
BEGIN;
\ir helpers/display_loss_fixture.sql
INSERT INTO stock_declarations(operation,product_id,quantity,baseline_quantity,reason,declared_by,idempotency_key)
 SELECT 'display_waste',p.id,2,10,'Legacy display loss',a.id,p.key FROM loss_products p CROSS JOIN loss_actors a WHERE p.kind='legacy' AND a.kind='cashier';
INSERT INTO stock_declarations(operation,product_id,quantity,baseline_quantity,reason,declared_by,idempotency_key,status,reviewed_by,reviewed_at,rejection_reason)
 SELECT 'display_waste',p.id,2,10,'Legacy rejected loss',a.id,p.key,'rejected',o.id,now(),'Legacy rejection'
 FROM loss_products p CROSS JOIN loss_actors a CROSS JOIN loss_actors o WHERE p.kind='rejected' AND a.kind='cashier' AND o.kind='owner';
SELECT pg_temp.authenticate_pin((SELECT uid FROM loss_actors WHERE kind='cashier'));
SET LOCAL ROLE authenticated;
INSERT INTO loss_payload SELECT 'legacy_retry',waste_display_stock_v4(id,2,'Legacy display loss',key) FROM loss_products WHERE kind='legacy';
INSERT INTO loss_results(tap) SELECT is((SELECT value->>'display_withdrawal_applied' FROM loss_payload WHERE name='legacy_retry'),'false','Legacy retry reports that withdrawal is still deferred');
INSERT INTO loss_results(tap) SELECT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(get_stock_declarations_v1()) d WHERE d->>'id'=(SELECT value->>'declaration_id' FROM loss_payload WHERE name='legacy_retry') AND d->>'display_withdrawal_applied'='false' AND NOT d ?| ARRAY['baseline_quantity','result']),'Masked declaration list exposes only the withdrawal marker');
INSERT INTO loss_payload SELECT 'legacy_rejected_retry',waste_display_stock_v4(id,2,'Legacy rejected loss',key) FROM loss_products WHERE kind='rejected';
INSERT INTO loss_results(tap) SELECT ok((SELECT value @> '{"status":"rejected","display_withdrawal_applied":false,"idempotent_replay":true}'::jsonb FROM loss_payload WHERE name='legacy_rejected_retry'),'Legacy rejected replay stays rejected without withdrawal');
RESET ROLE;
INSERT INTO loss_results(tap) SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT id FROM loss_products WHERE kind='legacy')),10::numeric,'Legacy retry never invents an immediate withdrawal');
INSERT INTO loss_results(tap) SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT id FROM loss_products WHERE kind='rejected')),10::numeric,'Legacy rejected replay leaves shelf unchanged');
SELECT pg_temp.authenticate_pin((SELECT uid FROM loss_actors WHERE kind='owner'));
SET LOCAL ROLE authenticated;
SELECT approve_stock_declaration_v3((SELECT (value->>'declaration_id')::uuid FROM loss_payload WHERE name='legacy_retry'));
INSERT INTO loss_payload SELECT 'legacy_approval_retry',approve_stock_declaration_v3((SELECT (value->>'declaration_id')::uuid FROM loss_payload WHERE name='legacy_retry'));
INSERT INTO loss_results(tap) SELECT ok((SELECT (value->>'idempotent_replay')::boolean FROM loss_payload WHERE name='legacy_approval_retry'),'Legacy approval replay is idempotent');
RESET ROLE;
INSERT INTO loss_results(tap) SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT id FROM loss_products WHERE kind='legacy')),8::numeric,'Legacy first approval removes shelf loss once');
INSERT INTO loss_results(tap) SELECT is((SELECT current_stock FROM products WHERE id=(SELECT id FROM loss_products WHERE kind='legacy')),8::numeric,'Legacy approval removes global loss once');
INSERT INTO loss_results(tap) SELECT ok((SELECT display_withdrawal_applied FROM stock_declarations WHERE id=(SELECT (value->>'declaration_id')::uuid FROM loss_payload WHERE name='legacy_retry')),'Legacy approval durably marks shelf withdrawal');
INSERT INTO loss_results(tap) SELECT is((SELECT count(*) FROM display_movements WHERE product_id=(SELECT id FROM loss_products WHERE kind='legacy')),1::bigint,'Legacy approval has exactly one shelf ledger entry');
INSERT INTO loss_results(tap) SELECT is((SELECT count(*) FROM stock_movements WHERE product_id=(SELECT id FROM loss_products WHERE kind='legacy')),1::bigint,'Legacy approval has exactly one global ledger entry');
SELECT pg_temp.authenticate_pin((SELECT uid FROM loss_actors WHERE kind='owner'));
SET LOCAL ROLE authenticated;
INSERT INTO loss_payload SELECT 'own',waste_display_stock_v4(id,1,'Owner physical loss',key) FROM loss_products WHERE kind='owner';
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT approve_stock_declaration_v3(%L)',(SELECT value->>'declaration_id' FROM loss_payload WHERE name='own')),'P0003','independent_approver_required','Owner cannot approve own declaration');
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT reject_stock_declaration_v1(%L,%L)',(SELECT value->>'declaration_id' FROM loss_payload WHERE name='own'),'Own rejection'),'P0003','independent_approver_required','Owner cannot reject own declaration');
RESET ROLE;
SELECT pg_temp.authenticate_pin((SELECT uid FROM loss_actors WHERE kind='denied'));
SET LOCAL ROLE authenticated;
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT waste_display_stock_v4(%L,1,%L,%L)',id,'Denied loss',key),'P0003','forbidden','Explicit permission deny overrides cashier grant') FROM loss_products WHERE kind='main';
RESET ROLE;
DELETE FROM display_stock WHERE product_id=(SELECT id FROM loss_products WHERE kind='missing');
SELECT pg_temp.authenticate_pin((SELECT uid FROM loss_actors WHERE kind='cashier'));
SET LOCAL ROLE authenticated;
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT waste_display_stock_v4(%L,1,%L,%L)',id,'Missing shelf',key),'P0001','display_stock_not_found','Missing shelf row fails atomically') FROM loss_products WHERE kind='missing';
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT waste_display_stock_v4(%L,1,%L,%L)',id,'Wrong product',key),'P0002','product_not_found','Non-display product rejected') FROM loss_products WHERE kind='non_display';
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT waste_display_stock_v4(%L,%L::numeric,%L,%L)',(SELECT id FROM loss_products WHERE kind='main'),q,'Invalid loss',gen_random_uuid()),'22023','invalid_quantity','Invalid quantity rejected: '||COALESCE(q::text,'NULL')) FROM unnest(ARRAY[NULL::numeric,0,-1,'NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric,1.0001,10000000]) q;
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT waste_display_stock_v4(%L,9999999.999,%L,%L)',id,'Valid maximum',key),'P0001','insufficient_display_stock','Largest storable quantity reaches availability guard') FROM loss_products WHERE kind='main';
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT waste_display_stock_v4(%L,1,%L,NULL)',id,'Missing key'),'22023','idempotency_key_required','Request key required') FROM loss_products WHERE kind='main';
INSERT INTO loss_results(tap) SELECT throws_ok(format('SELECT waste_display_stock_v4(%L,1,%L,%L)',id,'no',key),'P0001','reason_required','Reason required') FROM loss_products WHERE kind='main';
RESET ROLE;
INSERT INTO loss_results(tap) SELECT is((SELECT current_stock FROM products WHERE id=(SELECT id FROM loss_products WHERE kind='main')),10::numeric,'All validation failures preserve global stock');
INSERT INTO loss_results(tap) SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT id FROM loss_products WHERE kind='main')),10::numeric,'All validation failures preserve shelf stock');
INSERT INTO loss_results(tap) SELECT is((SELECT count(*) FROM stock_declarations WHERE product_id IN(SELECT id FROM loss_products WHERE kind IN('main','missing','non_display'))),0::bigint,'Rejected requests leave no declarations');
INSERT INTO loss_results(tap) SELECT ok(NOT has_function_privilege('anon','public.submit_stock_declaration_v2(text,uuid,numeric,text,uuid)','EXECUTE'),'Anon cannot submit declaration');
INSERT INTO loss_results(tap) SELECT ok(NOT has_function_privilege('anon','public.approve_stock_declaration_v3(uuid)','EXECUTE'),'Anon cannot approve declaration');
INSERT INTO loss_results(tap) SELECT ok(to_regprocedure('public.submit_stock_declaration_v1(text,uuid,numeric,text,uuid)') IS NULL AND to_regprocedure('public.approve_stock_declaration_v2(uuid)') IS NULL,'Replaced declaration signatures are removed');
INSERT INTO loss_results(tap) SELECT * FROM finish();
SELECT count(*) FILTER(WHERE tap LIKE 'not ok%') failures,jsonb_agg(tap ORDER BY seq) lines FROM loss_results;
ROLLBACK;
