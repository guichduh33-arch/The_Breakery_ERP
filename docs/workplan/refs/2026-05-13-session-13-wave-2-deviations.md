# Session 13 — Wave 2 deviations log

> Append-only history of where Wave 2 phase implementations diverged from the
> INDEX expectations. Each phase adds its own section.

---

## Phase 2.B — Reports infra (2026-05-14)

| # | INDEX expectation | Reality | Action taken |
|---|---|---|---|
| 1 | RPCs read `pos_orders` / `pos_order_items` | Actual canonical names are `orders` / `order_items` (cf. `20260503000003_init_pos.sql`) | RPCs target the real table names. No migration adds an alias. |
| 2 | `audit_logs` columns `resource_type` + `resource_id` ; PK UUID | Actual columns `entity_type` + `entity_id` (cf. `20260503000005_init_settings.sql`) ; PK `BIGSERIAL` (BIGINT) | RPC signature reflects real schema (`p_entity_type` ; returns `id BIGINT`). |
| 3 | `staff` table (suggested name) | No dedicated `staff` table — staff identity = `user_profiles` ; `orders.served_by` references `user_profiles(id)` | RPC `get_sales_by_staff_v1` joins `user_profiles`. |
| 4 | Recharts 3.6 (mentioned in module ref §24) | Not installed; 3.x has React 18.3 peer issues with our 18.2 pin | Recharts pinned at `^2.13.0`. Module ref will be updated in a follow-up doc PR. |
| 5 | Single broad `reports.read` permission | The 5 first reports cover sales/inventory/audit categories ; we need finer gating per module ref §13 (`reports.sales`, `reports.inventory`, `reports.audit`, `reports.financial`) | INSERT 4 new permission rows (`reports.sales.read`, `reports.inventory.read`, `reports.audit.read`, `reports.financial.read`) ; grant to `ADMIN` + `MANAGER` roles. `has_permission()` function NOT re-created. |
| 6 | `apply_migration` keeps cloud `schema_migrations` in sync | Cloud ledger is missing all `20260517*` rows (Wave 1 was applied via `execute_sql`) | Phase 2.B uses `apply_migration` for all 7 files. Wave-1 history backfill is **out of scope** of this phase. |
| 7 | INDEX implies 5 separate sub-permissions (`reports.sales`, etc.) without `.read` suffix | Existing convention uses `module.action` (e.g. `inventory.read`, `inventory.adjust`) | Naming aligned with convention → `reports.sales.read`, etc. |
| 8 | "Cursor pagination" without specifying limit cap | Risk of clients passing `p_limit=10_000_000` | RPC clamps to `LEAST(p_limit, 200)` server-side. |

**Net impact**: tests are written against the real schema ; consumer BO hooks shape arguments correctly. No INDEX rewrite needed — this file captures the deltas authoritatively.

---
