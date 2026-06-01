# POS receipt payment method fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: invoke `superpowers:writing-plans` to author and `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) to run this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. TDD-first: write the smoke test asserting the buffered payload reflects the real method, then widen the type and fix the builder.

**Goal:** Make the printed receipt reflect the **real** payment method (`cash | card | qris | edc | transfer | store_credit`) instead of the hardcoded `'cash'`. Root cause is a frozen literal type `payment.method: 'cash'` on `ReceiptPayload` plus a hardcoded `method: 'cash'` in `buildReceiptPayload`, while the real value is already available as the `paymentMethod` prop.

**Architecture:** Client-only. Widen `ReceiptPayload.payment.method` to a 6-method union (make `cash_received`/`change_given` optional), then propagate `props.paymentMethod` in `buildReceiptPayload`. Verify the call-site passes the real method. No DB, no RPC, no EF. The fidelity of the printed output depends on the external print-bridge consuming `payment.method` (out of scope here — we deliver the correct payload only).

**Tech Stack:** React + Vitest, `apps/pos`. Print mock mode `VITE_PRINT_MOCK=1` for the smoke test (asserts via `getMockPrintBuffer()`).

**Spec:** [`../specs/2026-06-01-pos-receipt-payment-method-fix-spec.md`](../specs/2026-06-01-pos-receipt-payment-method-fix-spec.md)
**Branch:** `fix/pos-receipt-payment-method` (from `master` @ `70c5cf1`)
**Effort:** S (~0.5–1 day)

---

## Verified facts (code `fichier:ligne`, 2026-06-01)

- **Frozen type (root cause)** — `apps/pos/src/services/print/printService.ts:60`:
  ```ts
  payment: { method: 'cash'; amount: number; cash_received: number; change_given: number };
  ```
  The literal `'cash'` makes any other value a TS error. (Note: `StationTicketPayload.payment.method` at line 31 is already `string` — only `ReceiptPayload` is frozen.)
- **Hardcoded builder** — `apps/pos/src/features/payment/SuccessModal.tsx:58-63` sets `method: 'cash'` (line 59) while the real method is the prop `paymentMethod: string` declared at `SuccessModal.tsx:26` (spec said `:27` — off by one; prop confirmed present). The builder ignores it.
- **Call-site to verify** — `<SuccessModal>` is rendered in the cart/checkout flow; the plan's P1 verifies what value is passed as `paymentMethod` (single tender vs split-pay). `useCheckout.ts` (split-pay aware via `PaymentInput | PaymentInput[]`, line 26) does not itself render the modal — trace the parent component that owns the modal and reads the selected tender(s).
- **Mock buffer** — `getMockPrintBuffer()` (printService.ts:85) returns entries `{ printer, kind: 'receipt', payload }`; `printReceipt` buffers in mock mode (printService.ts:117-120). The smoke test reads `payload.payment.method`.
- **S34 non-regression target** — `apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx` must stay green.

---

## File Structure (overview)

```
apps/pos/src/services/print/printService.ts            (EDIT — widen ReceiptPayload.payment + optional cash fields)
apps/pos/src/features/payment/SuccessModal.tsx          (EDIT — buildReceiptPayload propagates props.paymentMethod)
apps/pos/src/features/payment/__tests__/receipt-payment-method.smoke.test.tsx   (NEW)
```

---

## Phase 0 — branch + call-site verification (BLOCKING)

- [ ] **P0.1** Create `fix/pos-receipt-payment-method` from `master` @ `70c5cf1` ; commit spec + plan.
- [ ] **P0.2 — VERIFY CALL-SITE (gate).** Grep for `<SuccessModal` in `apps/pos/src` and read the parent. Confirm `paymentMethod=` is wired to the cashier-selected tender, not a hardcoded default. **Record the split-pay decision** (spec Choix 3): for multi-tender orders, what scalar does the parent pass? Decision to ratify in this plan — V1 = pass the **dominant method** (largest tender) or the literal `'Split'`; the per-tender breakdown on the receipt is a documented follow-up. If the parent passes nothing meaningful for splits, note it as a deviation and pick the safest V1 (dominant method). Do NOT proceed to P2 until this is settled.

