-- 20260517000220_extend_customers_birthday.sql
-- Session 13 / Phase 6.B — Marketing cascade : birthday cron + GDPR-style
-- marketing consent.
--
-- Adds two nullable columns to `customers` :
--   * `birth_date` DATE — used by the birthday cron (matches on
--     (EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date))).
--   * `marketing_consent` BOOLEAN DEFAULT false — only customers with
--     explicit opt-in receive marketing emails (birthday + future
--     campaigns).
--
-- Indexes :
--   * `idx_customers_birthday` — expression index on month/day so the
--     daily cron scans O(today's birthdays) rather than full table.
--   * `idx_customers_marketing_consent` — partial index for consent=true.

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS birth_date         DATE,
  ADD COLUMN IF NOT EXISTS marketing_consent  BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.birth_date IS
  'Customer date-of-birth. Used by the birthday-notify-daily cron job to identify candidates. Nullable — customers may opt out of providing it.';
COMMENT ON COLUMN public.customers.marketing_consent IS
  'Explicit opt-in for marketing communications (birthday + campaigns). Must be true for the customer to be picked up by notify_birthday_customers_v1().';

CREATE INDEX IF NOT EXISTS idx_customers_birthday
  ON public.customers (
    (EXTRACT(MONTH FROM birth_date)::INT),
    (EXTRACT(DAY   FROM birth_date)::INT)
  )
  WHERE birth_date IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_marketing_consent
  ON public.customers (marketing_consent)
  WHERE marketing_consent = true AND deleted_at IS NULL;

COMMIT;
