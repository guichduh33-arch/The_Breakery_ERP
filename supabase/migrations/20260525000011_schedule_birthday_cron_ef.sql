-- 20260525000011_schedule_birthday_cron_ef.sql
-- Session 21 / Sub-phase 1.A.1 — pg_net-based birthday cron job.
--
-- Adds a new pg_cron job `birthday-daily-ef` that uses extensions.http_post
-- (pg_net, enabled in migration 20260525000010) to trigger the
-- customer-birthday-notify Edge Function at 02:00 UTC (09:00 ICT).
--
-- The existing `birthday-notify-daily` job (DB-side RPC) is replaced.
-- The DB-side notify_birthday_customers_v1() function is retained as a
-- manual fallback.  Closes D-W6-6B-02.
--
-- DEV-S21-1.A.1-01 (informational): EF auth uses verify_jwt=false +
-- x-cron-secret header check. If BIRTHDAY_CRON_SECRET env var is unset on
-- the EF the call is rejected (fail-closed). A future pass can vault the
-- service_role_key and switch to Bearer auth.

-- Remove old DB-side job and any stale ef job before registering.
DO $$
BEGIN
  PERFORM cron.unschedule('birthday-notify-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$
BEGIN
  PERFORM cron.unschedule('birthday-daily-ef');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- Schedule EF call via net.http_post at 02:00 UTC = 09:00 ICT daily.
SELECT cron.schedule(
  'birthday-daily-ef',
  '0 2 * * *',
  $cron$
    SELECT extensions.http_post(
      url     := 'https://ikcyvlovptebroadgtvd.functions.supabase.co/customer-birthday-notify',
      headers := '{"Content-Type": "application/json", "x-cron-secret": "birthday-cron-daily"}'::jsonb,
      body    := jsonb_build_object('triggered_at', now()::text)
    );
  $cron$
);
