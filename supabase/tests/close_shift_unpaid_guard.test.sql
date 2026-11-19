-- Une caisse ne se clôture pas en laissant une commande impayée derrière elle
-- (close_shift_v15), et le dashboard sépare les ardoises des commandes en
-- salle (get_dashboard_open_orders_v4). Constat production du 2026-11-16.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

DO $fixture$
DECLARE
  a uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  a3 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid();
  o_open uuid := gen_random_uuid(); o_tab uuid := gen_random_uuid();
  owner_role text; owner_claims text; before jsonb;
BEGIN
  SELECT code INTO owner_role FROM roles ORDER BY code LIMIT 1;
  -- Une seule session ouverte par utilisateur : chaque caisse a son titulaire.
  INSERT INTO auth.users(id) VALUES(a),(a2),(a3);
  INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash)
    SELECT x.p, x.a, owner_role, 'Unpaid guard fixture', 'UPG-' || left(x.p::text,8), true,
           extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf'))
      FROM (VALUES (p,a),(p2,a2),(p3,a3)) AS x(p,a);
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    VALUES(p,'shift.close',true,'Regression fixture');

  -- Les ventes d'un jour encore ouvert ne se lisent que par le propriétaire
  -- (reporting_private.closed_pos_orders_v1) : le dashboard se lit sous lui.
  SELECT jsonb_build_object('sub',up.auth_user_id,'role','authenticated')::text INTO owner_claims
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND up.role_code = 'SUPER_ADMIN'
   ORDER BY up.created_at, up.id LIMIT 1;
  IF owner_claims IS NULL THEN
    RAISE EXCEPTION 'fixture: no active SUPER_ADMIN to read the dashboard';
  END IF;
  -- Seulement `request.jwt.claims` : `claim.sub` primerait sur les changements d'acteur.
  PERFORM set_config('request.jwt.claims',owner_claims,true);
  before := get_dashboard_open_orders_v4();
  PERFORM set_config('upg.before',before::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);

  INSERT INTO pos_sessions(id,opened_by,opening_cash,status) VALUES(s1,p,0,'open'),(s2,p2,0,'open'),(s3,p3,0,'open');
  -- s1 : une commande ouverte impayée, puis ce que la garde doit ignorer :
  -- une commande en attente, une annulée, une reprise d'historique.
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total)
    VALUES(o_open,'UPG-OPEN-'||left(o_open::text,8),s1,'pending_payment','pos','take_out',30000,0,30000);
  INSERT INTO orders(order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,is_held)
    VALUES('UPG-HELD-'||left(gen_random_uuid()::text,8),s1,'pending_payment','pos','take_out',20000,0,20000,true);
  INSERT INTO orders(order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,voided_at,voided_by,void_reason)
    VALUES('UPG-VOID-'||left(gen_random_uuid()::text,8),s1,'voided','pos','take_out',15000,0,15000,now(),p,'Regression fixture');
  INSERT INTO orders(order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,is_historical_import)
    VALUES('UPG-HIST-'||left(gen_random_uuid()::text,8),s1,'pending_payment','pos','take_out',12000,0,12000,true);
  -- s2 : seulement une ardoise.
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,outstanding_at)
    VALUES(o_tab,'UPG-TAB-'||left(o_tab::text,8),s2,'pending_payment','pos','take_out',40000,0,40000,now());
  -- s3 : une commande tablette prise en charge, encore au statut `draft`.
  INSERT INTO orders(order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,sent_to_kitchen_at)
    VALUES('UPG-DRAFT-'||left(gen_random_uuid()::text,8),s3,'draft','tablet','dine_in',25000,0,25000,now());

  PERFORM set_config('upg.s1',s1::text,true);
  PERFORM set_config('upg.s2',s2::text,true);
  PERFORM set_config('upg.s3',s3::text,true);
  PERFORM set_config('upg.open',o_open::text,true);
  PERFORM set_config('upg.tab',o_tab::text,true);
  PERFORM set_config('upg.actor',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  PERFORM set_config('upg.owner',owner_claims,true);
END $fixture$;

-- Dashboard : la commande ouverte est sur le plancher, l'ardoise non.
SELECT set_config('request.jwt.claims', current_setting('upg.owner'), true);
CREATE TEMP TABLE upg_after AS SELECT get_dashboard_open_orders_v4() AS r;
SELECT ok(
  (SELECT r->'orders' FROM upg_after) @> jsonb_build_array(jsonb_build_object('id', current_setting('upg.open'))),
  'T1: an unpaid open order is listed on the floor');
SELECT ok(
  NOT ((SELECT r->'orders' FROM upg_after) @> jsonb_build_array(jsonb_build_object('id', current_setting('upg.tab')))),
  'T2: a tab (outstanding) is not listed on the floor');
SELECT is(
  (SELECT (r->>'outstanding_count')::int FROM upg_after) - (current_setting('upg.before')::jsonb->>'outstanding_count')::int,
  1, 'T3a: exactly one more tab is counted apart');
SELECT is(
  (SELECT (r->>'outstanding_total')::numeric FROM upg_after) - (current_setting('upg.before')::jsonb->>'outstanding_total')::numeric,
  40000::numeric, 'T3b: the tab amount is counted apart');
SELECT is(
  (SELECT (r->>'open_count')::int FROM upg_after) - (current_setting('upg.before')::jsonb->>'open_count')::int,
  2, 'T3c: the floor gains the open order and the draft only');

-- Clôture : bloquée tant que la commande ouverte existe.
SELECT set_config('request.jwt.claims', current_setting('upg.actor'), true);
SELECT throws_ok(
  format($$SELECT close_shift_v15(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s1')),
  'P0001', 'unpaid_orders_open',
  'T4: close_shift_v15 refuses a shift with an unpaid open order');
SELECT throws_ok(
  format($$SELECT close_shift_v13(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s1')),
  'P0001', 'unpaid_orders_open',
  'T5: the close_shift_v13 envelope goes through the same guard');
SELECT is(
  (SELECT status::text FROM pos_sessions WHERE id = current_setting('upg.s1')::uuid),
  'open', 'T6: the refused shift stays open');
SELECT throws_ok(
  format($$SELECT close_shift_v15(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s3')),
  'P0001', 'unpaid_orders_open',
  'T7: a picked-up tablet order still in draft also blocks the close');

-- Une fois la commande ouverte mise en attente, la clôture passe : l'attente,
-- l'annulation et la reprise d'historique ne bloquent pas.
UPDATE orders SET is_held = true WHERE id = current_setting('upg.open')::uuid;
SELECT lives_ok(
  format($$SELECT close_shift_v15(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s1')),
  'T8: held, voided and historical orders do not block the close');
SELECT is(
  (SELECT status::text FROM pos_sessions WHERE id = current_setting('upg.s1')::uuid),
  'closed', 'T9: the shift is closed');

-- Une ardoise ne bloque pas.
SELECT lives_ok(
  format($$SELECT close_shift_v10(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s2')),
  'T10: a tab does not block the close (through the v10 envelope)');

-- Droits et versions.
SELECT ok(NOT has_function_privilege('anon','public.close_shift_v15(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb)','EXECUTE'),
  'T11: anon cannot close a shift');
SELECT ok(NOT has_function_privilege('anon','public.get_dashboard_open_orders_v4()','EXECUTE'),
  'T12: anon cannot read the open orders panel');
SELECT ok(to_regprocedure('public.get_dashboard_open_orders_v3()') IS NULL,
  'T13: the previous dashboard version is removed');

SELECT * FROM finish();
ROLLBACK;
