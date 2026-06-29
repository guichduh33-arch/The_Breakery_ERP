# Session 52 — INDEX — B2B per-invoice settlement (P1.2)

> Branch `swarm/session-52` (base `docs/curation-2026-06-28` → #132 + curated CLAUDE.md)
> Spec `docs/superpowers/specs/2026-06-29-b2b-per-invoice-settlement-design.md`
> Plan `docs/superpowers/plans/2026-06-29-b2b-per-invoice-settlement.md`
> DB layer applied + verified live on cloud `ikcyvlovptebroadgtvd` (MCP, controller).
> Closes audit findings **T5 / C3 / C4** (`docs/workplan/audits/2026-06-27-audit-integral-par-module.md`).

## 1. Summary

- **C3 closed** — B2B payments now settle individual invoices. New append-only ledger
  `b2b_payment_allocations`; `record_b2b_payment_v2` writes real allocation rows and sets
  `orders.paid_at` + `status='paid'` on full settlement (v1 only wrote a metadata JSONB and
  never touched `paid_at`, so `view_b2b_invoices.is_unpaid` was TRUE for life).
- **C4 closed** — single source of truth. `view_b2b_invoices`/`view_ar_aging` rebuilt on
  `outstanding = total − Σ amount_applied`; `get_pos_b2b_debts_v3` derives B2B `paid` from the
  allocation ledger (retail ardoise still from `order_payments`). POS and BO now agree.
- **T5 closed** — `cancel_b2b_order_v1` (reverse JE + stock via `sale_void` + AR balance,
  `status='voided'`, blocked if any allocation); `create_b2b_order_v2` re-checks the credit limit
  **after** the customer `FOR UPDATE` lock (TOCTOU); dedicated perms `b2b.payment.record` /
  `b2b.order.cancel` replace the generic `customers.update` gate on payment recording.
- **Reconcile** — `reconcile_b2b_balance_v1` (read-only, gate `b2b.read`) flags drift between the
  cached `b2b_current_balance` and the ledger-derived outstanding (alert only, decision D3).
- **Allocation mode** — targeted invoice list (array order) + FIFO fallback (decision D1).
- **pgTAP** — new `b2b_settlement.test.sql` 14/14 green; existing B2B suites realigned to v2/v3.

## 2. Migrations applied (local NAME-block → cloud version clock-assigned)

| File timestamp | Object |
|---|---|
| `20260710000065_create_b2b_payment_allocations` | append-only ledger + RLS + REVOKE pair (SELECT-only authenticated) + indexes + FK |
| `20260710000066_seed_b2b_payment_record_cancel_perms` | perms `b2b.payment.record` + `b2b.order.cancel` → SUPER_ADMIN/ADMIN/MANAGER |
| `20260710000067_record_b2b_payment_v2` | targeted+FIFO allocation, sets `paid_at`/`status=paid`; DROP v1; REVOKE pair |
| `20260710000068_cancel_b2b_order_v1` | new RPC (+ extend `journal_entries_reference_type_check` with `b2b_order_cancel`); REVOKE pair |
| `20260710000069_create_b2b_order_v2_toctou` | credit re-check post-lock; DROP v1; REVOKE pair |
| `20260710000070_rebuild_b2b_views_outstanding` | `view_b2b_invoices` (+amount_paid/outstanding, exclude voided) + `view_ar_aging` (sum outstanding) |
| `20260710000071_get_pos_b2b_debts_v3` | B2B paid from allocations; DROP v2; REVOKE pair |
| `20260710000072_reconcile_b2b_balance_v1` | read-only cache↔ledger drift; REVOKE pair |

> One controller-applied corrective (same-session, pre-merge, `CREATE OR REPLACE`):
> `cancel_b2b_order_v1` set void metadata (`voided_at`/`voided_by`/`void_reason`) to satisfy
> `chk_orders_void_consistency` — folded back into file `_068`.

## 3. New files

- **Migrations**: 065–072 (above).
- **DB tests**: `supabase/tests/b2b_settlement.test.sql` (T1–T14) — **14/14 PASS**.
- **Client**: `apps/backoffice/src/features/btob/hooks/useCancelB2bOrder.ts`.
- **Spec**: `docs/superpowers/specs/2026-06-29-b2b-per-invoice-settlement-design.md`.
- **Plan**: `docs/superpowers/plans/2026-06-29-b2b-per-invoice-settlement.md`; this INDEX.

## 4. Files modified

- `apps/backoffice/.../btob/hooks/useRecordB2bPayment.ts` — v2 + optional `invoiceIds`; return `allocations[]`.
- `apps/backoffice/.../btob/hooks/useCreateB2bOrder.ts` — v2 (TOCTOU).
- `apps/backoffice/.../pages/btob/B2BPaymentsPage.tsx` — `canRecord` gate → `b2b.payment.record`.
- `apps/pos/.../customers/hooks/useOutstandingDebts.ts` — `get_pos_b2b_debts_v2` → `v3`.
- `packages/supabase/src/rls/permissions.ts` — `PermissionCode` += `b2b.balance.adjust`, `b2b.payment.record`, `b2b.order.cancel`.
- `packages/supabase/src/types.generated.ts` — regenerated post-apply.
- `supabase/tests/{b2b_foundation,b2b_order_flag_aware_stock,customers_pii_gate}.test.sql` + `functions/record-b2b-payment.test.ts` + `btob/__tests__/b2b-foundation.smoke.test.tsx` — realigned to v2/v3.

## 5. Tests run (live, MCP `execute_sql`, BEGIN/ROLLBACK, by lead)

| Suite | Count | Status |
|---|---|---|
| `b2b_settlement` (new) | 14 | PASS |
| `b2b_order_flag_aware_stock` (realigned) | 3 | PASS (0 failures) |
| `record_b2b_payment_v2` guards (overpayment, non-b2b) | 2 | PASS |
| `pnpm typecheck` (supabase + backoffice + pos) | — | PASS |
| `pnpm build` (turbo) | — | PASS |
| BO smoke `b2b` (`b2b-foundation` + `B2BFieldsSection`) | 7 | PASS |

> `usePaymentFlowLogic.test` (Vitest) remains the pre-existing **env-gated** baseline failure
> (`VITE_SUPABASE_URL`) — unrelated, not a regression.

## 6. RPCs / objects added / bumped

| Action | Object | Notes |
|---|---|---|
| add | table `b2b_payment_allocations` | append-only allocation ledger |
| add | `cancel_b2b_order_v1` | reverse JE/stock/balance; block if allocated |
| add | `reconcile_b2b_balance_v1` | read-only drift alert |
| bump | `record_b2b_payment_v1 → v2` | targeted+FIFO allocation, `paid_at`; DROP v1 |
| bump | `create_b2b_order_v1 → v2` | credit re-check post-lock (TOCTOU); DROP v1 |
| bump | `get_pos_b2b_debts_v2 → v3` | B2B paid from allocations; DROP v2 |
| add | perms `b2b.payment.record`, `b2b.order.cancel` | SUPER_ADMIN/ADMIN/MANAGER |

## 7. Decisions (spec D1–D4, validated 2026-06-29)

- **D1** — allocation = targeted (`p_invoice_ids` array order) + FIFO fallback.
- **D2** — `cancel_b2b_order_v1` blocked if any allocation (`order_has_payments`); credit-notes stay backlog.
- **D3** — keep `b2b_current_balance` cache; reconcile RPC is alert-only (no auto-fix).
- **D4** — settled invoice → `status='paid'`+`paid_at`; cancelled → `status='voided'` (no `cancelled` enum).

## 8. Deviations vs spec/plan

| ID | Section | What happened | Reason | Risk |
|---|---|---|---|---|
| DEV-S52-01 | Stock reversal | cancel uses `movement_type='sale_void'` (not `'adjustment'` as the plan hinted) | `adjustment` requires a `reason` per `chk_stock_movements_reason_required`; `sale_void` is the semantic inverse and exempt | Informational |
| DEV-S52-02 | Void metadata | cancel sets `voided_at/voided_by/void_reason` | `chk_orders_void_consistency` requires them when `status='voided'` | Informational (corrected pre-merge) |
| DEV-S52-03 | UI scope | invoice multi-select in `RecordB2bPaymentModal` + invoice-level Cancel button **deferred** | No per-invoice list surface exists in the BO (aggregate per-customer only); building one exceeds the "minimal" intent. FIFO default fully closes the functional gap; `useCancelB2bOrder` + `invoiceIds` are wired and ready for a future invoice-list surface | Follow-up |
| DEV-S52-04 | Allocation timing | allocation loops run **after** the `b2b_payments` INSERT (FK needs `payment_id`); legacy `allocation` JSONB snapshot back-filled via `UPDATE` | FK ordering | Informational |

## 9. Acceptance criteria (spec §11)

- [x] **A1** — `b2b_payment_allocations` append-only (anon no SELECT; authenticated SELECT-only).
- [x] **A2** — payment links to specific invoice(s); full settlement sets `paid_at`+`status=paid` (C3).
- [x] **A3** — targeted allocation honors array order; remainder → FIFO.
- [x] **A4** — POS (`get_pos_b2b_debts_v3`) == BO (`view_b2b_invoices`) outstanding (C4).
- [x] **A5** — `cancel_b2b_order_v1` reverses JE+stock+balance; blocked when allocated.
- [x] **A6** — `create_b2b_order_v2` re-checks credit after `FOR UPDATE`.
- [x] **A7** — `reconcile_b2b_balance_v1` reports drift.
- [x] **A8** — new perms gate the RPCs; REVOKE pairs complete; v1 RPCs dropped; types regenerated.
- [x] **A9** — existing B2B suites green on the new signatures.

## 10. Deferred (vague suivante / follow-ups)

1. **Invoice-list UI** (DEV-S52-03): BO per-invoice list surface → adopt targeted allocation
   (`invoiceIds`) in `RecordB2bPaymentModal` + invoice-level Cancel button (`useCancelB2bOrder`).
2. **Unify stock deduction** via `record_stock_movement_v1` across sale/combo/modifier/B2B (T2 / P1.4).
3. **Accounting correctness** (T6 / P1.3): TB cumulative as-of, PB1 void+refund dedup, fiscal guard fail-closed.
4. **Credit-notes / refund-on-cancel** (TASK-09-014).
5. **CI live-RPC** — B2B suites stay out of CI until `SUPABASE_SERVICE_ROLE_KEY` is configured (audit C6).
