-- 20260701000010_alter_po_items_add_unit_factor.sql
-- Session 46 / Wave A2 — Add unit_factor_to_base to purchase_order_items.
--
-- R2 (Spec §3): the PO line now carries a conversion factor so the receive RPC
-- can convert received_qty × unit_factor_to_base into base units before calling
-- record_stock_movement_v1. The stock ledger always lives in the product's base
-- unit (products.unit); the PO line unit may differ (e.g., "box" with factor 12
-- when the base unit is "pcs").
--
-- Design decisions (D5):
--   • Single source of truth: conversion is computed IN-RPC
--     (receive_purchase_order_v2). We do NOT add a generated base_quantity
--     column to avoid duplicating the arithmetic.
--   • DEFAULT 1: existing rows keep neutral factor (unit = base unit) so no
--     backfill is needed.
--   • NOT NULL: a NULL factor would silently nullify the conversion; DEFAULT 1
--     ensures the DB-level constraint is always satisfied for old rows.
--
-- The column is also used by update_purchase_order_v1 (A6) when replacing
-- line items.

ALTER TABLE purchase_order_items
  ADD COLUMN unit_factor_to_base NUMERIC(20,10) NOT NULL DEFAULT 1;

-- Validate: factor must be > 0 (a factor of 0 would erase stock).
ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_unit_factor_positive
    CHECK (unit_factor_to_base > 0);

COMMENT ON COLUMN purchase_order_items.unit_factor_to_base IS
  'Session 46 — S46-A2. Conversion factor: 1 PO-line unit = unit_factor_to_base '
  'base units (products.unit). DEFAULT 1 = PO unit equals base unit. Must be > 0. '
  'receive_purchase_order_v2 multiplies received_qty × this factor before calling '
  'record_stock_movement_v1 so the stock ledger stays in base units.';
