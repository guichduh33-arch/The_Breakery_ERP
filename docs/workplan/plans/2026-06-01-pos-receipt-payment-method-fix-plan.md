# POS Receipt Payment Method Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the printed receipt reflect the real payment method (`cash | card | qris | edc | transfer | store_credit`) instead of the hardcoded `'cash'`.

**Architecture:** Client-only fix in `apps/pos`. The root cause is a frozen literal type `payment.method: 'cash'` on `ReceiptPayload` plus a hardcoded `method: 'cash'` in `buildReceiptPayload`, while the real value is already carried by the `paymentMethod` prop. We widen `ReceiptPayload.payment.method` by reusing the canonical `PaymentMethod` union already exported by `@breakery/domain` (DRY — no new type), make the cash-only fields (`cash_received`/`change_given`) optional, then propagate `props.paymentMethod` in the builder. No DB, no RPC, no Edge Function. Faithful printed rendering depends on the external print-bridge consuming `payment.method` (out of scope — we deliver the correct payload only; validated in mock mode).

**Tech Stack:** React 18 + TypeScript + Vitest + React Testing Library, `apps/pos`. Print mock mode `VITE_PRINT_MOCK=1` for the smoke test (asserts the buffered payload via `getMockPrintBuffer()`). Domain types from `@breakery/domain`.

**Spec:** [`../specs/2026-06-01-pos-receipt-payment-method-fix-spec.md`](../specs/2026-06-01-pos-receipt-payment-method-fix-spec.md)
**Branch:** `fix/pos-receipt-payment-method` (from `master` @ `70c5cf1`)
**Effort:** S (~0.5–1 day)

---

## Verified facts (code `file:line`, read 2026-06-01)

- **Frozen type (root cause)** — `apps/pos/src/services/print/printService.ts:60`:
  ```ts
  payment: { method: 'cash'; amount: number; cash_received: number; change_given: number };
  ```
  The literal `'cash'` makes any other value a TS error. `StationTicketPayload.payment.method` at **`printService.ts:31`** is already `string` — confirmed **out of scope**; only `ReceiptPayload` is frozen.
- **Hardcoded builder** — `apps/pos/src/features/payment/SuccessModal.tsx:58-63` sets `method: 'cash'` (line **59**) while the real method is the prop `paymentMethod: string` declared at **`SuccessModal.tsx:26`**. The builder ignores it.
- **Canonical union (reuse, do NOT redefine)** — `packages/domain/src/types/payment.ts:2`:
  ```ts
  export type PaymentMethod = 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';
  ```
  Re-exported from `@breakery/domain` (consumed today at `apps/pos/src/features/payment/PaymentTerminal.tsx:20` via `import { ..., type PaymentMethod, type Tender } from '@breakery/domain';`). These are exactly the 6 project methods (recoupe S30 `get_payments_by_method_v1`). **The plan reuses `PaymentMethod` — it does NOT introduce a new `ReceiptPaymentMethod` alias.**
- **Call-site (P0 gate, verified)** — `apps/pos/src/features/payment/PaymentTerminal.tsx:256-271` renders `<SuccessModal ... paymentMethod={success.paymentMethod} />` (line **265**). `success.paymentMethod` is typed `PaymentMethod` (`SuccessState` at `PaymentTerminal.tsx:53`) and set at **`PaymentTerminal.tsx:213`** to `tendersToShip[0]!.method`.
  - **Single tender (fast-path):** `tendersToShip = [tender]` built from `selectedMethod` (`PaymentTerminal.tsx:153-162`). `[0]` is the only tender → correct method.
  - **Split-pay (multi-tender, S10):** `tendersToShip = tenders` (the full accumulated array, `PaymentTerminal.tsx:151-152`). `tendersToShip[0]!.method` is the **first tender's** method — NOT "dominant", NOT a `'Split'` sentinel. **This is the V1 behavior to document** (see DEV-RPM-P0-01 below). The receipt will show whatever method the cashier added first. The per-tender breakdown on the receipt is a documented follow-up (spec §5 Hors scope).
  - **Decision ratified for V1:** keep `tendersToShip[0]!.method` as-is at the call-site. The fix does NOT change split-pay derivation — it only stops the builder from overwriting the (already-correct-for-single-tender) value with `'cash'`. Adding a dominant-method / `'Split'` sentinel is out of scope and tracked as a follow-up.
