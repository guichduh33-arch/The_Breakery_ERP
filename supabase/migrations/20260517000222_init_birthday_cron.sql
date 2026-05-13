-- 20260517000222_init_birthday_cron.sql
-- Session 13 / Phase 6.B — Marketing cascade : daily birthday notifier.
--
-- Two pieces :
--   1. PL/pgSQL wrapper `notify_birthday_customers_v1()` — iterates
--      customers whose birthday is "today" (in DB default tz) and
--      enqueues one `customer_birthday` notification per customer.
--      Returns the number of rows enqueued.
--   2. pg_cron schedule `birthday-notify-daily` at 09:00 daily (UTC by
--      default — Supabase pg_cron runs in UTC).
--
-- Eligibility :
--   - customer.deleted_at IS NULL
--   - customer.birth_date IS NOT NULL
--   - EXTRACT(MONTH FROM birth_date) = today AND EXTRACT(DAY) = today
--   - customer.email IS NOT NULL AND length(email) > 0
--   - customer.marketing_consent = true (D-W6-6B-01 opt-in gate)
--
-- Idempotency :
--   - `enqueue_notification_v1(... p_idempotency_key)` is called with
--     uuid_generate_v5(namespace, format('birthday-%s-%s', customer.id, today))
--     to prevent the same customer being notified twice if the cron is
--     re-run on the same day.
--
-- See deviation D-W6-6B-02 : we write to outbox via the RPC rather than
-- HTTP-trigger the EF (pg_net not available on staging).

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================================================
-- Wrapper function (includes the search_path fix that originally landed
-- in migration 000223 — folded back here so the file matches the
-- deployed function. uuid_generate_v5 lives in the `extensions` schema
-- on Supabase, so we explicitly include it in search_path).
-- ===========================================================================

DROP FUNCTION IF EXISTS public.notify_birthday_customers_v1();

CREATE OR REPLACE FUNCTION public.notify_birthday_customers_v1()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_today          DATE := current_date;
  v_today_month    INT  := EXTRACT(MONTH FROM current_date)::INT;
  v_today_day      INT  := EXTRACT(DAY   FROM current_date)::INT;
  v_namespace      UUID := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID;
  v_count          INT  := 0;
  v_cust           RECORD;
  v_idem           UUID;
  v_vars           JSONB;
BEGIN
  FOR v_cust IN
    SELECT id, name, email, lifetime_points
    FROM public.customers
    WHERE deleted_at IS NULL
      AND birth_date IS NOT NULL
      AND EXTRACT(MONTH FROM birth_date)::INT = v_today_month
      AND EXTRACT(DAY   FROM birth_date)::INT = v_today_day
      AND email IS NOT NULL
      AND length(trim(email)) > 0
      AND marketing_consent = true
  LOOP
    v_idem := extensions.uuid_generate_v5(
      v_namespace,
      'birthday-' || v_cust.id::TEXT || '-' || v_today::TEXT
    );

    -- Match the seed template variables : customer_name + bonus_points.
    -- bonus_points is a flat 50 placeholder until loyalty_tiers comes
    -- back in V3. Adjust when birthday_bonus_grant() is wired.
    v_vars := jsonb_build_object(
      'customer_name', COALESCE(v_cust.name, 'friend'),
      'bonus_points',  50
    );

    BEGIN
      PERFORM public.enqueue_notification_v1(
        p_template_code   => 'customer_birthday',
        p_recipient       => v_cust.email,
        p_variables       => v_vars,
        p_channel         => 'email',
        p_scheduled_for   => NULL,
        p_idempotency_key => v_idem
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Log + continue : a single bad row should not abort the batch.
      RAISE WARNING 'notify_birthday_customers_v1 skipped customer %: %',
        v_cust.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_birthday_customers_v1() FROM public, anon, authenticated;
-- Only the cron job + postgres role should call this. Manual triggers go
-- through SECURITY DEFINER as `service_role` or `postgres`.
GRANT EXECUTE ON FUNCTION public.notify_birthday_customers_v1() TO service_role;

COMMENT ON FUNCTION public.notify_birthday_customers_v1() IS
  'Session 13 / Phase 6.B — Enqueues a customer_birthday notification for each opted-in customer whose birth_date matches today. Idempotent via uuid_v5(birthday-{cust}-{date}). Returns count enqueued.';

-- ===========================================================================
-- pg_cron schedule
-- ===========================================================================

-- Remove any prior registration (idempotent migration).
DO $$
BEGIN
  PERFORM cron.unschedule('birthday-notify-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END$$;

SELECT cron.schedule(
  'birthday-notify-daily',
  '0 9 * * *',
  $cron$SELECT public.notify_birthday_customers_v1();$cron$
);

COMMIT;
