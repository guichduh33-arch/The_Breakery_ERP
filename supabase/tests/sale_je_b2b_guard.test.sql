-- supabase/tests/sale_je_b2b_guard.test.sql
--
-- Guarde 20260818000006 sur create_sale_journal_entry() : les commandes B2B
-- (order_type='b2b', revenu déjà porté par la JE reference_type='b2b_order'
-- DR 1132/CR 4131 émise par create_b2b_order) ne doivent JAMAIS déclencher ce
-- trigger, notamment quand record_b2b_payment les fait passer à 'paid' SANS
-- ligne order_payments (bug confirmé : ça retombait en fallback cash et
-- doublait le revenu — 10 commandes touchées sur dev). Côté void, la garde
-- couvre aussi la branche 'voided' par principe de symétrie et lève un
-- blocage fiscal potentiel (check_fiscal_period_open sur la date de CRÉATION
-- d'une commande B2B ancienne) — mais aucune JE fantôme n'a jamais existé sur
-- ce chemin : cancel_b2b_order_v1 exige status='b2b_pending' en entrée,
-- jamais 'paid', donc la branche void du trigger (OLD.status IN
-- ('paid','completed')) n'a jamais pu s'activer pour une annulation B2B.
--
-- T1-T2 : commande B2B UPDATE -> paid sans order_payments ⇒ AUCUNE JE 'sale',
--         AUCUN audit_logs 'je.payment_fallback_cash' pour cette commande.
-- T3    : filet EXISTS — une commande dont l'order_type N'EST PAS 'b2b' mais
--         qui porte déjà une JE reference_type='b2b_order' (anomalie/legacy)
--         est couverte par la seconde branche du OR, indépendamment de
--         order_type. AUCUNE JE 'sale' non plus.
-- T4-T6 : non-régression — commande POS normale, paid SANS order_payments :
--         le fallback cash reste émis, avec sa ligne d'audit, JE équilibrée.
-- T7    : durcissement défensif (belt-and-suspenders), PAS la preuve d'un
--         second bug corrigé — voir le bloc T7 plus bas pour le détail.
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK. GUC pass-flag pattern
-- S25 (DEV-S25-2.A-03), style s44_je_by_method.test.sql.

BEGIN;
SELECT plan(7);

-- Fixture partagée : un served_by (profile) + une session POS open.
DO $$
DECLARE v_prof UUID; v_sess UUID;
BEGIN
  SELECT id INTO v_prof FROM user_profiles WHERE deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;
  PERFORM set_config('b2bguard.profile_id', v_prof::text, true);
  PERFORM set_config('b2bguard.session_id', v_sess::text, true);
END $$;

---------------------------------------------------------------------------
-- T1-T2 : commande B2B (order_type='b2b'), b2b_pending -> paid, zéro
-- order_payments ⇒ pas de JE 'sale', pas d'audit fallback.
---------------------------------------------------------------------------
DO $$
DECLARE v_order_id UUID; v_n_sale INT; v_n_audit INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status,
                      subtotal, tax_amount, total)
    VALUES ('#B2BG-T1-' || gen_random_uuid()::text, NULL, current_setting('b2bguard.profile_id')::uuid,
            'b2b', 'b2b_pending', 100000, 0, 100000)
    RETURNING id INTO v_order_id;

  UPDATE orders SET status = 'paid', paid_at = now() WHERE id = v_order_id;

  SELECT count(*) INTO v_n_sale FROM journal_entries
    WHERE reference_type = 'sale' AND reference_id = v_order_id;
  SELECT count(*) INTO v_n_audit FROM audit_logs
    WHERE action = 'je.payment_fallback_cash' AND entity_id = v_order_id;

  PERFORM set_config('b2bguard.t1_order', v_order_id::text, true);
  PERFORM set_config('b2bguard.t1_pass', (v_n_sale = 0)::text, true);
  PERFORM set_config('b2bguard.t2_pass', (v_n_audit = 0)::text, true);
END $$;
SELECT ok(current_setting('b2bguard.t1_pass')::boolean,
  'T1 — B2B order paid without order_payments: no ''sale'' JE emitted (double-revenue fix)');
SELECT ok(current_setting('b2bguard.t2_pass')::boolean,
  'T2 — B2B order paid without order_payments: no je.payment_fallback_cash audit row');