- **Mock buffer** — `getMockPrintBuffer()` (`printService.ts:85`) returns entries; for receipts `{ printer, kind: 'receipt', payload }` (`MockReceiptEntry`, `printService.ts:69-73`). `printReceipt` buffers in mock mode (`printService.ts:117-120`). The smoke test reads `payload.payment.method`.
- **Reference smokes** — `apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx` (S34; `buildProps` defaults `paymentMethod: 'cash'`, mocks `useStationPrinters` → cashier printer, stubs `VITE_PRINT_MOCK=1`, clears buffer in `beforeEach`) and `apps/pos/src/__tests__/print.smoke.test.tsx` (passes `paymentMethod="cash"`). Both must stay green.

---

## File Structure (overview)

```
apps/pos/src/services/print/printService.ts                                   (EDIT — ReceiptPayload.payment: reuse PaymentMethod, make cash fields optional)
apps/pos/src/features/payment/SuccessModal.tsx                                 (EDIT — buildReceiptPayload propagates props.paymentMethod; cash fields conditional)
apps/pos/src/features/payment/__tests__/receipt-payment-method.smoke.test.tsx  (NEW  — asserts buffered payload.payment.method reflects the real method)
```

Responsibilities:
- `printService.ts` — owns the `ReceiptPayload` contract sent to the print-bridge. Widening the `payment.method` type here is the type-level root-cause fix.
- `SuccessModal.tsx` — owns `buildReceiptPayload`, the value-level root-cause fix. Propagates the prop and supplies cash-only fields conditionally.
- `receipt-payment-method.smoke.test.tsx` — new co-located smoke proving the value propagates end-to-end through the mock buffer.

---

## Task 0: Branch + call-site verification (BLOCKING gate)

**Files:**
- Read-only: `apps/pos/src/features/payment/PaymentTerminal.tsx:53,150-174,205-214,256-271`
- Read-only: `packages/domain/src/types/payment.ts:1-10`

- [ ] **Step 1: Create the branch**

```bash
git checkout master
git pull
git checkout -b fix/pos-receipt-payment-method
git log -1 --format=%H   # confirm base is 70c5cf1 (or current master tip)
```

- [ ] **Step 2: Verify the call-site passes the real method (gate)**

Run: `git grep -n "<SuccessModal" -- apps/pos/src`
Expected output (the only render site outside tests):
```
apps/pos/src/features/payment/PaymentTerminal.tsx:258:      <SuccessModal
```

Run: `git grep -n "paymentMethod" -- apps/pos/src/features/payment/PaymentTerminal.tsx`
Expected: `paymentMethod: PaymentMethod;` (line 53, `SuccessState`), `paymentMethod: tendersToShip[0]!.method,` (line 213), `paymentMethod={success.paymentMethod}` (line 265).

Confirm by reading `PaymentTerminal.tsx:205-214` that `setSuccess({ ..., paymentMethod: tendersToShip[0]!.method })` carries the cashier-selected tender (NOT a hardcoded default). This is true for single-tender. For split-pay, `tendersToShip` is the full array and `[0]` is the first tender added.

- [ ] **Step 3: Record the split-pay V1 decision (no code change at the call-site)**

Confirm the decision in this plan's Deviations log (DEV-RPM-P0-01, already pre-filled below): **V1 keeps `tendersToShip[0]!.method` — the receipt shows the first tender's method for splits.** Do NOT change `PaymentTerminal.tsx`. The fix is purely: stop the builder overwriting this value with `'cash'`. A dominant-method or `'Split'` sentinel is a documented follow-up (spec §5).

