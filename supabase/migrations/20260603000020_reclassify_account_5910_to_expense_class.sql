-- 20260603000020_reclassify_account_5910_to_expense_class.sql
-- Session 26 / Wave 1.H / migration _020 :
--   Reclasser 5910 Cash Variance Loss de class 5 (COGS) → class 6 (OpEx).
--
-- Closes audit finding F-S26-AC-XX-mediums (audit V3 medium).
--
-- Rationale : Cash Variance Loss représente la différence entre cash compté
-- et cash attendu au close_shift_v1 (gap shortage). Ce n est PAS un coût des
-- biens vendus (class 5), c est une charge opérationnelle d exploitation
-- (class 6, similar to pertes et profits divers).
--
-- Impact :
--   - get_profit_loss_v1 : 5910 sortait dans cogs (sous-section "other") →
--     maintenant ressort dans opex (sous-section "other")
--   - get_balance_sheet_v1 : sans impact direct (5910 contribue à CYE via
--     class 4-5-6 net)
--   - Reports historiques : les périodes pré-S26 montreraient ce montant
--     en COGS, post-S26 en OpEx. Pas de rejouage historique (acceptable
--     car V3 jamais déployée en prod).

UPDATE accounts SET account_class = 6 WHERE code = '5910';

-- Note : on ne renomme PAS le compte pour préserver les liens audit_logs et
-- références. Le code reste '5910' (incohérent avec convention 5=COGS / 6=OpEx
-- mais documentaire). Renumber to '6910' deferred to backlog post-S30.
