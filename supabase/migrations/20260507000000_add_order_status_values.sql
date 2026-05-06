-- 20260507000000_add_order_status_values.sql
-- Session 5 / migration 0 : add 'pending_payment' + 'completed' to order_status enum.
-- Must run in its own migration BEFORE any usage. Postgres rejects new enum values
-- in the same transaction that creates them (SQLSTATE 55P04 "unsafe use of new value").

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'pending_payment';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'completed';
