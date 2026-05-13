# 11 — Shift Open / Close & Cash Reconciliation

> **Last verified**: 2026-05-03
> **Scope**: V2 monolith. Cashier opens a `pos_sessions` row, accumulates orders during the shift, then closes via `close_shift_with_snapshot` RPC which freezes a `shift_snapshots` JSONB payload and posts a variance JE if cash counted differs from expected.
> **Related modules**: [04-modules/12-cash-register-shift.md](../04-modules/12-cash-register-shift.md), [04-modules/03-payments-split.md](../04-modules/03-payments-split.md), [04-modules/10-accounting-double-entry.md](../04-modules/10-accounting-double-entry.md)

---

## 1. Trigger

| Sub-event | Initiator | Permission | Effect |
|---|---|---|---|
| **Open shift** | Cashier opens POS for the first time today (or after previous close) — UI prompts via `OpenShiftModal` | `sales.create` (PIN-verified user) | Create or recover `pos_sessions` row with `status='open'`, `opening_cash`, `opened_by`, `terminal_id` |
| **Recover shift** | Cashier re-opens POS after browser refresh / power loss → `get_user_open_shift(user_id)` returns the orphan row | implicit | UI rebinds to existing session — no new row |
| **Add tip / cash drop** | Cashier records a cash movement during the shift (optional) | `sales.create` | UPDATE `pos_sessions.tips_cash`, `tips_card`, `cash_drops` |
| **Close shift** | Cashier or manager clicks "Close Shift" → `CloseShiftModal` → `close_shift` (V2 legacy) or `close_shift_with_snapshot` (V3 path) RPC | `sales.shift.close` OR cashier IS the `opened_by` | Set `status='closed'`, capture variance, post JE if variance ≠ 0 |
| **Manager validation** | After close, manager opens `ShiftHistoryModal` → marks `manager_validated=true` | `users.create` (manager) | Audit trail; `prevent_update_on_closed_shift` allows ONLY this field |

Two RPC paths coexist in V2:

- **`close_shift`** (legacy V2 monolith): `src/hooks/useShift.ts:357`, returns `CloseShiftResult` with reconciliation
- **`close_shift_with_snapshot`** (V3 path, also seeded in V2 by migration `20260430180000`): SECURITY DEFINER, atomic snapshot + JE, idempotent. New code SHOULD use this one.

---

## 2. Sequence diagram (open + close)

