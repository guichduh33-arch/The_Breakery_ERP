-- supabase/tests/b2b_sales_recognized_at_order_date.test.sql
-- ADR-049 — une vente B2B entre dans les rapports de ventes à sa date de commande.
--
-- CE QUE CETTE SUITE PROTÈGE :
-- - `recognized_sales_v2` reconnaît une commande B2B à `created_at`, qu'elle soit
--   impayée (`b2b_pending`) ou soldée plus tard (`paid`) ; une B2B annulée reste
--   dehors ;
-- - la règle de caisse est inchangée : ardoise à `outstanding_at`, vente payée à
--   `paid_at` ;
-- - le rapport PB1 garde l'ancienne règle (B2B au solde, B2B impayée absente),
--   via `pb1_recognized_sales_v1`, sans droit direct pour les rôles applicatifs ;
-- - la famille `get_pb1_report` est passée en v8, la v7 a disparu, droits identiques.
--
--   T1  : B2B impayée reconnue à la date de commande
--   T2  : B2B soldée plus tard reconnue à la date de commande
--   T3  : B2B annulée absente
--   T4  : ardoise de caisse reconnue à outstanding_at
--   T5  : vente de caisse payée reconnue à paid_at
--   T6  : PB1 — B2B impayée absente
--   T7  : PB1 — B2B soldée reconnue au jour du solde
--   T8  : PB1 — ardoise et vente de caisse identiques à la projection partagée
--   T9  : aucun droit direct sur la vue PB1 pour authenticated, anon, PUBLIC
--   T10 : get_pb1_report_v8 présente, v7 absente, exécutable par authenticated, pas par anon
--
-- Lancé via mcp execute_sql : le verdict sort par RAISE EXCEPTION si un test échoue,
-- et le ROLLBACK final nettoie la fixture.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE TEMP TABLE b2r_results(n serial, result text);
INSERT INTO b2r_results(result) SELECT plan(10);

CREATE TEMP TABLE b2r_ctx AS
SELECT o.id AS owner_id, o.auth_user_id AS owner_uid,
  (SELECT id FROM public.customers WHERE deleted_at IS NULL ORDER BY id LIMIT 1) AS customer_id,
  (SELECT id FROM public.pos_sessions ORDER BY opened_at LIMIT 1) AS session_id,
  gen_random_uuid() AS b2b_pending, gen_random_uuid() AS b2b_paid, gen_random_uuid() AS b2b_voided,
  gen_random_uuid() AS tab, gen_random_uuid() AS counter,
  timestamptz '2026-10-10 10:00+08' AS d_order,
  timestamptz '2026-10-11 09:00+08' AS d_tab,
  timestamptz '2026-10-20 15:00+08' AS d_paid
FROM public.user_profiles o
WHERE o.role_code='SUPER_ADMIN' AND o.is_active AND o.deleted_at IS NULL AND o.auth_user_id IS NOT NULL
ORDER BY o.id LIMIT 1;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM b2r_ctx WHERE customer_id IS NOT NULL AND session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'missing_owner_customer_or_session_fixture';
  END IF;
END $$;

INSERT INTO public.orders(id,order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,voided_at,voided_by,void_reason,outstanding_at,customer_id,session_id,served_by)
SELECT b2b_pending,'PGTAP-B2R-1','b2b'::order_type,'b2b_pending'::order_status,1000,0,1000,d_order,NULL::timestamptz,NULL::timestamptz,NULL::uuid,NULL::text,NULL::timestamptz,customer_id,NULL::uuid,owner_id FROM b2r_ctx UNION ALL
SELECT b2b_paid,  'PGTAP-B2R-2','b2b','paid',       2000,0,2000,d_order,d_paid,NULL,NULL,NULL,NULL,customer_id,NULL::uuid,owner_id FROM b2r_ctx UNION ALL
SELECT b2b_voided,'PGTAP-B2R-3','b2b','voided',     3000,0,3000,d_order,NULL,d_paid,owner_id,'pgtap void',NULL,customer_id,NULL::uuid,owner_id FROM b2r_ctx UNION ALL
SELECT tab,       'PGTAP-B2R-4','take_out','pending_payment',4000,0,4000,d_order,NULL,NULL,NULL,NULL,d_tab,customer_id,session_id,owner_id FROM b2r_ctx UNION ALL
SELECT counter,   'PGTAP-B2R-5','take_out','paid',  5000,0,5000,d_order,d_paid,NULL,NULL,NULL,NULL,NULL,session_id,owner_id FROM b2r_ctx;

