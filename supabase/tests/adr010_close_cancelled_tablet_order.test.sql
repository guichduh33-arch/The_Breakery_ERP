-- supabase/tests/adr010_close_cancelled_tablet_order.test.sql
--
-- Audit Tablet Ordering (2026-07-31) — décision propriétaire du 2026-07-31 :
-- `cancel_tablet_order` est supprimée (elle laissait annuler depuis la salle une
-- commande dont TOUTES les lignes sont posées `is_locked` dès la création, sans
-- manager ni perte — ADR-010 D3/D4), et `close_cancelled_tablet_order_v1` ne
-- fait que CONSTATER une commande déjà vidée par le flux cancel-item.
--
-- L'enjeu du garde testé ici : si la clôture acceptait une commande dont des
-- lignes sont encore actives, elle rouvrirait exactement la porte que la
-- suppression vient de fermer.

BEGIN;
SELECT plan(7);

DO $$
DECLARE
  v_prof  UUID;
  v_auth  UUID;
  v_order UUID;
  v_p1    UUID;
  v_p2    UUID;
BEGIN
  SELECT up.id, up.auth_user_id INTO v_prof, v_auth
    FROM user_profiles up
    WHERE up.auth_user_id IS NOT NULL
      AND has_permission(up.auth_user_id, 'payments.process')
    LIMIT 1;
  IF v_prof IS NULL THEN
    RAISE EXCEPTION 'fixture: no user_profiles row with payments.process';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_p1 FROM products WHERE is_active LIMIT 1;
  SELECT id INTO v_p2 FROM products WHERE is_active AND id <> v_p1 LIMIT 1;
  IF v_p2 IS NULL THEN RAISE EXCEPTION 'fixture: need 2 active products'; END IF;

  INSERT INTO orders (order_number, order_type, status, created_via,
                      table_number, sent_to_kitchen_at, subtotal, tax_amount, total)
    VALUES ('#T018', 'dine_in', 'pending_payment', 'tablet',
            '7', now(), 0, 0, 0)
    RETURNING id INTO v_order;

  -- Lignes telles que `create_tablet_order` les pose : verrouillées et parties
  -- en cuisine dès la création.
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price,
                           quantity, line_total, is_locked, kitchen_status,
                           sent_to_kitchen_at)
    VALUES (v_order, v_p1, 'Croissant', 20000, 2, 40000, true, 'pending', now()),
           (v_order, v_p2, 'Cappuccino', 30000, 1, 30000, true, 'pending', now());

  PERFORM set_config('a018.order', v_order::text, true);
  PERFORM set_config('a018.prof',  v_prof::text,  true);
END $$;

-- T1 — l'ancienne porte est bel et bien murée.
SELECT is_empty(
  $$ SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'cancel_tablet_order' $$,
  'cancel_tablet_order est supprimee (ADR-010 : plus d annulation depuis la salle)'
);

-- T2 — le garde central : refus tant qu'une ligne vit encore.
SELECT throws_ok(
  format('SELECT close_cancelled_tablet_order_v1(%L::uuid)',
         current_setting('a018.order')),
  'P0014',
  NULL,
  'refuse de clore tant que des lignes sont actives (pas de contournement du flux cancel-item)'
);

-- T3 — une commande partiellement annulee reste refusee.
-- `chk_order_items_cancel_consistency` exige l'attelage complet : une ligne
-- annulee porte toujours sa date, sa raison (>= 3 car.) et son auteur.
UPDATE order_items SET is_cancelled = true, cancelled_at = now(),
       cancelled_reason = 'client parti', cancelled_by = current_setting('a018.prof')::uuid
  WHERE id = (SELECT id FROM order_items
               WHERE order_id = current_setting('a018.order')::uuid
               ORDER BY created_at LIMIT 1);

SELECT throws_ok(
  format('SELECT close_cancelled_tablet_order_v1(%L::uuid)',
         current_setting('a018.order')),
  'P0014',
  NULL,
  'refuse encore quand UNE seule des deux lignes est annulee'
);

-- T4/T5 — toutes les lignes annulees : la cloture constate.
UPDATE order_items SET is_cancelled = true, cancelled_at = now(),
       cancelled_reason = 'client parti', cancelled_by = current_setting('a018.prof')::uuid
  WHERE order_id = current_setting('a018.order')::uuid AND is_cancelled = false;

SELECT lives_ok(
  format('SELECT close_cancelled_tablet_order_v1(%L::uuid)',
         current_setting('a018.order')),
  'clot une commande dont toutes les lignes sont annulees'
);

SELECT is(
  (SELECT status::text FROM orders WHERE id = current_setting('a018.order')::uuid),
  'voided',
  'la commande passe en voided'
);

-- T6 — la tracabilite n'est pas optionnelle.
SELECT isnt_empty(
  format($$ SELECT 1 FROM audit_logs
             WHERE entity_type = 'orders' AND entity_id = %L::uuid
               AND action = 'order.close_cancelled_tablet' $$,
         current_setting('a018.order')),
  'la cloture laisse une ligne audit_logs'
);

-- T7 — defense in depth : anon n'herite de rien (ni direct, ni via PUBLIC).
SELECT ok(
  NOT has_function_privilege('anon', 'public.close_cancelled_tablet_order_v1(uuid, text)', 'EXECUTE'),
  'anon ne peut pas executer close_cancelled_tablet_order_v1'
);

SELECT * FROM finish();
ROLLBACK;