```mermaid
sequenceDiagram
    participant Cashier
    participant POS as POSMainPage
    participant PIN as PIN Modal
    participant Modal as OpenShiftModal / CloseShiftModal
    participant Hook as useShift (useShift.ts)
    participant RPC1 as open_shift / get_user_open_shift
    participant RPC2 as close_shift_with_snapshot
    participant DB as pos_sessions
    participant Snap as shift_snapshots
    participant Trig as create_shift_close_journal_entry
    participant JE as journal_entries + journal_entry_lines
    participant Z as exportShiftZReport (PDF)

    Note over Cashier,POS: SHIFT OPEN
    Cashier->>POS: Open POS for the day
    POS->>PIN: Verify cashier PIN
    POS->>Hook: handleOpenShift(cash, terminal, notes)
    Hook->>RPC1: rpc('get_user_open_shift', { p_user_id })
    alt orphan session found
        RPC1-->>Hook: existing row
        Hook->>POS: setActiveShiftUserId; recover
        POS->>POS: toast "Shift recovered for {user}"
    else none
        Hook->>RPC1: rpc('open_shift', { p_user_id, p_opening_cash, p_terminal_id_str })
        RPC1->>DB: INSERT pos_sessions (status='open', opening_cash, opened_by)
        Note over DB: Partial UNIQUE INDEX prevents 2 open shifts per terminal
        RPC1-->>Hook: new session row
        POS->>POS: toast "Shift opened for {user}"
    end

    Note over Cashier,DB: ORDERS DURING SHIFT
    POS->>DB: orders.pos_session_id = current_session.id (FK)

    Note over Cashier,Z: SHIFT CLOSE
    Cashier->>POS: Click "Close Shift"
    POS->>Modal: Show CloseShiftModal (expected vs counted)
    Cashier->>Modal: Enter actual cash, qris, edc; optional notes
    Modal->>Hook: handleCloseShift(actualCash, actualQris, actualEdc, notes)
    Hook->>RPC2: rpc('close_shift_with_snapshot', { p_session_id, p_closing_cash, p_notes })
    RPC2->>DB: SELECT … FROM pos_sessions WHERE id=… FOR UPDATE
    RPC2->>Snap: Idempotency check: shift_snapshots WHERE session_id=…
    alt snapshot exists
        RPC2-->>Hook: idempotent_replay=true, prior snapshot_id, je_id
    else fresh close
        RPC2->>RPC2: Status guard (open|recounting only)
        RPC2->>RPC2: Authz guard (opened_by==caller OR has 'sales.shift.close')
        RPC2->>DB: SELECT aggregates from orders WHERE pos_session_id=… (cash_total, qris_total, …)
        RPC2->>RPC2: variance = closing_cash − (opening_cash + cash_total − refund_total)
        RPC2->>Snap: INSERT shift_snapshots (payload JSONB schema_v=1)
        RPC2->>DB: UPDATE pos_sessions SET status='closed', closed_at=NOW(), cash_difference=variance, snapshot_id=…
        DB->>Trig: AFTER UPDATE OF status fires create_shift_close_journal_entry
        alt variance != 0
            Trig->>JE: INSERT journal_entries (reference_type='shift_close', total_debit/credit=ABS(variance))
            alt overage (variance>0)
                Trig->>JE: DR Cash 1110 / CR Other Income 4200 (SHIFT_CLOSE_OVERAGE)
            else shortage (variance<0)
                Trig->>JE: DR Admin Expense 5300 / CR Cash 1110 (SHIFT_CLOSE_SHORTAGE)
            end
        end
        RPC2-->>Hook: { snapshot_id, variance, status='closed', je_id }
    end
    Hook->>Modal: setReconciliationData; setClosedShiftStats
    Modal->>Z: Optional Print Z-Report (PDF via exportShiftZReport)
    Modal-->>Cashier: Display variance + manager-validate prompt
```

---

## 3. Étapes détaillées

### 3.1 Open shift

| # | Acteur | Action | Fichier | Lignes |
|---|---|---|---|---|
| 1 | Cashier | Opens POS; if no current shift, PIN modal then `OpenShiftModal` | `src/pages/pos/POSMainPage.tsx` | 271-278 |
| 2 | UI | Submits `(opening_cash, terminal, notes)` | `src/components/pos/shift/OpenShiftModal.tsx` | n/a |
| 3 | Hook | `openShiftMutation.mutateAsync()` first calls `get_user_open_shift(user_id)` to detect orphan sessions | `src/hooks/useShift.ts` | 282-301 |
| 4 | RPC | `get_user_open_shift` returns the open row if any (RLS-bypass via SECURITY DEFINER) | `supabase/migrations/20260205070000_add_missing_shift_lan_functions.sql` | n/a |
| 5 | Hook | If orphan found → recover (no new row, just bind UI) | `src/hooks/useShift.ts` | 296-301 |
| 6 | Hook | Else call `open_shift(p_user_id, p_opening_cash, p_terminal_id_str)` | id. | 304-308 |
| 7 | RPC | INSERT `pos_sessions` (status='open', opening_cash, opened_by, terminal_id, opened_at=NOW(), session_number generated) | `supabase/migrations/` (open_shift fn) | n/a |
| 8 | DB | Partial UNIQUE INDEX `uq_pos_sessions_one_open_per_terminal` enforces "1 open per terminal" | `supabase/migrations/20260430180000_caissapp_shift_snapshots_and_close_rpc.sql` | 172-178 |
| 9 | Hook | `setActiveShiftUserId(userId)`; invalidate `['current-shift']` and `['terminal-shifts']` queries | `src/hooks/useShift.ts` | 327-340 |
| 10 | Hook | onError: toast.error with the RPC message | id. | 342-344 |

