# Stock-card ledger layout + CSV export — design

**Date:** 2026-06-18
**Status:** approved (user "go ahead, looks right")
**Scope:** Backoffice — both stock-movement pages reformatted to a running-balance stock card (matching the owner's reference screenshot) with CSV export.

## Goal

Replace the two existing stock-movement tables (signed `quantity` + `value`) with a
spreadsheet-style **stock card** carrying these 13 columns, and let the user export the
loaded rows to CSV:

`date · created_time · ref_no · type · product_group · product · uom · beginning_qty · incoming_qty · outgoing_qty · balance_qty · price · movement_amount`

Two pages converge on the same layout:
- **Reports ▸ Stock Movement History** — `/backoffice/reports/stock-movements` (`reports.inventory.read`)
- **Inventory ▸ Stock Movements** (live) — `/backoffice/inventory/movements` (`inventory.read`)

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Pages | **Both** get the layout + CSV; share one table + hook + CSV column set. |
| `ref_no` | **Generated code** `<PREFIX><yymmdd><8-digit seq>`, per source document (same `reference_id` → same code; rows with null `reference_id` each get their own). Computed client-side, sequenced per prefix within the loaded set. Won't match real document numbers (accepted). |
| `beginning_qty`/`balance_qty` | **Per-product running balance**, seeded with the true opening balance at `p_start`. Requires the full ordered set → **drop cursor pagination**, load the full filtered date range with a row cap. |
| `price` | **Current `products.cost_price`** (WAC) — constant per product, matching the screenshot. |
| `movement_amount` | `quantity × cost_price` (signed). |
| `product_group` | **Product category name** (`categories.name`). |
| Default range | Last 30 days. Live page gains a date bound it didn't have. |
| Row cap | 5000 (max 10000); `truncated` flag → "narrow your filters" banner. CSV exports the loaded rows. |

## Data — new RPC `get_stock_movement_ledger_v1`

```
get_stock_movement_ledger_v1(
  p_start         TEXT,             -- 'YYYY-MM-DD'
  p_end           TEXT,             -- 'YYYY-MM-DD'
  p_product_id    UUID  DEFAULT NULL,
  p_movement_type TEXT  DEFAULT NULL,
  p_section_id    UUID  DEFAULT NULL,
  p_limit         INT   DEFAULT 5000
) RETURNS JSONB   -- { lines: [...], truncated: bool, row_count: int }
```

- `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
- Gate: auth required **AND** (`has_permission(uid,'inventory.read')` OR `has_permission(uid,'reports.inventory.read')`) so both pages' audiences pass.
- REVOKE pair S25 (FROM PUBLIC, anon + ALTER DEFAULT PRIVILEGES). No new table, no new permission.
- The existing `get_stock_movements_v1` (8-arg + 6-arg) and `get_stock_movements_v2` are **left untouched** (other consumers: `MovementHistoryDrawer`, aggregates). They become unused by these two pages; not dropped here.

### Computation

- Clamp `v_limit := LEAST(GREATEST(p_limit,1), 10000)`.
- `v_start := p_start||'T00:00:00Z'`, `v_end := p_end||'T23:59:59Z'`.
- **Predicate** `P` (shared by opening + in-range): product/type/section filters, where section means `(from_section_id = p_section_id OR to_section_id = p_section_id)`.
- **Opening** per product: `SUM(quantity)` over rows matching `P` with `created_at < v_start`.
- **In-range** rows: matching `P` and `created_at BETWEEN v_start AND v_end`, ordered `product_name, created_at, id`.
  - `running := SUM(quantity) OVER (PARTITION BY product_id ORDER BY created_at, id ROWS UNBOUNDED PRECEDING)`
  - `balance_qty := opening + running`
  - `beginning_qty := balance_qty - quantity`
  - `incoming_qty := GREATEST(quantity, 0)`, `outgoing_qty := GREATEST(-quantity, 0)`
  - `price := products.cost_price`, `movement_amount := quantity * COALESCE(cost_price,0)`
  - `product_group := categories.name` (LEFT JOIN), `unit := stock_movements.unit`
  - `created_by_name := user_profiles.full_name`
- Apply `LIMIT v_limit + 1`; emit first `v_limit`, set `truncated := (count > v_limit)`.

> Balance reconciles row-to-row within the **displayed filter set** (opening + running both honour `P`). With a `movement_type`/`section` filter the balance is therefore filter-scoped (documented); the primary unfiltered / product-filtered stock card is exact.

## Domain helpers (pure TS, `packages/domain/src/inventory/`)

- `movementTypeLabel(type)` → `sale`→`POS_SALE`, `opname_in|opname_out`→`OPNAME`, `cost_price_correction`→`COST_CORRECTION`, else `type.toUpperCase()`.
- `movementRefPrefix(type)` → `sale|sale_void`→`SL`, `production*`→`SP`, `purchase|purchase_return`→`PO`, `incoming`→`IN`, `transfer_*`→`TR`, `adjustment*`→`AD`, `opname_*`→`OP`, `waste`→`WS`, `cost_price_correction`→`CC`, `reservation_*`→`RS`, else `MV`.
- `buildMovementRefNo({ movementType, key, date, seq })` → `PREFIX + yymmdd(date) + zeroPad(seq,8)`.
- `assignRefNos(lines)` → walk lines in display order; group by `reference_id ?? 'row:'+id`; per-prefix incrementing sequence; returns `Map<lineId, ref_no>`. Pure, testable.

## Front

- `useStockLedger(params)` — single (non-infinite) `useQuery` over `get_stock_movement_ledger_v1`; returns `{ lines, truncated }`.
- `<StockLedgerTable rows truncated isLoading />` — 13 columns, product-grouped, monospace numerics, incoming green / outgoing red, sticky header, truncation banner. Computes `ref_no` + `type` label via the domain helpers.
- One `CsvColumn<StockLedgerLine>[]` (13 columns) → CSV via existing `buildCsv` + `<ExportButtons>`.
- **Report page**: keep `ReportPage` chrome + `DateRangePicker` + type filter (dropdown rebuilt from the real enum); swap body for `<StockLedgerTable>`; CSV already wired.
- **Inventory page**: keep header + KPI tiles + `MovementsFiltersBar`; swap `DataTable` for `<StockLedgerTable>`; add `<ExportButtons>`; remove "Load more" (full-range load).

## Tests

- **pgTAP** `stock_movement_ledger.test.sql`: opening-balance seed; running balance reconciles (`beginning + net = balance`); incoming/outgoing split; category + cost join; gate denied for a no-perm role; gate passes for `reports.inventory.read`-only; REVOKE pair (anon cannot execute); `truncated` flag.
- **domain unit**: `movementTypeLabel`, `movementRefPrefix`, `buildMovementRefNo`, `assignRefNos` (shared code per reference_id, per-prefix sequencing, null-ref fallback).
- **BO smoke**: both pages render the 13 column headers + CSV button; truncation banner shows when flagged.

## Out of scope

- Persistent global ref_no counter table (chose per-query sequencing).
- Historically-accurate per-movement valuation (chose current WAC, matching screenshot).
- Dropping the legacy `get_stock_movements_v1/v2` RPCs (other consumers remain).
- Section-stock semantics for the balance columns under a section filter (documented as filter-scoped).
