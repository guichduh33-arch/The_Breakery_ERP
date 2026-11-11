-- supabase/tests/reporting_owner_check_once.test.sql
-- reporting_private.closed_pos_orders_v1 teste le propriétaire UNE fois par
-- requête (sous-requête non corrélée) avant le contrôle par ligne.
--
-- CE QUE CETTE SUITE PROTÈGE : le raccourci ne change l'ensemble des lignes
-- visibles pour AUCUN compte. Le propriétaire voit tout ; un autre compte voit
-- exactement ce que rend le contrôle par ligne ; sans session, seul le B2B
-- reste. Fixture : une session ouverte aujourd'hui, une vente comptoir et une
-- commande B2B du jour — la vente comptoir d'un jour non clos doit rester
-- cachée à un non-propriétaire.
--
--   T1 : la vue porte le test propriétaire en sous-requête
--   T2 : propriétaire — toutes les commandes
--   T3 : non-propriétaire — exactement le contrôle par ligne
--   T4 : non-propriétaire — vente du jour non clos cachée, B2B visible
--   T5 : sans session — seulement le B2B
--   T6 : aucun droit direct pour authenticated, anon, PUBLIC
--   T7 : les vues dépendantes suivent (lignes de commande, ventes reconnues)
--
-- Lancé via mcp execute_sql enveloppé dans BEGIN/ROLLBACK — auto-nettoyant.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE TEMP TABLE roc_results(n serial, result text);
INSERT INTO roc_results(result) SELECT plan(7);

CREATE TEMP TABLE roc_ctx AS
SELECT o.id AS owner_id, o.auth_user_id AS owner_uid, s.auth_user_id AS staff_uid,
  gen_random_uuid() AS session_id, gen_random_uuid() AS o_counter, gen_random_uuid() AS o_b2b
FROM (SELECT id,auth_user_id FROM public.user_profiles WHERE role_code='SUPER_ADMIN' AND is_active
        AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1) o,
     (SELECT id,auth_user_id FROM public.user_profiles WHERE role_code<>'SUPER_ADMIN' AND is_active
        AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1) s;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM roc_ctx) THEN RAISE EXCEPTION 'missing_owner_or_staff_fixture'; END IF;
END $$;

-- Une session ouverte rend le jour non clos. La base de dev en porte souvent
-- une déjà (une seule session ouverte par compte) : on n'en crée une que s'il
-- n'y en a aucune, puis la fixture s'y rattache.
INSERT INTO public.pos_sessions(id,opened_by,opening_cash,opened_at,status)
SELECT session_id,owner_id,0,now() - interval '1 hour','open' FROM roc_ctx
WHERE NOT EXISTS(SELECT 1 FROM public.pos_sessions WHERE status<>'closed' OR closed_at IS NULL);
UPDATE roc_ctx SET session_id=(SELECT id FROM public.pos_sessions
  WHERE status<>'closed' OR closed_at IS NULL ORDER BY opened_at LIMIT 1);
INSERT INTO public.orders(id,order_number,order_type,status,subtotal,tax_amount,total,created_at,paid_at,session_id,served_by)
SELECT o_counter,'PGTAP-ROC-1','take_out'::order_type,'paid'::order_status,1000,0,1000,now(),now(),session_id,owner_id FROM roc_ctx UNION ALL
SELECT o_b2b,'PGTAP-ROC-2','b2b','b2b_pending',1000,0,1000,now(),NULL,NULL,owner_id FROM roc_ctx;
INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total)
SELECT o_counter,(SELECT id FROM public.products WHERE deleted_at IS NULL LIMIT 1),'roc',1000,1,1000 FROM roc_ctx;

-- Prend l'identité d'un compte (NULL = aucune session) pour la suite de la transaction.
CREATE FUNCTION pg_temp.roc_as(p uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  PERFORM set_config('request.jwt.claim.sub',COALESCE(p::text,''),true);
  PERFORM set_config('request.jwt.claims',CASE WHEN p IS NULL THEN '{}'
    ELSE jsonb_build_object('sub',p,'role','authenticated')::text END,true);
END $f$;

INSERT INTO roc_results(result) SELECT ok(
  pg_get_viewdef('reporting_private.closed_pos_orders_v1'::regclass, true) ~ '\(\s*SELECT\s+is_business_owner_v1\(\)',
  'T1: the view tests the owner in an uncorrelated subquery');

SELECT pg_temp.roc_as(owner_uid) FROM roc_ctx;
INSERT INTO roc_results(result) SELECT is(
  (SELECT count(*) FROM reporting_private.closed_pos_orders_v1),
  (SELECT count(*) FROM public.orders),
  'T2: the owner sees every order');
INSERT INTO roc_results(result) SELECT ok(
  (SELECT count(*) FROM reporting_private.closed_order_items_v1) = (SELECT count(*) FROM public.order_items)
  AND EXISTS(SELECT 1 FROM reporting_private.recognized_sales_v2 r, roc_ctx c WHERE r.id = c.o_counter),
  'T7: dependent views follow — every order line, and the paid fixture sale is recognized');

SELECT pg_temp.roc_as(staff_uid) FROM roc_ctx;
INSERT INTO roc_results(result) SELECT ok(
  NOT EXISTS (
    (SELECT id FROM reporting_private.closed_pos_orders_v1
     EXCEPT
     SELECT o.id FROM public.orders o WHERE o.order_type='b2b'
        OR public.can_view_sales_day_v1(coalesce(o.outstanding_at,o.paid_at,o.created_at)::date))
    UNION ALL
    (SELECT o.id FROM public.orders o WHERE o.order_type='b2b'
        OR public.can_view_sales_day_v1(coalesce(o.outstanding_at,o.paid_at,o.created_at)::date)
     EXCEPT
     SELECT id FROM reporting_private.closed_pos_orders_v1)),
  'T3: a non-owner sees exactly what the per-row check returns');
INSERT INTO roc_results(result) SELECT ok(
  NOT EXISTS(SELECT 1 FROM reporting_private.closed_pos_orders_v1 v WHERE v.id = c.o_counter)
  AND EXISTS(SELECT 1 FROM reporting_private.closed_pos_orders_v1 v WHERE v.id = c.o_b2b),
  'T4: a non-owner does not see a counter sale of an unclosed day, and sees the B2B order') FROM roc_ctx c;

SELECT pg_temp.roc_as(NULL);
INSERT INTO roc_results(result) SELECT is(
  (SELECT count(*) FROM reporting_private.closed_pos_orders_v1),
  (SELECT count(*) FROM public.orders WHERE order_type='b2b'),
  'T5: without a session only B2B orders remain');

INSERT INTO roc_results(result) SELECT ok(
  NOT has_table_privilege('authenticated','reporting_private.closed_pos_orders_v1','SELECT')
  AND NOT has_table_privilege('anon','reporting_private.closed_pos_orders_v1','SELECT')
  AND NOT has_table_privilege('public','reporting_private.closed_pos_orders_v1','SELECT'),
  'T6: no direct privilege for authenticated, anon or PUBLIC');

INSERT INTO roc_results(result) SELECT * FROM finish();
SELECT result FROM roc_results ORDER BY n;
ROLLBACK;
