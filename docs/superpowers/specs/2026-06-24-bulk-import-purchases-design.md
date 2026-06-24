# Phase 2a — Historical Purchases Bulk Import (reports-only) — Design

> **Status:** approved 2026-06-24. Part of the multi-phase bulk-import workstream.
> Phase 1 (master data: suppliers + customers) shipped on `master` (PR #115).
> This is **Phase 2a** — the first transactional-history entity. Sales and Expenses
> are separate later specs. The generic `apps/backoffice/src/features/data-import/`
> framework from Phase 1 is reused unchanged.

## 1. Goal & user intent

Let the user bulk-import **historical purchases** from an Excel `.xlsx` file so that
past purchasing activity shows up in the purchase **reports** and the **Purchase
Orders list**, without any live money-path side effects.

Decisions locked with the user (2026-06-24):

| Question | Decision |
|---|---|
| Phase 2 scoping | **One entity at a time** — Purchases first |
| Money-path side effects | **None** — reports & lists only (no JE, no stock, no GRN) |
| Visibility | **Purchase reports + Purchase Orders list**, marked as historical/imported |
| Multi-line POs | **Grouped by `po_reference`** — one Excel row = one product line |
| `po_reference` storage | **Dedicated traceability column** (`import_reference`), not `notes` |
| Export scope | **Only historical imports** (`is_historical_import = true`) |

## 2. Why direct insert is reports-only safe (verified)

The purchase money-path is **not** triggered by `purchase_orders` rows:

- The purchase JE trigger `trg_create_purchase_je` fires `AFTER INSERT ON
  goods_receipt_notes` (migration `20260517000113`), **not** on `purchase_orders`.
- `stock_movements` are written by `receive_purchase_order_v2` (which inserts the GRN),
  never by inserting a PO.
- The purchase reports read directly from `purchase_orders` + `purchase_order_items`
  with the filter `status NOT IN ('draft','cancelled')`
  (`get_purchase_by_date_v1`, `get_purchase_by_supplier_v1`, `get_purchase_items_v1`).

Therefore inserting a `purchase_orders` row with `status='received'` and its
`purchase_order_items` (with `received_quantity = quantity`) — **without** creating a
`goods_receipt_notes` row and **without** calling `receive_purchase_order_v2` — makes the
purchase appear in every report and the PO list while writing **zero** rows to
`stock_movements`, `goods_receipt_notes`, and `journal_entries`.

**Hard guarantee (asserted by test):** row counts of `stock_movements`,
`goods_receipt_notes`, and `journal_entries` are identical before and after a commit.

## 3. Schema changes

Migration `add_purchase_orders_historical_import_flag`:

- `ALTER TABLE purchase_orders ADD COLUMN is_historical_import BOOLEAN NOT NULL DEFAULT FALSE;`
- `ALTER TABLE purchase_orders ADD COLUMN import_reference TEXT;`
  (the user-supplied `po_reference` grouping key, for traceability; nullable, only set on imports)
- Partial index for the list-page filter/badge:
  `CREATE INDEX idx_po_historical_import ON purchase_orders (is_historical_import) WHERE is_historical_import;`

No change to `purchase_order_items`.

## 4. Excel template (sheet "Purchases")

One row = one product line. Header columns are repeated on every line of the same
`po_reference`; the RPC takes the first non-null value per group and flags
intra-group inconsistencies.

| Column | Required | Type | Notes |
|---|---|---|---|
| `po_reference` | yes | text | in-file grouping key → stored as `import_reference` |
| `supplier_code` | yes | text | resolved to `suppliers.code` (active, not deleted) |
| `order_date` | yes | text | `YYYY-MM-DD`, becomes `order_date` + `received_date` |
| `payment_terms` | no | text | `cash` \| `credit`, default `credit` |
| `notes` | no | text | PO-level note (header) |
| `product_sku` | yes | text | resolved to `products.sku` (active, not deleted) |
| `quantity` | yes | number | > 0 |
| `unit_cost` | yes | number | > 0, per purchase unit (supplier price) |
| `unit` | yes | text | 1–16 chars (matches `purchase_order_items.unit` CHECK) |

The real `po_number` is generated server-side from the existing PO-number sequence;
`po_reference` is only the grouping key and is persisted in `import_reference`.

## 5. RPC `import_purchases_v1(p_payload jsonb, p_dry_run boolean, p_idempotency_key uuid)`

Same contract and conventions as the Phase 1 import RPCs:

- `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
- **Gate** via `has_permission(auth.uid(), '<purchasing create perm>')` — exact permission
  code (`purchasing.po` family) confirmed at plan time against the `permissions` table.
- **Idempotency S25 flavor 2**: `p_idempotency_key` required on commit; stored in the shared
  `import_master_data_idempotency_keys` table (entity = `'purchases'`); replay returns the
  stored report with `idempotent_replay: true`; PK `unique_violation` catch + re-read for races.
- **Anon defense-in-depth (S20)**: `REVOKE ALL … FROM PUBLIC`, `REVOKE EXECUTE … FROM anon`,
  `GRANT EXECUTE … TO authenticated`, `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC`.

**Input:** the flat array of line rows (the generic parser output). The RPC **groups by
`po_reference`** server-side.

**Validation (exhaustive, never fail-fast):**
- `po_reference`, `supplier_code`, `order_date`, `product_sku`, `quantity`, `unit_cost`, `unit` present per row.
- `supplier_code` resolves to a live supplier; else `unknown_supplier`.
- `product_sku` resolves to a live product; else `unknown_product`.
- `quantity > 0`, `unit_cost > 0`; else `invalid_amount`.
- `order_date` matches `YYYY-MM-DD` and is a valid calendar date; else `invalid_date`.
- `payment_terms ∈ {cash, credit}`; else `invalid_payment_terms`.
- Header consistency per `po_reference` group (supplier_code / order_date / payment_terms /
  notes identical across the group's rows); else `inconsistent_header`.

**Summary:** `{ "Purchases": { "purchase_orders_created": N, "line_items_created": M } }`.

**Report JSON shape** (matches Phase 1 `ImportReport`):
`{ valid, errors:[{sheet,row,sku,code,message}], summary, idempotent_replay }`.

**Commit (only when `valid` and not dry-run):** per `po_reference` group, insert one
`purchase_orders` row (`status='received'`, `order_date`, `received_date = order_date`,
`payment_terms`, `is_historical_import=true`, `import_reference = po_reference`,
generated `po_number`, computed `subtotal`/`total`) and its N `purchase_order_items`
(`quantity`, `unit_cost`, `unit`, `received_quantity = quantity`). Writes an `audit_logs`
row (`purchases.imported`). **No GRN, no stock movement, no JE.**

## 6. Live-flow guards

The `is_historical_import=true` flag makes a PO non-operational:

- `receive_purchase_order_v2`, `cancel_po`, `record_po_payment_v1` `RAISE EXCEPTION`
  when called on a historical-import PO (a bumped `_vN+1` per the monotonic-versioning rule,
  or an in-function guard added in the same migration where compatible).
- The PO list page renders an **"Imported"** badge for these rows.

> Plan-time check: confirm the exact current versions of these three RPCs and whether a guard
> can be added without a signature bump. If a bump is required, follow the monotonic
> `_vN → _vN+1` + `DROP FUNCTION … vN` rule and the REVOKE pair.

## 7. UI & framework reuse

The generic `apps/backoffice/src/features/data-import/` framework is reused **unchanged** —
the parser already emits flat rows; the header/line grouping happens entirely in the RPC.

New / modified front-end:
- New `apps/backoffice/src/features/purchasing/import/purchasesImportDef.ts` — the column def
  (section 4), `rpcName: 'import_purchases_v1'`, `sheetName: 'Purchases'`, invalidate the PO
  list query key.
- New `useHistoricalPurchasesExport.ts` — fetches POs with `is_historical_import=true` shaped to
  the template columns (one row per line item, `po_reference = import_reference`).
- Modify `apps/backoffice/src/pages/purchasing/PurchaseOrdersListPage.tsx` — wire (and **add if
  absent**) the Template / Import / Export buttons (Import gated on the PO create permission),
  render the `ImportEntityModal`, and add the "Imported" badge in the row/status cell.

`EntitySummaryGrid` renders the `Purchases` summary generically (no change).

## 8. Testing

- **Vitest** (`apps/backoffice`): `purchasesImportDef` template round-trips through
  `parseEntityWorkbook`; a multi-line fixture (two `po_reference` groups) parses to the
  expected flat rows.
- **pgTAP** (cloud `ikcyvlovptebroadgtvd`, BEGIN/ROLLBACK):
  - dry-run writes nothing;
  - valid commit creates the expected PO(s) in `status='received'` with `is_historical_import=true`;
  - **`stock_movements`, `goods_receipt_notes`, `journal_entries` counts unchanged** (the reports-only guarantee);
  - idempotent replay (same key) does not double-insert;
  - `unknown_supplier` / `unknown_product` / `invalid_amount` / `invalid_date` /
    `inconsistent_header` each flagged invalid with no write;
  - a guarded live RPC (`receive_purchase_order_v2`) raises on a historical-import PO;
  - `anon` denied with `42501`.
- After the migration: regen types → `packages/supabase/src/types.generated.ts` and commit.

## 9. Out of scope

- Historical **Sales** and **Expenses** imports (separate later specs).
- Any live money-path posting for imported purchases (intentionally none).
- Refactoring `catalog-import` onto the shared framework.

## 10. Open items resolved

- (a) `po_reference` storage → **dedicated `import_reference` column**.
- (b) Export scope → **only historical imports** (`is_historical_import = true`).
