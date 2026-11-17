-- Plan comptable propre à la société : intégration de la charte de Mamat.
--
-- Décision de Mamat du 2026-11-17 : la charte (44 comptes) s'intègre au plan
-- comptable existant SANS renuméroter les comptes du système. Les émetteurs
-- automatiques, la clôture annuelle et les rapports lisent ces codes ; la
-- production porte déjà son historique d'écritures sur eux.
--
-- Trois cas :
--   1. Même sens qu'un compte existant → le compte garde son code et prend le
--      libellé de la charte (ex. 6111 devient « Salaries & wages », code charte 6100).
--   2. Absent du plan → créé sous le code de la charte quand il est libre.
--   3. Code de la charte déjà pris avec un autre sens → créé sous un code libre
--      voisin : 2210 → 2250 (2210 = dette fidélité), 3300 → 3310 (3300 = résultat
--      de l'exercice), 4900 → 4950 (4900 = remises), 5100 → 5120 (5100 = groupe
--      COGS), 5200 → 5300 (le rapport de résultat range tout 52x en « Waste »).
--      4200 → 4131 et 3200 → 3110 relèvent du cas 1 : même sens, code existant.
--
-- Écart volontaire de libellé : 6121 devient « Taxes & duties (Bapenda) », sans
-- « PB1 ». La PB1 collectée vit en 2110 et son reversement au Bapenda débite
-- 2110 ; un libellé de charge « PB1 » inviterait à la passer deux fois.
--
-- Section de flux de trésorerie posée explicitement à chaque INSERT (le défaut
-- `operating` ferait compter un compte de trésorerie deux fois) : immobilisations
-- → investing ; emprunts, prêt à l'associé (ses prélèvements, soldés en
-- dividende), dettes d'associés, dividendes → financing ; le reste → operating.
--
-- Les catégories de dépenses neuves pointent vers les nouveaux comptes de
-- charge, pour que le workflow de dépenses les alimente sans écriture manuelle.
--
-- Rejouable : ON CONFLICT / NOT EXISTS, et les renommages sont idempotents.

-- 1. Libellés de la charte sur les comptes de même sens.
UPDATE accounts AS a
   SET name = v.name
  FROM (VALUES
    ('1112', 'Bank Mandiri (current account)'),
    ('1114', 'Cash – withdrawals & internal transfers'),
    ('3100', 'Share capital & partner contributions'),
    ('3110', 'Partner current account / drawings'),
    ('4100', 'Counter sales (B2C: card, QR, cash)'),
    ('4131', 'B2B sales (hotels, villas, cafés, restaurants)'),
    ('6111', 'Salaries & wages'),
    ('6113', 'Water, gas & energy'),
    ('6114', 'Small equipment & supplies'),
    ('6115', 'Advertising & marketing'),
    ('6116', 'Maintenance & repairs'),
    ('6118', 'Transport, delivery & fuel'),
    ('6121', 'Taxes & duties (Bapenda)'),
    ('6122', 'Bank charges'),
    ('6190', 'Other operating expenses')
  ) AS v(code, name)
 WHERE a.code = v.code
   AND a.name IS DISTINCT FROM v.name;

