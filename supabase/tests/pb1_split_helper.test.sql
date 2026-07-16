-- supabase/tests/pb1_split_helper.test.sql
-- Lot 6a — `_pb1_split_v1` est le SEUL porteur de la formule PB1 (migration _171).
--
-- Verrouille les deux branches du réglage `business_config.tax_inclusive` :
--   inclusive (true, mode d'exploitation actuel) : prix catalogue TTC
--     tax   = round_idr(x * r / (1 + r))   — part embarquée
--     total = x                            — le brut EST le total
--   exclusive (false)                          : prix catalogue HT
--     tax   = round_idr(x * r)             — part ajoutée
--     total = x + tax
--
-- La bascule de `tax_inclusive` est faite DANS la transaction et annulée par le
-- ROLLBACK final — c'est le seul endroit du lot 6a où le mode `false` est exercé.
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

-- Taux figé à 10 % pour que les attendus ne dépendent pas de la config live.
UPDATE business_config SET tax_rate = 0.1000 WHERE id = 1;

SELECT plan(6);

---------------------------------------------------------------------------
-- Mode INCLUSIVE (true) — comportement d'exploitation actuel, à l'identique
---------------------------------------------------------------------------
UPDATE business_config SET tax_inclusive = true WHERE id = 1;

SELECT is(
  (SELECT subtotal FROM _pb1_split_v1(100000)), 100000::NUMERIC,
  'inclusive — subtotal == brut des lignes'
);

SELECT is(
  (SELECT tax_amount FROM _pb1_split_v1(100000)), 9100::NUMERIC,
  'inclusive — tax == round_idr(100000 * 0.1 / 1.1) == 9100 (part embarquée)'
);

SELECT is(
  (SELECT total FROM _pb1_split_v1(100000)), 100000::NUMERIC,
  'inclusive — total == brut, JAMAIS gonflé par la taxe'
);

---------------------------------------------------------------------------
-- Mode EXCLUSIVE (false) — le réglage devient effectif
---------------------------------------------------------------------------
UPDATE business_config SET tax_inclusive = false WHERE id = 1;

SELECT is(
  (SELECT subtotal FROM _pb1_split_v1(100000)), 100000::NUMERIC,
  'exclusive — subtotal == brut des lignes (inchangé)'
);

SELECT is(
  (SELECT tax_amount FROM _pb1_split_v1(100000)), 10000::NUMERIC,
  'exclusive — tax == round_idr(100000 * 0.1) == 10000 (part ajoutée)'
);

SELECT is(
  (SELECT total FROM _pb1_split_v1(100000)), 110000::NUMERIC,
  'exclusive — total == brut + taxe'
);

SELECT * FROM finish();
ROLLBACK;
