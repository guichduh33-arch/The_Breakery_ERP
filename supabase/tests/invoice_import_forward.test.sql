-- La réparation documentaire n'ouvre aucune mutation du registre financier importé.
BEGIN;
\ir helpers/invoice_forward.sql
SELECT no_plan();
INSERT INTO inf_state(tag) SELECT unnest(ARRAY['run','document','imported','key']);
INSERT INTO historical_import_runs(id,client_key,source_system,kind,batch_reference,payload_hash,preview_hash,actor_id,status,created_at)
 SELECT s.id,gen_random_uuid(),'INF-'||s.id,'purchases','Invoice forward import',repeat('a',64),repeat('b',64),
 a.profile_id,'applying',timestamptz '2026-10-30 23:59:59+08' FROM inf_state s CROSS JOIN inf_actor a
 WHERE s.tag='run' AND a.kind='owner';
SELECT set_config('breakery.historical_import_run',(SELECT id::text FROM inf_state WHERE tag='run'),true);
INSERT INTO historical_import_documents(id,run_id,source_system,kind,source_reference,source_hash,source_payload,entity_id,
 document_date,effective_at,time_precision,account_id,total_amount,created_at)
 SELECT d.id,r.id,'INF-'||r.id,'purchases','Invoice forward import',repeat('a',64),'{}',p.id,
 date '2026-10-01',timestamptz '2026-10-01 00:00+08','day',c.account_id,100,timestamptz '2026-10-30 23:59:59+08'
 FROM inf_state d CROSS JOIN inf_state r CROSS JOIN inf_state p CROSS JOIN inf_state cv
 JOIN expense_categories c ON c.id=cv.id WHERE d.tag='document' AND r.tag='run' AND p.tag='imported' AND cv.tag='category';
INSERT INTO purchase_orders(id,po_number,supplier_id,status,payment_terms,subtotal,total_amount,created_by,financial_import_document_id)
 SELECT p.id,'INF-'||p.id,s.id,'received','credit',100,100,a.profile_id,d.id
 FROM inf_state p CROSS JOIN inf_state s CROSS JOIN inf_state d CROSS JOIN inf_actor a
 WHERE p.tag='imported' AND s.tag='supplier' AND d.tag='document' AND a.kind='owner';
UPDATE historical_import_runs SET status='applied' WHERE id=(SELECT id FROM inf_state WHERE tag='run');
SELECT set_config('breakery.historical_import_run','',true);
SELECT ok(_imported_before_invoice_cutoff_v1('purchase_order',(SELECT id FROM inf_state WHERE tag='imported')),
 'existing trusted import registry proves pre-cutoff provenance');
SELECT is((SELECT invoice_exempt FROM purchase_orders WHERE id=(SELECT id FROM inf_state WHERE tag='imported')),false,
 'creating new record never manufactures a frozen exemption even with old fixture dates');
UPDATE inf_state SET path='purchase-orders/'||(SELECT id FROM inf_state WHERE tag='imported')||'/'||id||'.pdf' WHERE tag='key';
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'purchase-invoices',path,a.auth_id::text,'{"mimetype":"application/pdf","size":7}'
 FROM inf_state CROSS JOIN inf_actor a WHERE tag='key' AND a.kind='owner';
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='owner')); END $$;
SET LOCAL ROLE authenticated;
SELECT ok((set_po_invoice_v2((SELECT id FROM inf_state WHERE tag='imported'),(SELECT path FROM inf_state WHERE tag='key'),
 NULL,(SELECT id FROM inf_state WHERE tag='key'))->>'applied')::boolean,'invoice can be associated with imported order outside import context');
RESET ROLE;
SELECT is((SELECT total_amount FROM purchase_orders WHERE id=(SELECT id FROM inf_state WHERE tag='imported')),100::numeric,
 'invoice repair leaves imported amount unchanged');
SELECT throws_ok($q$UPDATE purchase_orders SET total_amount=101 WHERE id=(SELECT id FROM inf_state WHERE tag='imported')$q$,
 'P0003','financial_import_requires_dedicated_workflow','financial edits still require import workflow');
SELECT throws_ok($q$UPDATE purchase_orders SET invoice_path=NULL,total_amount=101 WHERE id=(SELECT id FROM inf_state WHERE tag='imported')$q$,
 'P0003','financial_import_requires_dedicated_workflow','invoice edit cannot smuggle financial changes');
SELECT throws_ok($q$UPDATE purchase_orders SET financial_import_document_id=NULL WHERE id=(SELECT id FROM inf_state WHERE tag='imported')$q$,
 'P0003','financial_import_marker_immutable','invoice repair never permits marker removal');
SELECT throws_ok($q$DELETE FROM purchase_orders WHERE id=(SELECT id FROM inf_state WHERE tag='imported')$q$,
 'P0003','financial_import_requires_dedicated_workflow','imported order cannot be deleted outside workflow');
SELECT throws_ok($q$UPDATE purchase_orders SET invoice_exempt=true WHERE id=(SELECT id FROM inf_state WHERE tag='imported')$q$,
 'P0003','financial_import_requires_dedicated_workflow','invoice-only exception excludes exemption mutation');
SELECT ok(NOT has_function_privilege('authenticated','public._historical_import_entity_guard_v3()','EXECUTE')
 AND NOT has_function_privilege('anon','public._historical_import_entity_guard_v3()','EXECUTE'),'import trigger helper is internal');
SELECT ok(to_regprocedure('public._historical_import_entity_guard_v1()') IS NULL
 AND to_regprocedure('public._historical_import_entity_guard_v2()') IS NULL,'both previous guard signatures are removed');
SELECT * FROM finish();
ROLLBACK;
