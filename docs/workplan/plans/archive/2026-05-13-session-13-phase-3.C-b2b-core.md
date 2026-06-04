# Session 13 — Phase 3.C — B2B core + stock reservations + Cash-Register variance + shift JE

**Branch:** `swarm/session-13`
**Date opened:** 2026-05-14
**Migration block:** `20260517000130..000136` (7 migrations)
**Complexity:** L (~24-30 h)
**Parallel-with:** 3.A (purchasing), 3.B (expenses)

## Scope

Combo phase delivering:

1. **Module 09 (Customers)** — B2B fields on `customers` + `validate_b2b_credit_limit_v1` RPC.
2. **Module 06 (Inventory)** — `stock_reservations` table + hold/release/consume RPCs + pg_cron expiry job + `record_stock_movement_v1` ledger integration (movement_types `reservation_hold`/`reservation_release` already in enum).
3. **Module 12 (Cash Register)** — `pos_sessions` extension (cash_in_total, cash_out_total, variance_total), `cash_movements` table, `record_cash_movement_v1`, `close_shift_v1` RPC that computes variance and emits balanced JE via `SHIFT_CASH_VARIANCE_EXPENSE` / `SHIFT_CASH_VARIANCE_INCOME` mappings, variance threshold config + UI alert.

## Prereq verification (already done)

