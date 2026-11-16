-- Inventaire gelé simulé sous postgres ; les dates Storage ne prouvent rien.
BEGIN;
\ir helpers/invoice_forward.sql
SELECT no_plan();
SELECT pg_temp.invoice_expense('legacy'),pg_temp.invoice_expense('local'),pg_temp.invoice_expense('other');
INSERT INTO inf_state(tag) SELECT unnest(ARRAY['png','webp','local-key','pdf','bad','backdated','changed','zero','large','foreign']);
UPDATE inf_state SET path='expenses/'||(SELECT id FROM inf_state WHERE tag=CASE
 WHEN inf_state.tag IN('local-key','pdf') THEN 'local' ELSE 'legacy' END)||'/'||id||CASE
 WHEN tag IN('png','backdated','changed','local-key') THEN '.png' WHEN tag='webp' THEN '.webp' ELSE '.pdf' END
 WHERE tag NOT IN('category','supplier','legacy','local','other');
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata,created_at)
 SELECT 'expense-receipts',s.path,a.auth_id::text,jsonb_build_object('mimetype',CASE
 WHEN s.tag IN('png','changed','backdated') THEN 'image/png' WHEN s.tag='webp' THEN 'image/webp' ELSE 'application/pdf' END,
 'size',CASE WHEN s.tag='zero' THEN 0 WHEN s.tag='large' THEN 5242881 WHEN s.tag='pdf' THEN 5242880 ELSE 7 END),
 timestamptz '2020-01-01 00:00+08' FROM inf_state s CROSS JOIN inf_actor a
 WHERE s.tag IN('png','webp','changed','pdf','zero','large','foreign')
  AND a.kind=CASE WHEN s.tag='foreign' THEN 'stranger' ELSE 'owner' END;
-- Reproduire un objet recensé au cutover, sans modifier l'inventaire réel hors transaction.
INSERT INTO invoice_private.legacy_receipt_objects(object_id,bucket_id,name,owner_id,metadata_md5)
 SELECT o.id,o.bucket_id,o.name,o.owner_id,md5(o.metadata::text) FROM storage.objects o
 WHERE o.name IN(SELECT path FROM inf_state WHERE tag IN('png','webp','changed'));
UPDATE storage.objects SET metadata=metadata||'{"size":8}'::jsonb
 WHERE name=(SELECT path FROM inf_state WHERE tag='changed');
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata,created_at)
 SELECT 'expense-receipts',path,a.auth_id::text,'{"mimetype":"image/png","size":7}',
 timestamptz '2020-01-01 00:00+08' FROM inf_state CROSS JOIN inf_actor a WHERE tag='backdated' AND a.kind='owner';
SELECT ok(invoice_private.is_legacy_receipt((SELECT path FROM inf_state WHERE tag='png'),
 (SELECT auth_id FROM inf_actor WHERE kind='owner')),'frozen object identity proves legacy membership');
SELECT ok(NOT invoice_private.is_legacy_receipt((SELECT path FROM inf_state WHERE tag='backdated'),
 (SELECT auth_id FROM inf_actor WHERE kind='owner')),'backdated newly inserted object is not legacy');
SELECT ok(NOT invoice_private.is_legacy_receipt((SELECT path FROM inf_state WHERE tag='changed'),
 (SELECT auth_id FROM inf_actor WHERE kind='owner')),'metadata mutation invalidates frozen identity');
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='owner')); END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts','expenses/'||id||'/'||gen_random_uuid()||'.png',auth.uid()::text,
 '{"mimetype":"image/png","size":7}' FROM inf_state WHERE tag='legacy'$q$,
 '42501',NULL,'new PNG uploads are forbidden despite existing draft permissions');
