-- 20260505010005_seed_loyalty_accounts.sql
-- Session 3 / migration 5 : plan comptable additions — loyalty accounts
-- ON CONFLICT DO NOTHING to be safe if re-run against existing DB

INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active) VALUES
  ('2210', 'Loyalty Liability', 2, 'liability', 'credit', true, true, true),
  ('4900', 'Sales Discounts',   4, 'revenue',   'debit',  true, true, true)
ON CONFLICT (code) DO NOTHING;
