# Session 13 — Phase 3.A — Purchasing PO Workflow

**Date:** 2026-05-14 (executed)
**Wave:** 3 (Module 7 — Purchasing & Suppliers)
**Complexity:** L (~20-26h, single subagent)
**Migration block:** `20260517000110..000114` (5 migrations)
**Status:** in-progress

## Goal

Net-new V3 Purchase Order workflow with goods-receipt-driven journal
entries. PO lifecycle (`draft → pending → partial → received → cancelled`).
Stock incremented and lots minted on goods receipt; JE
`DR Inventory + DR VAT Input = CR Payable` posts automatically via
existing `create_purchase_journal_entry()` trigger.

## Prerequisite verification (done 2026-05-14)

- `accounting_mappings` rows present and `is_active=true`:
  - `PURCHASE_PAYABLE`  → account_code `2141`
  - `PURCHASE_VAT_INPUT` → account_code `1151`
  - `INVENTORY_GENERAL` → account_code `1141`
  - `PURCHASE_CASH_OUT` → account_code `1110`
- `create_purchase_journal_entry()` exists (Phase 1.A migration `000011`).
  Trigger reads NEW.{subtotal, vat_amount, total, payment_terms,
  received_date, received_by, grn_number}.
- `record_stock_movement_v1(p_product_id, p_movement_type, p_quantity,
  p_reason, p_unit_cost, p_supplier_id, p_idempotency_key, p_unit,
  p_from_section_id, p_to_section_id, p_metadata, p_lot_id)` confirmed.
- `create_stock_lot_v1(p_product_id, p_quantity, p_unit, p_location_id,
  p_expires_at, p_batch_number, p_idempotency_key, p_metadata)` confirmed.
- `suppliers`, `user_profiles`, `products`, `stock_movements`, `stock_lots`,
  `journal_entries`, `sections` tables exist.
- `permissions` schema: columns `code, module, action, description`.
- `role_permissions`: `role_code, permission_code, is_granted`.
- `has_permission(uid, perm)` already covers 12 inventory perms; no
  re-CREATE allowed (CI grep gate).
- `audit_log` (singular) is the active audit table per Phase 2.A pattern.
  `audit_logs` (plural) also exists for compatibility.

## Migrations (5)

1. **`20260517000110_init_purchase_orders.sql`** — Tables
   `purchase_orders`, `purchase_order_items`, `goods_receipt_notes` with
   sequences, RLS, indexes. Adds `purchasing.po.manage`,
   `purchasing.po.create`, `purchasing.po.receive`, `purchasing.po.cancel`,
   `purchasing.po.read` permissions and grants to SUPER_ADMIN/ADMIN/MANAGER.
2. **`20260517000111_create_create_po_rpc.sql`** — `create_purchase_order_v1`
   RPC: manager+, validates items, computes totals (VAT split provided by
   caller), status='pending'. Idempotency via key.
3. **`20260517000112_create_receive_po_rpc.sql`** — `receive_purchase_order_v1`
   RPC: atomic. Per line: create lot upfront if shelf-life set, call
   record_stock_movement_v1 with movement_type='purchase'. Insert
   `goods_receipt_notes` row — trigger emits JE via `create_purchase_journal_entry`.
   Updates PO status based on full/partial receipt.
4. **`20260517000113_attach_purchase_je_trigger.sql`** — Attach
   `trg_create_purchase_je AFTER INSERT ON goods_receipt_notes`.
5. **`20260517000114_create_cancel_po_rpc.sql`** — `cancel_purchase_order_v1`
   RPC: refuse if PO has any GRN (PO_PARTIALLY_RECEIVED) or status='received'
   (PO_ALREADY_RECEIVED); else mark `cancelled`.

## App (BO)

- Feature folder `apps/backoffice/src/features/purchasing/`:
  - Hooks: `usePurchaseOrdersList`, `usePurchaseOrderDetail`,
    `useCreatePurchaseOrder`, `useReceivePurchaseOrder`,
    `useCancelPurchaseOrder`.
  - Components: `POStatusBadge`, `POFormDraft`, `ReceiveDialog`,
    `CancelDialog`, `POPrintView`.
- Pages: `PurchaseOrdersListPage`, `NewPurchaseOrderPage`,
  `PurchaseOrderDetailPage` under `apps/backoffice/src/pages/purchasing/`.
- `routes/index.tsx` — register 3 routes.
- `layouts/BackofficeLayout.tsx` — Purchasing sidebar group with nested items.

## Tests

- pgTAP `supabase/tests/purchasing_po.test.sql` — T_PO_01..15.
- Vitest live `supabase/tests/functions/purchasing-po.test.ts` — full cycle
  including JE balance check.
- BO smoke `apps/backoffice/src/features/purchasing/__tests__/POFormDraft.smoke.test.tsx`.

## DoD checklist

- [ ] 5 migrations applied via MCP `apply_migration`.
- [ ] Types regenerated + committed.
- [ ] `pnpm typecheck` green across all 6 packages.
- [ ] pgTAP T_PO_01..15 green.
- [ ] Vitest live full cycle: create → receive → JE balanced + stock
      incremented + GRN row exists.
- [ ] Cancel before receive OK; after refused.
- [ ] BO pages render; sidebar Purchasing group active; smoke test green.
- [ ] Commits squash-mergeable with Claude co-author.

## Deviations

Tracked as `D-W3-3A-NN` in
`docs/workplan/refs/2026-05-14-session-13-wave-3-deviations.md`.
