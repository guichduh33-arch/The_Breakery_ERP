-- 20260512000000_extend_loyalty_txn_type_refund.sql
-- Session 10 — extend loyalty_txn_type with 'refund' for void/partial-refund reversal entries.
-- Used by void_order_rpc (full reverse + restored redemption) and refund_order_rpc (pro-rata
-- earned deduction). Must come BEFORE 20260512000008/9 which reference it.
--
-- Note: ALTER TYPE ADD VALUE in Postgres ≥ 12 is allowed inside a transaction provided the
-- new value is not USED in the same transaction. Each Supabase migration runs in its own
-- transaction, so subsequent migration files (-008/-009 RPCs) can safely use 'refund'.

ALTER TYPE loyalty_txn_type ADD VALUE IF NOT EXISTS 'refund';
