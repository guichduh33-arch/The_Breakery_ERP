-- 20260525000012_fix_birthday_cron_ef_net_schema.sql
-- Session 21 / Sub-phase 1.A.1 — corrective: fix net.http_post schema + arg order.
--
-- Migration _011 used extensions.http_post with named params; the actual
-- function is net.http_post(url, body, params, headers, timeout_ms) in the
-- `net` schema with positional args.
-- Replace the cron job command with the correct positional call.

DO $$
BEGIN
  PERFORM cron.unschedule('birthday-daily-ef');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'birthday-daily-ef',
  '0 2 * * *',
  $cron$
    SELECT net.http_post(
      'https://ikcyvlovptebroadgtvd.functions.supabase.co/customer-birthday-notify',
      jsonb_build_object('triggered_at', now()::text),
      '{}'::jsonb,
      '{"Content-Type": "application/json", "x-cron-secret": "birthday-cron-daily"}'::jsonb
    );
  $cron$
);
