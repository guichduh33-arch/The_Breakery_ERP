-- 20260525000010_enable_pg_net_extension.sql
-- Session 21 / Sub-phase 1.A.1 — Enable pg_net for EF HTTP calls from pg_cron.
--
-- pg_net is available on this Supabase Pro project (default_version 0.20.0)
-- but was not installed. We enable it here so that cron job
-- `birthday-daily-ef` can use net.http_post to trigger the
-- customer-birthday-notify Edge Function.
--
-- The existing `birthday-notify-daily` cron (jobid 6, calls
-- notify_birthday_customers_v1 DB-side) is preserved as a fallback.
-- Migration 20260525000011 schedules the pg_net-based job alongside it;
-- once the EF is confirmed working the DB-side job can be unscheduled.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