**Do NOT proceed to Task 2 until this gate is settled.** Task 1 (test-first) may be authored in parallel, but its `'card'`/`'qris'` cases will only compile/pass after Task 2 widens the type.

- [ ] **Step 4: Commit the branch setup (spec + plan already on branch)**

```bash
git add docs/workplan/specs/2026-06-01-pos-receipt-payment-method-fix-spec.md docs/workplan/plans/2026-06-01-pos-receipt-payment-method-fix-plan.md
git commit -m "docs(pos): receipt payment-method fix — spec + plan + call-site verification"
```

---

## Task 1: Failing smoke test (test-first)

**Files:**
- Test: `apps/pos/src/features/payment/__tests__/receipt-payment-method.smoke.test.tsx` (NEW)

- [ ] **Step 1: Write the failing test**

Create `apps/pos/src/features/payment/__tests__/receipt-payment-method.smoke.test.tsx` (mirrors the S34 `receipt-targets-cashier.smoke.test.tsx` setup — mocks `sonner`, `@/lib/supabase`, `useStationPrinters`; stubs `VITE_PRINT_MOCK=1`; clears the mock buffer; mocks `fetch` for the `openCashDrawer` side-effect):

```tsx
// apps/pos/src/features/payment/__tests__/receipt-payment-method.smoke.test.tsx
//
// POS receipt payment-method fix — the buffered receipt payload must carry the
// REAL payment method (props.paymentMethod), not a hardcoded 'cash'.
//
// Under VITE_PRINT_MOCK=1, printReceipt pushes to the mock buffer instead of a
// network call. We render <SuccessModal> in isolation and inspect the buffer's
// receipt entry payload.payment.method.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import {
  getMockPrintBuffer,
  clearMockPrintBuffer,
} from '@/services/print/printService';
import type { ReceiptPayload } from '@/services/print/printService';
import type { SuccessModalProps } from '../SuccessModal';

// ── Static mocks ──────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
  supabaseUrl: 'http://localhost:54321',
}));

const CASHIER_PRINTER = { ip_address: '192.168.1.10', port: 9100, name: 'Cashier' };

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({
    data: new Map([['cashier', CASHIER_PRINTER]]),
  }),
}));

const originalFetch = globalThis.fetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function buildProps(overrides?: Partial<SuccessModalProps>): SuccessModalProps {
  return {
    open: true,
    orderNumber: 'ORD-777',
    total: 55_000,
    changeGiven: 5_000,
    pointsEarned: 0,
    cashReceived: 60_000,
    cashierName: 'Test Cashier',
    cart: {
      items: [
        { id: 'line-1', product_id: 'p1', name: 'Espresso', unit_price: 25_000, quantity: 1, modifiers: [] },
      ],
      order_type: 'dine_in',
    },
    paymentMethod: 'cash',
    onNewOrder: vi.fn(),
    ...overrides,
  };
}

async function renderAndGetReceipt(props: SuccessModalProps): Promise<ReceiptPayload> {
  const { SuccessModal } = await import('../SuccessModal');
  render(withQuery(<SuccessModal {...props} />));
  await waitFor(() => {
    expect(getMockPrintBuffer().some((e) => e.kind === 'receipt')).toBe(true);
  });
  const entry = getMockPrintBuffer().find((e) => e.kind === 'receipt')!;
  return entry.payload as ReceiptPayload;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuccessModal — receipt reflects the real payment method', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;

    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
      printedItemIds: [],
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
      isOffline: false,
    });

    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'EMP1' },
      sessionToken: 'tok',
      permissions: [],
      isAuthenticated: true,
      isLoading: false,
      error: null,
    } as never);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('card payment → payload.payment.method === "card"', async () => {
    const payload = await renderAndGetReceipt(buildProps({ paymentMethod: 'card' }));
    expect(payload.payment.method).toBe('card');
    // Card has no cash change.
    expect(payload.payment.cash_received).toBeUndefined();
    expect(payload.payment.change_given).toBeUndefined();
  });

  it('qris payment → payload.payment.method === "qris"', async () => {
    const payload = await renderAndGetReceipt(buildProps({ paymentMethod: 'qris' }));
    expect(payload.payment.method).toBe('qris');
  });

  it('cash payment → method "cash" with cash_received/change_given present (non-regression)', async () => {
    const payload = await renderAndGetReceipt(
      buildProps({ paymentMethod: 'cash', cashReceived: 60_000, changeGiven: 5_000 }),
    );
    expect(payload.payment.method).toBe('cash');
    expect(payload.payment.cash_received).toBe(60_000);
    expect(payload.payment.change_given).toBe(5_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @breakery/app-pos test receipt-payment-method`
