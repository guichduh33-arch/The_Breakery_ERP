-- supabase/tests/sale_je_reads_order_tax_amount.test.sql
-- Lot 6a (3/8) — `create_sale_journal_entry` lit `orders.tax_amount` et ne
-- recalcule plus la part PB1 depuis `total`.
--
-- Deux comportements verrouillés ici :
--
--   T1-T3  Vente POS — INCHANGÉ. La JE crédite 2110 du montant porté par la
--          commande, l'équilibre tient. Non-régression du cas nominal.
--
--   T4-T6  Vente B2B — CHANGÉ deux fois, l'un renforçant l'autre :
--
--          (1) 2026-07-17 — `create_b2b_order_v6` écrit tax_amount = 0 (vente
--          en gros hors champ PBJT, ADR-005, décision propriétaire). AVANT ce
--          correctif, le trigger recalculait round_idr(total * r/(1+r)) et
--          créditait 2110 malgré tout : 81 600 IDR de PB1 fantôme sur la V3
--          dev, soit 9,38 % du PB1 déclaré, remontant jusqu'au Bapenda via
--          calculate_pb1_payable_v1 (qui somme les crédits de 2110). Une
--          régression trouvée en écrivant CE correctif : avec tax_amount = 0,
--          la ligne PB1 devenait (debit=0, credit=0) et violait
--          `journal_entry_lines_check` — le trigger levait une exception et
--          le paiement B2B échouait. D'où la garde `IF v_vat > 0` dans le
--          trigger (toujours en vigueur, elle protège encore la vente POS
--          normale à tax_amount = 0 le cas échéant).
--
--          (2) 2026-08-18 (migration 20260818000006) — le point (1) ne
--          suffisait pas : les commandes B2B passées `paid` par
--          `record_b2b_payment` (SANS aucune ligne `order_payments` — le
--          règlement B2B vit dans `b2b_payments`, pas `order_payments`)
--          retombaient dans le fallback cash du trigger et faisaient émettre
--          une SECONDE JE de revenu (reference_type='sale', CR 4100 sur
--          SALE_POS_REVENUE) en plus de la JE `b2b_order` déjà posée à la
--          création (DR 1132 / CR 4131) — revenu doublé, confirmé sur 10
--          commandes dev. Le correctif ajoute une garde en tête du trigger :
--          `order_type = 'b2b'` (ou une JE `reference_type='b2b_order'`
--          préexistante référençant la commande) court-circuite tout le
--          trigger — AUCUNE JE 'sale' n'est plus émise pour une commande B2B,
--          quel que soit son contenu. T4-T6 vérifient maintenant cette
--          absence totale, pas seulement l'absence de la ligne PB1.
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
-- T4-T6 : vente B2B — AUCUNE JE 'sale' n'est plus émise du tout (garde
-- 20260818000006). Le revenu B2B vit exclusivement dans la JE
-- reference_type='b2b_order' (DR 1132 AR-B2B / CR 4131 SALE_B2B_REVENUE)
-- posée par create_b2b_order au moment de la création de la commande — ce
-- fixture n'en insère pas ici, seul le comportement du trigger sur `orders`
-- est sous test.
---------------------------------------------------------------------------
-- T4 : aucune ligne 2110 — reste vrai (COALESCE 0), mais pour une raison plus
-- large qu'avant 2026-08-18 : il n'y a maintenant AUCUNE JE 'sale' du tout
-- pour cette commande, PB1 fantôme y compris.
SELECT is(
  (SELECT COALESCE(sum(l.credit), 0) FROM journal_entry_lines l
     JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reference_id = current_setting('breakery.je_b2b')::uuid
      AND je.reference_type = 'sale'
      AND l.account_id = resolve_mapping_account('SALE_PB1_TAX')),
  0::NUMERIC,
  'B2B T4 : aucune ligne 2110 — plus de PB1 fantôme (renforcé : plus aucune JE ''sale'' du tout)'
);

-- T5 : CHANGÉ 2026-08-18 — avant la garde, la commande B2B se voyait créditer
-- SALE_POS_REVENUE de 100000 (revenu doublé avec la JE b2b_order de création).
-- Depuis la garde, il n'y a plus de ligne 4100 non plus : COALESCE(sum,0) = 0.
SELECT is(
  (SELECT COALESCE(sum(l.credit), 0) FROM journal_entry_lines l
     JOIN journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reference_id = current_setting('breakery.je_b2b')::uuid
      AND je.reference_type = 'sale'
      AND l.account_id = resolve_mapping_account('SALE_POS_REVENUE')),
  0::NUMERIC,
  'B2B T5 : aucune ligne 4100 SALE_POS_REVENUE — le trigger n''émet plus de JE ''sale'' pour une commande B2B (fix revenu doublé)'
);

-- T6 : CHANGÉ 2026-08-18 — avant la garde, une JE 'sale' équilibrée existait
-- bel et bien pour cette commande (c'était le bug : équilibrée mais en trop).
-- Le test de non-retour porte maintenant sur l'ABSENCE totale de cette JE.
SELECT is(
  (SELECT count(*) FROM journal_entries je
    WHERE je.reference_id = current_setting('breakery.je_b2b')::uuid
      AND je.reference_type = 'sale'),
  0::BIGINT,
  'B2B T6 : zéro JE ''sale'' pour la commande B2B — le revenu ne vit que dans la JE ''b2b_order'''
);

SELECT * FROM finish();
ROLLBACK;
