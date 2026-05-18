-- 20260601000014_seed_b2b_payment_bank_mapping.sql
-- Session 24 / Phase 1.A.1 / migration 8
--
-- Pre-flight (refs/2026-05-19-session-24-preflight.md) confirmé :
--   * B2B_AR mapping → 1132 existe déjà (seed S13 20260517000005:106)
--   * SALE_B2B_REVENUE mapping → 4131 existe déjà (seed S13 20260517000005:87)
--   * SALE_PAYMENT_CASH mapping → 1110 existe (seed S13 20260517000001:40)
--
-- Manquant pour S24 : un mapping pour les paiements B2B reçus par virement /
-- carte (DR Bank Operating au lieu de DR Cash on Hand). Le compte 1112
-- "Bank — Operating" existe déjà (seed 20260517000005:24).
--
-- record_b2b_payment_v1 fera :
--   p_method='cash'       → DR SALE_PAYMENT_CASH (1110)
--   p_method≠'cash'       → DR B2B_PAYMENT_BANK  (1112)

INSERT INTO accounting_mappings (mapping_key, account_code, description) VALUES
  ('B2B_PAYMENT_BANK', '1112', 'B2B payment received via bank transfer/card → DR Bank Operating')
ON CONFLICT (mapping_key) DO NOTHING;
