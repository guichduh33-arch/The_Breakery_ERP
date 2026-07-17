-- supabase/tests/sale_je_reads_order_tax_amount.test.sql
-- Lot 6a (3/8) — `create_sale_journal_entry` lit `orders.tax_amount` et ne
-- recalcule plus la part PB1 depuis `total`.
--
-- Deux comportements verrouillés ici :
--
--   T1-T3  Vente POS — INCHANGÉ. La JE crédite 2110 du montant porté par la
--          commande, l'équilibre tient. Non-régression du cas nominal.
--
--   T4-T6  Vente B2B — CHANGÉ, volontairement. `create_b2b_order_v5` écrit
--          tax_amount = 0 (vente en gros hors champ PBJT, ADR-005, décision
--          propriétaire du 2026-07-17). AVANT ce correctif, le trigger
--          recalculait round_idr(total * r/(1+r)) et créditait 2110 malgré tout :
--          81 600 IDR de PB1 fantôme sur la V3 dev, soit 9,38 % du PB1 déclaré,
--          remontant jusqu'au Bapenda via calculate_pb1_payable_v1 (qui somme les
--          crédits de 2110). T4 est le test de non-retour de ce bug.
--
--          T6 couvre aussi une régression trouvée EN ÉCRIVANT ce test : avec
--          tax_amount = 0, la ligne PB1 devenait (debit=0, credit=0) et violait
--          `journal_entry_lines_check` — le trigger levait une exception et le
--          paiement B2B échouait. D'où la garde `IF v_vat > 0` dans le trigger.
--
-- Les JE B2B antérieures au 2026-07-17 ne sont PAS corrigées (sujet fiscal
-- séparé) — ce test ne porte que sur les écritures nouvelles.
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

UPDATE business_config SET tax_rate = 0.1000 WHERE id = 1;

DO $$
DECLARE
  v_cashier UUID := (SELECT id FROM user_profiles WHERE role_code='CASHIER' LIMIT 1);
  v_session UUID;
  v_pos     UUID;
  v_b2b     UUID;
BEGIN
  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_cashier, closing_cash=0
   WHERE opened_by = v_cashier AND status='open';

  INSERT INTO pos_sessions (opened_by, opening_cash)
  VALUES (v_cashier, 100000) RETURNING id INTO v_session;

  -- Vente POS : la commande porte un PB1 de 9100 (mode inclusive, 100000 TTC).
  INSERT INTO orders (order_number, session_id, served_by, order_type, status,
                      subtotal, tax_amount, total)
  VALUES ('T-JE-POS-' || gen_random_uuid()::text, v_session, v_cashier, 'dine_in', 'paid',
          100000, 9100, 100000)
  RETURNING id INTO v_pos;

  -- Vente B2B : hors champ PBJT — la commande porte tax_amount = 0.
  INSERT INTO orders (order_number, session_id, served_by, order_type, status,
                      subtotal, tax_amount, total)
  VALUES ('T-JE-B2B-' || gen_random_uuid()::text, v_session, v_cashier, 'b2b', 'paid',
          100000, 0, 100000)
  RETURNING id INTO v_b2b;

  PERFORM set_config('breakery.je_pos', v_pos::text, false);
  PERFORM set_config('breakery.je_b2b', v_b2b::text, false);
END $$;

SELECT plan(6);

---------------------------------------------------------------------------
-- T1-T3 : vente POS — comportement INCHANGÉ
---------------------------------------------------------------------------
SELECT is(
  (SELECT sum(l.credit) FROM journal_entry_lines l
     JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reference_id = current_setting('breakery.je_pos')::uuid
      AND je.reference_type = 'sale'
      AND l.account_id = resolve_mapping_account('SALE_PB1_TAX')),
  9100::NUMERIC,
  'POS T1 : 2110 crédité de orders.tax_amount (9100) — pas d''un recalcul'
);

SELECT is(
  (SELECT sum(l.credit) FROM journal_entry_lines l
     JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reference_id = current_setting('breakery.je_pos')::uuid
      AND je.reference_type = 'sale'
      AND l.account_id = resolve_mapping_account('SALE_POS_REVENUE')),
  90900::NUMERIC,
  'POS T2 : revenue net == total - tax == 90900'
);

SELECT is(
  (SELECT sum(l.debit) - sum(l.credit) FROM journal_entry_lines l
     JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reference_id = current_setting('breakery.je_pos')::uuid
      AND je.reference_type = 'sale'),
  0::NUMERIC,
  'POS T3 : JE équilibrée (Σ debit == Σ credit)'
);

---------------------------------------------------------------------------
-- T4-T6 : vente B2B — comportement CHANGÉ (correction du PB1 fantôme)
---------------------------------------------------------------------------
-- COALESCE : il n'y a désormais AUCUNE ligne 2110 pour une vente hors champ —
-- `journal_entry_lines_check` interdit une ligne nulle, donc pas de taxe ⇒ pas
-- de ligne. C'est aussi le test de non-retour : avant le correctif, 2110 était
-- crédité de round_idr(100000 * 0.1/1.1) = 9100 sur cette vente B2B.
SELECT is(
  (SELECT COALESCE(sum(l.credit), 0) FROM journal_entry_lines l
     JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reference_id = current_setting('breakery.je_b2b')::uuid
      AND je.reference_type = 'sale'
      AND l.account_id = resolve_mapping_account('SALE_PB1_TAX')),
  0::NUMERIC,
  'B2B T4 : aucune ligne 2110 — la vente en gros ne génère PLUS de PB1 fantôme'
);

SELECT is(
  (SELECT sum(l.credit) FROM journal_entry_lines l
     JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reference_id = current_setting('breakery.je_b2b')::uuid
      AND je.reference_type = 'sale'
      AND l.account_id = resolve_mapping_account('SALE_POS_REVENUE')),
  100000::NUMERIC,
  'B2B T5 : revenue net == total — aucune taxe extraite du chiffre d''affaires'
);

SELECT is(
  (SELECT sum(l.debit) - sum(l.credit) FROM journal_entry_lines l
     JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reference_id = current_setting('breakery.je_b2b')::uuid
      AND je.reference_type = 'sale'),
  0::NUMERIC,
  'B2B T6 : JE équilibrée malgré tax = 0 (revenue net == total)'
);

SELECT * FROM finish();
ROLLBACK;
