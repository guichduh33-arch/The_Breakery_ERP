-- 20260526000011_extend_movement_type_with_cost_price_correction.sql
-- Session 22 / Phase 1.B.1 — DEV-S17-1.B-01.
--
-- Split 1/2 of the WAC guard RPC stack. ALTER TYPE ... ADD VALUE cannot be used
-- in the SAME transaction that references the new value (PG 55P04 'unsafe use
-- of new value'). Companion 20260526000012 consumes 'cost_price_correction' in
-- the relaxed CHECK constraint + the update_cost_price_v1 RPC body.
--
-- This file MUST commit alone before 000012 runs. Supabase apply_migration
-- wraps each call in its own tx, so applying these via two separate MCP calls
-- gives the required commit boundary.
--
-- Deviation : the spec's original block reserved 000010..000011 for B.1 (one
-- migration for REVOKE, one for the RPC). PG's enum-in-tx rule forced the RPC
-- migration to split. Tracked as DEV-S22-1.B-01 (informational).

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'cost_price_correction';
