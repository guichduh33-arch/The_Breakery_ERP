-- 20260525000020_add_cash_flow_section_to_accounts.sql
-- Session 21 / Sub-phase 1.A.2 — Add cash_flow_section ENUM to accounts.
--
-- Adds a new column accounts.cash_flow_section classifying each GL account
-- into operating / investing / financing / none for the cash flow statement.
-- Default is 'operating' (safe for income + expense accounts).
-- Closes D-W6-6A-2 from S13 follow-ups.

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.cash_flow_section AS ENUM ('operating','investing','financing','none');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS cash_flow_section public.cash_flow_section
    NOT NULL DEFAULT 'operating';

COMMENT ON COLUMN public.accounts.cash_flow_section IS
  'S21: cash flow report classification. operating=daily ops, '
  'investing=capex/asset disposals, financing=debt/equity, '
  'none=non-cash or clearing accounts. Default operating.';

-- Seed obvious investing accounts (fixed assets, equipment).
-- Account codes 16% = fixed assets (SAK-EMKM class 1, long-term).
UPDATE public.accounts
   SET cash_flow_section = 'investing'
 WHERE code LIKE '16%'
   AND deleted_at IS NULL;

-- Seed obvious financing accounts (long-term liabilities, equity contributions).
-- Account codes 21% = long-term liabilities (SAK-EMKM class 2, non-current).
-- Account codes 31% = paid-in capital / equity.
UPDATE public.accounts
   SET cash_flow_section = 'financing'
 WHERE (code LIKE '21%' OR code LIKE '31%')
   AND deleted_at IS NULL;

-- Non-cash clearing / suspense accounts (code 999%).
UPDATE public.accounts
   SET cash_flow_section = 'none'
 WHERE code LIKE '999%'
   AND deleted_at IS NULL;

COMMIT;