-- 2. Comptes absents du plan.
INSERT INTO accounts (code, name, account_class, account_type, balance_type,
                      is_postable, is_system, is_active, cash_flow_section) VALUES
  ('1400', 'Employee advances (cashbon)',                            1, 'asset',     'debit',  true, true, true, 'operating'),
  ('1410', 'Prepaid rent (lease Oct. 2025 – Dec. 2027)',             1, 'asset',     'debit',  true, true, true, 'operating'),
  ('1450', 'Receivable from shareholder (loan granted)',             1, 'asset',     'debit',  true, true, true, 'financing'),
  ('1460', 'Receivable from PT ABT (expenses paid on its behalf)',   1, 'asset',     'debit',  true, true, true, 'operating'),
  ('1600', 'Fixed assets – equipment & furniture',                   1, 'asset',     'debit',  true, true, true, 'investing'),
  ('1610', 'Production machinery & equipment',                       1, 'asset',     'debit',  true, true, true, 'investing'),
  ('1690', 'Accumulated depreciation',                               1, 'asset',     'credit', true, true, true, 'investing'),
  ('2200', 'Loans & financial debts (repayments)',                   2, 'liability', 'credit', true, true, true, 'financing'),
  ('2250', 'Debt – loan in Ines''s name (on behalf of the company)', 2, 'liability', 'credit', true, true, true, 'financing'),
  ('2300', 'Payable to shareholder (loan received)',                 2, 'liability', 'credit', true, true, true, 'financing'),
  ('2400', 'Payable to landlord – remaining lease balance',          2, 'liability', 'credit', true, true, true, 'operating'),
  ('2990', 'Suspense account (to be classified)',                    2, 'liability', 'credit', true, true, true, 'operating'),
  ('3310', 'Dividends paid',                                         3, 'equity',    'debit',  true, true, true, 'financing'),
  ('4300', 'Custom orders / events / transfers sales',               4, 'revenue',   'credit', true, true, true, 'operating'),
  ('4950', 'Other operating income',                                 4, 'revenue',   'credit', true, true, true, 'operating'),
  ('5120', 'Raw materials & food purchases',                         5, 'expense',   'debit',  true, true, true, 'operating'),
  ('5300', 'Packaging purchases',                                    5, 'expense',   'debit',  true, true, true, 'operating'),
  ('6110', 'Social security contributions (BPJS)',                   6, 'expense',   'debit',  true, true, true, 'operating'),
  ('6120', 'Management compensation',                                6, 'expense',   'debit',  true, true, true, 'operating'),
  ('6350', 'Waste collection',                                       6, 'expense',   'debit',  true, true, true, 'operating'),
  ('6400', 'Telephone & Internet',                                   6, 'expense',   'debit',  true, true, true, 'operating'),
  ('6450', 'Software & subscriptions',                               6, 'expense',   'debit',  true, true, true, 'operating'),
  ('6600', 'Professional fees (legal, consulting)',                  6, 'expense',   'debit',  true, true, true, 'operating'),
  ('6810', 'Loan interest',                                          6, 'expense',   'debit',  true, true, true, 'operating'),
  ('6950', 'Depreciation expense',                                   6, 'expense',   'debit',  true, true, true, 'operating'),
  ('6960', 'Allowance for doubtful accounts',                        6, 'expense',   'debit',  true, true, true, 'operating'),
  ('7100', 'Financial income (interest)',                            4, 'revenue',   'credit', true, true, true, 'operating'),
  ('7110', 'Interest income – shareholder',                          4, 'revenue',   'credit', true, true, true, 'operating')
ON CONFLICT (code) DO NOTHING;

-- 3. Catégories de dépenses vers les nouveaux comptes de charge payés comptant.
INSERT INTO expense_categories (code, name, account_id, is_active, description)
SELECT v.code, v.name, a.id, true, v.description
  FROM (VALUES
    ('BPJS',              'BPJS',                '6110', 'Social security contributions (BPJS)'),
    ('MANAGEMENT_COMP',   'Management Pay',      '6120', 'Management compensation'),
    ('WASTE_COLLECTION',  'Waste Collection',    '6350', 'Waste collection service'),
    ('TELECOM',           'Phone & Internet',    '6400', 'Telephone and internet subscriptions'),
    ('SOFTWARE',          'Software',            '6450', 'Software and online subscriptions'),
    ('PROFESSIONAL_FEES', 'Professional Fees',   '6600', 'Legal, accounting and consulting fees'),
    ('LOAN_INTEREST',     'Loan Interest',       '6810', 'Interest paid on loans')
  ) AS v(code, name, account_code, description)
  JOIN accounts a ON a.code = v.account_code
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories c WHERE c.code = v.code);