Expected: FAIL — the `'card'` and `'qris'` cases fail because `buildReceiptPayload` hardcodes `method: 'cash'` (`SuccessModal.tsx:59`), so `payload.payment.method` is `'cash'` for every case. (The file also will not typecheck against the frozen `ReceiptPayload.payment.method: 'cash'` once the builder is changed — that is why the type widen comes first in Task 2.)

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/pos/src/features/payment/__tests__/receipt-payment-method.smoke.test.tsx
git commit -m "test(pos): receipt smoke asserts real payment method (failing)"
```

---

## Task 2: Widen the type + propagate the prop

**Files:**
- Modify: `apps/pos/src/services/print/printService.ts:60`
- Modify: `apps/pos/src/features/payment/SuccessModal.tsx:7,58-63`

- [ ] **Step 1: Widen `ReceiptPayload.payment.method` (reuse the domain union)**

In `apps/pos/src/services/print/printService.ts`, change the import at line 2 to also pull `PaymentMethod` from `@breakery/domain`:

```ts
// apps/pos/src/services/print/printService.ts
import type { PaymentMethod, PrintKind, PrinterRole } from '@breakery/domain';
```

Then change line 60 (the `ReceiptPayload.payment` field) from:

```ts
  payment: { method: 'cash'; amount: number; cash_received: number; change_given: number };
```

to (reuse the canonical 6-method union; cash-only fields become optional):

```ts
  payment: { method: PaymentMethod; amount: number; cash_received?: number; change_given?: number };
```

Do NOT define a new `ReceiptPaymentMethod` alias — `PaymentMethod` from `@breakery/domain` (`packages/domain/src/types/payment.ts:2`) is exactly `'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit'` and is already the project canonical. `MockReceiptEntry` (`printService.ts:69-73`) references `ReceiptPayload` by type, so it updates automatically — no edit needed there.

- [ ] **Step 2: Type the `SuccessModalProps.paymentMethod` prop precisely**

In `apps/pos/src/features/payment/SuccessModal.tsx`, change the import at line 7 to add `PaymentMethod`:

```ts
import { calculateTotals } from '@breakery/domain';
import type { Cart, PaymentMethod } from '@breakery/domain';
import { printReceipt, openCashDrawer, type ReceiptPayload } from '@/services/print/printService';
```

Then change the prop declaration at line 26 from `paymentMethod: string;` to:

```ts
  paymentMethod: PaymentMethod;
```

This matches what `PaymentTerminal.tsx:265` already passes (`success.paymentMethod` is typed `PaymentMethod`), and the existing reference smokes pass string literals (`'cash'`) that are valid `PaymentMethod` members — no test breakage.

- [ ] **Step 3: Propagate the real method in `buildReceiptPayload` (cash fields conditional)**

In `apps/pos/src/features/payment/SuccessModal.tsx`, replace the `payment` block at lines 58-63 (the hardcoded `method: 'cash'`) with the propagated method and conditional cash fields:

```ts
    payment: {
      method: props.paymentMethod,
      amount: props.total,
      ...(props.paymentMethod === 'cash'
        ? { cash_received: props.cashReceived, change_given: props.changeGiven ?? 0 }
        : {}),
    },