---------------------------------------------------------------------------
-- T3 : filet EXISTS — order_type <> 'b2b' mais une JE 'b2b_order'
-- préexistante référence déjà cette commande (anomalie/legacy). La seconde
-- branche du OR doit suffire, indépendamment de order_type.
---------------------------------------------------------------------------
DO $$
DECLARE
  v_order_id UUID;
  v_je_id    UUID;
  v_prof     UUID := current_setting('b2bguard.profile_id')::uuid;
  v_n_sale   INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status,
                      subtotal, tax_amount, total)
    VALUES ('#B2BG-T3-' || gen_random_uuid()::text, current_setting('b2bguard.session_id')::uuid, v_prof,
            'dine_in', 'pending_payment', 50000, 4545, 50000)
    RETURNING id INTO v_order_id;

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    'TEST-B2BGUARD-' || gen_random_uuid()::text, CURRENT_DATE,
    'fixture b2b_order JE for EXISTS filet', 'b2b_order', v_order_id,
    'posted', 50000, 50000, v_prof
  ) RETURNING id INTO v_je_id;

  UPDATE orders SET status = 'paid', paid_at = now() WHERE id = v_order_id;

  SELECT count(*) INTO v_n_sale FROM journal_entries
    WHERE reference_type = 'sale' AND reference_id = v_order_id;

  PERFORM set_config('b2bguard.t3_pass', (v_n_sale = 0)::text, true);
END $$;
SELECT ok(current_setting('b2bguard.t3_pass')::boolean,
  'T3 — order_type<>''b2b'' but pre-existing b2b_order JE: EXISTS filet still blocks the ''sale'' JE');

---------------------------------------------------------------------------
-- T4-T6 : non-régression — commande POS normale, paid SANS order_payments,
-- le fallback cash reste émis, avec sa ligne d'audit, JE équilibrée.
---------------------------------------------------------------------------
DO $$
DECLARE v_order_id UUID; v_n_fb INT; v_n_audit INT; v_bal NUMERIC;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status,
                      subtotal, tax_amount, total, created_via)
    VALUES ('#B2BG-T4-' || gen_random_uuid()::text, current_setting('b2bguard.session_id')::uuid,
            current_setting('b2bguard.profile_id')::uuid,
            'take_out', 'paid', 12000, 1091, 12000, 'pos')
    RETURNING id INTO v_order_id;

  SELECT count(*) INTO v_n_fb FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type = 'sale' AND je.reference_id = v_order_id
      AND jel.description ILIKE '%fallback to cash%';
  SELECT count(*) INTO v_n_audit FROM audit_logs
    WHERE action = 'je.payment_fallback_cash' AND entity_id = v_order_id
      AND metadata->>'direction' = 'sale';
  SELECT COALESCE(SUM(jel.debit),0) - COALESCE(SUM(jel.credit),0) INTO v_bal FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type = 'sale' AND je.reference_id = v_order_id;

  PERFORM set_config('b2bguard.t4_pass', (v_n_fb = 1)::text, true);
  PERFORM set_config('b2bguard.t5_pass', (v_n_audit = 1)::text, true);
  PERFORM set_config('b2bguard.t6_pass', (abs(v_bal) < 0.01)::text, true);
END $$;
SELECT ok(current_setting('b2bguard.t4_pass')::boolean,
  'T4 — non-regression: normal POS order paid without order_payments still gets the cash fallback line');
SELECT ok(current_setting('b2bguard.t5_pass')::boolean,
  'T5 — non-regression: cash fallback still writes its je.payment_fallback_cash audit row');
SELECT ok(current_setting('b2bguard.t6_pass')::boolean,
  'T6 — non-regression: the fallback ''sale'' JE stays balanced (Σdebit == Σcredit)');

---------------------------------------------------------------------------
-- T7 : la commande B2B de T1, paid -> voided ⇒ pas de JE 'sale_void'.
--
-- Durcissement DÉFENSIF (belt-and-suspenders), pas la preuve d'un second bug
-- corrigé : ce chemin paid -> voided n'est atteignable par AUCUNE RPC vivante
-- aujourd'hui pour une commande B2B — cancel_b2b_order_v1 n'accepte que
-- status='b2b_pending' en entrée, et void_order_rpc échoue en amont sur une
-- commande B2B (session_id NULL). Ce test verrouille le comportement du
-- trigger SI ce chemin s'ouvrait un jour (nouvelle RPC, correction manuelle
-- de statut, etc.) — il ne documente pas une régression déjà observée.
---------------------------------------------------------------------------
DO $$
DECLARE
  v_order_id UUID := current_setting('b2bguard.t1_order')::uuid;
  v_n_void   INT;
BEGIN
  UPDATE orders SET status = 'voided', voided_at = now(),
    voided_by = current_setting('b2bguard.profile_id')::uuid,
    void_reason = 'b2b guard test'
   WHERE id = v_order_id;

  SELECT count(*) INTO v_n_void FROM journal_entries
    WHERE reference_type = 'sale_void' AND reference_id = v_order_id;

  PERFORM set_config('b2bguard.t7_pass', (v_n_void = 0)::text, true);
END $$;
SELECT ok(current_setting('b2bguard.t7_pass')::boolean,
  'T7 — B2B order paid -> voided: no ''sale_void'' JE emitted, guard blocks the reversal path too');

SELECT * FROM finish();
ROLLBACK;
