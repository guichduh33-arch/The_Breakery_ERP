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

## D-W3-3C-01 — Reservation RPCs decouple from `record_stock_movement_v1`

**INDEX spec says (line 727):** "integration `record_stock_movement_v1`
types `reservation_hold` / `reservation_release`".
**Real implementation:** `reservation_hold_v1` / `reservation_release_v1` /
`reservation_consume_v1` write only to `stock_reservations` + `audit_log`.
They do NOT call `record_stock_movement_v1`.

### Cause
The Wave 1 `record_stock_movement_v1` primitive unconditionally updates
`section_stock` for any non-zero quantity with `from_section_id` /
`to_section_id`. If a reservation hold called the primitive with
`movement_type='reservation_hold', quantity=-N, from_section_id=X`, then
the section_stock for X would drop by N — virtual hold + physical stock
becomes double-counted. The downstream sale movement (which already
decrements section_stock) would then over-subtract.

Additionally, the primitive hardcodes `reference_type='admin_action'`
internally and refuses `movement_type IN ('sale','sale_void')`, so we can't
fully describe a reservation via the ledger anyway.

### Resolution
- `stock_reservations` table is the source of truth for held quantities.
- Available stock is computed as `current_stock − sum(active holds)` via
  `v_product_available_stock` view (only reservations with `status='held'
  AND expires_at > now()` count).
- Each RPC writes its own `audit_log` row (`stock.reservation.hold`,
  `stock.reservation.release`, `stock.reservation.consume`).
- The `movement_type` enum values `reservation_hold` / `reservation_release`
  remain in `pg_enum` (Wave 1 inv-phase 1.A migration `000020`) for future
  use if section_stock decoupling lands as a separate primitive.

### Verification
- pgTAP T_RSV_03 asserts hold reduces `available_quantity`; T_RSV_04
  asserts release restores it; both work without any `stock_movements` row
  being written.
- Vitest live `stock-reservations.test.ts` confirms idempotent replay +
  insufficient_available_stock raise.

---

## D-W3-3C-02 — `pos_sessions.expected_total` reuses existing `expected_cash` column

**INDEX spec says (line 728):** ALTER `pos_sessions` ADD `expected_total`.
**Real schema:** `pos_sessions` already has `expected_cash NUMERIC(14,2)`
from V3 bootstrap. Migration `000133` reuses it; only adds `cash_in_total`,
`cash_out_total`, `variance_total`, `closing_notes`.

### Cause
Spec author was unaware of the bootstrap column. Duplicating with a new
name would split the source of truth.

### Resolution
`close_shift_v1` writes the computed expected cash to `expected_cash`. The
column comment notes its role (`opening + cash sales + cash_in - cash_out`).

### Verification
- pgTAP T_SHIFT_01a..d asserts presence of the 4 new columns.
- `expected_cash` column inspected via `information_schema.columns` before
  authoring migration.

---

## D-W3-3C-03 — Variance JE uses `reference_type='shift_close'`, not new `shift_variance` reference type

**INDEX implication:** add a new `shift_variance` reference_type entry.
**Real implementation:** reuses the existing `'shift_close'` value already
in the `journal_entries_reference_type_check` CHECK constraint.

### Cause
The `reference_type` CHECK list (set in Phase 1.A migration `000003`)
already contains `'shift_close'`. Adding `'shift_variance'` would require
another constraint patch with no semantic benefit — both terms describe
the same event (variance is emitted only at close).

### Resolution
`close_shift_v1` emits the JE with `reference_type='shift_close'` and
`reference_id=session_id`. One JE per session (idempotency via existence
lookup before insert).

### Verification
- Vitest live `cash-register-close.test.ts` reads
  `journal_entries.reference_type` and asserts `'shift_close'` for both
  over and short variance paths.

---

## D-W3-3C-04 — Variance thresholds stored as columns on `business_config`, not in a KV `app_settings` table