SELECT throws_ok($q$INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts','expenses/'||id||'/'||gen_random_uuid()||'.webp',auth.uid()::text,
 '{"mimetype":"image/webp","size":7}' FROM inf_state WHERE tag='legacy'$q$,
 '42501',NULL,'new WebP uploads are forbidden');
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 'expenses/not-a-uuid/bad.png',NULL,gen_random_uuid())$q$,'22023','invalid_receipt_path','malformed legacy path is rejected');
SELECT is(set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='backdated'),NULL,(SELECT id FROM inf_state WHERE tag='backdated'))->>'reason',
 'legacy_upload_unavailable','forged old timestamp cannot authorize PNG association');
SELECT is(set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='changed'),NULL,(SELECT id FROM inf_state WHERE tag='changed'))->>'reason',
 'legacy_upload_unavailable','changed inventoried object receives a terminal refusal');
SELECT ok((set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='png'),NULL,(SELECT id FROM inf_state WHERE tag='png'))->>'applied')::boolean,
 'owned frozen PNG can recover its interrupted association');
SELECT ok((set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='webp'),(SELECT path FROM inf_state WHERE tag='png'),
 (SELECT id FROM inf_state WHERE tag='webp'))->>'applied')::boolean,'owned frozen WebP can replace draft reference');
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='zero'),(SELECT path FROM inf_state WHERE tag='webp'),
 (SELECT id FROM inf_state WHERE tag='zero'))$q$,'22023','invalid_receipt_file','zero-byte metadata is refused');
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='large'),(SELECT path FROM inf_state WHERE tag='webp'),
 (SELECT id FROM inf_state WHERE tag='large'))$q$,'22023','invalid_receipt_file','size above five MiB is refused');
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='foreign'),(SELECT path FROM inf_state WHERE tag='webp'),
 (SELECT id FROM inf_state WHERE tag='foreign'))$q$,'42501','receipt_object_owner_mismatch','association validates object ownership');
UPDATE inf_state SET result=set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='local'),path,NULL,id) WHERE tag='local-key';
SELECT is((SELECT result->>'reason' FROM inf_state WHERE tag='local-key'),'legacy_upload_unavailable',
 'local-only interrupted legacy attempt ends with successful JSON refusal');
SELECT is((SELECT result->>'applied' FROM inf_state WHERE tag='local-key'),'false','terminal refusal never applies reference');
SELECT ok((SELECT result ? 'receipt_path' AND result->'receipt_path'='null'::jsonb FROM inf_state WHERE tag='local-key'),
 'terminal refusal returns actual null reference');
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='local'),
 NULL,NULL,(SELECT id FROM inf_state WHERE tag='local-key'))$q$,'22023','expense_receipt_key_conflict','terminal key binds payload');
SELECT ok((set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='local'),
 (SELECT path FROM inf_state WHERE tag='pdf'),NULL,(SELECT id FROM inf_state WHERE tag='pdf'))->>'applied')::boolean,
 'next JPEG/PDF attempt uses a fresh key and succeeds');
SELECT is(set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='local'),
 (SELECT path FROM inf_state WHERE tag='local-key'),NULL,(SELECT id FROM inf_state WHERE tag='local-key')),
 (SELECT result||'{"idempotent_replay":true}' FROM inf_state WHERE tag='local-key'),
 'terminal refusal replays exact first result after reference changes');
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='other'),
 NULL,NULL,(SELECT id FROM inf_state WHERE tag='pdf'))$q$,'22023','expense_receipt_key_conflict','same key cannot target another expense');
RESET ROLE;
UPDATE expenses SET status='submitted' WHERE id=(SELECT id FROM inf_state WHERE tag='legacy');
SET LOCAL ROLE authenticated;
SELECT is(set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='png'),NULL,(SELECT id FROM inf_state WHERE tag='png'))->>'receipt_path',
 (SELECT path FROM inf_state WHERE tag='png'),'old result replays before new status or file validation');
SELECT ok((set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='legacy'),
 (SELECT path FROM inf_state WHERE tag='webp'),NULL,gen_random_uuid())->>'applied')::boolean,
 'existing current legacy reference is confirmed without new upload');
