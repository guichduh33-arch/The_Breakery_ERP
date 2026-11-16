-- Réparation après paiements réels de fixture ; objets Storage simulés, rollback intégral.
BEGIN;
\ir helpers/invoice_forward.sql
SELECT no_plan();
SELECT pg_temp.invoice_po('partial'),pg_temp.invoice_po('complete'),pg_temp.invoice_po('locked');
INSERT INTO inf_state(tag) SELECT unnest(ARRAY['partial-old','complete-old','locked-old','partial-new','complete-new','race']);
UPDATE inf_state SET path='purchase-orders/'||(SELECT id FROM inf_state p WHERE p.tag=split_part(inf_state.tag,'-',1))||'/'||id||'.pdf'
 WHERE tag LIKE '%-old' OR tag LIKE '%-new';
UPDATE inf_state SET path='purchase-orders/'||(SELECT id FROM inf_state WHERE tag='locked')||'/'||id||'.pdf' WHERE tag='race';
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'purchase-invoices',s.path,a.auth_id::text,'{"mimetype":"application/pdf","size":7}'
 FROM inf_state s CROSS JOIN inf_actor a WHERE s.tag LIKE '%-old' AND a.kind='owner';
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='owner')); END $$;
SET LOCAL ROLE authenticated;
SELECT is(can_upload_po_invoice_v2(NULL),false,'unknown order returns strict false');
SELECT ok(can_upload_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked')),'unpaid valid target initially accepts upload');
SELECT ok((set_po_invoice_v2((SELECT id FROM inf_state WHERE tag=split_part(s.tag,'-',1)),
 s.path,NULL,s.id)->>'applied')::boolean,'initial invoice association: '||s.tag)
 FROM inf_state s WHERE s.tag LIKE '%-old';
SELECT lives_ok($q$SELECT record_po_payment_v2(p.id,CASE WHEN p.tag='complete' THEN 1000 ELSE 100 END,
 'cash',NULL,gen_random_uuid()) FROM inf_state p WHERE p.tag IN('partial','complete','locked')$q$,
 'fixtures settle partially and completely through the payment RPC');
SELECT is(can_upload_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked')),false,
 'first payment locks valid invoice even when cached upload permission was true');
SELECT throws_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'purchase-invoices',path,auth.uid()::text,'{"mimetype":"application/pdf","size":7}' FROM inf_state WHERE tag='race'$q$,
 '42501',NULL,'stale UI permission cannot upload after payment locks invoice');
UPDATE inf_state SET result=set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked'),path,
 (SELECT path FROM inf_state WHERE tag='locked-old'),id) WHERE tag='race';
SELECT is((SELECT result->>'applied' FROM inf_state WHERE tag='race'),'false','setter rechecks lock after cached permission');
RESET ROLE;
SELECT throws_ok($q$UPDATE purchase_orders SET invoice_path=NULL WHERE id=(SELECT id FROM inf_state WHERE tag='locked')$q$,
 '22023','invoice_locked_after_payment','direct privileged write cannot replace valid paid invoice');
-- Simuler une ancienne référence devenue invalide ; aucun privilège client n'est relâché.
UPDATE storage.objects SET metadata='{"mimetype":"image/png","size":7}'
 WHERE name IN(SELECT path FROM inf_state WHERE tag IN('partial-old','complete-old'));
UPDATE purchase_orders SET invoice_path=NULL WHERE id=(SELECT id FROM inf_state WHERE tag='complete');
SET LOCAL ROLE authenticated;
SELECT is(can_upload_po_invoice_v2((SELECT id FROM inf_state WHERE tag='partial')),true,
 'invalid invoice remains repairable after partial settlement');
SELECT is(can_upload_po_invoice_v2((SELECT id FROM inf_state WHERE tag='complete')),true,
 'missing invoice remains repairable after complete settlement');
SELECT lives_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'purchase-invoices',path,auth.uid()::text,'{"mimetype":"application/pdf","size":7}'
 FROM inf_state WHERE tag IN('partial-new','complete-new')$q$,'paid repair permissions allow fresh PDF upload metadata');
SELECT ok((set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='partial'),
 (SELECT path FROM inf_state WHERE tag='partial-new'),(SELECT path FROM inf_state WHERE tag='partial-old'),
 (SELECT id FROM inf_state WHERE tag='partial-new'))->>'applied')::boolean,'partial paid PO accepts replacement of invalid invoice');
