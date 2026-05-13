# Session 13 — Wave 3 Deviation Pack

**Date opened:** 2026-05-14
**Status:** open — appended as Wave 3 phases land.

This document records intentional deviations between the Wave 3 INDEX/spec
and the SQL/code that actually landed on staging `ikcyvlovptebroadgtvd` and
in the repo. Each entry covers cause + resolution + verification, mirroring
the Wave 1 / Wave 2 deviation packs.

---

## D-W3-3A-01 — Permission codes use `purchasing.po.*`, not `purchasing.po.manage`

**INDEX spec says:** `has_permission('purchasing.po.manage')` for all writes.
**Real codes inserted:**
- `purchasing.po.read`
- `purchasing.po.create`
- `purchasing.po.receive`
- `purchasing.po.cancel`

### Cause
A single `manage` permission was too coarse for production reality —
manager creates POs but only ADMIN should cancel after partial receipt.
Splitting along action verbs matches the inventory module convention
(`inventory.transfer.create`, `inventory.transfer.receive`,
`inventory.opname.finalize`).

### Resolution
Migration `000110` seeds 4 action-scoped permissions instead of one
`manage`. RLS / RPC gates reference the action-specific code:
- POs visible via `purchasing.po.read` (granted to all back-office roles).
- `create_purchase_order_v1` requires `purchasing.po.create` (SUPER_ADMIN,
  ADMIN, MANAGER).
- `receive_purchase_order_v1` requires `purchasing.po.receive` (same).
- `cancel_purchase_order_v1` requires `purchasing.po.cancel` (same).

### Verification
- `SELECT code FROM permissions WHERE module='purchasing'` returns 4 rows.
- Manager can create + receive + cancel; cashier cannot read.

---

## D-W3-3A-02 — `goods_receipt_notes` carries `subtotal/total/payment_terms` to satisfy `create_purchase_journal_entry()` trigger

**Spec says:** GRN row has `(po_id, received_by, total_amount, vat_amount, notes)`.
**Real columns include extra:** `subtotal`, `total`, `payment_terms`,
`received_date`.

### Cause
`create_purchase_journal_entry()` (Phase 1.A migration `000011`) reads from
NEW: `subtotal`, `vat_amount`, `total`, `payment_terms`, `received_date`,
`received_by`, `grn_number`. Calling the trigger from a GRN that lacks
those columns would short-circuit to zero-value JE.

### Resolution
GRN table mirrors the trigger contract:
- `subtotal` DECIMAL(14,2) NOT NULL — sum of received quantity × unit_cost.
- `vat_amount` DECIMAL(14,2) NOT NULL — pro-rata of PO vat_amount.
- `total` DECIMAL(14,2) NOT NULL — `subtotal + vat_amount`.
- `payment_terms` TEXT NOT NULL DEFAULT 'credit' (CHECK in {'cash','credit'}).
- `received_date` DATE NOT NULL DEFAULT current_date.
- The `total_amount` field requested in the spec is aliased to `total`.

### Verification
- pgTAP T_PO_03 asserts column presence.
- Vitest live cycle: 1 JE per GRN with `total_debit = total_credit = total`.

---

## D-W3-3A-03 — Movement type `purchase` instead of `incoming` for goods receipt

**Inventory primitive history note:** earlier inventory phases used
`incoming` for receive_stock and `purchase` for a separate code path.

### Cause
`movement_type` enum has both `incoming` and `purchase`. Phase 1.A
mappings + Phase 3.A semantics align on `purchase` for any movement
emitted by a PO receipt (lots upfront, JE via `create_purchase_journal_entry`).
The legacy `record_incoming_stock_v1` (no JE) keeps using `incoming`.

### Resolution
`receive_purchase_order_v1` calls
`record_stock_movement_v1(..., p_movement_type='purchase', ...)` per line.
This also matches the existing `tr_20_je_emit` mapping for purchase.

### Verification
- pgTAP T_PO_09 asserts `movement_type='purchase'` on emitted rows.
- Vitest live: assertion on `stock_movements` filter
  `reference_type='purchase_order'` AND `movement_type='purchase'`.

---
