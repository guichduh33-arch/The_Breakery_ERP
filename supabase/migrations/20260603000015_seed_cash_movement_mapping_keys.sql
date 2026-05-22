-- 20260603000015_seed_cash_movement_mapping_keys.sql
-- Session 26 / Wave 1.F / migration _015 :
--   Seed mapping keys pour record_cash_movement_v2 JE emission.
--
-- Closes audit finding F-S26-AC-03 (partial — seed only ; v2 RPC in _016).
--
-- 3100 Owner Capital existe déjà (seed S13 _005:42).
-- 1112 Bank Operating existe déjà (seed S13 _005:24, mapping B2B_PAYMENT_BANK).
-- 1110 Cash on Hand existe déjà (mapping SALE_PAYMENT_CASH).
--
-- Nouveaux mapping keys :
--   CASH_MOVEMENT_OWNER_CAPITAL    → 3100 Owner Capital (apport)
--   CASH_MOVEMENT_BANK             → 1112 Bank Operating (transfer)

INSERT INTO accounting_mappings (mapping_key, account_code, description) VALUES
  ('CASH_MOVEMENT_OWNER_CAPITAL', '3100',
    'Owner injects cash into shift → CR Owner Capital (equity)'),
  ('CASH_MOVEMENT_BANK',          '1112',
    'Bank transfer (cash → bank or bank → cash) ; DR or CR depending on direction')
ON CONFLICT (mapping_key) DO NOTHING;
