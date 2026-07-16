-- supabase/tests/notifications_dispatch_live.test.sql
-- Settings §6.A (migration 20260716000169) — pipeline notifications vivant :
-- enqueue_notification_v2 (variables persistées, idempotence),
-- pick_notifications_batch_v2 (claim + variables), v1 droppées, cron minutely.
-- Run via MCP execute_sql / API-from-file (BEGIN..ROLLBACK envelope carried by
-- this file; temp-table capture pattern).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- ── Seed : service-role context (auth.uid() NULL → gate skipped, comme l'EF) ──
-- (enqueue_v2 garde le gate notifications.send pour les appels user-JWT.)

-- T1: colonne variables existe sur notification_outbox.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t1_column',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notification_outbox'
        AND column_name = 'variables') = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_column', false);
END $$;

-- T2: enqueue_v2 substitue le texte ET persiste les variables brutes.
DO $$ DECLARE v_id UUID; v_row notification_outbox%ROWTYPE; BEGIN
  v_id := enqueue_notification_v2(
    'low_stock_alert', 'ops@test.local',
    jsonb_build_object('product_name','Croissant','current_stock',2,'threshold',10,'unit','pcs'),
    'email', NULL, NULL);
  SELECT * INTO v_row FROM notification_outbox WHERE id = v_id;
  INSERT INTO _r VALUES ('t2_enqueue',
    v_row.status = 'queued'
    AND v_row.body LIKE '%Croissant%'
    AND v_row.variables->>'product_name' = 'Croissant'
    AND (v_row.variables->>'threshold')::INT = 10);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_enqueue', false);
END $$;

-- T3: idempotence — même clé → même id, pas de 2e ligne.
DO $$ DECLARE v_key UUID := gen_random_uuid(); v_a UUID; v_b UUID; BEGIN
  v_a := enqueue_notification_v2('po_received', 'ops@test.local',
    jsonb_build_object('po_number','PO-1','supplier_name','S','total',100,'received_at','now'),
    'email', NULL, v_key);
  v_b := enqueue_notification_v2('po_received', 'ops@test.local',
    jsonb_build_object('po_number','PO-1','supplier_name','S','total',100,'received_at','now'),
    'email', NULL, v_key);
  INSERT INTO _r VALUES ('t3_idempotent',
    v_a = v_b
    AND (SELECT count(*) FROM notification_outbox WHERE idempotency_key = v_key) = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_idempotent', false);
END $$;

-- T4: template inconnu/inactif rejeté (P0002).
DO $$ BEGIN
  PERFORM enqueue_notification_v2('does_not_exist', 'x@y.z', '{}'::jsonb, 'email', NULL, NULL);
  INSERT INTO _r VALUES ('t4_unknown_template', false);
EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO _r VALUES ('t4_unknown_template', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_unknown_template', false);
END $$;

-- T5: pick_v2 claim atomique — statut passe à sending, variables retournées.
DO $$ DECLARE v_batch RECORD; v_found BOOLEAN := false; BEGIN
  FOR v_batch IN SELECT * FROM pick_notifications_batch_v2(100) LOOP
    IF v_batch.recipient = 'ops@test.local' AND v_batch.variables IS NOT NULL THEN
      v_found := true;
    END IF;
    IF v_batch.status <> 'sending' THEN
      v_found := false; EXIT;
    END IF;
  END LOOP;
  INSERT INTO _r VALUES ('t5_pick', v_found
    AND NOT EXISTS (SELECT 1 FROM notification_outbox
                     WHERE recipient = 'ops@test.local' AND status IN ('queued','retry')));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_pick', false);
END $$;

-- T6: v1 droppées, v2 sans anon/PUBLIC.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t6_versioning',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('enqueue_notification_v1','pick_notifications_batch_v1','notify_birthday_customers_v1')) = 0
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('enqueue_notification_v2','pick_notifications_batch_v2','notify_birthday_customers_v2')
        AND p.proacl::text NOT LIKE '%anon%'
        AND p.proacl::text NOT LIKE '{=X%') = 3);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_versioning', false);
END $$;

-- T7: le cron minutely est planifié et son commande cible l'EF avec le header vault.
DO $$ DECLARE v_cmd TEXT; BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'notification-dispatch-minutely';
  INSERT INTO _r VALUES ('t7_cron',
    v_cmd IS NOT NULL
    AND v_cmd LIKE '%notification-dispatch%'
    AND v_cmd LIKE '%x-dispatch-secret%'
    AND v_cmd LIKE '%vault.decrypted_secrets%'
    AND (SELECT schedule FROM cron.job WHERE jobname = 'notification-dispatch-minutely') = '* * * * *');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_cron', false);
END $$;

SELECT plan(7);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_column'),           'T1: notification_outbox.variables column exists');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_enqueue'),          'T2: enqueue_v2 substitutes text AND persists raw variables');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_idempotent'),       'T3: idempotency key replays the first row');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_unknown_template'), 'T4: unknown template rejected (P0002)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_pick'),             'T5: pick_v2 claims to sending and returns variables');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_versioning'),       'T6: v1 trio dropped; v2 ACL excludes anon/PUBLIC');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_cron'),             'T7: minutely dispatch cron scheduled with vault header');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
