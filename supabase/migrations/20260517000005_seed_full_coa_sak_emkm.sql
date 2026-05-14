-- 20260517000005_seed_full_coa_sak_emkm.sql
-- Session 13 / Phase 1.A / migration 10-007 :
--   Full SAK-EMKM Chart of Accounts seed (≈ 37 additional accounts) +
--   complete the 24-key accounting_mappings seed started in 000001.
--
-- Why : the V3 init seeded only 5 accounts (1110, 4100, 2110, 2210, 4900). Full
-- COA covers Cash variants (1111-1116), AR (1131), Inventory split (1141-1143),
-- VAT input (1151), AP (2141), VAT output (2142), PB1 (2143), Capital (3100),
-- CYE (3300 — added in 000004), Revenue split (4111 POS / 4131 B2B), 4190 Discount,
-- 5110 Production COGS (postable, since 5100 GROUP is non-postable), 5210 Waste,
-- 6111-6190 OpEx, plus shift cash variance pair (4910 / 5910).
--
-- The mapping seed in 000001 was partial because FK on accounts(code) required codes
-- to pre-exist. This file (a) creates the missing accounts, (b) backfills the
-- remaining 19 mapping keys.

-- ---------------------------------------------------------------------------
-- (a) Additional COA accounts (idempotent via ON CONFLICT)
-- ---------------------------------------------------------------------------
INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active) VALUES
  -- 1xxx Assets
  ('1100', 'Current Assets',                1, 'asset',     'debit',  false, true, true),
  ('1111', 'Petty Cash',                    1, 'asset',     'debit',  true,  true, true),
  ('1112', 'Bank — Operating',              1, 'asset',     'debit',  true,  true, true),
  ('1113', 'Bank — Savings',                1, 'asset',     'debit',  true,  true, true),
  ('1114', 'Cash in Transit',               1, 'asset',     'debit',  true,  true, true),
  ('1115', 'Cash — QRIS Clearing',          1, 'asset',     'debit',  true,  true, true),
  ('1116', 'Cash — Card Clearing',          1, 'asset',     'debit',  true,  true, true),
  ('1131', 'Accounts Receivable',           1, 'asset',     'debit',  true,  true, true),
  ('1132', 'AR — B2B',                      1, 'asset',     'debit',  true,  true, true),
  ('1141', 'Inventory — General',           1, 'asset',     'debit',  true,  true, true),
  ('1142', 'Inventory — Raw Material',      1, 'asset',     'debit',  true,  true, true),
  ('1143', 'Inventory — Finished Goods',    1, 'asset',     'debit',  true,  true, true),
  ('1151', 'VAT Input (PPN Masukan)',       1, 'asset',     'debit',  true,  true, true),
  -- 2xxx Liabilities
  ('2100', 'Current Liabilities',           2, 'liability', 'credit', false, true, true),
  ('2141', 'Accounts Payable',              2, 'liability', 'credit', true,  true, true),
  ('2142', 'VAT Output (PPN Keluaran)',     2, 'liability', 'credit', true,  true, true),
  ('2143', 'PB1 Restaurant Tax Payable',    2, 'liability', 'credit', true,  true, true),
  -- 3xxx Equity
  ('3000', 'Equity',                        3, 'equity',    'credit', false, true, true),
  ('3100', 'Owner Capital',                 3, 'equity',    'credit', true,  true, true),
  -- 3300 CYE was added in 000004
  -- 4xxx Revenue
  ('4000', 'Revenue',                       4, 'revenue',   'credit', false, true, true),
  ('4111', 'POS Revenue',                   4, 'revenue',   'credit', true,  true, true),
  ('4131', 'B2B Revenue',                   4, 'revenue',   'credit', true,  true, true),
  ('4190', 'Sales Discount (Promo)',        4, 'revenue',   'debit',  true,  true, true),
  ('4910', 'Cash Variance Gain',            4, 'revenue',   'credit', true,  true, true),
  -- 5xxx COGS — 5100 GROUP non-postable ; 5110 / 5210 postable.
  ('5000', 'Cost of Goods Sold',            5, 'expense',   'debit',  false, true, true),
  ('5100', 'Production COGS — Group',       5, 'expense',   'debit',  false, true, true),
  ('5110', 'Production COGS — Direct',      5, 'expense',   'debit',  true,  true, true),
  ('5210', 'Waste Expense',                 5, 'expense',   'debit',  true,  true, true),
  ('5910', 'Cash Variance Loss',            5, 'expense',   'debit',  true,  true, true),
  -- 6xxx Operating Expenses
  ('6000', 'Operating Expenses',            6, 'expense',   'debit',  false, true, true),
  ('6111', 'Salary & Wages',                6, 'expense',   'debit',  true,  true, true),
  ('6112', 'Rent',                          6, 'expense',   'debit',  true,  true, true),
  ('6113', 'Utilities',                     6, 'expense',   'debit',  true,  true, true),
  ('6114', 'Supplies',                      6, 'expense',   'debit',  true,  true, true),
  ('6115', 'Marketing',                     6, 'expense',   'debit',  true,  true, true),
  ('6116', 'Maintenance',                   6, 'expense',   'debit',  true,  true, true),
  ('6190', 'Other Operating Expense',       6, 'expense',   'debit',  true,  true, true),
  ('6510', 'Adjustment Expense (Stock)',    6, 'expense',   'debit',  true,  true, true)
