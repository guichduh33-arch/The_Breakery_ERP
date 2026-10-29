-- Donnees preexistantes independantes ; leurs references peuvent se repeter ailleurs.
CREATE TEMP TABLE historical_background(run_id uuid,document_id uuid,payment_id uuid);
WITH r AS (
 INSERT INTO public.historical_import_runs(client_key,source_system,kind,batch_reference,payload_hash,preview_hash,actor_id,status)
 SELECT gen_random_uuid(),'other-historical-'||actor,'sales','existing',repeat('b',64),repeat('c',64),actor,'applied'
 FROM historical_fixture RETURNING id,source_system
), d AS (
 INSERT INTO public.historical_import_documents(run_id,source_system,kind,source_reference,source_hash,source_payload,entity_id,document_date,effective_at,time_precision,account_id,total_amount)
 SELECT id,source_system,'sales','SALE-1',repeat('b',64),'{}',gen_random_uuid(),date '2096-01-01',timestamptz '2096-01-01 00:00:00+08','day',resolve_mapping_account('SALE_POS_REVENUE'),1 FROM r
 RETURNING id,run_id,source_system
), p AS (
 INSERT INTO public.historical_import_payments(run_id,source_system,kind,source_reference,source_hash,source_payload,payment_date,effective_at,time_precision,amount,method)
 SELECT run_id,source_system,'sales','PAY-2',repeat('b',64),'{}',date '2096-01-01',timestamptz '2096-01-01 00:00:00+08','day',1,'cash' FROM d
 RETURNING id,run_id
)
INSERT INTO historical_background SELECT p.run_id,d.id,p.id FROM p JOIN d ON d.run_id=p.run_id;

-- Ces vues de recette ne masquent aucun objet public utilise par les RPC.
CREATE TEMP VIEW historical_test_runs AS
 SELECT r.* FROM public.historical_import_runs r
 JOIN historical_fixture f ON r.source_system=(f.payload->>'source_system');
CREATE TEMP VIEW historical_test_documents AS
 SELECT d.* FROM public.historical_import_documents d
 JOIN historical_fixture f ON d.source_system=(f.payload->>'source_system');
CREATE TEMP VIEW historical_test_payments AS
 SELECT p.* FROM public.historical_import_payments p
 JOIN historical_fixture f ON p.source_system=(f.payload->>'source_system');
CREATE TEMP VIEW historical_test_allocations AS
 SELECT a.* FROM public.historical_import_allocations a
 JOIN historical_test_documents d ON d.id=a.document_id;
CREATE TEMP VIEW historical_test_stock_effects AS
 SELECT e.* FROM public.historical_import_stock_effects e
 JOIN historical_test_runs r ON r.id=e.run_id;
INSERT INTO historical_tap(result) SELECT ok(EXISTS(SELECT 1 FROM public.historical_import_documents d
 JOIN historical_background b ON b.document_id=d.id WHERE d.source_reference='SALE-1'),
 'pre-existing import with the same source reference is present');
INSERT INTO historical_tap(result) SELECT is((SELECT count(*)::integer FROM historical_test_documents),0,
 'fixture scope excludes pre-existing historical documents');