```

`cash_received`/`change_given` are now supplied only for `cash` (they have no meaning for card/QRIS/EDC/transfer/store_credit), matching the optional type from Step 1. For split-pay, `props.paymentMethod` is whatever `PaymentTerminal` passed (first tender's method, per Task 0 — unchanged by this fix).

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test receipt-payment-method`
Expected: PASS — all 3 cases green (`card` → `'card'`, `qris` → `'qris'`, `cash` → `'cash'` with `cash_received: 60000` + `change_given: 5000`).

- [ ] **Step 5: Run typecheck to verify the widened union compiles**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS — `'card'`/`'qris'` now compile against `ReceiptPayload.payment.method: PaymentMethod`; the conditional spread satisfies the optional `cash_received?`/`change_given?`.

- [ ] **Step 6: Commit the fix**

```bash
git add apps/pos/src/services/print/printService.ts apps/pos/src/features/payment/SuccessModal.tsx
git commit -m "fix(pos): receipt reflects real payment method (reuse domain PaymentMethod, cash fields optional)"
```

---

## Task 3: Non-regression sweep + PR

**Files:**
- Read-only verification: `apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx`, `apps/pos/src/__tests__/print.smoke.test.tsx`

- [ ] **Step 1: Run the receipt + payment smoke suites**

Run: `pnpm --filter @breakery/app-pos test receipt payment`
Expected: PASS — including the S34 `receipt-targets-cashier.smoke.test.tsx` and `print.smoke.test.tsx` (both pass `paymentMethod` values that remain valid `PaymentMethod` members; the optional cash fields preserve the existing `'cash'` payload shape).

- [ ] **Step 2: Full POS typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS (no `paymentMethod` callers broke — `PaymentTerminal` already passes a `PaymentMethod`).

- [ ] **Step 3: Open the PR**