### 3.2 During the shift

- Every order created via `complete_order_with_payments` carries `pos_session_id = current_session.id` (FK in `orders` table).
- `cash_register_movements` (or equivalent — `pos_sessions.cash_drops` JSONB) tracks intermediate cash drops if used.
- `pos_sessions.tips_cash` / `tips_card` accumulate from POS-side tip dialogs.

### 3.3 Close shift (V3 path: `close_shift_with_snapshot`)

| # | Acteur | Action | Fichier | Lignes |
|---|---|---|---|---|
| 1 | Cashier | Clicks "Close Shift" → `CloseShiftModal` opens with computed `expectedCash = opening_cash + cash_total` | `src/components/pos/shift/CloseShiftModal.tsx` | 65 |
| 2 | UI | Cashier enters `actualCash`, `actualQris`, `actualEdc`, optional notes (`blindMode` hides expected) | id. | 32-42 |
| 3 | Hook | `closeShiftMutation` → `rpc('close_shift_with_snapshot', { p_session_id, p_closing_cash: actualCash, p_notes })` (V3 path) | `src/hooks/useShift.ts` (legacy path uses `close_shift`) | 357-363 |
| 4 | RPC step 1 | `SELECT … FROM pos_sessions WHERE id = p_session_id FOR UPDATE` (verrou avant idempotence — TWEAK 2) | `supabase/migrations/20260430180000_caissapp_shift_snapshots_and_close_rpc.sql` | 257-262 |
| 5 | RPC step 2 | Idempotency: if `shift_snapshots WHERE session_id=…` exists → return replay JSON | id. | 269-287 |
| 6 | RPC step 3 | Status guard: rejects unless `status IN ('open', 'recounting')` | id. | 290-293 |
| 7 | RPC step 4 | Authorization: `auth.uid() == opened_by` OR `user_has_permission(auth.uid(), 'sales.shift.close')` | id. | 295-313 |
| 8 | RPC step 5 | Aggregate orders: `SUM(total) FILTER (status='completed')`, by `payment_method` (`cash`, `qris`, `card`, `transfer`, `edc`), counts of voids + refunds | id. | 315-336 |
| 9 | RPC | `expected_cash = opening_cash + cash_total − refund_total`; `variance = closing_cash − expected_cash` | id. | 337-338 |
| 10 | RPC step 6 | INSERT `shift_snapshots (session_id, payload, schema_version=1)` — payload includes `order_count, total, cash_total, qris_total, card_total, bank_total, edc_total, void_count, refund_count, discount_total, tip_cash, tip_card, expected_cash, actual_cash, variance, opening_cash, session_number, opened_at, closed_at` | id. | 365-368 |
| 11 | RPC step 7 | `UPDATE pos_sessions SET status='closed', closed_at=NOW(), closed_by=caller, closing_cash=…, cash_difference=variance, snapshot_id=…` | id. | 371-381 |
| 12 | Trigger | `trg_create_shift_close_journal_entry` fires AFTER UPDATE OF status when status transitions to 'closed' | id. | 540-545 |
| 13 | Trigger fn | No-op if `cash_difference = 0` (D-013-001-quater) | id. | 444-446 |
| 14 | Trigger fn | Fiscal-period guard: if `is_fiscal_period_closed(closed_at::DATE)` → skip JE with WARNING | id. | 449-457 |
| 15 | Trigger fn | Idempotency: skip if a JE already exists for `reference_type='shift_close' AND reference_id=NEW.id` | id. | 460-466 |
| 16 | Trigger fn | Branch overage vs. shortage; resolve mapping account; INSERT JE header + 2 lines | id. | 468-531 |
| 17 | RPC step 9 | Return `{ snapshot_id, session_id, variance, status, je_id, idempotent_replay }` | id. | 391-399 |
| 18 | Hook | `setReconciliationData`, `setClosedShiftStats`; invalidate `['current-shift']` and `['terminal-shifts']` queries | `src/hooks/useShift.ts` | 368-382 |
| 19 | UI | Optional `exportShiftZReport({ reconciliation, totalSales, …, openingCash, notes })` → PDF download (jsPDF) | `src/components/pos/shift/CloseShiftModal.tsx` | 68-80 |

