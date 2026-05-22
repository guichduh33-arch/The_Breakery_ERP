-- 20260603000019_seed_account_3200_retained_earnings.sql
-- Session 26 / Wave 1.H / migration _019 :
--   Seed compte 3200 Retained Earnings explicit (class 3 Equity).
--
-- Closes audit finding F-S26-AC-XX-mediums (audit V3 medium).
--
-- Contexte : SAK EMKM exige un compte explicit "Laba Ditahan" (Retained
-- Earnings) qui accumule les profits cumulés des exercices antérieurs.
-- Le compte 3300 Current Year Earnings (is_postable=false) calcule LIVE
-- l exercice en cours, mais pas l accumulation historique.
--
-- 3200 = Retained Earnings (cumul historique). Lors de la clôture annuelle
-- (close_fiscal_period_v1 phase 1.I avec p_year_end=TRUE), une JE est émise :
--   DR 3300 (CYE current year)
--   CR 3200 (carry forward to retained earnings)
-- → réinitialise 3300 à 0 pour le nouvel exercice.

INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active)
VALUES ('3200', 'Retained Earnings (Laba Ditahan)', 3, 'equity', 'credit', true, true, true)
ON CONFLICT (code) DO NOTHING;
