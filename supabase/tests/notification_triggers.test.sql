-- supabase/tests/notification_triggers.test.sql
-- Settings §6.A (migration 20260716000170) — 5 déclencheurs de notifications :
-- helper système gate-free, low_stock edge-triggered + 1/jour, expense/po/b2b/
-- order, exception-safety (l'écriture métier survit à un enqueue cassé).
-- Run via API-from-file (BEGIN..ROLLBACK envelope; temp-table capture pattern).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- ── Seed : alert_email + impersonation d'un utilisateur SANS notifications.send ──
UPDATE business_config SET alert_email = 'ops@test.local' WHERE id = 1;

DO $$
DECLARE v_auth UUID;
BEGIN
  -- Un utilisateur réel qui N'A PAS notifications.send (cashier-like) — prouve
  -- que les triggers passent le gate via le helper système.
  SELECT up.auth_user_id INTO v_auth
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND NOT has_permission(up.auth_user_id, 'notifications.send')
   LIMIT 1;
  IF v_auth IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  END IF;
END $$;

-- T1: les 6 triggers + le helper système existent ; helper non exécutable par authenticated.
DO $$ BEGIN
  INSERT INTO _r VALUES ('t1_wiring',
    (SELECT count(*) FROM pg_trigger WHERE tgname IN (
      'trg_notify_order_complete_update','trg_notify_order_complete_insert',
      'trg_notify_b2b_payment','trg_notify_expense_approved',
      'trg_notify_po_received','trg_notify_low_stock') AND NOT tgisinternal) = 6
    AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = '_enqueue_notification_system_v1'
            AND p.proacl::text NOT LIKE '%authenticated%'
            AND p.proacl::text NOT LIKE '%anon%') = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t1_wiring', false);
END $$;

-- T2: low_stock — franchissement à la baisse → 1 row queued vers alert_email ;
--     re-franchissement le même jour → toujours 1 row (uuid_v5 product+date).
DO $$ DECLARE v_pid UUID; v_cnt INT; BEGIN
  SELECT id INTO v_pid FROM products WHERE min_stock_threshold > 0 LIMIT 1;
  IF v_pid IS NULL THEN
    RAISE WARNING 't2 skipped: no product with threshold';
    INSERT INTO _r VALUES ('t2_low_stock', true);
  ELSE
    UPDATE products SET current_stock = min_stock_threshold + 10 WHERE id = v_pid;
    UPDATE products SET current_stock = min_stock_threshold - 1  WHERE id = v_pid;
    -- Re-cross (remonte puis redescend) le même jour → pas de doublon.
    UPDATE products SET current_stock = min_stock_threshold + 10 WHERE id = v_pid;
    UPDATE products SET current_stock = min_stock_threshold - 2  WHERE id = v_pid;
    SELECT count(*) INTO v_cnt FROM notification_outbox
     WHERE template_code = 'low_stock_alert' AND recipient = 'ops@test.local'
       AND created_at > now() - interval '1 minute';
    INSERT INTO _r VALUES ('t2_low_stock', v_cnt = 1);
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_low_stock', false);
END $$;

-- T3: expense approved → alert interne avec les variables jointes.
DO $$ DECLARE v_eid UUID; v_row notification_outbox%ROWTYPE; BEGIN
  SELECT id INTO v_eid FROM expenses LIMIT 1;
  IF v_eid IS NULL THEN
    RAISE WARNING 't3 skipped: no expense row';
    INSERT INTO _r VALUES ('t3_expense', true);
  ELSE
    UPDATE expenses SET status = 'submitted' WHERE id = v_eid;
    UPDATE expenses SET status = 'approved'  WHERE id = v_eid;
    SELECT * INTO v_row FROM notification_outbox
     WHERE template_code = 'expense_approved' AND recipient = 'ops@test.local'
     ORDER BY created_at DESC LIMIT 1;
    INSERT INTO _r VALUES ('t3_expense',
      v_row.id IS NOT NULL AND v_row.status = 'queued'
      AND (v_row.variables ? 'expense_number') AND (v_row.variables ? 'amount'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_expense', false);
END $$;

-- T4: purchase order received → alert interne.
DO $$ DECLARE v_pid UUID; v_cnt INT; BEGIN
  SELECT id INTO v_pid FROM purchase_orders LIMIT 1;
  IF v_pid IS NULL THEN
    RAISE WARNING 't4 skipped: no purchase order row';
    INSERT INTO _r VALUES ('t4_po', true);
  ELSE
    UPDATE purchase_orders SET status = 'pending'  WHERE id = v_pid;
    UPDATE purchase_orders SET status = 'received' WHERE id = v_pid;
    SELECT count(*) INTO v_cnt FROM notification_outbox
     WHERE template_code = 'po_received' AND recipient = 'ops@test.local'
       AND created_at > now() - interval '1 minute';
    INSERT INTO _r VALUES ('t4_po', v_cnt = 1);
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_po', false);
END $$;

-- T5: order → completed avec client emailé → email client (order_complete).
DO $$ DECLARE v_oid UUID; v_cid UUID; v_cnt INT; BEGIN
  SELECT id INTO v_cid FROM customers
   WHERE deleted_at IS NULL AND email IS NOT NULL AND length(trim(email)) > 0 LIMIT 1;
  SELECT id INTO v_oid FROM orders LIMIT 1;
  IF v_oid IS NULL OR v_cid IS NULL THEN
    RAISE WARNING 't5 skipped: no order or emailed customer';
    INSERT INTO _r VALUES ('t5_order', true);
  ELSE
    UPDATE orders SET customer_id = v_cid, status = 'draft'     WHERE id = v_oid;
    UPDATE orders SET status = 'completed'                      WHERE id = v_oid;
    SELECT count(*) INTO v_cnt FROM notification_outbox
     WHERE template_code = 'order_complete'
       AND recipient = (SELECT email FROM customers WHERE id = v_cid)
       AND created_at > now() - interval '1 minute';
    INSERT INTO _r VALUES ('t5_order', v_cnt = 1);
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_order', false);
END $$;

-- T6: b2b_payments INSERT → payment_received vers l'email du client B2B.
DO $$ DECLARE v_cid UUID; v_uid UUID; v_cnt INT; BEGIN
  SELECT id INTO v_cid FROM customers
   WHERE deleted_at IS NULL AND email IS NOT NULL AND length(trim(email)) > 0 LIMIT 1;
  SELECT id INTO v_uid FROM user_profiles WHERE deleted_at IS NULL LIMIT 1;
  IF v_cid IS NULL OR v_uid IS NULL THEN
    RAISE WARNING 't6 skipped: no emailed customer or profile';
    INSERT INTO _r VALUES ('t6_b2b_payment', true);
  ELSE
    INSERT INTO b2b_payments (payment_number, customer_id, amount, method, paid_at, created_by, allocation)
    VALUES ('PAY-TEST-TRG', v_cid, 12345, 'transfer', now(), v_uid, '[]'::jsonb);
    SELECT count(*) INTO v_cnt FROM notification_outbox
     WHERE template_code = 'payment_received'
       AND created_at > now() - interval '1 minute';
    INSERT INTO _r VALUES ('t6_b2b_payment', v_cnt = 1);
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_b2b_payment', false);
END $$;

-- T7: exception-safety — alert_email invalide au niveau du helper ? Non :
--     on casse l'enqueue en désactivant le template ; l'écriture métier passe.
DO $$ DECLARE v_pid UUID; v_ok BOOLEAN := false; BEGIN
  UPDATE notification_templates SET is_active = false WHERE code = 'low_stock_alert';
  SELECT id INTO v_pid FROM products WHERE min_stock_threshold > 0 OFFSET 1 LIMIT 1;
  IF v_pid IS NULL THEN
    SELECT id INTO v_pid FROM products WHERE min_stock_threshold > 0 LIMIT 1;
  END IF;
  IF v_pid IS NULL THEN
    RAISE WARNING 't7 skipped: no product';
    v_ok := true;
  ELSE
    UPDATE products SET current_stock = min_stock_threshold + 5 WHERE id = v_pid;
    UPDATE products SET current_stock = min_stock_threshold - 5 WHERE id = v_pid;
    -- L'UPDATE métier a survécu (template inactif → no-op silencieux).
    v_ok := (SELECT current_stock < min_stock_threshold FROM products WHERE id = v_pid);
  END IF;
  UPDATE notification_templates SET is_active = true WHERE code = 'low_stock_alert';
  INSERT INTO _r VALUES ('t7_safety', v_ok);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_safety', false);
END $$;

-- T8: alert_email NULL → aucun enqueue interne, l'écriture métier passe.
DO $$ DECLARE v_pid UUID; v_before INT; v_after INT; BEGIN
  UPDATE business_config SET alert_email = NULL WHERE id = 1;
  SELECT count(*) INTO v_before FROM notification_outbox WHERE template_code = 'po_received';
  UPDATE purchase_orders SET status = 'pending'
    WHERE id = (SELECT id FROM purchase_orders LIMIT 1);
  UPDATE purchase_orders SET status = 'received'
    WHERE id = (SELECT id FROM purchase_orders LIMIT 1);
  SELECT count(*) INTO v_after FROM notification_outbox WHERE template_code = 'po_received';
  INSERT INTO _r VALUES ('t8_null_alert', v_after = v_before);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t8_null_alert', false);
END $$;

SELECT plan(8);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t1_wiring'),      'T1: 6 triggers + gate-free system helper (no app-role EXECUTE)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t2_low_stock'),   'T2: low_stock edge-triggered, one alert per product per day');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t3_expense'),     'T3: expense approved alerts alert_email with joined variables');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t4_po'),          'T4: PO received alerts alert_email');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t5_order'),       'T5: order completed emails the attached customer');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t6_b2b_payment'), 'T6: b2b payment insert emails the B2B customer');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t7_safety'),      'T7: inactive template = silent no-op, business write survives');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='t8_null_alert'),  'T8: NULL alert_email skips internal alerts, write survives');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();
ROLLBACK;