---

## Phase 1 — test-first

- [ ] **P1.1** Write `apps/pos/src/features/payment/__tests__/receipt-payment-method.smoke.test.tsx` under `VITE_PRINT_MOCK=1`. Mirror `receipt-targets-cashier.smoke.test.tsx` setup (mock `useStationPrinters`, clear the mock buffer in `beforeEach`/`afterEach`). Cases:
  - render `<SuccessModal open paymentMethod='card' ... />` → after the print effect, the buffered receipt entry has `payload.payment.method === 'card'`.
  - `paymentMethod='qris'` → `payload.payment.method === 'qris'`.
  - `paymentMethod='cash'` → `payload.payment.method === 'cash'` AND `cash_received`/`change_given` present (non-regression).
  Run → **expect failure** (currently always `'cash'`; and `'card'` won't even compile against the frozen type once the builder is changed — that's why the type widen comes first in P2).

---

## Phase 2 — widen type + propagate

- [ ] **P2.1** In `printService.ts`: add `export type ReceiptPaymentMethod = 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';` and change line 60 to `payment: { method: ReceiptPaymentMethod; amount: number; cash_received?: number; change_given?: number };` (cash-only fields now optional). Keep the `MockReceiptEntry` type consistent.
- [ ] **P2.2** In `SuccessModal.tsx` `buildReceiptPayload`: replace `method: 'cash'` (line 59) with `method: props.paymentMethod as ReceiptPaymentMethod` (import the type). For non-cash methods, omit `cash_received`/`change_given` (use the conditional-spread pattern already used elsewhere in the builder, e.g. `...(props.paymentMethod === 'cash' ? { cash_received: props.cashReceived, change_given: props.changeGiven ?? 0 } : {})`). For the split decision from P0.2, map accordingly (e.g. fall back to `'cash'` typing if dominant is cash, or carry the chosen scalar).
- [ ] **P2.3** Run the smoke test → **PASS**. `pnpm --filter @breakery/app-pos typecheck` → PASS (the widened union compiles `'card'`/`'qris'`).

---

## Phase 3 — verification + PR

- [ ] **P3.1** `pnpm --filter @breakery/app-pos test receipt payment` → all green, including S34 `receipt-targets-cashier.smoke.test.tsx` (non-regression).
- [ ] **P3.2** `pnpm --filter @breakery/app-pos typecheck` → PASS.
- [ ] **P3.3** PR `fix/pos-receipt-payment-method` → `master`. Title `fix(pos): receipt reflects real payment method (widen ReceiptPayload.method)`. Body links spec, states the split-pay V1 decision.

---

## Acceptance criteria

- [ ] `ReceiptPayload.payment.method` accepts the 6 project methods.
- [ ] `buildReceiptPayload` propagates `props.paymentMethod` (no hardcoded `'cash'`).
- [ ] A card/QRIS payment produces `payment.method` = the real method (test-proven via mock buffer).
- [ ] `cash_received`/`change_given` supplied only for `cash` (optional in type).
- [ ] Call-site passes the real method (verified P0.2); split-pay V1 decision documented.
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS; S34 receipt smoke stays green.

---

## Risks / dependencies

- **Dependency** — faithful printed rendering depends on the external print-bridge consuming `payment.method`; in mock we validate the payload only.
- **Split-pay risk** — if the call-site derives `paymentMethod` poorly for splits, the receipt could show a misleading method; mitigated by the **blocking** P0.2 verification. No migration / RPC / EF.

## Deviations log (fill during execution)

| ID | Severity | Description |
|---|---|---|
| _(à compléter — esp. split-pay decision)_ | | |

## Out of scope

- Full multi-tender line-by-line breakdown on the receipt (follow-up).
- NPWP / PB1 on receipt (backlog S35+).
- Print-bridge rendering implementation (external — cf. `pos-print-bridge-deploy`).
- Client-side total recompute in `buildReceiptPayload` (already present `SuccessModal.tsx:33`) — untouched.
