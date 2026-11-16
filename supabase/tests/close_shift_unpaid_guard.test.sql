-- Une caisse ne se clôture pas en laissant une commande impayée derrière elle
-- (close_shift_v14), et le dashboard sépare les ardoises des commandes en
-- salle (get_dashboard_open_orders_v4). Constat production du 2026-11-16.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

DO $fixture$
DECLARE
  a uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  o_open uuid := gen_random_uuid(); o_held uuid := gen_random_uuid(); o_tab uuid := gen_random_uuid();
  owner_role text;
BEGIN
  SELECT code INTO owner_role FROM roles ORDER BY code LIMIT 1;
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash)
    VALUES(p,a,owner_role,'Unpaid guard fixture','UPG-' || left(p::text,8),true,
           extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf')));
  -- Une seule session ouverte par utilisateur : la seconde caisse a son titulaire.
  INSERT INTO auth.users(id) VALUES(a2);
  INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash)
    VALUES(p2,a2,owner_role,'Unpaid guard fixture 2','UPG-' || left(p2::text,8),true,
           extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf')));
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    VALUES(p,'shift.close',true,'Regression fixture'),
          (p,'orders.read',true,'Regression fixture');
  -- Seulement `request.jwt.claims` : `claim.sub` primerait sur le changement
  -- d'acteur plus bas.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  INSERT INTO pos_sessions(id,opened_by,opening_cash,status) VALUES(s1,p,0,'open'),(s2,p2,0,'open');
  -- s1 : une commande ouverte impayée, une en attente, une ardoise.
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total)
    VALUES(o_open,'UPG-OPEN-'||left(o_open::text,8),s1,'pending_payment','pos','take_out',30000,0,30000);
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,is_held)
    VALUES(o_held,'UPG-HELD-'||left(o_held::text,8),s1,'pending_payment','pos','take_out',20000,0,20000,true);
  -- s2 : seulement une ardoise.
  INSERT INTO orders(id,order_number,session_id,status,created_via,order_type,subtotal,tax_amount,total,outstanding_at)
    VALUES(o_tab,'UPG-TAB-'||left(o_tab::text,8),s2,'pending_payment','pos','take_out',40000,0,40000,now());
  PERFORM set_config('upg.s1',s1::text,true);
  PERFORM set_config('upg.s2',s2::text,true);
  PERFORM set_config('upg.open',o_open::text,true);
  PERFORM set_config('upg.tab',o_tab::text,true);
  PERFORM set_config('upg.actor',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  -- Les ventes d'un jour encore ouvert ne se lisent que par le propriétaire
  -- (reporting_private.closed_pos_orders_v1) : le dashboard se lit sous lui.
  PERFORM set_config('upg.owner',(
    SELECT jsonb_build_object('sub',up.auth_user_id,'role','authenticated')::text
      FROM user_profiles up
     WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
       AND up.role_code = 'SUPER_ADMIN'
     ORDER BY up.created_at, up.id LIMIT 1),true);
END $fixture$;

-- Dashboard : la commande ouverte est sur le plancher, l'ardoise non.
SELECT set_config('request.jwt.claims', current_setting('upg.owner'), true);
SELECT ok(
  (SELECT get_dashboard_open_orders_v4()->'orders') @> jsonb_build_array(jsonb_build_object('id', current_setting('upg.open'))),
  'T1: an unpaid open order is listed on the floor');
SELECT ok(
  NOT ((SELECT get_dashboard_open_orders_v4()->'orders') @> jsonb_build_array(jsonb_build_object('id', current_setting('upg.tab')))),
  'T2: a tab (outstanding) is not listed on the floor');
SELECT ok(
  (get_dashboard_open_orders_v4()->>'outstanding_count')::int >= 1
  AND (get_dashboard_open_orders_v4()->>'outstanding_total')::numeric >= 40000,
  'T3: tabs are counted apart');

-- Clôture : bloquée tant que la commande ouverte existe.
SELECT set_config('request.jwt.claims', current_setting('upg.actor'), true);
SELECT throws_ok(
  format($$SELECT close_shift_v14(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s1')),
  'P0001', 'unpaid_orders_open',
  'T4: close_shift_v14 refuses a shift with an unpaid open order');
SELECT throws_ok(
  format($$SELECT close_shift_v13(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s1')),
  'P0001', 'unpaid_orders_open',
  'T5: the close_shift_v13 envelope goes through the same guard');
SELECT is(
  (SELECT status::text FROM pos_sessions WHERE id = current_setting('upg.s1')::uuid),
  'open', 'T6: the refused shift stays open');

-- Une fois la commande mise en attente, la clôture passe : l'attente est
-- conçue pour franchir le shift (reopen_held_order).
UPDATE orders SET is_held = true WHERE id = current_setting('upg.open')::uuid;
SELECT lives_ok(
  format($$SELECT close_shift_v14(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s1')),
  'T7: a held order alone does not block the close');
SELECT is(
  (SELECT status::text FROM pos_sessions WHERE id = current_setting('upg.s1')::uuid),
  'closed', 'T8: the shift is closed');

-- Une ardoise ne bloque pas.
SELECT lives_ok(
  format($$SELECT close_shift_v10(%L::uuid, 0, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb)$$, current_setting('upg.s2')),
  'T9: a tab does not block the close (through the v10 envelope)');

-- Droits et versions.
SELECT ok(NOT has_function_privilege('anon','public.close_shift_v14(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb)','EXECUTE'),
  'T10: anon cannot close a shift');
SELECT ok(NOT has_function_privilege('anon','public.get_dashboard_open_orders_v4()','EXECUTE'),
  'T11: anon cannot read the open orders panel');
SELECT ok(to_regprocedure('public.get_dashboard_open_orders_v3()') IS NULL,
  'T12: the previous dashboard version is removed');

SELECT * FROM finish();
ROLLBACK;