SELECT ok((set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='complete'),
 (SELECT path FROM inf_state WHERE tag='complete-new'),NULL,
 (SELECT id FROM inf_state WHERE tag='complete-new'))->>'applied')::boolean,'fully paid PO accepts missing invoice repair');
SELECT is(can_upload_po_invoice_v2((SELECT id FROM inf_state WHERE tag='complete')),false,'repaired valid fully paid invoice is locked again');
SELECT ok((set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='complete'),
 (SELECT path FROM inf_state WHERE tag='complete-new'),NULL,
 (SELECT id FROM inf_state WHERE tag='complete-new'))->>'idempotent_replay')::boolean,'successful repair replays after lock');
SELECT throws_ok($q$SELECT set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='complete'),NULL,NULL,
 (SELECT id FROM inf_state WHERE tag='complete-new'))$q$,'22023','po_invoice_key_conflict','repair result binds payload');
SELECT is(set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='complete'),
 (SELECT path FROM inf_state WHERE tag='complete-old'),NULL,(SELECT id FROM inf_state WHERE tag='complete-old'))->>'invoice_path',
 (SELECT path FROM inf_state WHERE tag='complete-old'),'original association replay returns first result after repair');
RESET ROLE;
SELECT is((SELECT invoice_path FROM purchase_orders WHERE id=(SELECT id FROM inf_state WHERE tag='complete')),
 (SELECT path FROM inf_state WHERE tag='complete-new'),'old result replay never restores superseded invoice');
SELECT is((SELECT sum(amount) FROM purchase_payments WHERE purchase_order_id=(SELECT id FROM inf_state WHERE tag='complete')),
 1000::numeric,'repair does not change full paid amount');
SELECT is((SELECT count(*) FROM purchase_payments WHERE purchase_order_id IN(SELECT id FROM inf_state WHERE tag IN('partial','complete','locked'))),
 3::bigint,'repair and retries do not duplicate payments');
SELECT ok((SELECT bool_and(actor_id=(SELECT profile_id FROM inf_actor WHERE kind='owner')
 AND payload ? 'invoice_path' AND NOT metadata ? 'invoice_path') FROM audit_logs
 WHERE entity_id IN(SELECT id FROM inf_state WHERE tag IN('partial','complete','locked')) AND action='po.invoice_updated'),
 'invoice audit records profile actor, context and diff separately');
SELECT is((SELECT count(*) FROM audit_logs WHERE entity_id=(SELECT id FROM inf_state WHERE tag='complete') AND action='po.invoice_updated'),
 2::bigint,'repair emits one audit and replay emits none');
UPDATE storage.objects SET metadata='{"mimetype":"image/png","size":7}' WHERE name=(SELECT path FROM inf_state WHERE tag='locked-old');
SET LOCAL ROLE authenticated;
SELECT is(can_upload_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked')),true,'changed validity is evaluated server-side');
SELECT is(set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked'),(SELECT path FROM inf_state WHERE tag='race'),
 (SELECT path FROM inf_state WHERE tag='locked-old'),(SELECT id FROM inf_state WHERE tag='race')),
 (SELECT result||'{"idempotent_replay":true}' FROM inf_state WHERE tag='race'),
 'persisted race refusal remains exact even when repair later becomes possible');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='manager')); END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='complete'),
 (SELECT path FROM inf_state WHERE tag='complete-new'),NULL,(SELECT id FROM inf_state WHERE tag='complete-new'))$q$,
 '22023','po_invoice_key_conflict','another authorized payer cannot replay actor-bound result');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='stranger')); END $$;
SET LOCAL ROLE authenticated;
SELECT is(can_upload_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked')),false,'active session without rights returns strict false');
SELECT throws_ok($q$SELECT set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked'),NULL,NULL,gen_random_uuid())$q$,
 '42501','permission_denied','setter refuses caller without purchase permissions');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT is(can_upload_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked')),false,'no session returns strict false');
SELECT throws_ok($q$SELECT set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='locked'),NULL,NULL,gen_random_uuid())$q$,
 '28000','not_authenticated','association requires active PIN session');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon','public.can_upload_po_invoice_v2(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.set_po_invoice_v2(uuid,text,text,uuid)','EXECUTE'),
 'PO APIs revoke PUBLIC and anon access');
SELECT ok(NOT has_table_privilege('authenticated','public.po_invoice_results','INSERT')
 AND NOT has_table_privilege('authenticated','public.po_invoice_results','SELECT')
 AND NOT has_table_privilege('service_role','public.po_invoice_results','UPDATE'),
 'result ledger remains private and append-only for API roles');
SELECT * FROM finish();
ROLLBACK;
