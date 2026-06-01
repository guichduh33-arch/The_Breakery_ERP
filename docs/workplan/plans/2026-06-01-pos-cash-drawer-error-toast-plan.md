# POS cash drawer error toast — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: invoke `superpowers:writing-plans` to author and `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) to run this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. TDD-first: write the smoke proving a failed `openCashDrawer()` surfaces a toast, then fix the `useEffect`.

**Goal:** Surface a `toast.warning` when `openCashDrawer()` fails at the end of payment, instead of silently swallowing its result in a `Promise.all`. The cashier currently gets no feedback when the drawer doesn't open (bridge down, drawer not wired, HTTP non-ok), while a print failure already shows a toast. Apply the S34 "failure visible, never silent" pattern to the drawer.

**Architecture:** Client-only, single file (`SuccessModal.tsx` effect), plus one smoke test. The drawer failure must NOT block receipt printing nor the modal/new-order flow — receipt and drawer stay independent. No DB, no RPC, no EF.

**Tech Stack:** React + Vitest + `sonner` toast, `apps/pos`.

**Spec:** [`../specs/2026-06-01-pos-cash-drawer-error-toast-spec.md`](../specs/2026-06-01-pos-cash-drawer-error-toast-spec.md)
**Branch:** `fix/pos-cash-drawer-error-toast` (from `master` @ `70c5cf1`)
**Effort:** S (~0.25 day)

---

## Verified facts (code `fichier:ligne`, 2026-06-01)

- **Silent swallow** — `apps/pos/src/features/payment/SuccessModal.tsx:87-90`:
  ```ts
  useEffect(() => {
    if (!open) return;
    void Promise.all([handlePrint(), openCashDrawer()]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  ```
  `openCashDrawer()`'s `{ success, error? }` result is discarded.
- **`openCashDrawer()` signature** — `apps/pos/src/services/print/printService.ts:146-164` returns `Promise<{ success: boolean; error?: string }>` and takes **NO arguments** → it is **not** internally gated on payment method. Any cash-gating must happen at the call-site in `SuccessModal`.
- **`paymentMethod` prop** available at `SuccessModal.tsx:26` (used to decide whether a drawer open was even expected).
- **Print toast precedent (do not touch)** — `SuccessModal.tsx:81-83` `handlePrint` already shows `toast.warning('Print server unreachable — receipt not printed')` on its own; the drawer gets a **separate, independent** toast.

---

## File Structure (overview)

```
apps/pos/src/features/payment/SuccessModal.tsx                          (EDIT — capture drawer result, toast on failure)
apps/pos/src/features/payment/__tests__/cash-drawer-error-toast.smoke.test.tsx   (NEW)
```

---

## Phase 0 — branch + gating verification (BLOCKING)

- [ ] **P0.1** Create `fix/pos-cash-drawer-error-toast` from `master` @ `70c5cf1` ; commit spec + plan.
- [ ] **P0.2 — VERIFY DRAWER GATING (gate).** Confirm there is currently **no** cash-only gate around `openCashDrawer()` (verified: it's called unconditionally in the `useEffect` at `SuccessModal.tsx:89`, and `openCashDrawer()` takes no method arg). **Decision to ratify:** the toast must only fire when a drawer open was *expected*. V1 = fire the toast on failure **only when `props.paymentMethod === 'cash'`** (the only method that expects a physical drawer open). Whether to also *skip the `openCashDrawer()` call itself* for non-cash is a separate question — keep the call as-is (no behaviour change for the call) and only gate the **toast** on cash to avoid spamming false warnings on card/QRIS. Document this in the deviations log.

---

## Phase 1 — test-first

- [ ] **P1.1** Write `apps/pos/src/features/payment/__tests__/cash-drawer-error-toast.smoke.test.tsx`. Mock `@/services/print/printService` so `openCashDrawer` is a `vi.fn()` and `printReceipt` resolves `{ success: true }`; mock `sonner` `toast` (spy `warning`); mock `useStationPrinters`. Cases:
  - `openCashDrawer` → `{ success: false, error: 'HTTP 503' }`, render `<SuccessModal open paymentMethod='cash' ... />` → `toast.warning` called with the drawer message; modal still rendered (no crash; receipt not blocked — `printReceipt` still invoked).
  - `openCashDrawer` → `{ success: true }`, `paymentMethod='cash'` → drawer toast **not** called.
  - `openCashDrawer` → `{ success: false }`, `paymentMethod='card'` → drawer toast **not** called (per P0.2 gating).
  Run → **expect failure** (current code never reads the drawer result).

---

## Phase 2 — fix

- [ ] **P2.1** In `SuccessModal.tsx`, replace the `void Promise.all([...])` effect (lines 87-90) with a result-aware async IIFE that keeps print and drawer independent:
  ```ts
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [, drawer] = await Promise.all([handlePrint(), openCashDrawer()]);
      if (!drawer.success && props.paymentMethod === 'cash') {
        toast.warning('Cash drawer did not open — please open it manually');
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  ```
  Leave `handlePrint`'s own print-failure toast (lines 81-83) untouched. Keep the eslint-disable comment for the deps array.
- [ ] **P2.2** Run the smoke test → **PASS**. `pnpm --filter @breakery/app-pos typecheck` → PASS.

---

## Phase 3 — verification + PR

- [ ] **P3.1** `pnpm --filter @breakery/app-pos test payment` → all green; confirm the print-failure toast still works (existing behaviour, non-regression).
- [ ] **P3.2** `pnpm --filter @breakery/app-pos typecheck` → PASS.
- [ ] **P3.3** PR `fix/pos-cash-drawer-error-toast` → `master`. Title `fix(pos): surface cash drawer open failure as a toast (cash only)`. Body links spec + states the cash-gating decision.

---

## Acceptance criteria

- [ ] A failed `openCashDrawer()` produces a cashier-readable `toast.warning`.
- [ ] The drawer failure does NOT block receipt printing nor the modal/new-order flow.
- [ ] The drawer toast is distinct from the print-failure toast (two separate messages).
- [ ] The toast does not fire for methods where a drawer open wasn't expected (cash-gated, verified P0.2).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

---

## Risks / dependencies

- **Low risk** — localized to the `SuccessModal` effect.
- **Verification dependency** — cash-gating the toast (P0.2) prevents false warnings on non-cash payments.
- No migration / RPC / EF. Operationally depends on the external print-bridge for the real success/failure signal.

## Deviations log (fill during execution)

| ID | Severity | Description |
|---|---|---|
| _(à compléter — esp. cash-gating decision)_ | | |

## Out of scope

- Automatic drawer-open retry.
- Manual "Open drawer" button in SuccessModal (possible UX follow-up).
- `/drawer/open` print-bridge implementation (external — cf. `pos-print-bridge-deploy`).
- Refactoring whether the `openCashDrawer()` *call* itself should be skipped for non-cash (only the toast is cash-gated in V1).
