-- supabase/tests/store_credit_expiry_reprise_produit.test.sql
-- ADR-013 Lot 4 (D7) — expire_store_credit_v1 :
--   reprise en produit des avoirs périmés (JE DR 2220 / CR 4920), FIFO sur la
--   part restante, idempotence (2e run = 0), kill-switch réglage 0.
-- Run via MCP execute_sql (BEGIN..ROLLBACK) ou API-from-file.

BEGIN;
SELECT plan(6);

DO $$
DECLARE v_prof UUID; v_c1 UUID; v_c2 UUID; v_c3 UUID;
BEGIN
  SELECT id INTO v_prof FROM user_profiles WHERE deleted_at IS NULL LIMIT 1;

  -- Réglage actif (6 mois) pour les runs T1-T4.
  UPDATE business_config SET store_credit_expiry_months = 6 WHERE id = 1;

  -- C1 : un crédit 10 000 expiré hier, jamais consommé.
  INSERT INTO customers (name, customer_type) VALUES ('SC Expiry C1', 'retail') RETURNING id INTO v_c1;
  PERFORM 1 FROM customers WHERE id = v_c1 FOR UPDATE;
  PERFORM _apply_store_credit_v1(v_c1, 10000, 'manager_grant', NULL, NULL,
                                 now() - interval '1 day', v_prof, NULL);

  -- C2 : crédit 10 000 expiré, partiellement consommé (spend 4 000) -> seule la
  -- part restante (6 000) doit expirer (FIFO).
  INSERT INTO customers (name, customer_type) VALUES ('SC Expiry C2', 'retail') RETURNING id INTO v_c2;
  PERFORM 1 FROM customers WHERE id = v_c2 FOR UPDATE;
  PERFORM _apply_store_credit_v1(v_c2, 10000, 'manager_grant', NULL, NULL,
                                 now() - interval '1 day', v_prof, NULL);
  PERFORM _apply_store_credit_v1(v_c2, -4000, 'spend', 'orders', gen_random_uuid(), NULL, v_prof, NULL);

  PERFORM set_config('sce.prof', v_prof::text, true);
  PERFORM set_config('sce.c1', v_c1::text, true);
  PERFORM set_config('sce.c2', v_c2::text, true);
END $$;

-- T1 — run 1 : C1 entièrement repris, C2 pour la part restante -> 2 expirations.
DO $$
DECLARE v_n INT; v_bal1 NUMERIC; v_exp1 NUMERIC;
BEGIN
  v_n := expire_store_credit_v1();
  SELECT store_credit_balance INTO v_bal1 FROM customers WHERE id = current_setting('sce.c1')::uuid;
  SELECT delta INTO v_exp1 FROM customer_store_credit_ledger
   WHERE customer_id = current_setting('sce.c1')::uuid AND source = 'expiry';
  PERFORM set_config('sce.t1', (v_n = 2 AND v_bal1 = 0 AND v_exp1 = -10000)::text, true);
END $$;
SELECT ok(current_setting('sce.t1')::boolean,
  'T1: run 1 expires both credits, C1 fully reprised (balance 0, expiry -10000)');

-- T2 — FIFO : C2 n'expire que la part restante (6 000), solde 0.
SELECT ok(
  (SELECT delta FROM customer_store_credit_ledger
    WHERE customer_id = current_setting('sce.c2')::uuid AND source = 'expiry') = -6000
  AND (SELECT store_credit_balance FROM customers WHERE id = current_setting('sce.c2')::uuid) = 0,
  'T2: partially spent credit expires only the remaining 6000 (FIFO)');

-- T3 — JE de reprise : DR 2220 / CR 4920, équilibré, une par expiration.
DO $$
DECLARE v_n INT;
BEGIN
  SELECT count(*) INTO v_n
    FROM journal_entries je
   WHERE je.reference_type = 'store_credit_expiry'
     AND EXISTS (SELECT 1 FROM journal_entry_lines l
                  WHERE l.journal_entry_id = je.id
                    AND l.account_id = resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT')
                    AND l.debit > 0)
     AND EXISTS (SELECT 1 FROM journal_entry_lines l
                  WHERE l.journal_entry_id = je.id
                    AND l.account_id = resolve_mapping_account('STORE_CREDIT_EXPIRY_INCOME')
                    AND l.credit > 0)
     AND je.total_debit = je.total_credit
     AND je.reference_id IN (SELECT id FROM customer_store_credit_ledger
                              WHERE source = 'expiry'
                                AND customer_id IN (current_setting('sce.c1')::uuid,
                                                    current_setting('sce.c2')::uuid));
  PERFORM set_config('sce.t3', (v_n = 2)::text, true);
END $$;
SELECT ok(current_setting('sce.t3')::boolean,
  'T3: each expiry emits a balanced JE DR 2220 / CR 4920 (breakage income)');

-- T4 — idempotence : run 2 -> 0 expiration nouvelle.
SELECT is(expire_store_credit_v1(), 0, 'T4: second run finds nothing to expire (idempotent)');

-- T5 — kill-switch : réglage 0 -> le job ne reprend rien, même expiré.
DO $$
DECLARE v_c3 UUID; v_n INT; v_rows INT;
BEGIN
  UPDATE business_config SET store_credit_expiry_months = 0 WHERE id = 1;
  INSERT INTO customers (name, customer_type) VALUES ('SC Expiry C3', 'retail') RETURNING id INTO v_c3;
  PERFORM 1 FROM customers WHERE id = v_c3 FOR UPDATE;
  PERFORM _apply_store_credit_v1(v_c3, 5000, 'manager_grant', NULL, NULL,
                                 now() - interval '1 day', current_setting('sce.prof')::uuid, NULL);
  v_n := expire_store_credit_v1();
  SELECT count(*) INTO v_rows FROM customer_store_credit_ledger
   WHERE customer_id = v_c3 AND source = 'expiry';
  PERFORM set_config('sce.t5', (v_n = 0 AND v_rows = 0)::text, true);
END $$;
SELECT ok(current_setting('sce.t5')::boolean,
  'T5: setting 0 disables expiry entirely (even for stamped credits)');

-- T6 — réconciliation post-scénario sur les clients du test.
SELECT is(
  (SELECT COALESCE(SUM(store_credit_balance), 0) FROM customers
    WHERE name IN ('SC Expiry C1', 'SC Expiry C2', 'SC Expiry C3')),
  (SELECT COALESCE(SUM(delta), 0) FROM customer_store_credit_ledger l
    JOIN customers c ON c.id = l.customer_id
    WHERE c.name IN ('SC Expiry C1', 'SC Expiry C2', 'SC Expiry C3')),
  'T6: sum of cached balances == sum of ledger deltas for test customers');

SELECT * FROM finish();
ROLLBACK;
