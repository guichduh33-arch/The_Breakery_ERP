-- Retrait des deux versions remplacées le 2026-11-17 en phase additive.
--
--   - `finalize_opname_v6`, remplacée par `finalize_opname_v7`
--     (20261117000001, S1-10, ADR-038) ;
--   - `get_balance_sheet_v4`, remplacée par `get_balance_sheet_v5`
--     (20261117000003, charte de comptes de la société).
--
-- Condition du retrait, relevée le 2026-11-17 : le back-office publié en
-- production sur `60c20d79` appelle les nouvelles versions et ne nomme plus
-- les anciennes ; aucune fonction SQL ni Edge Function ne les appelle, en dev
-- comme en production ; les tests pgTAP sont repointés dans le même commit.

-- Sans IF EXISTS : une signature fausse doit échouer, pas passer en silence.
DROP FUNCTION public.finalize_opname_v6(uuid, uuid);
DROP FUNCTION public.get_balance_sheet_v4(date);