**INDEX spec says (line 731):** seed `variance_threshold_pct=0.5%` and
`variance_threshold_abs=50000 IDR` into `business_config` or `app_settings`.
**Real implementation:** ALTER `business_config` ADD
`shift_variance_threshold_pct NUMERIC(6,4) DEFAULT 0.0050`,
`shift_variance_threshold_abs NUMERIC(14,2) DEFAULT 50000`.

### Cause
`app_settings` table does not exist in V3. `business_config` is a
singleton (id=1) and matches existing config storage convention
(`tax_rate`, `tax_inclusive`, `timezone`). Adding typed columns gives us
CHECK constraints + named accessors instead of stringly-typed KV.

### Resolution
Two new columns with CHECKs:
- `shift_variance_threshold_pct >= 0 AND <= 1` (fraction).
- `shift_variance_threshold_abs >= 0` (IDR).

UI reads `SELECT shift_variance_threshold_pct, shift_variance_threshold_abs
FROM business_config WHERE id=1` to feed `VarianceWarningBadge`.

### Verification
- pgTAP T_SHIFT_08a/b assert column presence.
- Defaults: 0.5% pct, 50000 IDR abs (verified via `column_default` in
  `information_schema.columns`).

---

## D-W3-3C-05 — Mapping keys are `SHIFT_CASH_VARIANCE_INCOME` / `SHIFT_CASH_VARIANCE_EXPENSE`, not `SHIFT_CASH_VARIANCE_OVER` / `SHORT`

**INDEX spec says (line 730):** mappings `SHIFT_CASH_VARIANCE_OVER` and
`SHIFT_CASH_VARIANCE_SHORT`.
**Real keys (already seeded in Phase 1.A migration `000010`):**
- `SHIFT_CASH_VARIANCE_INCOME` (account `4910` — CR Cash Variance Gain)
- `SHIFT_CASH_VARIANCE_EXPENSE` (account `5910` — DR Cash Variance Loss)

### Cause
Phase 1.A author used semantic balance-sheet naming (income vs expense
matching CR vs DR), not directional naming (over vs short). The semantics
are equivalent: positive variance → DR Cash / CR INCOME; negative variance
→ DR EXPENSE / CR Cash.

### Resolution
Migration `000135` (`close_shift_v1`) resolves the existing mappings;
Migration `000136` does NOT seed new mapping keys.

### Verification
- `SELECT mapping_key FROM accounting_mappings WHERE mapping_key LIKE
  'SHIFT_CASH%'` returns the 2 expected rows.
- Vitest live `cash-register-close.test.ts` verifies balanced JE (debit =
  credit) for both directions.

---

## D-W3-3C-06 — Legacy `customers_customer_type_check` CHECK had to be dropped before B2B inserts

**Discovered in:** smoke test of Migration `000130`.

### Cause
A pre-existing CHECK constraint (V2 carryover) pinned
`customer_type = 'retail'::customer_type` even though the
`customer_type` enum supported `'b2b'`. Inserting any B2B row raised
`23514: violates check constraint customers_customer_type_check`.

### Resolution
Migration `000130` drops the legacy CHECK at the end. The `customer_type`
enum continues to guarantee validity (no need for a redundant CHECK).

### Verification
- `SELECT conname FROM pg_constraint WHERE conrelid='customers'::regclass
  AND contype='c'` no longer lists `customers_customer_type_check` after
  migration `000130`.
- pgTAP T_B2B_05 successfully inserts a B2B customer to test over-limit.

---

## D-W3-3C-07 — Role codes in `roles` table are uppercase (`ADMIN`, `MANAGER`, `CASHIER`), not lowercase

**Discovered in:** initial apply attempt of Migration `000136`.

### Cause
Role permissions FK references `roles.code`. The seeded role codes are
`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `CASHIER`, `waiter` (mixed case).
First seed attempt used lowercase `admin` / `manager` / etc. and failed
the FK.

### Resolution
Migration `000136` final seed uses the actual stored case:
`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `CASHIER`, `waiter`. Future phases
should query `roles.code` before seeding role grants.

### Verification
- `SELECT code FROM roles ORDER BY code` returns the 5 known roles.
- Migration `000136` applied successfully on second try.

---