- `pos_sessions` columns: `id, opened_by, opened_at, opening_cash, opening_notes, closed_at, closed_by, closing_cash, expected_cash, status (shift_status enum: open|closed)`. Need to ADD `cash_in_total`, `cash_out_total`, `variance_total`, `closing_notes`. Reuse existing `expected_cash`.
- `customers` exists with `customer_type` enum (`retail`/`b2b`). Need 5 new columns: `b2b_company_name TEXT, b2b_tax_id TEXT, b2b_payment_terms_days INT, b2b_credit_limit NUMERIC(14,2), b2b_current_balance NUMERIC(14,2) DEFAULT 0`.
- `journal_entries.reference_type` CHECK allows `'shift_close'` (will use for variance JE) and accepts free text for `'reservation'` is **not** in the list — but `stock_movements.reference_type` is free TEXT (and inside `record_stock_movement_v1` it's hardcoded to `'admin_action'`). So reservation ledger entries will reference_type=`admin_action` with metadata.reservation_id; the variance JE will use `'shift_close'`.
- `stock_movements.movement_type` enum already includes `reservation_hold` and `reservation_release` — confirmed via pg_enum.
- `stock_movements.unit` NOT NULL — `record_stock_movement_v1` auto-resolves from products.unit.
- `chk_stock_movements_section_required` — `reservation_hold`/`reservation_release` require either `from_section_id` or `to_section_id`. So reservation RPCs MUST pass `section_id` to either `to_section_id` (hold, since stock is "moved" virtually into hold pool) or analogous slot. **Decision:** use `from_section_id` for hold (out of section availability) and `from_section_id` for release reversal (back into section). Quantity sign: hold uses negative quantity (-qty) to depress sectionStock if linked, release uses positive (+qty). **Refinement:** to keep `section_stock` unchanged (since reservation is virtual), we pass `quantity=0` is rejected by RPC. So we will use SIGNED quantity but exempt section_stock through metadata. Actually the primitive updates section_stock unconditionally for non-zero qty. **Final decision:** to avoid double-counting reservations into section_stock, we will NOT call `record_stock_movement_v1` for reservation hold/release. Instead, reservations are tracked exclusively in `stock_reservations` table; available_qty calculations subtract active holds at query time. Movement ledger entries for reservations are deferred (cleaner audit trail anyway). **Updated Migration 132 scope:** drop the ledger integration; metadata-only audit_log entries instead.
- `accounting_mappings` has `SHIFT_CASH_VARIANCE_EXPENSE` (5910 — short) and `SHIFT_CASH_VARIANCE_INCOME` (4910 — over). `B2B_AR` (1132) and `SALE_B2B_REVENUE` (4131) exist. No new mappings needed — seed only `variance_threshold_pct` and `variance_threshold_abs` business config.
- `has_permission(uuid, text)` is canonical. Need new perms: `shift.close`, `shift.cash_movement`, `customers.b2b.update`, `inventory.reservation.create`, `inventory.reservation.release`.
- `pg_cron` extension available — confirmed.
- `next_journal_entry_number(date)`, `resolve_mapping_account(text)`, `check_fiscal_period_open(date)`, `round_idr(numeric)` all exist.
- `business_config` is a singleton row (id=1) — extend columns rather than KV.

## Migration plan (7 files, all via `apply_migration`)

| # | File | Purpose |
|---|------|---------|
| 130 | `20260517000130_extend_customers_b2b_fields.sql` | ALTER customers ADD 5 B2B columns + index on customer_type. |
| 131 | `20260517000131_create_validate_b2b_credit_limit_rpc.sql` | `validate_b2b_credit_limit_v1(p_customer_id, p_order_amount) RETURNS jsonb` — STABLE, returns `{allowed, current_balance, credit_limit, available, would_exceed_by, customer_type}`. |
| 132 | `20260517000132_init_stock_reservations.sql` | Table `stock_reservations` + RLS (auth READ, RPC-only WRITE) + `reservation_hold_v1`, `reservation_release_v1`, `reservation_consume_v1` RPCs + `release_expired_reservations()` + `cron.schedule('release-expired-reservations', '*/5 * * * *', ...)` + view `v_product_available_stock` (current_stock - active holds). |
| 133 | `20260517000133_extend_pos_sessions_cash_in_out.sql` | ALTER pos_sessions ADD `cash_in_total NUMERIC(14,2) DEFAULT 0`, `cash_out_total NUMERIC(14,2) DEFAULT 0`, `variance_total NUMERIC(14,2)`, `closing_notes TEXT`. |
| 134 | `20260517000134_create_record_cash_movement_rpc.sql` | Table `cash_movements(id, session_id FK pos_sessions, direction TEXT CHECK IN ('in','out'), amount, reason, idempotency_key UUID UNIQUE, created_by, created_at)` + RLS + `record_cash_movement_v1` RPC (manager+ via has_permission, updates aggregate column on pos_sessions). |
| 135 | `20260517000135_create_close_shift_rpc.sql` | `close_shift_v1(p_session_id, p_counted_cash, p_notes, p_idempotency_key) RETURNS jsonb` — perm `shift.close`, computes expected_cash = opening_cash + Σ(cash sales) + cash_in_total − cash_out_total ; variance = counted − expected ; emits JE via mapping (sign-aware) ; sets status='closed'. |
| 136 | `20260517000136_seed_business_config_shift_variance.sql` | ALTER business_config ADD `variance_threshold_pct NUMERIC(5,4) DEFAULT 0.005`, `variance_threshold_abs NUMERIC(14,2) DEFAULT 50000` ; seed perms (`shift.close`, `shift.cash_movement`, `customers.b2b.update`, `inventory.reservation.*`) and grant to manager / admin roles. |

## App files

### Backoffice
- `apps/backoffice/src/features/customers/components/B2BFieldsSection.tsx` (CREATE) — collapsible card with 5 B2B inputs, only visible if `customer_type='b2b'`.
- `apps/backoffice/src/features/customers/__tests__/B2BFieldsSection.smoke.test.tsx` (CREATE) — RTL smoke.

### POS
- `apps/pos/src/features/shift/components/CloseShiftModal.tsx` (CREATE) — Numpad counted-cash entry, variance preview, calls `close_shift_v1`.
- `apps/pos/src/features/shift/components/CashInOutModal.tsx` (CREATE) — mid-shift adjustments.
- `apps/pos/src/features/shift/components/VarianceWarningBadge.tsx` (CREATE).
- `apps/pos/src/features/shift/hooks/useCloseShift.ts` (CREATE).
- `apps/pos/src/features/shift/hooks/useCashMovement.ts` (CREATE).
- `apps/pos/src/features/shift/__tests__/CloseShiftModal.smoke.test.tsx` (CREATE).

### Domain
- `packages/domain/src/inventory/reservations/index.ts` (CREATE).
- `packages/domain/src/inventory/reservations/reservationCalculator.ts` (CREATE) — pure `availableQty(currentStock, activeHolds): number` + helpers.
- `packages/domain/src/inventory/reservations/__tests__/reservationCalculator.test.ts` (CREATE).
- `packages/domain/src/inventory/index.ts` (UPDATE) — re-export reservations barrel.

## Tests

- `supabase/tests/b2b_credit.test.sql` (CREATE, pgTAP) — `T_B2B_01..06`.
- `supabase/tests/stock_reservations.test.sql` (CREATE, pgTAP) — `T_RSV_01..08`.
- `supabase/tests/cash_register.test.sql` (CREATE, pgTAP) — `T_SHIFT_01..08`.
- `supabase/tests/functions/cash-register-close.test.ts` (CREATE, Vitest live) — login as manager (EMP003) + open shift + paid orders + close + assert JE.
- `supabase/tests/functions/stock-reservations.test.ts` (CREATE, Vitest live) — hold/release/consume + expiry cron simulation.

## Working sequence

1. Sub-plan + commit ✓ (this file).
2. Apply migration 130 (B2B fields) + smoke pgTAP.
3. Apply migration 131 (validate_b2b_credit_limit_v1) + pgTAP T_B2B_01..06.
4. Apply migration 132 (stock_reservations + RPCs + cron) + pgTAP T_RSV_01..08.
5. Apply migration 133 (pos_sessions extension).
6. Apply migration 134 (cash_movements + record_cash_movement_v1).
7. Apply migration 135 (close_shift_v1) + pgTAP T_SHIFT_01..08.
8. Apply migration 136 (seed perms + business_config thresholds).
9. Regen types via MCP → write to `packages/supabase/src/types.generated.ts`.
10. Vitest live RPC tests (2 files).
11. Pure domain package (`reservations/`).
12. Backoffice + POS UI components + smoke tests.
13. `pnpm typecheck`. Fix any drift.
14. Append deviations to `docs/workplan/refs/2026-05-14-session-13-wave-3-deviations.md` (create if missing).
15. Final commits per scope (migrations, domain, UI, tests, docs).

## DoD checklist

- [ ] 7 migrations applied via MCP.
- [ ] `types.generated.ts` regenerated and committed.
- [ ] `pnpm typecheck` green.
- [ ] `validate_b2b_credit_limit_v1` returns `allowed=false` when balance + order > credit limit.
- [ ] Stock reservation expires after `expires_at` via `release_expired_reservations()` (cron job scheduled).
- [ ] `close_shift_v1` emits balanced JE through `SHIFT_CASH_VARIANCE_*` mappings (debit = credit, lines reference cash account 1110).
- [ ] Cash-in/out modal records into `cash_movements` and updates `pos_sessions.cash_in_total`/`cash_out_total`.
- [ ] Variance threshold (abs 50000 IDR or 0.5%) triggers UI warning badge.
- [ ] pgTAP + Vitest live + RTL smokes green.
- [ ] Commits squash-mergeable, Claude co-author.

## Decisions / deviations carried forward

- **D-W3-3C-01:** Reservation RPCs do **NOT** call `record_stock_movement_v1`. Reason: section_stock would be double-counted (virtual hold vs physical stock). Instead, available_qty = current_stock − sum(active holds) via view `v_product_available_stock`. Audit trail lives in `stock_reservations` rows + audit_log entries from RPCs.
- **D-W3-3C-02:** `pos_sessions.expected_total` (per spec) renamed to reuse existing `expected_cash` column (already in schema). Spec migration 133 only adds `cash_in_total`, `cash_out_total`, `variance_total`, `closing_notes`.
- **D-W3-3C-03:** Variance JE uses `reference_type='shift_close'` (already in CHECK list). No new reference_type needed.
- **D-W3-3C-04:** Business config thresholds stored as columns on singleton `business_config` (not KV `app_settings` — that table doesn't exist).
- **D-W3-3C-05:** Reservation movement_type enum values `reservation_hold`/`reservation_release` already exist in `movement_type` enum (Wave 1 phase 1.A migration `000020`) — no enum extension needed in this phase. (Confirmed in pg_enum.)