-- Le propriétaire voit toutes les journées : la projection n'est pas filtrée.
SELECT set_config('request.jwt.claim.sub',owner_uid::text,true),
       set_config('request.jwt.claims',jsonb_build_object('sub',owner_uid,'role','authenticated')::text,true)
FROM b2r_ctx;

INSERT INTO b2r_results(result) SELECT is(
  (SELECT r.recognized_at FROM reporting_private.recognized_sales_v2 r WHERE r.id=c.b2b_pending), c.d_order,
  'T1: an unpaid B2B order is recognized at its order date') FROM b2r_ctx c;
INSERT INTO b2r_results(result) SELECT is(
  (SELECT r.recognized_at FROM reporting_private.recognized_sales_v2 r WHERE r.id=c.b2b_paid), c.d_order,
  'T2: a B2B order settled later is recognized at its order date') FROM b2r_ctx c;
INSERT INTO b2r_results(result) SELECT ok(
  NOT EXISTS(SELECT 1 FROM reporting_private.recognized_sales_v2 r WHERE r.id=c.b2b_voided),
  'T3: a voided B2B order is not recognized') FROM b2r_ctx c;
INSERT INTO b2r_results(result) SELECT is(
  (SELECT r.recognized_at FROM reporting_private.recognized_sales_v2 r WHERE r.id=c.tab), c.d_tab,
  'T4: a counter tab is still recognized at outstanding_at') FROM b2r_ctx c;
INSERT INTO b2r_results(result) SELECT is(
  (SELECT r.recognized_at FROM reporting_private.recognized_sales_v2 r WHERE r.id=c.counter), c.d_paid,
  'T5: a paid counter sale is still recognized at paid_at') FROM b2r_ctx c;

INSERT INTO b2r_results(result) SELECT ok(
  NOT EXISTS(SELECT 1 FROM reporting_private.pb1_recognized_sales_v1 r WHERE r.id=c.b2b_pending),
  'T6: PB1 keeps the previous rule — an unpaid B2B order is absent') FROM b2r_ctx c;
INSERT INTO b2r_results(result) SELECT is(
  (SELECT r.recognized_at FROM reporting_private.pb1_recognized_sales_v1 r WHERE r.id=c.b2b_paid), c.d_paid,
  'T7: PB1 keeps the previous rule — a settled B2B order counts on its settlement day') FROM b2r_ctx c;
INSERT INTO b2r_results(result) SELECT ok(
  (SELECT array_agg(r.recognized_at ORDER BY r.id) FROM reporting_private.pb1_recognized_sales_v1 r WHERE r.id IN (c.tab,c.counter))
  = (SELECT array_agg(r.recognized_at ORDER BY r.id) FROM reporting_private.recognized_sales_v2 r WHERE r.id IN (c.tab,c.counter))
  AND (SELECT count(*) FROM reporting_private.pb1_recognized_sales_v1 r WHERE r.id IN (c.tab,c.counter)) = 2,
  'T8: PB1 and the shared projection agree on counter tabs and counter sales') FROM b2r_ctx c;

INSERT INTO b2r_results(result) SELECT ok(
  NOT has_table_privilege('authenticated','reporting_private.pb1_recognized_sales_v1','SELECT')
  AND NOT has_table_privilege('anon','reporting_private.pb1_recognized_sales_v1','SELECT')
  AND NOT has_table_privilege('public','reporting_private.pb1_recognized_sales_v1','SELECT'),
  'T9: no direct privilege on the PB1 projection for authenticated, anon or PUBLIC');

INSERT INTO b2r_results(result) SELECT ok(
  to_regprocedure('public.get_pb1_report_v8(integer,integer)') IS NOT NULL
  AND to_regprocedure('public.get_pb1_report_v7(integer,integer)') IS NULL
  AND has_function_privilege('authenticated','public.get_pb1_report_v8(integer,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_pb1_report_v8(integer,integer)','EXECUTE'),
  'T10: get_pb1_report_v8 replaces v7 with the same privileges');

INSERT INTO b2r_results(result) SELECT * FROM finish();
DO $$ BEGIN
  IF num_failed() > 0 THEN
    RAISE EXCEPTION 'b2b_sales_recognized_at_order_date: % failed — %', num_failed(),
      (SELECT string_agg(result, ' | ' ORDER BY n) FROM b2r_results WHERE result LIKE 'not ok%');
  END IF;
END $$;
SELECT result FROM b2r_results ORDER BY n;
ROLLBACK;