ON CONFLICT (code) DO NOTHING;

-- Adjustment income mirror — uses revenue class so it credits naturally.
INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active)
VALUES ('4510', 'Adjustment Income (Stock)', 4, 'revenue', 'credit', true, true, true)
ON CONFLICT (code) DO NOTHING;

-- Opname income/expense aliases (same accounts as adjustment ; semantically distinct mapping)
-- We map OPNAME_INCOME→4510 and OPNAME_EXPENSE→6510 to keep ledger lean ; if separation is
-- needed later, new accounts can be added and the mapping updated without trigger changes.

-- ---------------------------------------------------------------------------
-- (b) Complete the accounting_mappings seed (the remaining 19 keys ; 5 keys were
--     seeded in 000001 for codes already present in V3).
-- ---------------------------------------------------------------------------
INSERT INTO accounting_mappings (mapping_key, account_code, description) VALUES
  -- Payments (channels)
  ('SALE_PAYMENT_QRIS',           '1115', 'Sale via QRIS → DR Cash — QRIS Clearing'),
  ('SALE_PAYMENT_DEBIT',          '1116', 'Sale via debit card → DR Cash — Card Clearing'),
  ('SALE_PAYMENT_CREDIT_CARD',    '1116', 'Sale via credit card → DR Cash — Card Clearing'),
  -- Revenue split
  ('SALE_B2B_REVENUE',            '4131', 'B2B sale revenue → CR B2B Revenue'),
  -- Purchases
  ('PURCHASE_PAYABLE',            '2141', 'Purchase invoice received on credit → CR AP'),
  ('PURCHASE_VAT_INPUT',          '1151', 'Purchase VAT input → DR VAT Input'),
  ('PURCHASE_CASH_OUT',           '1110', 'Purchase paid cash → CR Cash on Hand'),
  -- Inventory
  ('INVENTORY_GENERAL',           '1141', 'Default inventory bucket → DR/CR Inventory General'),
  ('INVENTORY_RAW_MATERIAL',      '1142', 'Raw material bucket → Inventory Raw Material'),
  ('INVENTORY_FINISHED_GOODS',    '1143', 'Finished goods bucket → Inventory Finished Goods'),
  -- Production
  ('PRODUCTION_COGS',             '5110', 'Production COGS direct → DR Production COGS Direct'),
  -- Stock-movement journal entries
  ('WASTE_EXPENSE',               '5210', 'Waste write-off → DR Waste Expense / CR Inventory'),
  ('ADJUSTMENT_INCOME',           '4510', 'Stock adjustment positive variance → CR Adjustment Income'),
  ('ADJUSTMENT_EXPENSE',          '6510', 'Stock adjustment negative variance → DR Adjustment Expense'),
  ('OPNAME_INCOME',               '4510', 'Opname positive variance → CR Adjustment Income'),
  ('OPNAME_EXPENSE',              '6510', 'Opname negative variance → DR Adjustment Expense'),
  -- Expenses / B2B
  ('EXPENSE_DEFAULT',             '6190', 'Default expense bucket → DR Other Operating Expense'),
  ('B2B_AR',                      '1132', 'B2B AR on credit invoice → DR AR — B2B'),
  -- Shift cash variance
  ('SHIFT_CASH_VARIANCE_INCOME',  '4910', 'Shift overage on close → CR Cash Variance Gain'),
  ('SHIFT_CASH_VARIANCE_EXPENSE', '5910', 'Shift shortage on close → DR Cash Variance Loss')
ON CONFLICT (mapping_key) DO NOTHING;