### 3.4 Manager validation (post-close)

After close, the row is **immutable** except for two columns: `manager_validated` and `manager_id`. The `prevent_update_on_closed_shift` BEFORE UPDATE trigger (`supabase/migrations/20260430180000_caissapp_shift_snapshots_and_close_rpc.sql:555-607`) raises `shift_closed_immutable: cannot modify locked fields on closed session` if any other column changes.

---

## 4. Tables impactées

| Table | Operations | Notes |
|---|---|---|
| `pos_sessions` | INSERT (open), UPDATE (close), UPDATE (manager validate post-close) | Partial UNIQUE on `(terminal_id) WHERE status='open'` enforces 1-open-per-terminal |
| `shift_snapshots` | INSERT only on close (immutable, JSONB payload, `schema_version=1`) | RLS: SELECT for `is_authenticated()`; no INSERT/UPDATE policy (only SECURITY DEFINER fn writes) |
| `orders` | SELECT (aggregates) | Filtered by `pos_session_id` |
| `journal_entries` | INSERT 1 row when `cash_difference != 0` (`reference_type='shift_close'`) | `entry_number` prefix `'SC'` |
| `journal_entry_lines` | INSERT 2 rows (DR + CR balanced) | Mappings: `SHIFT_CLOSE_OVERAGE` → 4200, `SHIFT_CLOSE_SHORTAGE` → 5300; cash side via `SALE_PAYMENT_CASH` mapping (1110) |
| `accounting_mappings` | SELECT (resolve mapping keys) | Seeded by migration |
| `accounts` | SELECT | Account 4200 (Other Income) and 5300 (Admin Expenses) must exist + `is_postable=TRUE` |

---

## 5. Journal entries (variance only)

### Cash overage (counted > expected, variance > 0)

| Account | Code | Mapping key | Debit | Credit |
|---|---|---|---|---|
| Cash | 1110 | `SALE_PAYMENT_CASH` | `variance` | 0 |
| Other Income | 4200 | `SHIFT_CLOSE_OVERAGE` | 0 | `variance` |

### Cash shortage (counted < expected, variance < 0)

| Account | Code | Mapping key | Debit | Credit |
|---|---|---|---|---|
| Admin Expenses | 5300 | `SHIFT_CLOSE_SHORTAGE` | `ABS(variance)` | 0 |
| Cash | 1110 | `SALE_PAYMENT_CASH` | 0 | `ABS(variance)` |

### No variance (variance = 0)

**No JE posted.** Avoids zero-amount entries (D-013-001-quater).

`reference_type='shift_close'`, `reference_id=session.id`, entry number prefix `SC-`.

---

## 6. Cas d'erreur

