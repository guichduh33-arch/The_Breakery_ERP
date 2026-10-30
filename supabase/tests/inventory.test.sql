-- supabase/tests/inventory.test.sql
-- Session 12 — pgTAP test suite for inventory MVP RPCs + RLS.
--
-- Runner:
--   docker exec -i supabase_db_The_Breakery_ERP psql -U postgres -v ON_ERROR_STOP=1 \
--     -f - < supabase/tests/inventory.test.sql
--
-- Wrapped in BEGIN…ROLLBACK so the test data never leaks into the live DB.
-- pgTAP requires `ok()` to be invoked via SELECT (PERFORM swallows the row)
-- so DO blocks that need to record an assertion stash their boolean result
-- in a setting (set_config('breakery.tN_pass', ...)) which a follow-up
-- top-level SELECT ok() then asserts.
--
-- Coverage matrix:
--   T1  record_stock_movement_v1: rejects sale movement_type
--   T2  record_stock_movement_v1: rejects quantity = 0
--   T3  adjust_stock_v2: happy path 10 -> 15 (+ audit_logs + signed movement)
--   T4  adjust_stock_v2: idempotent replay (same idempotency_key)
--   T5  adjust_stock_v2: MANAGER lacking inventory.adjust -> forbidden (P0003)
--   T6  adjust_stock_v2: p_new_qty < 0 rejected
--   T7  receive_stock_v1 est DROPPÉE (Q3 audit 2026-07-27 — réception valorisée
--       via le flux PO/achat direct uniquement)
--   T8  record_incoming_stock_v2 existe toujours (entrées non-achat conservées)
--   T9  waste_stock_v2: qty > on-hand -> insufficient_stock (P0002)
--   T10 waste_stock_v2: happy path (current_stock decremented, movement negative)
--   T11 RLS: direct INSERT into stock_movements blocked for `authenticated`
--   T12 get_stock_levels_v4: bucket 'low' filters out rows with threshold = 0
--   T13 Row-lock serialization: two adjusts on same row sum correctly (no lost update)
--   T14 void_order_rpc + complete_order regression (sale_void restores stock)
--   T15 record_stock_movement_v1: REVOKE EXECUTE enforced on `authenticated` role
--   T16 record_incoming_stock_v2: CASHIER -> forbidden (P0003)
--   T17 record_incoming_stock_v2: MANAGER + qty 0 -> quantity_must_be_positive
--   T18 record_incoming_stock_v2: MANAGER happy path (no supplier) — movement row +
--       current_stock bump + audit row
--   T19 record_incoming_stock_v2: MANAGER + soft-deleted supplier -> P0002
--   T20 record_incoming_stock_v2: idempotent replay (same key, identical args)
--   T21 get_stock_counters_v1: total independent of the page window, and readable on an empty result
--   T22 get_stock_levels_v4: search is case-insensitive (ILIKE) — upper/lower both match
--   T23 get_stock_levels_v4: p_category_id filter returns only matching products
--   T24 get_stock_levels_v4: bucket 'low' excludes products with current_stock >= threshold (threshold>0)
--   T25 adjust_stock_v2: p_new_qty=0 sets stock to 0 and emits negative delta movement
--   T26 adjust_stock_v2: key reuse with different reason is rejected
--   T27 waste_stock_v2: reason shorter than 3 chars rejected with reason_required
--   T28 waste_stock_v2: qty > current_stock rejected with insufficient_stock (P0002) — distinct product
--   T41 ADR-024: counters equal the row count of get_stock_levels_v4 for every bucket
--   T42 ADR-024: CASHIER -> forbidden P0003 on get_stock_counters_v1 (negative gate)
--
-- ADR-027 (2026-08-16) : T29-T40 (create/receive/cancel_internal_transfer_v1 +
-- section_stock + RLS internal_transfers) supprimés — feature transferts et ses
-- tables droppées, mono-section. Les numéros T29-T40 restent VACANTS (pas de
-- renumérotation) pour ne pas fausser l'historique des diffs ; T41/T42 gardent
-- leur numéro d'origine.

BEGIN;
\ir helpers/inventory_cases_01.sql
\ir helpers/inventory_cases_02.sql
\ir helpers/inventory_cases_03.sql
ROLLBACK;
