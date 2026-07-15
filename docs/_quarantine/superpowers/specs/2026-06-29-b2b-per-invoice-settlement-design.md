# Design — B2B per-invoice settlement (P1.2)

> Date: 2026-06-29 · Branch `swarm/session-52` (base `swarm/session-50`→#132 + docs curation)
> Closes audit findings **T5 / C3 / C4** (`docs/workplan/audits/2026-06-27-audit-integral-par-module.md`).
> Direct continuation of tranche 2a-i (#132). Scope source: §10 of
> `docs/workplan/plans/2026-06-28-session-51-INDEX.md`.

## 1. Problem (audit T5 / C3 / C4)

B2B AR integrity is broken from the first payment:

- **C3 — `paid_at` never set.** `record_b2b_payment_v1` decrements the cached
  `customers.b2b_current_balance` and writes a JSONB *metadata-only* allocation snapshot,
  but never touches `orders.paid_at`. `view_b2b_invoices.is_unpaid = (paid_at IS NULL)` is
  therefore **TRUE for life**, and `view_ar_aging` (built on it) is structurally wrong.
- **C4 — two divergent sources of truth.** The POS panel `get_pos_b2b_debts_v2` computes
  `outstanding = total − Σ order_payments`. B2B payments land in `b2b_payments`, **never** in
  `order_payments` → a B2B invoice fully paid in BackOffice still shows 100% unpaid at the POS.
  Meanwhile BO trusts the `b2b_current_balance` cache and `view_ar_aging`. The three never
  reconcile.
- **T5 secondary** — no B2B cancellation (`void_order_rpc` requires `paid` + a session);
  credit-limit gate is **TOCTOU** (checked before the `FOR UPDATE` lock); payment recording
  is gated on the generic `customers.update` rather than a dedicated permission.

Root cause: payments are not linked to specific invoices, and there is no single derivation
point for "what does this customer / invoice still owe".

## 2. Decisions (validated with owner 2026-06-29)

- **D1 — Allocation mode = targeted + FIFO fallback.** `record_b2b_payment_v2` accepts an
  optional explicit invoice list; any remainder allocates FIFO across the oldest unpaid
  invoices.
- **D2 — Cancel scope = block if any allocation.** `cancel_b2b_order_v1` only cancels a
  fully-unpaid B2B invoice (zero allocations). If a payment is allocated, it raises and the
  user must handle the payment first. Credit-notes / refund-on-cancel stay backlog
  (TASK-09-014).
- **D3 — Source of truth = keep cache + reconcile/drift alert.** `b2b_current_balance`
  remains a fast cache; a read-only reconcile RPC derives the true balance from the ledger and
  flags drift. No removal of the cache (bounded blast radius).
- **D4 — Settled status.** No `cancelled` value exists in `order_status`
  (`{draft,paid,voided,pending_payment,completed,b2b_pending}`). Fully-settled invoice →
  `status='paid'` + `paid_at`. Cancelled invoice → `status='voided'`. Partial → stays
  `b2b_pending`, outstanding tracked via allocations.

## 3. New table — `b2b_payment_allocations` (append-only ledger)

```sql
b2b_payment_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES b2b_payments(id),
  invoice_id      uuid NOT NULL REFERENCES orders(id),
  amount_applied  numeric(14,2) NOT NULL CHECK (amount_applied > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, invoice_id)
)
```

- **RLS / grants:** SELECT for `authenticated`; INSERT/UPDATE/DELETE revoked for
  `authenticated`/`anon`/`PUBLIC` — written only by SECURITY DEFINER RPCs (same posture as
  `b2b_payments`). `ALTER DEFAULT PRIVILEGES` anon defense-in-depth per CLAUDE.md §S20.
- Indexes on `invoice_id` and `payment_id`.
- **Single derivation point:** `invoice_outstanding = orders.total − Σ amount_applied`
  (over non-voided allocations of that invoice). `customer_outstanding = Σ invoice_outstanding`
  over the customer's non-voided unpaid b2b invoices.

## 4. RPCs

### 4.1 `record_b2b_payment_v2` (DROP v1, same migration)

Signature adds `p_invoice_ids uuid[] DEFAULT NULL` (keeps the v1 7-arg order, appends arg 8):

```
record_b2b_payment_v2(p_customer_id uuid, p_amount numeric, p_method payment_method,
  p_reference text DEFAULT NULL, p_paid_at timestamptz DEFAULT now(),
  p_notes text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL,
  p_invoice_ids uuid[] DEFAULT NULL)
```

- **Gate:** `b2b.payment.record` (new perm; granted SUPER_ADMIN/ADMIN/MANAGER — mirrors the
  current `customers.update` holder set → no role loses the ability).
- Preserves v1: auth + profile, idempotency replay (`b2b_payments.idempotency_key`),
  amount/customer validation, fiscal-period guard, `FOR UPDATE` customer lock, overpayment
  guard, JE (DR Cash/Bank / CR B2B_AR), `b2b_current_balance -= amount`, audit log.
- **Allocation (new):**
  1. If `p_invoice_ids` non-null: allocate to those invoices **in array order**. Validate each
     is the customer's, `order_type='b2b'`, not voided, `outstanding > 0`. Apply
     `LEAST(invoice_outstanding, amount_remaining)`; if Σ targeted-outstanding < amount, the
     remainder continues to FIFO; if a targeted invoice is invalid → `check_violation`.
  2. FIFO fallback for any remainder: oldest `b2b_pending` unpaid invoices first.
  3. INSERT real `b2b_payment_allocations` rows; also keep populating the legacy
     `b2b_payments.allocation` JSONB snapshot for continuity.
- **Settlement:** every invoice whose outstanding reaches 0 → `orders.paid_at = p_paid_at`,
  `status='paid'`. Partial invoices stay `b2b_pending`.
- Return adds `allocations` (array of `{invoice_id, amount_applied, fully_settled}`).

### 4.2 `cancel_b2b_order_v1` (new)

```
cancel_b2b_order_v1(p_order_id uuid, p_reason text, p_idempotency_key uuid DEFAULT NULL)
```

- **Gate:** `b2b.order.cancel` (new perm → SUPER_ADMIN/ADMIN/MANAGER).
- **Preconditions:** order exists, `order_type='b2b'`, `status='b2b_pending'`, **zero rows in
  `b2b_payment_allocations` for this invoice** → else `RAISE order_has_payments` (P0011).
  `p_reason` length ≥ 3.
- **Reversal (same txn):**
  - JE contra of the creation entry: DR `SALE_B2B_REVENUE` / CR `B2B_AR` for `order.total`,
    `reference_type='b2b_order_cancel'`, `reference_id=order_id`. Fiscal-period guard.
  - Stock: mirror creation flag-aware logic with **positive** quantities (tracked product →
    `current_stock += qty` + reversing `stock_movements` row; `deduct_stock` → restore recipe
    materials). Uses the same raw pattern as creation (the "unify via
    `record_stock_movement_v1`" cleanup is T2/P1.4 — out of scope here).
  - `b2b_current_balance -= order.total` (guard ≥ 0).
  - `status='voided'`, store cancel reason (audit_logs `b2b.order.cancelled`).
- Idempotent via `p_idempotency_key` (audit_logs replay, mirror `adjust_b2b_balance_v2`).

### 4.3 `create_b2b_order_v2` (DROP v1) — TOCTOU fix

Today `validate_b2b_credit_limit_v1` runs **before** the customer `FOR UPDATE` lock. v2 moves
the credit re-check to **after** the lock and validates against the locked balance, closing the
race where two concurrent orders both pass just under the limit. All flag-aware stock logic
from the in-place S50 fix (migration `_059`) is preserved verbatim.

### 4.4 `reconcile_b2b_balance_v1(p_customer_id uuid DEFAULT NULL)` (new, read-only)

- **Gate:** `b2b.read`. SECURITY DEFINER STABLE.
- Returns one row per b2b customer (or just the one): `cached_balance`, `derived_balance`
  (Σ invoice_outstanding over non-voided unpaid b2b invoices), `drift = cached − derived`,
  `has_drift = (drift <> 0)`. **No auto-fix** — alerting only. BO surfaces drift; manual
  correction goes through `adjust_b2b_balance_v2`.

## 5. Views (single source of truth)

- **`view_b2b_invoices`** rebuilt: add `amount_paid` (Σ allocations), `outstanding`
  (`total − amount_paid`), `is_unpaid = outstanding > 0`; **exclude `status='voided'`**.
  `paid_at` retained for display but `is_unpaid` no longer depends on it alone.
- **`view_ar_aging`** rebuilt on `outstanding` (partial-payment-aware) instead of
  `paid_at IS NULL`; same 4 buckets keyed on invoice age.
- **`get_pos_b2b_debts_v3`** (DROP v2): for `order_type='b2b'` orders, compute `paid` from
  `b2b_payment_allocations`; retail ardoise (other order types) keeps `order_payments`. Result:
  POS panel and BO agree on B2B outstanding. Repoint POS hook.

## 6. Permissions

| Code | Module | Granted to | Notes |
|---|---|---|---|
| `b2b.payment.record` | b2b | SUPER_ADMIN/ADMIN/MANAGER | new — replaces generic `customers.update` gate on payment recording |
| `b2b.order.cancel` | b2b | SUPER_ADMIN/ADMIN/MANAGER | new |
| `b2b.balance.adjust` | b2b | (exists, 2a-i) | reused |
| `b2b.read` | b2b | (exists, #129) | reused for reconcile |

## 7. UI wiring (minimal, DB-first)

- `apps/backoffice/.../btob/hooks/useRecordB2bPayment.ts` → v2; `RecordB2bPaymentModal` gains
  an optional invoice multi-select (unpaid invoices of the customer); omitting it = FIFO.
- `apps/backoffice/.../btob/hooks/useCreateB2bOrder.ts` → v2.
- POS `CustomerDebtsPanel` / `useOutstandingDebts` → `get_pos_b2b_debts_v3`.
- BO B2B invoice list: a **Cancel** action calling `cancel_b2b_order_v1` (confirm dialog +
  reason). Heavier cancel/credit-note UX stays backlog.
- Optional: surface `reconcile_b2b_balance_v1` drift as a badge on the B2B dashboard (nice to
  have; can defer to follow-up if it inflates scope).

## 8. Testing

- **pgTAP** `supabase/tests/b2b_settlement.test.sql` (run via MCP `execute_sql`,
  BEGIN/ROLLBACK):
  - FIFO allocation across multiple invoices; targeted allocation honors order; targeted +
    FIFO remainder.
  - Partial payment → `paid_at` NULL, outstanding correct; full payment → `paid_at` set,
    `status='paid'`.
  - POS (`get_pos_b2b_debts_v3`) and BO (`view_b2b_invoices`) agree after a B2B payment.
  - Cancel unpaid → JE reversed, stock restored, balance decremented, `status='voided'`,
    dropped from `view_b2b_invoices`.
  - Cancel blocked when an allocation exists (`order_has_payments`).
  - TOCTOU: credit re-check after lock rejects an over-limit concurrent order.
  - `reconcile_b2b_balance_v1` detects an injected drift.
  - Gates: anon REVOKE on the new table + RPCs; insufficient-role raises `permission_denied`.
  - Idempotency replay on `record_b2b_payment_v2` and `cancel_b2b_order_v1`.
- **Vitest live-RPC** per new RPC family (`supabase/tests/functions/b2b-settlement-*.test.ts`).
- **BO smoke** for repointed hooks (`useRecordB2bPayment` v2, `useCreateB2bOrder` v2, cancel).
- Regenerate types via MCP after migrations; commit `packages/supabase/src/types.generated.ts`.

## 9. Migrations (monotonic, next NAME-block after `20260710000064`)

1. `20260710000065_create_b2b_payment_allocations.sql` — table + RLS + REVOKE pair + indexes.
2. `20260710000066_seed_b2b_payment_record_cancel_perms.sql` — `b2b.payment.record` +
   `b2b.order.cancel` permissions + role grants.
3. `20260710000067_record_b2b_payment_v2.sql` — v2 + DROP v1 + REVOKE pair.
4. `20260710000068_cancel_b2b_order_v1.sql` — new RPC + REVOKE pair.
5. `20260710000069_create_b2b_order_v2_toctou.sql` — v2 + DROP v1 + REVOKE pair.
6. `20260710000070_rebuild_b2b_views_outstanding.sql` — `view_b2b_invoices` + `view_ar_aging`.
7. `20260710000071_get_pos_b2b_debts_v3.sql` — v3 + DROP v2 + REVOKE pair.
8. `20260710000072_reconcile_b2b_balance_v1.sql` — read-only reconcile + REVOKE pair.

(Exact split may merge adjacent files during execution; numbering stays monotonic.)

## 10. Out of scope (follow-ups)

- Unify stock deduction via `record_stock_movement_v1` across sale/combo/modifier/B2B (T2 /
  P1.4 — dedicated wave).
- Credit-notes / refund-on-cancel / unallocate-and-credit (TASK-09-014).
- Auto-fix of detected drift (reconcile is alert-only by design D3).
- Bulk invoicing, statements, aging email cron (module-09 backlog, unrelated).

## 11. Acceptance criteria

- [ ] A1 — `b2b_payment_allocations` exists, append-only (anon + authenticated INSERT revoked),
  written only by RPCs.
- [ ] A2 — A B2B payment links to specific invoice(s); fully-covered invoice gets `paid_at` +
  `status='paid'` (C3 closed).
- [ ] A3 — Targeted allocation honors the supplied invoice order; remainder falls back to FIFO.
- [ ] A4 — POS (`get_pos_b2b_debts_v3`) and BO (`view_b2b_invoices`/`view_ar_aging`) report the
  same outstanding after a B2B payment (C4 closed).
- [ ] A5 — `cancel_b2b_order_v1` reverses JE + stock + balance on an unpaid invoice and is
  blocked when an allocation exists.
- [ ] A6 — `create_b2b_order_v2` re-checks the credit limit after the `FOR UPDATE` lock.
- [ ] A7 — `reconcile_b2b_balance_v1` reports drift between cache and ledger-derived balance.
- [ ] A8 — New perms `b2b.payment.record` / `b2b.order.cancel` gate the right RPCs; REVOKE
  pairs complete; v1 RPCs dropped; types regenerated.
- [ ] A9 — Existing B2B suites (`b2b_foundation`, `b2b_credit`) still green on the new
  signatures.