| Code / Symptôme | Cause | Recovery |
|---|---|---|
| `shift_not_found` (`02000`) | `p_session_id` doesn't exist | UI shouldn't normally pass invalid IDs; toast error |
| `shift_already_closed` (`22023`) | Status not in `('open', 'recounting')` | UI is showing stale state — invalidate `['current-shift']` |
| `unauthorized_close` (`42501`) | Caller is not `opened_by` AND lacks `sales.shift.close` | Manager must close, OR grant permission |
| `shift_closed_immutable` (`23514`) | Code attempted UPDATE on a closed session (only `manager_validated`/`manager_id` allowed) | Use the manager validation UI; do NOT raw-update closed shifts |
| Unique violation on open | A second `open_shift` while another `status='open'` exists for the same terminal | Recover via `get_user_open_shift`; refuse to open a 2nd |
| Variance is huge / unexpected | Forgot to record cash drop, miscounted, late refund | Use `notes` to explain; manager validates with `manager_validated=true` |
| JE not posted but `cash_difference != 0` | Mapping `SHIFT_CLOSE_OVERAGE` / `SHIFT_CLOSE_SHORTAGE` missing or account NULL | Trigger logs `RAISE NOTICE` and silently skips. Seed mappings (idempotent INSERT in migration) and re-trigger by setting status back-and-forth (manager intervention) |
| Fiscal period closed | `is_fiscal_period_closed(closed_at::DATE)` returns true | Trigger skips JE with WARNING; manager backdates the close to a future open period or re-opens fiscal period |
| Orphan shift after browser crash | `pos_sessions` row stuck `status='open'` | `get_user_open_shift` returns it; UI auto-recovers on next open. Manual cleanup via SQL if user/terminal mismatch |
| Idempotent replay returns previous snapshot | RPC re-called with same `p_session_id` (e.g. retry after timeout) | Expected — `idempotent_replay=true` flag in response. Display the prior snapshot. |

---

## 7. Tests

| Type | Fichier | Coverage |
|---|---|---|
| Embedded SQL smoke | `supabase/migrations/20260430180000_caissapp_shift_snapshots_and_close_rpc.sql` (lines 611-679) | TEST 1: payload CHECK rejects incomplete; TEST 2: partial UNIQUE rejects 2nd open shift |
| Unit | `src/hooks/__tests__/useShift.test.ts` (if present) | Mutations, optimistic updates, error mapping |
| Manual E2E | n/a | Open shift, ring 5 orders (mix cash/qris), close with deliberate +500 IDR overage; verify JE in `/accounting/journals` filtered by `reference_type='shift_close'` |
| Integration | n/a | Re-call `close_shift_with_snapshot` with same id → expect `idempotent_replay=true` |

---

## 8. Pitfalls

1. **Two close paths coexist.** V2 still has `close_shift` RPC (`useShift.ts:357`). New code must call `close_shift_with_snapshot` for atomicity, immutable snapshot, and JE generation. Migrate UI gradually.
2. **Variance sign convention**. `variance > 0` = overage (more cash than expected → income). `variance < 0` = shortage (less cash → expense). The trigger uses `NEW.cash_difference > 0` as the branch (line 469). Do not invert.
3. **Refunds are subtracted from expected cash**, not added to a separate refund account. `expected_cash = opening_cash + cash_total − refund_total` (line 337). If a refund was paid in cash from the drawer, the expected drops accordingly.
4. **Voids are NOT subtracted**. A voided order's cash never entered the drawer (it was reversed at void time). The trigger counts voids only for the snapshot statistics, not the cash math.
5. **Tips are tracked but not in expected cash**. `tips_cash` is in the snapshot payload but does NOT inflate `expected_cash`. Cashier counts the till including tips, then variance reflects unaccounted-for tips. Bakery custom: tips are pooled, recorded out-of-band.
6. **`pos_session_id` is required on every order** for shift accounting to work. If an order is created without it, it never appears in shift totals — silent revenue leak. Verify the order RPC sets `pos_session_id = current_session.id`.
7. **`recounting` ≡ `closing` (V3 FSM)**. The V2 enum value `'recounting'` is the V2 spelling for V3's `'closing'` state (D-013-001-ter). The RPC accepts both `open` and `recounting` as valid pre-close states.
8. **Manager close vs. cashier close.** The RPC allows either. Audit log: check `closed_by` to see who actually closed; `opened_by` to see the cashier responsible.
9. **`blindMode` hides expected from cashier UI** (`CloseShiftModal.tsx:30,21`). Variance is computed server-side regardless. Use blind mode to prevent cashier "fitting" the count to the expected.
10. **Idempotency relies on `pos_sessions.snapshot_id IS NOT NULL` after first close.** The replay path returns the prior snapshot but DOES NOT recompute. If the manager wants to re-close after correcting an error, they must `UPDATE pos_sessions SET status='open', snapshot_id=NULL` (manager-only manual SQL) — NEVER allowed via UI in V2.
11. **JE only on close transition `→ 'closed'`.** If a session is set to `'closed'` twice (impossible via RPC due to status guard, but possible via raw SQL), the trigger's idempotency check (line 460-466) prevents double JE.
12. **Z-Report PDF is generated client-side** (`shiftZReportExport.ts`). It's **not stored in DB** — re-print regenerates from current shift state. After close, the snapshot in `shift_snapshots` is the canonical archival source.

