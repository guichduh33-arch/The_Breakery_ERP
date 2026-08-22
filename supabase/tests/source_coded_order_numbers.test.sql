-- supabase/tests/source_coded_order_numbers.test.sql
-- Numérotation par origine (2026-08-16) — <code><DDMMYYYY><NNN> sur la
-- séquence quotidienne PARTAGÉE (order_sequences). Vérifie :
--   T1. fire_counter_order_v7 numérote P<DDMMYYYY><NNN> (défaut 'P').
--   T2. create_tablet_order_v8 numérote T2… quand la tablette envoie T2.
--   T3. Séquence partagée : le numéro tablette suit le fire (+1).
--   T4. Un code invalide est refusé (check_violation).
--   T5/T6. Le replay d'idempotence rend le MÊME numéro + drapeau.
--   T7. Unicité par jour métier (index orders_order_number_per_day_key).
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK). Pattern jwt-claims S37
-- (counter_fire.test.sql) : caller réel + auth.uid() simulé.

BEGIN;
SELECT plan(7);

-- Fixture : caller authentifié + session POS open + produit vendable.
DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_prod UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
     AND has_permission(up.auth_user_id, 'sales.create')
   LIMIT 1;
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'fixture: no user_profiles row with pos.sale.create + sales.create';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status)
      VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  -- ADR-022 déc. 1 : la garde de vendabilité est active — produit vendable déterministe.
  SELECT p.id INTO v_prod FROM products p
   WHERE p.sku = 'BEV-AMER'
     AND p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.is_active = true
     AND p.product_type <> 'combo'
     AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id AND c.is_active AND c.deleted_at IS NULL)
   LIMIT 1;
  IF v_prod IS NULL THEN
    SELECT p.id INTO v_prod FROM products p
     WHERE p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.is_active = true
       AND p.product_type <> 'combo'
       AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_product_id = p.id AND c.is_active AND c.deleted_at IS NULL)
     LIMIT 1;
  END IF;
  IF v_prod IS NULL THEN RAISE EXCEPTION 'fixture: aucun produit vendable'; END IF;

  CREATE TEMP TABLE _fx AS SELECT v_sess AS session_id, v_prod AS product_id;
END $$;

-- Actes : un fire (défaut P) puis une commande tablette (T2), mêmes fixtures.
DO $$
DECLARE
  v_fire JSONB; v_tablet UUID;
BEGIN
  v_fire := fire_counter_order_v7(
    gen_random_uuid(),
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb))
  );
  PERFORM set_config('test.src_fire_number', v_fire->>'order_number', true);

  v_tablet := create_tablet_order_v8(
    p_client_uuid  := gen_random_uuid(),
    p_waiter_id    := NULL,
    p_table_number := 'T-01',
    p_order_type   := 'dine_in',
    p_items        := jsonb_build_array(jsonb_build_object(
                        'product_id', (SELECT product_id FROM _fx),
                        'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    p_source_code  := 'T2'
  );
  PERFORM set_config('test.src_tablet_number',
    (SELECT order_number FROM orders WHERE id = v_tablet), true);
END $$;

-- T1
SELECT matches(
  current_setting('test.src_fire_number'),
  '^P' || to_char(CURRENT_DATE, 'DDMMYYYY') || '[0-9]{3,}$',
  'T1: fire comptoir — numéro P<DDMMYYYY><NNN> (défaut P)'
);

-- T2
SELECT matches(
  current_setting('test.src_tablet_number'),
  '^T2' || to_char(CURRENT_DATE, 'DDMMYYYY') || '[0-9]{3,}$',
  'T2: tablette — numéro T2<DDMMYYYY><NNN> (code envoyé)'
);

-- T3 : séquence quotidienne partagée (+1 entre les deux créations).
SELECT is(
  (regexp_replace(current_setting('test.src_tablet_number'), '^T2[0-9]{8}', ''))::int,
  (regexp_replace(current_setting('test.src_fire_number'), '^P[0-9]{8}', ''))::int + 1,
  'T3: séquence quotidienne partagée entre les portes (+1)'
);

-- T4 : code hors ^(P|T[0-9]+|BO)$ refusé.
SELECT throws_ok(
  $$SELECT fire_counter_order_v7(
      gen_random_uuid(),
      (SELECT session_id FROM _fx),
      jsonb_build_array(jsonb_build_object(
        'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000)),
      p_source_code := 'XX')$$,
  '23514',
  'Invalid source code: XX',
  'T4: code invalide refusé (check_violation)'
);

-- T5/T6 : replay idempotent — même numéro, drapeau porté.
DO $$
DECLARE
  v_uuid UUID := gen_random_uuid();
  v_first JSONB; v_second JSONB;
BEGIN
  v_first := fire_counter_order_v7(
    v_uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb))
  );
  v_second := fire_counter_order_v7(v_uuid, (SELECT session_id FROM _fx), '[]'::jsonb);
  PERFORM set_config('test.src_replay_first', v_first->>'order_number', true);
  PERFORM set_config('test.src_replay_second', v_second->>'order_number', true);
  PERFORM set_config('test.src_replay_flag', v_second->>'idempotent_replay', true);
END $$;

SELECT is(
  current_setting('test.src_replay_second'),
  current_setting('test.src_replay_first'),
  'T5: replay idempotent — même numéro que la 1ère exécution'
);

SELECT is(
  current_setting('test.src_replay_flag'), 'true',
  'T6: replay idempotent — drapeau idempotent_replay porté'
);

-- T7 : unicité sur le jour métier avec le nouveau format.
SELECT is(
  (SELECT count(*) FROM orders
    WHERE order_number = current_setting('test.src_fire_number')
      AND (timezone('Asia/Makassar', created_at))::date = CURRENT_DATE)::int,
  1,
  'T7: numéro unique sur le jour métier (orders_order_number_per_day_key)'
);

SELECT * FROM finish();
ROLLBACK;