RESET ROLE;
SELECT is((SELECT count(*) FROM expense_receipt_results WHERE expense_id=(SELECT id FROM inf_state WHERE tag='local')),
 2::bigint,'terminal result and next successful result are each durable exactly once');
SELECT is((SELECT count(*) FROM audit_logs WHERE entity_id=(SELECT id FROM inf_state WHERE tag='local')
 AND action='expense.receipt_updated'),1::bigint,'refusal and replay create no reference audit');
SELECT ok((SELECT bool_and(actor_id=(SELECT profile_id FROM inf_actor WHERE kind='owner')
 AND payload ? 'receipt_url' AND NOT metadata ? 'receipt_url') FROM audit_logs
 WHERE entity_id IN(SELECT id FROM inf_state WHERE tag IN('local','legacy')) AND action='expense.receipt_updated'),
 'audit uses profile actor and preserves context/diff separation');
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='manager')); END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='local'),
 (SELECT path FROM inf_state WHERE tag='local-key'),NULL,(SELECT id FROM inf_state WHERE tag='local-key'))$q$,
 '22023','expense_receipt_key_conflict','another authorized actor cannot replay terminal key');
RESET ROLE;
SELECT pg_temp.invoice_expense('payer-expense','approved');
INSERT INTO inf_state(tag) VALUES('payer-key');
UPDATE inf_state SET path='expenses/'||(SELECT id FROM inf_state WHERE tag='payer-expense')||'/'||id||'.pdf' WHERE tag='payer-key';
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
 SELECT 'expense-receipts',path,a.auth_id::text,'{"mimetype":"application/pdf","size":7}'
 FROM inf_state CROSS JOIN inf_actor a WHERE tag='payer-key' AND a.kind='payer';
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='payer')); END $$;
SET LOCAL ROLE authenticated;
SELECT ok((set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='payer-expense'),
 (SELECT path FROM inf_state WHERE tag='payer-key'),NULL,(SELECT id FROM inf_state WHERE tag='payer-key'))->>'applied')::boolean,
 'payer without manage can associate approved missing invoice');
RESET ROLE;
UPDATE expenses SET status='paid' WHERE id=(SELECT id FROM inf_state WHERE tag='payer-expense');
SET LOCAL ROLE authenticated;
SELECT ok((set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='payer-expense'),
 (SELECT path FROM inf_state WHERE tag='payer-key'),NULL,(SELECT id FROM inf_state WHERE tag='payer-key'))->>'idempotent_replay')::boolean,
 'payer can replay exact own association result after expense becomes paid');
RESET ROLE;
DO $$ BEGIN PERFORM pg_temp.authenticate_pin((SELECT auth_id FROM inf_actor WHERE kind='stranger')); END $$;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='local'),NULL,NULL,gen_random_uuid())$q$,
 '42501','permission_denied','active stranger cannot change private receipt');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$SELECT set_expense_receipt_v3((SELECT id FROM inf_state WHERE tag='local'),NULL,NULL,gen_random_uuid())$q$,
 '28000','not_authenticated','receipt association requires active PIN session');
SELECT throws_ok($q$SELECT pay_expense_v6((SELECT id FROM inf_state WHERE tag='local'))$q$,
 '28000','pay_expense_v6: caller not authenticated','payment validates session before accessing expense status');
RESET ROLE;
SELECT ok(NOT has_schema_privilege('authenticated','invoice_private','USAGE')
 AND NOT has_table_privilege('service_role','invoice_private.legacy_receipt_objects','INSERT'),
 'cutover inventory cannot be client-forged, including service API role');
SELECT ok(NOT has_function_privilege('authenticated','invoice_private.is_legacy_receipt(text,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.set_expense_receipt_v3(uuid,text,text,uuid)','EXECUTE'),
 'legacy evaluator is internal and anon has no inherited execute');
SELECT * FROM finish();
ROLLBACK;