```bash
git push -u origin fix/pos-receipt-payment-method
gh pr create --base master --head fix/pos-receipt-payment-method \
  --title "fix(pos): receipt reflects real payment method (widen ReceiptPayload.method)" \
  --body "Closes the P1 audit finding 'receipt always shows Cash'. Widens ReceiptPayload.payment.method to the canonical @breakery/domain PaymentMethod union (6 methods), makes cash-only fields optional, and propagates props.paymentMethod in buildReceiptPayload. Split-pay V1: receipt shows the first tender's method (tendersToShip[0]) — per-tender breakdown is a documented follow-up. Mock-mode smoke proves card/qris/cash payloads. No DB/RPC/EF. Spec: docs/workplan/specs/2026-06-01-pos-receipt-payment-method-fix-spec.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Acceptance criteria

- [ ] `ReceiptPayload.payment.method` accepts the 6 project methods via the reused `@breakery/domain` `PaymentMethod` union (Task 2 Step 1).
- [ ] `buildReceiptPayload` propagates `props.paymentMethod` — no hardcoded `'cash'` (Task 2 Step 3).
- [ ] A card/QRIS payment produces `payment.method` = the real method, proven via the mock buffer (Task 1 cases, green after Task 2).
- [ ] `cash_received`/`change_given` supplied only for `cash` (optional in type; conditional spread in builder).
- [ ] Call-site passes the real method (verified Task 0 Step 2); split-pay V1 decision documented (DEV-RPM-P0-01).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS (Task 2 Step 5, Task 3 Step 2).
- [ ] S34 `receipt-targets-cashier.smoke.test.tsx` + `print.smoke.test.tsx` stay green (Task 3 Step 1).

---

## Risks / dependencies

- **Dependency** — faithful printed rendering depends on the external print-bridge consuming `payment.method`; in mock mode we validate the payload only (spec §6).
- **Split-pay** — `PaymentTerminal` passes `tendersToShip[0]!.method` (first tender) for multi-tender orders; the receipt therefore shows the first tender's method, which can be misleading. Mitigated by being explicit (DEV-RPM-P0-01); a dominant-method / `'Split'` sentinel is a documented follow-up.
- No migration, no RPC, no Edge Function. No `StationTicketPayload` change (already `string`).

## Deviations log

| ID | Severity | Description |
|---|---|---|
| DEV-RPM-P0-01 | Informational | Split-pay V1: the receipt shows the **first tender's** method (`PaymentTerminal.tsx:213` → `tendersToShip[0]!.method`), not a dominant-method or `'Split'` sentinel. Ratified for V1 — call-site unchanged. Per-tender breakdown on the receipt is a follow-up (spec §5 Hors scope). |
| DEV-RPM-2-01 | Informational | Plan reuses `@breakery/domain` `PaymentMethod` instead of defining a new `ReceiptPaymentMethod` alias (spec §2 Choix 1 suggested a local alias). DRY: the canonical 6-method union already exists at `packages/domain/src/types/payment.ts:2` and is what the call-site passes — a local alias would duplicate it. |
| DEV-RPM-2-02 | Informational | `SuccessModalProps.paymentMethod` tightened from `string` to `PaymentMethod` (spec described it as `string` at `:27`; actual is `:26`). This matches the value `PaymentTerminal.tsx:265` already passes and prevents future callers from passing an invalid method string. |

## Out of scope

- Full multi-tender line-by-line breakdown on the receipt (follow-up).
- NPWP / PB1 on receipt (backlog S35+).
- Print-bridge rendering implementation (external — cf. `pos-print-bridge-deploy`).
- `StationTicketPayload.payment.method` (`printService.ts:31`) — already `string`, untouched.
- Client-side total recompute in `buildReceiptPayload` via `calculateTotals` (already present `SuccessModal.tsx:33`) — untouched.

---

## Self-Review

**1. Spec coverage** — every spec §3 acceptance criterion maps to a task:
- "`ReceiptPayload.payment.method` accepts 6 methods" → Task 2 Step 1.
- "`buildReceiptPayload` propagates `props.paymentMethod`" → Task 2 Step 3.
- "card/QRIS produces real method" → Task 1 cases + Task 2.
- "`cash_received`/`change_given` only for cash" → Task 2 Step 1 (optional) + Step 3 (conditional spread).
- "call-site passes real method (verified)" → Task 0 Step 2.
- "split-pay decision documented" → Task 0 Step 3 + DEV-RPM-P0-01.
- "typecheck PASS" → Task 2 Step 5 / Task 3 Step 2.
- Spec §4 tests (`receipt-payment-method.smoke` card/qris/cash; non-regression `receipt-targets-cashier`) → Task 1 + Task 3 Step 1.
- No gaps.

**2. Placeholder scan** — no "TBD/TODO/implement later", no "add error handling", no "write tests for the above" without code, no "similar to Task N". Every code step shows complete code. The Deviations log is pre-filled (not a placeholder).

**3. Type consistency** — `PaymentMethod` is the single union used in `printService.ts` (Step 1), `SuccessModal.tsx` prop (Step 2) and builder (Step 3); the test's `paymentMethod` values (`'cash'/'card'/'qris'`) are valid members. `getMockPrintBuffer()`, `clearMockPrintBuffer()`, `ReceiptPayload`, `SuccessModalProps`, `buildReceiptPayload` names are consistent with the read source files. `tendersToShip[0]!.method` matches `PaymentTerminal.tsx:213`. No drift.

## Execution Handoff

Plan complete and saved to `docs/workplan/plans/2026-06-01-pos-receipt-payment-method-fix-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (Task 0 gate first, then 1 → 2 → 3), review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session with checkpoints for review. REQUIRED SUB-SKILL: superpowers:executing-plans.

Which approach?