---

## 9. Configuration prerequisites

- `pos_terminals` row for each physical till (POS device must know its `terminal_id_str`).
- `pos_sessions` table seeded by migrations 004 + 20260430180000.
- Partial UNIQUE INDEX `uq_pos_sessions_one_open_per_terminal` enforces 1-open-per-terminal.
- `shift_snapshots` table with payload CHECK requiring 8 keys (order_count, total, cash_total, qris_total, card_total, bank_total, void_count, discount_total).
- `accounting_mappings`: `SHIFT_CLOSE_OVERAGE` → 4200, `SHIFT_CLOSE_SHORTAGE` → 5300, `SALE_PAYMENT_CASH` → 1110.
- Accounts 4200 (Other Income), 5300 (Admin Expenses), 1110 (Cash) must exist with `is_postable=TRUE`.
- `journal_entries.reference_type` CHECK includes `'shift_close'`.
- `journal_entry_type` ENUM includes `'shift_close'`.
- Permission `sales.shift.close` for managers (cashiers can close their own shifts without it).

---

## 10. Reports & analytics impact

- **Z-Report** (per-shift): printed at close, also shown in `ShiftHistoryModal`.
- **Variance Report** (`/reports/operations/cash-variance`): aggregates `shift_snapshots.payload->variance` over time, by terminal/cashier. Detects systematic over-/under-counts.
- **Cash Drop Report**: lists `pos_sessions.cash_drops` events (mid-shift cash deposits to safe).
- **Tip Report**: `pos_sessions.tips_cash + tips_card` aggregated.
- **Shift Duration**: `closed_at - opened_at`.
- **Manager Validation Audit**: which closed shifts have `manager_validated=true` vs. pending.
- **Concentration Risk**: cashier-level variance trend — flags suspicious patterns (always overage = skimming alarm).

---

## 11. Observability

- Sentry captures Hook `onError` toasts (RPC failures: `shift_not_found`, `shift_already_closed`, `unauthorized_close`, `shift_closed_immutable`).
- `pos_sessions.cash_difference` history → variance trend via SQL.
- `shift_snapshots.created_at` records the close moment; payload is immutable JSONB — perfect audit trail.
- JE chain: each JE links back to the session via `reference_id`. Drill from `/accounting/journals?reference_type=shift_close` to the originating shift.
- Realtime: `pos_sessions` channel broadcasts row changes — manager dashboard auto-refreshes when a shift closes.

---

## 12. Related flows

- [01 — POS Sale Cash](./01-pos-sale-cash.md) — every order increments shift `cash_total` (or `qris_total`, etc.).
- [02 — POS Sale Split Payment](./02-pos-sale-split-payment.md) — split orders contribute to multiple payment-method totals.
- [03 — Void & Refund](./03-void-refund.md) — refunds reduce `expected_cash`; voids are stat-only.
- [10 — End of Day](./10-end-of-day.md) — daily report aggregates across all closed shifts for the day.
- [12 — Production & Stock Impact](./12-production-stock-impact.md) — production happens between shifts; not reflected in shift cash but JE-impacts the same `journal_entries` table.
