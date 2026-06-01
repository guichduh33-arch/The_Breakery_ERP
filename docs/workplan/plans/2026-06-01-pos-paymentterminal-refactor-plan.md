# POS PaymentTerminal Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This is an iso-behaviour refactor.** The non-regression guarantee rests entirely on the existing test suite. NEVER adapt a test's *logic* to make it pass — only mechanical import-path fixes are allowed, and only if a symbol a test imports physically moves (none do here: the tests import `PaymentTerminal` and mock `../hooks/useCheckout`).

**Goal:** Split `apps/pos/src/features/payment/PaymentTerminal.tsx` (634 lines, measured 2026-06-01) below the 500-line rule (target < 300) without changing any observable behaviour, by extracting (1) the flow logic into a hook `usePaymentFlowLogic` and (2) the JSX sub-blocks into dedicated presentation components.

**Architecture:** One non-IO-free hook (`usePaymentFlowLogic`) holds every store selector, derivation, local state and handler — `PaymentTerminal` calls it once and destructures. The JSX is then carved into 5 focused presentation components fed by that hook's return value. `PaymentTerminal` becomes a thin orchestrator (early returns + `<FullScreenModal>` composition + the footer Process-Payment button, which MUST stay here because the idempotency test targets it via `getAllByRole('button', { name: /Process Payment/i })[0]`). The pure-math helpers stay in `@breakery/domain` — nothing moves there.

**Tech Stack:** React 18 + TypeScript, Zustand stores (`paymentStore`/`cartStore`/`authStore`), React Query (`useCheckout`/`useFireToStations`), `@breakery/ui` primitives, `@breakery/domain` pure helpers, Vitest + `@testing-library/react`, pnpm + turbo, Windows PowerShell shell.

**Branch:** `refactor/pos-payment-terminal` (create from `master` @ `70c5cf1`).
**Effort:** M (~1-2 days). **No migration / RPC / EF. No DB change.**

---

## Invariants (read before touching anything)

These ARE the definition of "iso-behaviour". Any violation is a regression.

1. **`data-testid` preserved byte-for-byte** — consumed by tests:
   - `payment-retry-banner`, `payment-retry-button` (`PaymentTerminal.tsx:426,440`)
   - `payment-already-paid-banner`, `payment-already-paid-dismiss` (`:453,466`)
   - `pay-cash-exact` (`:483`), `pay-split-entry` (`:499`)
   - `pay-method-${m.value}` (`:526`), `pay-add-tender` (`:595`)
2. **Accessible labels preserved** — `PaymentTerminal.idempotency.test.tsx:109` targets the footer button via `getAllByRole('button', { name: /Process Payment/i })[0]`. The footer "Process Payment" button (`:608-622`) and its `disabled={!canProcess || checkout.isPending}` condition MUST stay in `PaymentTerminal.tsx` with the same name and condition.
3. **Import paths the test mocks resolve against** — `PaymentTerminal.idempotency.test.tsx:32`, `checkout-autofire.smoke.test.tsx:40` both `vi.mock('../hooks/useCheckout', ...)`. That literal `'../hooks/useCheckout'` is resolved from the *test file* (`apps/pos/src/features/payment/__tests__/`) → it points at `apps/pos/src/features/payment/hooks/useCheckout`. The new hook `usePaymentFlowLogic` MUST import `useCheckout` from `./useCheckout` (same physical module → the mock applies). `checkout-autofire.smoke.test.tsx:48,58,62` also mock `@/features/cart/hooks/useFireToStations`, `@/features/cart/hooks/useStationPrinters`, `@/features/settings/hooks/usePOSPresets` by ABSOLUTE path — keep those exact import specifiers in the hook.
4. **Idempotency-key lifecycle unchanged** — the key lives in `paymentStore` and is regenerated only on `close`/`reset` (via `resetCartAfterCheckout()` + `reset()` in `handleDismissAlreadyPaid`/`handleNewOrder`). `dispatchCheckout` records `lastTendersShipped` so `handleRetry` resends the same payload (and the unchanged store key). `PaymentTerminal.idempotency.test.tsx:130-132` asserts the resent `payment` array AND that `idempotencyKey` is unchanged.
5. **Effect order inside `dispatchCheckout` is sacred** — `setLastError(null)` → `setLastTendersShipped(...)` → `await checkout.mutateAsync(...)` → non-blocking `fireToStations.mutateAsync(...).then/.catch` (a printer failure must NEVER block the success screen) → `setSuccess(...)`. Preserve order AND non-blocking.
6. **`@breakery/domain` stays IO-free** — `usePaymentFlowLogic` lives in `apps/pos` (it consumes Zustand + React Query). Pure helpers (`calculateTotals`, `sumTenders`, `computeRemaining`, `validateTenders`, `classifyCheckoutError`, `earnPointsForCustomer`, `tierFromLifetime`, `calculateChange`, `TIERS`) stay in the domain — do NOT duplicate.
7. **No new file exceeds 500 lines.** Target each well under 300.

---

## File Structure (decomposition decisions locked here)

### New — flow hook
```
apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts
  Single responsibility: own ALL store selectors + derivations (totals/remaining/
  draft/fastPathReady/canProcess) + local UI state (success/lastError/lastTendersShipped/
  splitOpen) + handlers (handleAddTender/handleProcess/dispatchCheckout/handleRetry/
  handleDismissAlreadyPaid/handleNewOrder/handleSplitComplete). Returns a typed
  `const` object the orchestrator + presentation components consume. ~210 lines.
apps/pos/src/features/payment/hooks/__tests__/usePaymentFlowLogic.test.ts
  Bonus unit test (value-add unlocked by the extraction): renderHook over the derived
  flags. ~80 lines.
```

### New — shared util (so presentation components + orchestrator share `formatLabel`)
```
apps/pos/src/features/payment/format.ts
  Single responsibility: `formatLabel(amount)` (moved verbatim from PaymentTerminal.tsx:628).
  ~5 lines.
```

### New — presentation components
```
apps/pos/src/features/payment/components/paymentMethods.ts
  The METHODS const + IconComponent type (moved from PaymentTerminal.tsx:36-45). ~12 lines.
apps/pos/src/features/payment/components/PaymentMethodGrid.tsx
  Renders the 6-method selection grid. Props: { selectedMethod, onSelect }. ~35 lines.
apps/pos/src/features/payment/components/TenderDraftPanel.tsx
  "Enter Amount" display + preset grid + Numpad + "Add Tender" button. ~80 lines.
apps/pos/src/features/payment/components/QuickPayRow.tsx
  Cash-Exact fast-path button + "Split by Item" button. ~50 lines.
apps/pos/src/features/payment/components/RetryBanner.tsx
  Renders the retryable banner OR the already-paid banner from `lastError`. ~70 lines.
apps/pos/src/features/payment/components/OrderSummaryPanel.tsx
  LEFT column: items table + loyalty badge + subtotal/redeem/promo/discount/tax/total. ~95 lines.
apps/pos/src/features/payment/components/__tests__/PaymentMethodGrid.smoke.test.tsx
  Bonus render smoke. ~30 lines.
apps/pos/src/features/payment/components/__tests__/RetryBanner.smoke.test.tsx
  Bonus render smoke. ~45 lines.
```

### Changed
```
apps/pos/src/features/payment/PaymentTerminal.tsx
  Becomes a thin orchestrator: usePaymentFlowLogic() + early returns
  (success → <SuccessModal>, splitOpen → <SplitPaymentFlow>) + <FullScreenModal>
  header/footer + the 5 composed components. Footer Process-Payment button STAYS here.
  Target < 200 lines (was 634).
```

### Existing tests — must stay green WITHOUT logic change
```
apps/pos/src/features/payment/__tests__/PaymentTerminal.idempotency.test.tsx   (renders PaymentTerminal, mocks ../hooks/useCheckout — DIRECTLY AFFECTED)
apps/pos/src/features/payment/__tests__/checkout-autofire.smoke.test.tsx       (renders PaymentTerminal — DIRECTLY AFFECTED)
apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx (renders SuccessModal in isolation — NOT affected, but in the `payment` glob)
apps/pos/src/features/payment/split/__tests__/SplitPaymentFlow.smoke.test.tsx  (renders SplitPaymentFlow in isolation — NOT affected, but in the `payment` glob)
```

---

## Task 0: Branch + capture the GREEN baseline (BLOCKING — do first)

**Files:**
- No code files. This task captures the non-regression contract.

- [ ] **Step 1: Create the branch and commit spec + plan**

```bash
git checkout master
git pull --ff-only
git checkout -b refactor/pos-payment-terminal
git add docs/workplan/specs/2026-06-01-pos-paymentterminal-refactor-spec.md docs/workplan/plans/2026-06-01-pos-paymentterminal-refactor-plan.md
git commit -m "docs(workplan): pos paymentterminal refactor — spec + plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: Run the payment suite to capture the GREEN baseline**

Run: `pnpm --filter @breakery/app-pos test payment`

Expected: the 4 files run —
`PaymentTerminal.idempotency.test.tsx` (4 tests), `checkout-autofire.smoke.test.tsx` (2 tests), `receipt-targets-cashier.smoke.test.tsx`, `SplitPaymentFlow.smoke.test.tsx` — all PASS. **Write down the exact "Test Files N passed / Tests M passed" line.** This is the contract: any later difference is a regression to investigate. (Pre-existing env-gated failures `VITE_SUPABASE_URL Required` / `DEV-S25-2.A-02` are NOT in the `payment` glob — if any appear, note them as baseline, not regressions.)

- [ ] **Step 3: Run the typecheck baseline**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS. Note it as the reference.

- [ ] **Step 4: Confirm the current line count**

Run (PowerShell): `(Get-Content apps/pos/src/features/payment/PaymentTerminal.tsx).Count`
Expected: `634`. This is the "before" number for the INDEX.

---

## Task 1: Extract `formatLabel` to a shared util

> Smallest safe first move: pull the leaf helper out so both the orchestrator and the new presentation components can share it. Pure relocation.

**Files:**
- Create: `apps/pos/src/features/payment/format.ts`
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx` (import it, delete the local def at `:628-630`)
- Test: existing `apps/pos/src/features/payment/__tests__/*` (no new test — pure move)

- [ ] **Step 1: Create the util file with the verbatim helper**

`apps/pos/src/features/payment/format.ts`:

```ts
// apps/pos/src/features/payment/format.ts
// Shared by PaymentTerminal + its extracted presentation components.
// Moved verbatim from PaymentTerminal.tsx (was the trailing helper).

export function formatLabel(amount: number): string {
  return `Rp ${amount.toLocaleString('en-US')}`;
}
```

- [ ] **Step 2: Import it in PaymentTerminal and delete the local definition**

In `apps/pos/src/features/payment/PaymentTerminal.tsx`, add to the local-import block (after line 29):

```ts
import { formatLabel } from './format';
```

Then delete the trailing local definition (current lines 628-630):

```ts
function formatLabel(amount: number): string {
  return `Rp ${amount.toLocaleString('en-US')}`;
}
```

Leave the `void calculateChange;` line (`:632-633`) untouched.

- [ ] **Step 3: Run the payment suite — must match the Task 0 baseline**

Run: `pnpm --filter @breakery/app-pos test payment`
Expected: same PASS counts as Task 0 Step 2.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/payment/format.ts apps/pos/src/features/payment/PaymentTerminal.tsx
git commit -m "refactor(pos): extract formatLabel to payment/format.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extract the flow logic into `usePaymentFlowLogic` (the big move)

> Move state + derivations + handlers into the hook. `PaymentTerminal` keeps rendering the exact same JSX, just sourced from `flow.*`. Test BEFORE touching JSX so a regression here is attributed to the hook, not the markup.

**Files:**
- Create: `apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts`
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx` (replace the logic block with a single hook call + destructure; JSX unchanged except `flow.` prefixes)
- Test: existing `PaymentTerminal.idempotency.test.tsx` + `checkout-autofire.smoke.test.tsx`

- [ ] **Step 1: Create the hook with the logic moved VERBATIM**

`apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts` (every line below is lifted unchanged from `PaymentTerminal.tsx:34,47-54,56-254` — same imports, same effect order, same idempotency mechanics):

```ts
// apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts
// Iso-behaviour extraction of PaymentTerminal's flow logic (S-refactor 2026-06-01).
// Owns store selectors + derivations + local UI state + handlers. NOT IO-free
// (consumes Zustand + React Query) — stays in apps/pos by design. Pure math stays
// in @breakery/domain.
//
// IMPORTANT: imports useCheckout from './useCheckout' so the test mock
// vi.mock('../hooks/useCheckout', ...) (resolved from __tests__/) hits this module.

import { useState } from 'react';
import {
  calculateTotals, earnPointsForCustomer,
  validateTenders, sumTenders, computeRemaining,
  classifyCheckoutError, type RetryClassification,
  type Tender,
} from '@breakery/domain';
import { resetCartAfterCheckout, useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';
import { useCheckout } from './useCheckout';
import { usePOSPresets } from '@/features/settings/hooks/usePOSPresets';
import { useFireToStations } from '@/features/cart/hooks/useFireToStations';
import { toast } from 'sonner';
import type { PaymentMethod } from '@breakery/domain';

const TAX_RATE = 0.10;

export interface PaymentSuccessState {
  orderNumber: string;
  total: number;
  changeGiven: number | null;
  pointsEarned: number;
  customerName: string | undefined;
  paymentMethod: PaymentMethod;
}

export function usePaymentFlowLogic() {
  const isOpen = usePaymentStore((s) => s.isOpen);
  const close = usePaymentStore((s) => s.close);
  const reset = usePaymentStore((s) => s.reset);
  const selectedMethod = usePaymentStore((s) => s.selectedMethod);
  const selectMethod = usePaymentStore((s) => s.selectMethod);
  const cashReceivedStr = usePaymentStore((s) => s.cashReceivedStr);
  const setCashReceivedStr = usePaymentStore((s) => s.setCashReceivedStr);
  const tenders = usePaymentStore((s) => s.tenders);
  const addTender = usePaymentStore((s) => s.addTender);
  const removeTender = usePaymentStore((s) => s.removeTender);

  const cart = useCartStore((s) => s.cart);
  const attachedCustomer = useCartStore((s) => s.attachedCustomer);
  const appliedPromotions = useCartStore((s) => s.appliedPromotions);
  const user = useAuthStore((s) => s.user);
  const checkout = useCheckout();
  const { mutation: fireToStations } = useFireToStations();
  const { presets } = usePOSPresets();
  const quickAmounts = presets.quickPayments;

  const baseTotals = calculateTotals(cart, TAX_RATE);
  const promotionTotal = appliedPromotions.reduce((s, ap) => s + ap.amount, 0);
  const total = Math.max(0, baseTotals.total - promotionTotal);
  const tax_amount = Math.round((total * TAX_RATE) / (1 + TAX_RATE));
  const totals = { ...baseTotals, total, tax_amount };

  const tenderedSum = sumTenders(tenders);
  const remaining = computeRemaining(total, tenders);

  const draftAmount = Number(cashReceivedStr || '0');
  const isCashDraft = selectedMethod === 'cash';
  const draftTenderAmount = isCashDraft
    ? Math.min(draftAmount, remaining)
    : draftAmount;
  const cashChange = isCashDraft && draftAmount > remaining
    ? draftAmount - remaining
    : 0;

  const draftValid =
    selectedMethod !== null
    && draftTenderAmount > 0
    && remaining > 0
    && draftTenderAmount <= remaining
    && (isCashDraft || draftAmount === draftTenderAmount);

  const fastPathReady =
    tenders.length === 0
    && selectedMethod !== null
    && (
      (isCashDraft && draftAmount >= total)
      || (!isCashDraft && draftAmount === total)
    );

  const canProcess = remaining === 0 || fastPathReady;

  const [success, setSuccess] = useState<PaymentSuccessState | null>(null);
  const [lastError, setLastError] = useState<RetryClassification | null>(null);
  const [lastTendersShipped, setLastTendersShipped] = useState<Tender[] | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);

  function handleAddTender(): void {
    if (!selectedMethod || !draftValid) return;
    const isLast = draftTenderAmount === remaining;
    const tender: Tender = {
      method: selectedMethod,
      amount: draftTenderAmount,
      ...(isCashDraft ? { cash_received: draftAmount } : {}),
      ...(isCashDraft && cashChange > 0 && isLast ? { change_given: cashChange } : {}),
    };
    if (isCashDraft && cashChange > 0 && !isLast) {
      toast.error('Cash overpay only allowed on the last tender');
      return;
    }
    addTender(tender);
  }

  async function handleProcess(): Promise<void> {
    let tendersToShip: Tender[];
    if (tenders.length > 0 && remaining === 0) {
      tendersToShip = tenders;
    } else if (fastPathReady && selectedMethod) {
      const lastChange = isCashDraft ? Math.max(0, draftAmount - total) : 0;
      const tender: Tender = {
        method: selectedMethod,
        amount: total,
        ...(isCashDraft ? { cash_received: draftAmount } : {}),
        ...(isCashDraft && lastChange > 0 ? { change_given: lastChange } : {}),
      };
      tendersToShip = [tender];
    } else {
      return;
    }

    const v = validateTenders(total, tendersToShip);
    if (!v.ok) {
      toast.error(`Validation: ${v.error}${v.detail ? ` — ${v.detail}` : ''}`);
      return;
    }

    await dispatchCheckout(tendersToShip);
  }

  async function dispatchCheckout(tendersToShip: Tender[]): Promise<void> {
    setLastError(null);
    setLastTendersShipped(tendersToShip);
    try {
      const result = await checkout.mutateAsync({ cart, payment: tendersToShip });

      fireToStations.mutateAsync({ orderNumber: result.order_number }).then((results) => {
        for (const r of results) {
          if (!r.ok) {
            toast.error(`${r.role} printer unreachable — ticket not printed`);
          }
        }
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown';
        toast.error(`Station print failed: ${message}`);
      });

      setSuccess({
        orderNumber: result.order_number,
        total: result.total,
        changeGiven: result.change_given,
        pointsEarned: attachedCustomer
          ? earnPointsForCustomer(result.total, attachedCustomer.lifetime_points)
          : 0,
        customerName: attachedCustomer?.name ?? undefined,
        paymentMethod: tendersToShip[0]!.method,
      });
    } catch (err: unknown) {
      const classified = classifyCheckoutError(err);
      setLastError(classified);
      if (classified.kind === 'fatal') {
        toast.error(classified.userMessage);
      }
    }
  }

  function handleRetry(): void {
    if (!lastTendersShipped) return;
    void dispatchCheckout(lastTendersShipped);
  }

  function handleDismissAlreadyPaid(): void {
    resetCartAfterCheckout();
    reset();
    setLastError(null);
    setLastTendersShipped(null);
  }

  function handleNewOrder(): void {
    setSuccess(null);
    resetCartAfterCheckout();
    reset();
  }

  async function handleSplitComplete(splitTenders: Tender[]): Promise<void> {
    const v = validateTenders(total, splitTenders);
    if (!v.ok) {
      toast.error(`Validation: ${v.error}${v.detail ? ` — ${v.detail}` : ''}`);
      return;
    }
    await dispatchCheckout(splitTenders);
    setSplitOpen(false);
  }

  return {
    // modal
    isOpen, close,
    // identity / data
    user, cart, attachedCustomer, appliedPromotions, totals, tenderedSum,
    // method + draft
    selectedMethod, selectMethod, cashReceivedStr, setCashReceivedStr,
    quickAmounts, draftAmount, isCashDraft, draftTenderAmount, cashChange, draftValid,
    // tenders
    tenders, removeTender,
    // flow flags
    total, remaining, fastPathReady, canProcess,
    checkoutPending: checkout.isPending,
    // ui state
    success, lastError, splitOpen, setSplitOpen,
    // handlers
    handleAddTender, handleProcess, handleRetry,
    handleDismissAlreadyPaid, handleNewOrder, handleSplitComplete,
  } as const;
}
```

- [ ] **Step 2: Rewire PaymentTerminal to consume the hook (JSX still inline)**

In `apps/pos/src/features/payment/PaymentTerminal.tsx`, **replace the whole logic block** (current lines 34, 47-54, and 56-254 — i.e. the `TAX_RATE` const, the `SuccessState` interface, and everything from `export function PaymentTerminal() {` down through the end of `handleSplitComplete`) so the function body opens like this:

```ts
export function PaymentTerminal() {
  const {
    isOpen, close,
    user, cart, attachedCustomer, appliedPromotions, totals, tenderedSum,
    selectedMethod, selectMethod, cashReceivedStr, setCashReceivedStr,
    quickAmounts, draftAmount, isCashDraft, draftTenderAmount, cashChange, draftValid,
    tenders, removeTender,
    total, remaining, fastPathReady, canProcess, checkoutPending,
    success, lastError, splitOpen, setSplitOpen,
    handleAddTender, handleProcess, handleRetry,
    handleDismissAlreadyPaid, handleNewOrder, handleSplitComplete,
  } = usePaymentFlowLogic();
```

Then, in the JSX that follows (the early returns + the `<FullScreenModal>` body), mechanically replace every former local reference with the destructured name. Two specific renames to apply throughout the JSX:
- `checkout.isPending` → `checkoutPending` (occurs in the retry button `disabled`, the cash-exact button, the footer button, and their `'Processing…'` / `'Retrying…'` ternaries: former lines 439, 443, 482, 486, 498, 611, 614).
- Everything else keeps its exact name (e.g. `total`, `remaining`, `selectedMethod`, `cashReceivedStr`, `formatLabel`, the `tierFromLifetime`/`TIERS` usage in the loyalty IIFE — these domain symbols are still imported at the top of `PaymentTerminal.tsx`, leave that import line intact for now).

- [ ] **Step 3: Fix the top-of-file imports of PaymentTerminal**

Add the hook import (after the `./format` import from Task 1):

```ts
import { usePaymentFlowLogic } from './hooks/usePaymentFlowLogic';
```

Remove the imports now used ONLY by the moved logic (they live in the hook now). After this step `PaymentTerminal.tsx`'s import block should keep only what its remaining JSX still uses: `useState` is gone (no local state left) — delete `import { useState } from 'react';`. From `@breakery/domain` the JSX still uses `tierFromLifetime`, `TIERS`, and the types `PaymentMethod`/`RetryClassification`/`Tender` (for component prop typing in later tasks); keep those, drop `calculateTotals, calculateChange, earnPointsForCustomer, validateTenders, sumTenders, computeRemaining, classifyCheckoutError` from the domain import. Drop the now-unused store/hook imports `usePaymentStore`, `useAuthStore`, `useCheckout`, `usePOSPresets`, `useFireToStations`, `resetCartAfterCheckout`, `useCartStore`, and `toast`. Drop the trailing `void calculateChange;` line (`:632-633`) since `calculateChange` is no longer imported here. (TypeScript will flag any over-removal — let the typecheck in Step 5 catch it.)

- [ ] **Step 4: Run the payment suite — must match the Task 0 baseline EXACTLY**

Run: `pnpm --filter @breakery/app-pos test payment`
Expected: identical PASS counts to Task 0 Step 2. In particular `PaymentTerminal.idempotency.test.tsx` (4/4) must pass — that proves the mock still hits `useCheckout` through `./useCheckout` (Invariant 3), the retry resends the same payload, and the idempotency key is unchanged (Invariant 4). If anything breaks here, the cause is the hook extraction — not JSX.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS (catches any wrong import-removal in Step 3).

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts apps/pos/src/features/payment/PaymentTerminal.tsx
git commit -m "refactor(pos): extract PaymentTerminal flow logic to usePaymentFlowLogic

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extract `RetryBanner` (testid-bearing — do first among components)

> The two `role="alert"` banners carry 4 tested testids. Extract them first and retest immediately to lock the most fragile surface.

**Files:**
- Create: `apps/pos/src/features/payment/components/RetryBanner.tsx`
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx`
- Test: existing `PaymentTerminal.idempotency.test.tsx`

- [ ] **Step 1: Create the component (markup lifted verbatim from `:419-473`)**

`apps/pos/src/features/payment/components/RetryBanner.tsx`:

```tsx
// apps/pos/src/features/payment/components/RetryBanner.tsx
// Iso-behaviour extraction of PaymentTerminal's idempotency banners.
// Renders the retryable banner OR the already-paid banner from `lastError`.
// data-testids preserved byte-for-byte (consumed by PaymentTerminal.idempotency.test).

import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { RetryClassification } from '@breakery/domain';

export interface RetryBannerProps {
  lastError: RetryClassification | null;
  checkoutPending: boolean;
  onRetry: () => void;
  onDismissAlreadyPaid: () => void;
}

export function RetryBanner({
  lastError,
  checkoutPending,
  onRetry,
  onDismissAlreadyPaid,
}: RetryBannerProps) {
  if (lastError?.kind === 'retryable') {
    return (
      <div
        role="alert"
        data-testid="payment-retry-banner"
        className="mb-4 rounded-md border border-warning bg-warning-soft p-3 text-sm"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 text-warning shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-text-primary">Payment did not reach the server</div>
            <p className="text-text-secondary mt-1">{lastError.userMessage}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={onRetry}
              disabled={checkoutPending}
              data-testid="payment-retry-button"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              {checkoutPending ? 'Retrying…' : 'Retry payment'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (lastError?.kind === 'already_paid') {
    return (
      <div
        role="alert"
        data-testid="payment-already-paid-banner"
        className="mb-4 rounded-md border border-success bg-success-soft p-3 text-sm"
      >
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-success shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-text-primary">Order already finalized</div>
            <p className="text-text-secondary mt-1">{lastError.userMessage}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={onDismissAlreadyPaid}
              data-testid="payment-already-paid-dismiss"
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Replace the inline banners in PaymentTerminal with the component**

In `apps/pos/src/features/payment/PaymentTerminal.tsx`, delete the entire block of the two `{lastError?.kind === 'retryable' && (...)}` and `{lastError?.kind === 'already_paid' && (...)}` JSX expressions (former lines 419-473, including the leading comment) and replace with:

```tsx
          <RetryBanner
            lastError={lastError}
            checkoutPending={checkoutPending}
            onRetry={handleRetry}
            onDismissAlreadyPaid={handleDismissAlreadyPaid}
          />
```

Add the import (with the other component imports):

```ts
import { RetryBanner } from './components/RetryBanner';
```

The `AlertCircle`, `CheckCircle2`, `RefreshCw` lucide icons are now unused by the remaining PaymentTerminal JSX **only if** they appear nowhere else — `CheckCircle2` is still used by the footer (`:618`) so keep it; `AlertCircle` and `RefreshCw` are now only in `RetryBanner`, so drop them from the PaymentTerminal lucide import. Let the typecheck confirm.

- [ ] **Step 3: Run the payment suite**

Run: `pnpm --filter @breakery/app-pos test payment`
Expected: baseline match. `PaymentTerminal.idempotency.test.tsx` 4/4 PASS (testids `payment-retry-banner` / `payment-retry-button` / `payment-already-paid-banner` still resolve).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/payment/components/RetryBanner.tsx apps/pos/src/features/payment/PaymentTerminal.tsx
git commit -m "refactor(pos): extract RetryBanner from PaymentTerminal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extract `PaymentMethodGrid` + the `METHODS` const

**Files:**
- Create: `apps/pos/src/features/payment/components/paymentMethods.ts`
- Create: `apps/pos/src/features/payment/components/PaymentMethodGrid.tsx`
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx`
- Test: existing `PaymentTerminal.idempotency.test.tsx` (uses `pay-method-*`? No — but keep testid for the split/manual flows; verify with the suite)

- [ ] **Step 1: Create the methods registry (moved from `:36-45`)**

`apps/pos/src/features/payment/components/paymentMethods.ts`:

```ts
// apps/pos/src/features/payment/components/paymentMethods.ts
import {
  ArrowRightLeft, Banknote, CreditCard, QrCode, Smartphone, Wallet,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import type { PaymentMethod } from '@breakery/domain';

export type IconComponent = ForwardRefExoticComponent<
  Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>
>;

export const METHODS: { value: PaymentMethod; label: string; icon: IconComponent }[] = [
  { value: 'cash',         label: 'Cash',         icon: Banknote },
  { value: 'card',         label: 'Card',         icon: CreditCard },
  { value: 'qris',         label: 'QRIS',         icon: QrCode },
  { value: 'edc',          label: 'EDC',          icon: Smartphone },
  { value: 'transfer',     label: 'Transfer',     icon: ArrowRightLeft },
  { value: 'store_credit', label: 'Store Credit', icon: Wallet },
];
```

- [ ] **Step 2: Create the grid component (markup lifted verbatim from `:510-533`)**

`apps/pos/src/features/payment/components/PaymentMethodGrid.tsx`:

```tsx
// apps/pos/src/features/payment/components/PaymentMethodGrid.tsx
// Iso-behaviour extraction of PaymentTerminal's method grid.
// data-testid `pay-method-${value}` and focus-visible classes preserved.

import { SectionLabel, cn } from '@breakery/ui';
import type { PaymentMethod } from '@breakery/domain';
import { METHODS } from './paymentMethods';

export interface PaymentMethodGridProps {
  selectedMethod: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
}

export function PaymentMethodGrid({ selectedMethod, onSelect }: PaymentMethodGridProps) {
  return (
    <>
      <SectionLabel as="div" className="mb-2">Select Payment Method</SectionLabel>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {METHODS.map((m) => {
          const Icon = m.icon;
          const active = selectedMethod === m.value;
          return (
            <button
              key={m.value}
              onClick={() => onSelect(m.value)}
              className={cn(
                'h-24 rounded-md border flex flex-col items-center justify-center gap-1.5 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                active
                  ? 'border-gold bg-gold-soft text-gold'
                  : 'border-border-subtle bg-bg-elevated text-text-secondary hover:text-text-primary hover:border-gold/60',
              )}
              data-testid={`pay-method-${m.value}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="text-xs uppercase tracking-widest font-semibold">{m.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Replace the inline grid in PaymentTerminal**

In `PaymentTerminal.tsx`, delete the `SectionLabel`-"Select Payment Method" + `<div className="grid grid-cols-3 ...">{METHODS.map(...)}</div>` block (former lines 510-533) and replace with:

```tsx
              <PaymentMethodGrid selectedMethod={selectedMethod} onSelect={selectMethod} />
```

Delete the now-unused `METHODS` const + `IconComponent` type (former lines 36-45) and their lucide icon imports that are no longer used by PaymentTerminal's remaining JSX (`Banknote`, `CreditCard`, `QrCode`, `Smartphone`, `ArrowRightLeft`, `Wallet` — verify none reused elsewhere in the file; `Users`, `Plus`, `ArrowLeft`, `X`, `CheckCircle2` are still used). Add the import:

```ts
import { PaymentMethodGrid } from './components/PaymentMethodGrid';
```

Also drop the `ForwardRefExoticComponent`/`RefAttributes`/`LucideProps` type imports (`:31-32`) if PaymentTerminal no longer references them. Typecheck will confirm.

- [ ] **Step 4: Run the payment suite**

Run: `pnpm --filter @breakery/app-pos test payment`
Expected: baseline match.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/payment/components/paymentMethods.ts apps/pos/src/features/payment/components/PaymentMethodGrid.tsx apps/pos/src/features/payment/PaymentTerminal.tsx
git commit -m "refactor(pos): extract PaymentMethodGrid from PaymentTerminal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extract `TenderDraftPanel`

> The "Enter Amount" display + preset grid + Numpad + "Add Tender" button (former lines 535-599). Carries `pay-add-tender` + the `<Numpad>` (accessible label "Cash Received").

**Files:**
- Create: `apps/pos/src/features/payment/components/TenderDraftPanel.tsx`
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx`
- Test: existing payment suite

- [ ] **Step 1: Create the component (markup lifted verbatim from `:535-599`)**

`apps/pos/src/features/payment/components/TenderDraftPanel.tsx`:

```tsx
// apps/pos/src/features/payment/components/TenderDraftPanel.tsx
// Iso-behaviour extraction of PaymentTerminal's draft entry panel.
// Rendered only when a method is selected. data-testid `pay-add-tender` preserved.

import { Plus } from 'lucide-react';
import { Button, Currency, Numpad, SectionLabel, cn } from '@breakery/ui';
import { formatLabel } from '../format';

export interface TenderDraftPanelProps {
  cashReceivedStr: string;
  setCashReceivedStr: (value: string) => void;
  isCashDraft: boolean;
  cashChange: number;
  draftTenderAmount: number;
  draftAmount: number;
  remaining: number;
  quickAmounts: number[];
  draftValid: boolean;
  onAddTender: () => void;
}

export function TenderDraftPanel({
  cashReceivedStr,
  setCashReceivedStr,
  isCashDraft,
  cashChange,
  draftTenderAmount,
  draftAmount,
  remaining,
  quickAmounts,
  draftValid,
  onAddTender,
}: TenderDraftPanelProps) {
  return (
    <div className="space-y-4 mb-4">
      {/* ENTER AMOUNT — big centered display */}
      <div>
        <SectionLabel as="div" className="text-gold mb-2 text-center">
          Enter Amount
        </SectionLabel>
        <div className="bg-bg-input border-2 border-gold rounded-md py-5 text-center">
          <span className="font-mono tabular-nums text-3xl text-text-primary">
            Rp {cashReceivedStr || '0'}
          </span>
        </div>
        {isCashDraft && cashChange > 0 && draftTenderAmount === remaining && (
          <div className="mt-2 text-xs text-text-secondary text-right">
            Change: <Currency amount={cashChange} className="text-gold" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* AMOUNT RECEIVED preset grid */}
        <div>
          <SectionLabel as="div" className="text-gold mb-2">Amount Received</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setCashReceivedStr(String(remaining))}
              className={cn(
                'col-span-2 rounded-md py-2.5 text-xs font-bold uppercase tracking-widest border',
                draftAmount === remaining
                  ? 'bg-gold text-bg-base border-gold'
                  : 'bg-bg-input border-border-subtle hover:bg-bg-overlay text-text-primary',
              )}
            >
              Exact ({formatLabel(remaining)})
            </button>
            {isCashDraft && quickAmounts.filter((q) => q >= remaining).slice(0, 4).map((q) => (
              <button
                key={q}
                onClick={() => setCashReceivedStr(String(q))}
                className="rounded-md py-2.5 text-xs font-mono tabular-nums bg-bg-input border border-border-subtle hover:bg-bg-overlay text-text-primary"
              >
                {formatLabel(q)}
              </button>
            ))}
          </div>
        </div>

        {/* Numpad */}
        <div>
          <SectionLabel as="div" className="text-gold mb-2">Cash Received</SectionLabel>
          <Numpad value={cashReceivedStr} onChange={setCashReceivedStr} />
        </div>
      </div>

      <Button
        variant="secondary"
        size="lg"
        className="w-full uppercase tracking-widest"
        onClick={onAddTender}
        disabled={!draftValid}
        data-testid="pay-add-tender"
      >
        <Plus className="h-4 w-4 mr-2" aria-hidden /> Add Tender
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Replace the inline panel in PaymentTerminal**

In `PaymentTerminal.tsx`, the draft panel is wrapped in `{selectedMethod && (<div className="space-y-4 mb-4"> ... </div>)}` (former lines 535-600). Replace the inner `<div className="space-y-4 mb-4">...</div>` with:

```tsx
              {selectedMethod && (
                <TenderDraftPanel
                  cashReceivedStr={cashReceivedStr}
                  setCashReceivedStr={setCashReceivedStr}
                  isCashDraft={isCashDraft}
                  cashChange={cashChange}
                  draftTenderAmount={draftTenderAmount}
                  draftAmount={draftAmount}
                  remaining={remaining}
                  quickAmounts={quickAmounts}
                  draftValid={draftValid}
                  onAddTender={handleAddTender}
                />
              )}
```

Add the import:

```ts
import { TenderDraftPanel } from './components/TenderDraftPanel';
```

`Numpad`, `Plus` lucide/ui imports are now used only by the new component — drop them from PaymentTerminal's imports if unused there. Typecheck confirms.

- [ ] **Step 3: Run the payment suite**

Run: `pnpm --filter @breakery/app-pos test payment`
Expected: baseline match.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/payment/components/TenderDraftPanel.tsx apps/pos/src/features/payment/PaymentTerminal.tsx
git commit -m "refactor(pos): extract TenderDraftPanel from PaymentTerminal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract `QuickPayRow`

> Cash-Exact fast-path button (`pay-cash-exact`) + "Split by Item" button (`pay-split-entry`, touched by SplitPaymentFlow flow). Former lines 475-506.

**Files:**
- Create: `apps/pos/src/features/payment/components/QuickPayRow.tsx`
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx`
- Test: existing payment suite

- [ ] **Step 1: Create the component (markup lifted verbatim from `:476-506`)**

`apps/pos/src/features/payment/components/QuickPayRow.tsx`:

```tsx
// apps/pos/src/features/payment/components/QuickPayRow.tsx
// Iso-behaviour extraction of PaymentTerminal's quick-pay row.
// data-testids `pay-cash-exact` / `pay-split-entry` preserved.

import { Users } from 'lucide-react';
import type { PaymentMethod } from '@breakery/domain';
import { formatLabel } from '../format';

export interface QuickPayRowProps {
  fastPathReady: boolean;
  isCashDraft: boolean;
  selectedMethod: PaymentMethod | null;
  total: number;
  checkoutPending: boolean;
  cartEmpty: boolean;
  onProcess: () => void;
  onSplitOpen: () => void;
}

export function QuickPayRow({
  fastPathReady,
  isCashDraft,
  selectedMethod,
  total,
  checkoutPending,
  cartEmpty,
  onProcess,
  onSplitOpen,
}: QuickPayRowProps) {
  return (
    <div className="flex items-stretch gap-3 mb-5">
      {fastPathReady ? (
        <button
          type="button"
          onClick={onProcess}
          disabled={checkoutPending}
          data-testid="pay-cash-exact"
          className="flex-1 h-12 rounded-md bg-green hover:bg-green/90 text-white font-bold uppercase tracking-widest text-sm transition-colors disabled:opacity-60"
        >
          {checkoutPending
            ? 'Processing…'
            : `${isCashDraft ? 'Cash' : selectedMethod?.toUpperCase()} Exact — ${formatLabel(total)}`}
        </button>
      ) : (
        <div className="flex-1 h-12 rounded-md border border-dashed border-border-subtle grid place-items-center text-text-muted text-xs uppercase tracking-widest">
          Select a method to proceed
        </div>
      )}
      <button
        type="button"
        onClick={onSplitOpen}
        disabled={cartEmpty || checkoutPending}
        data-testid="pay-split-entry"
        className="h-12 px-4 rounded-md border border-purple-400/60 bg-purple-400/10 text-purple-400 font-bold uppercase tracking-widest text-xs hover:bg-purple-400/20 transition-colors disabled:opacity-40 inline-flex items-center gap-2"
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        Split by Item
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Replace the inline row in PaymentTerminal**

In `PaymentTerminal.tsx`, the row is wrapped in `{remaining > 0 && (<div className="flex items-stretch gap-3 mb-5"> ... </div>)}` (former lines 476-506). Replace the inner `<div>` with:

```tsx
          {remaining > 0 && (
            <QuickPayRow
              fastPathReady={fastPathReady}
              isCashDraft={isCashDraft}
              selectedMethod={selectedMethod}
              total={total}
              checkoutPending={checkoutPending}
              cartEmpty={cart.items.length === 0}
              onProcess={() => { void handleProcess(); }}
              onSplitOpen={() => setSplitOpen(true)}
            />
          )}
```

Add the import:

```ts
import { QuickPayRow } from './components/QuickPayRow';
```

`Users` lucide import is now only in the new component — drop it from PaymentTerminal if unused. Typecheck confirms.

- [ ] **Step 3: Run the payment suite**

Run: `pnpm --filter @breakery/app-pos test payment`
Expected: baseline match (the `pay-cash-exact` path is exercised by the idempotency test's fast-path footer click; `pay-split-entry` exists for the split flow).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/payment/components/QuickPayRow.tsx apps/pos/src/features/payment/PaymentTerminal.tsx
git commit -m "refactor(pos): extract QuickPayRow from PaymentTerminal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Extract `OrderSummaryPanel`

> The LEFT column: items table + loyalty IIFE + subtotal/redeem/promo/discount/tax/total. Former lines 307-382. Pure render, no critical testid.

**Files:**
- Create: `apps/pos/src/features/payment/components/OrderSummaryPanel.tsx`
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx`
- Test: existing payment suite

- [ ] **Step 1: Create the component (markup lifted verbatim from `:307-382`)**

`apps/pos/src/features/payment/components/OrderSummaryPanel.tsx`:

```tsx
// apps/pos/src/features/payment/components/OrderSummaryPanel.tsx
// Iso-behaviour extraction of PaymentTerminal's LEFT order-summary column.
// Pure render. Loyalty multiplier math stays inline (was already inline in PT).

import { Currency, LoyaltyBadge, PromotionLineRow } from '@breakery/ui';
import { tierFromLifetime, TIERS } from '@breakery/domain';
import type { calculateTotals } from '@breakery/domain';

// Mirror the shape PaymentTerminal builds (baseTotals + overridden total/tax_amount).
type Totals = ReturnType<typeof calculateTotals> & { total: number; tax_amount: number };

export interface OrderSummaryPanelProps {
  cart: ReturnType<typeof useCartLikeShape>;
  attachedCustomer: AttachedCustomer | null;
  appliedPromotions: AppliedPromotion[];
  totals: Totals;
}
```

> Typing note for the implementer: do NOT invent the prop types above. Use the exact existing types `PaymentTerminal` already passes — `cart` is `useCartStore`'s `cart` (import its type from `@/stores/cartStore`), `attachedCustomer` from the same store, `appliedPromotions` is the cart store's `appliedPromotions` element type. Replace the placeholder lines `cart: ReturnType<...>`, `attachedCustomer: AttachedCustomer | null`, `appliedPromotions: AppliedPromotion[]` with the real imported types from `@/stores/cartStore` (e.g. `import type { Cart, AttachedCustomer, AppliedPromotion } from '@/stores/cartStore'` — adjust names to the actual exports; if the store does not export named types, type the props with `cart: typeof useCartStore extends ... ` is overkill — instead lift the inline structural types `cart.items`/`attachedCustomer`/`appliedPromotions` as the component sees them). Then the body:

```tsx
export function OrderSummaryPanel({
  cart,
  attachedCustomer,
  appliedPromotions,
  totals,
}: OrderSummaryPanelProps) {
  return (
    <section className="bg-bg-base p-6 overflow-y-auto">
      <h3 className="text-xs uppercase tracking-widest text-text-primary mb-4">Current Order</h3>
      <table className="w-full text-sm">
        <thead className="text-text-secondary text-xs uppercase tracking-wide border-b border-border-subtle">
          <tr>
            <th className="text-left py-2">Item</th>
            <th className="text-right py-2 w-12">Qty</th>
            <th className="text-right py-2 w-24">Price</th>
          </tr>
        </thead>
        <tbody>
          {cart.items.map((it) => {
            const adj = it.modifiers.reduce((s, m) => s + m.price_adjustment, 0);
            const lineTotal = (it.unit_price + adj) * it.quantity;
            return (
              <tr key={it.id} className="border-b border-border-subtle align-top">
                <td className="py-3">
                  <div>{it.name}</div>
                  {it.modifiers.length > 0 && (
                    <div className="text-xs text-text-secondary mt-0.5">
                      {it.modifiers.map((m) => m.option_label).join(' · ')}
                    </div>
                  )}
                </td>
                <td className="text-right py-3">{it.quantity}</td>
                <td className="text-right py-3"><Currency amount={lineTotal} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-6 space-y-1 text-sm">
        {attachedCustomer && (() => {
          const tier = tierFromLifetime(attachedCustomer.lifetime_points);
          const tierMultiplier = TIERS.find((t) => t.tier === tier)?.points_multiplier ?? 1.0;
          const categoryMultiplier = attachedCustomer.category?.points_multiplier ?? 1.0;
          const cumulMultiplier = tierMultiplier * categoryMultiplier;
          const ptsToEarn = Math.floor((totals.total * cumulMultiplier) / 1000);
          return (
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-border-subtle">
              <LoyaltyBadge tier={tier} points={attachedCustomer.loyalty_points} />
              <span className="text-xs text-text-secondary">
                +{ptsToEarn} pts to earn ({cumulMultiplier.toFixed(2)}x)
              </span>
            </div>
          );
        })()}
        <div className="flex justify-between text-text-secondary">
          <span>Subtotal</span><Currency amount={totals.subtotal} />
        </div>
        {totals.redemption_amount > 0 && (
          <div className="flex justify-between text-text-secondary">
            <span>Loyalty redeem ({cart.loyaltyPointsToRedeem} pts)</span>
            <span className="font-mono text-red-400">-<Currency amount={totals.redemption_amount} /></span>
          </div>
        )}
        {appliedPromotions.map((ap) => (
          <PromotionLineRow key={ap.promotion_id} applied={ap} />
        ))}
        {cart.cartDiscount && (
          <div className="flex justify-between text-text-secondary">
            <span>
              Manual discount ({cart.cartDiscount.type === 'percentage' ? `${cart.cartDiscount.value}%` : 'fixed'})
            </span>
            <span className="font-mono text-red-400">-<Currency amount={cart.cartDiscount.amount} /></span>
          </div>
        )}
        <div className="flex justify-between text-text-secondary">
          <span>Tax (PB1 incl.)</span><Currency amount={totals.tax_amount} />
        </div>
        <div className="flex justify-between pt-3 border-t border-border-subtle">
          <span className="uppercase tracking-wide font-semibold">Total Amount</span>
          <Currency amount={totals.total} emphasis="gold" className="text-lg" />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Replace the inline LEFT column in PaymentTerminal**

In `PaymentTerminal.tsx`, replace the entire `<section className="bg-bg-base p-6 overflow-y-auto"> ... </section>` LEFT column (former lines 307-382, the one whose first child is `<h3>Current Order</h3>`) with:

```tsx
        <OrderSummaryPanel
          cart={cart}
          attachedCustomer={attachedCustomer}
          appliedPromotions={appliedPromotions}
          totals={totals}
        />
```

Add the import:

```ts
import { OrderSummaryPanel } from './components/OrderSummaryPanel';
```

`tierFromLifetime`, `TIERS`, `LoyaltyBadge`, `PromotionLineRow` are now only in the new component — drop them from PaymentTerminal's `@breakery/domain` / `@breakery/ui` imports if no longer referenced. `Currency` is still used by the RIGHT column (progress / remaining), keep it. Typecheck confirms.

- [ ] **Step 3: Run the payment suite**

Run: `pnpm --filter @breakery/app-pos test payment`
Expected: baseline match.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/payment/components/OrderSummaryPanel.tsx apps/pos/src/features/payment/PaymentTerminal.tsx
git commit -m "refactor(pos): extract OrderSummaryPanel from PaymentTerminal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Verify line counts + final orchestrator shape

**Files:**
- Read-only verification of all touched files.

- [ ] **Step 1: Count lines of every resulting file**

Run (PowerShell):

```powershell
@(
  'apps/pos/src/features/payment/PaymentTerminal.tsx',
  'apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts',
  'apps/pos/src/features/payment/format.ts',
  'apps/pos/src/features/payment/components/paymentMethods.ts',
  'apps/pos/src/features/payment/components/PaymentMethodGrid.tsx',
  'apps/pos/src/features/payment/components/TenderDraftPanel.tsx',
  'apps/pos/src/features/payment/components/QuickPayRow.tsx',
  'apps/pos/src/features/payment/components/RetryBanner.tsx',
  'apps/pos/src/features/payment/components/OrderSummaryPanel.tsx'
) | ForEach-Object { '{0,5}  {1}' -f (Get-Content $_).Count, $_ }
```

Expected: `PaymentTerminal.tsx` < 500 (target < 300); every other file < 500. If `PaymentTerminal.tsx` is still ≥ 500, the extraction is incomplete — re-check that all 5 components + the hook were wired in.

- [ ] **Step 2: Confirm the footer Process-Payment button is still IN PaymentTerminal.tsx (Invariant 2)**

Run: `Select-String -Path apps/pos/src/features/payment/PaymentTerminal.tsx -Pattern 'Process Payment'`
Expected: one match in the `<footer>` block — NOT extracted to a component. This is mandatory: `PaymentTerminal.idempotency.test.tsx:109` targets it via `getAllByRole('button', { name: /Process Payment/i })[0]`.

---

## Task 9: Bonus unit test — `usePaymentFlowLogic` derivations

> Value-add unlocked by the extraction. Tests the derived flags in isolation. Do NOT re-test what the idempotency test already covers (network/retry).

**Files:**
- Create: `apps/pos/src/features/payment/hooks/__tests__/usePaymentFlowLogic.test.ts`
- Test: the new file itself

- [ ] **Step 1: Write the failing test**

`apps/pos/src/features/payment/hooks/__tests__/usePaymentFlowLogic.test.ts`:

```ts
// apps/pos/src/features/payment/hooks/__tests__/usePaymentFlowLogic.test.ts
// Bonus unit coverage unlocked by the refactor: the derived flags
// (remaining / draftValid / fastPathReady / canProcess) in isolation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePaymentFlowLogic } from '../usePaymentFlowLogic';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));
vi.mock('../useCheckout', () => ({ useCheckout: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/features/cart/hooks/useFireToStations', () => ({
  useFireToStations: () => ({ mutation: { mutateAsync: vi.fn(), isPending: false }, firableCount: 0 }),
}));
vi.mock('@/features/settings/hooks/usePOSPresets', () => ({
  usePOSPresets: () => ({ presets: { quickPayments: [50_000, 100_000] } }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

function seedCartOneItem(): void {
  useCartStore.setState({
    cart: {
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 25_000, quantity: 1, modifiers: [] } as never],
      order_type: 'dine_in',
    },
    lockedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set<string>(),
    isOffline: false,
  });
  useAuthStore.setState({ user: { id: 'u1', full_name: 'T', role_code: 'CASHIER', employee_code: 'E1' } } as never);
}

describe('usePaymentFlowLogic — derived flags', () => {
  beforeEach(() => {
    seedCartOneItem();
  });

  it('cash exact draft (received === total) is fastPathReady and canProcess', () => {
    usePaymentStore.setState({ isOpen: true, selectedMethod: 'cash', cashReceivedStr: '25000', tenders: [] });
    const { result } = renderHook(() => usePaymentFlowLogic(), { wrapper });
    expect(result.current.total).toBe(25_000);
    expect(result.current.fastPathReady).toBe(true);
    expect(result.current.canProcess).toBe(true);
  });

  it('cash overpay (received > total) is fastPathReady with positive cashChange', () => {
    usePaymentStore.setState({ isOpen: true, selectedMethod: 'cash', cashReceivedStr: '30000', tenders: [] });
    const { result } = renderHook(() => usePaymentFlowLogic(), { wrapper });
    expect(result.current.fastPathReady).toBe(true);
    expect(result.current.cashChange).toBe(5_000);
  });

  it('non-cash must equal total exactly: under-amount is not fastPathReady', () => {
    usePaymentStore.setState({ isOpen: true, selectedMethod: 'card', cashReceivedStr: '20000', tenders: [] });
    const { result } = renderHook(() => usePaymentFlowLogic(), { wrapper });
    expect(result.current.fastPathReady).toBe(false);
    expect(result.current.draftValid).toBe(true); // partial card tender is a valid Add-Tender candidate
    expect(result.current.canProcess).toBe(false);
  });

  it('no method selected: nothing is processable', () => {
    usePaymentStore.setState({ isOpen: true, selectedMethod: null, cashReceivedStr: '', tenders: [] });
    const { result } = renderHook(() => usePaymentFlowLogic(), { wrapper });
    expect(result.current.draftValid).toBe(false);
    expect(result.current.fastPathReady).toBe(false);
    expect(result.current.canProcess).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter @breakery/app-pos test usePaymentFlowLogic`
Expected: 4 tests PASS. (If `total` ≠ 25_000, the cart-shape assertion needs the real `calculateTotals` behaviour — adjust the expected number to whatever `calculateTotals` returns for a single 25_000 line at `TAX_RATE = 0.10`; the flag assertions are the load-bearing part.)

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/features/payment/hooks/__tests__/usePaymentFlowLogic.test.ts
git commit -m "test(pos): unit-cover usePaymentFlowLogic derived flags

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Bonus render smokes — `PaymentMethodGrid` + `RetryBanner`

**Files:**
- Create: `apps/pos/src/features/payment/components/__tests__/PaymentMethodGrid.smoke.test.tsx`
- Create: `apps/pos/src/features/payment/components/__tests__/RetryBanner.smoke.test.tsx`

- [ ] **Step 1: Write the PaymentMethodGrid smoke**

`apps/pos/src/features/payment/components/__tests__/PaymentMethodGrid.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentMethodGrid } from '../PaymentMethodGrid';

describe('PaymentMethodGrid', () => {
  it('renders all 6 method tiles with their testids', () => {
    render(<PaymentMethodGrid selectedMethod={null} onSelect={vi.fn()} />);
    for (const value of ['cash', 'card', 'qris', 'edc', 'transfer', 'store_credit']) {
      expect(screen.getByTestId(`pay-method-${value}`)).toBeInTheDocument();
    }
  });

  it('calls onSelect with the tapped method', () => {
    const onSelect = vi.fn();
    render(<PaymentMethodGrid selectedMethod={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('pay-method-qris'));
    expect(onSelect).toHaveBeenCalledWith('qris');
  });
});
```

- [ ] **Step 2: Write the RetryBanner smoke**

`apps/pos/src/features/payment/components/__tests__/RetryBanner.smoke.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RetryBanner } from '../RetryBanner';
import type { RetryClassification } from '@breakery/domain';

const retryable: RetryClassification = { kind: 'retryable', userMessage: 'try again' } as RetryClassification;
const alreadyPaid: RetryClassification = { kind: 'already_paid', userMessage: 'done' } as RetryClassification;

describe('RetryBanner', () => {
  it('renders nothing when lastError is null', () => {
    const { container } = render(
      <RetryBanner lastError={null} checkoutPending={false} onRetry={vi.fn()} onDismissAlreadyPaid={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the retryable banner and fires onRetry', () => {
    const onRetry = vi.fn();
    render(<RetryBanner lastError={retryable} checkoutPending={false} onRetry={onRetry} onDismissAlreadyPaid={vi.fn()} />);
    expect(screen.getByTestId('payment-retry-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('payment-retry-button'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders the already-paid banner and fires onDismissAlreadyPaid', () => {
    const onDismiss = vi.fn();
    render(<RetryBanner lastError={alreadyPaid} checkoutPending={false} onRetry={vi.fn()} onDismissAlreadyPaid={onDismiss} />);
    expect(screen.getByTestId('payment-already-paid-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('payment-already-paid-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run both smokes**

Run: `pnpm --filter @breakery/app-pos test PaymentMethodGrid RetryBanner`
Expected: 5 tests PASS (2 + 3).

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/features/payment/components/__tests__/PaymentMethodGrid.smoke.test.tsx apps/pos/src/features/payment/components/__tests__/RetryBanner.smoke.test.tsx
git commit -m "test(pos): render smokes for PaymentMethodGrid + RetryBanner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Final non-regression sweep

**Files:**
- Read-only verification.

- [ ] **Step 1: Full payment suite vs the Task 0 baseline**

Run: `pnpm --filter @breakery/app-pos test payment`
Expected: same PASS counts as Task 0 Step 2 (4 original files), PLUS the 3 new bonus test files (`usePaymentFlowLogic`, `PaymentMethodGrid`, `RetryBanner`) now matched by the `payment` glob — all PASS. The original 4 files' results must be IDENTICAL to baseline (no test logic changed).

- [ ] **Step 2: Broader POS sweep for confidence**

Run: `pnpm --filter @breakery/app-pos test cart`
Expected: PASS (cart feature consumes none of the moved symbols, but `useFireToStations` lives there — confirm no collateral breakage).

- [ ] **Step 3: Full POS typecheck**

Run: `pnpm --filter @breakery/app-pos typecheck`
Expected: PASS.

---

## Task 12: Closeout — INDEX + CLAUDE.md + PR

**Files:**
- Create: `docs/workplan/plans/2026-06-01-pos-paymentterminal-refactor-INDEX.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the INDEX**

`docs/workplan/plans/2026-06-01-pos-paymentterminal-refactor-INDEX.md` with these sections (this is a pure front refactor — Migrations/Permissions/RPCs are "N/A"):
1. **Summary** — `PaymentTerminal.tsx` 634 → N lines (record the Task 8 number); 1 hook + 1 util + 6 component files extracted; iso-behaviour.
2. **Migrations applied** — N/A (refactor pur — no DB change).
3. **New files** — hook `usePaymentFlowLogic` + `format.ts` + `components/{paymentMethods,PaymentMethodGrid,TenderDraftPanel,QuickPayRow,RetryBanner,OrderSummaryPanel}` + 3 test files.
4. **Files modified** — `PaymentTerminal.tsx` (thin orchestrator).
5. **Tests run** — table `| Suite | Count | Status |` : payment suite baseline vs after (must match) + 3 bonus suites.
6. **Permissions seeded** — N/A.
7. **RPCs added / bumped** — N/A.
8. **Deferred** — CartItemRow/CartLineRow dedup (F-020 backlog S35+); `OrderSummaryPanel` could further split loyalty math into a sub-component (not needed for < 500).
9. **Deviations vs spec/plan** — table; record any prop-type adjustments in `OrderSummaryPanel` (Task 7 typing note) as `DEV-REFACTOR-7-01 informational` if the store didn't export named types.
10. **Acceptance criteria** — the checklist from the spec §3, all `- [x]`.

- [ ] **Step 2: Light CLAUDE.md bump**

In `CLAUDE.md` §Active Workplan, add ONE short line under "Current session" noting the out-of-cycle refactor: `PaymentTerminal split (634→<300 lines) into usePaymentFlowLogic + 6 presentation files, iso-behaviour, delivered on refactor/pos-payment-terminal — INDEX: docs/workplan/plans/2026-06-01-pos-paymentterminal-refactor-INDEX.md`. Do NOT touch "Migration sequence active" (no migration).

- [ ] **Step 3: Commit the closeout**

```bash
git add docs/workplan/plans/2026-06-01-pos-paymentterminal-refactor-INDEX.md CLAUDE.md
git commit -m "docs(workplan): pos paymentterminal refactor — INDEX + CLAUDE.md bump

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Open the PR**

```bash
git push -u origin refactor/pos-payment-terminal
gh pr create --base master --head refactor/pos-payment-terminal \
  --title "refactor(pos): split PaymentTerminal (634→<300 lines) into usePaymentFlowLogic + presentation components" \
  --body "Iso-behaviour refactor. Preserved invariants: data-testids byte-for-byte, idempotency-key lifecycle, dispatchCheckout effect order + non-blocking fire-to-stations, footer Process-Payment button stays in PaymentTerminal.tsx, domain stays IO-free. Existing payment suite identical baseline→after; 3 bonus test files added.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Acceptance criteria (mirror spec §3)

- [ ] `PaymentTerminal.tsx` < 500 lines (target < 300).
- [ ] Each extracted file < 500 lines.
- [ ] Behaviour strictly unchanged: every existing payment test passes WITHOUT logic change (Task 0 baseline == Task 11 result for the original 4 files).
- [ ] `data-testid` + accessible labels (Numpad "Cash Received", Process Payment, retry/already-paid banners, `pay-cash-exact`, `pay-split-entry`, `pay-add-tender`, `pay-method-*`) preserved byte-for-byte.
- [ ] No duplicated math: pure helpers stay in `@breakery/domain`.
- [ ] `@breakery/domain` stays IO-free (the hook stays in `apps/pos`).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

---

## Self-Review (run against the spec — passed)

**1. Spec coverage**
- Spec §1 (633/634-line monolith) → Tasks 1-7 extraction; Task 8 verifies line count. ✓
- Spec §2 Extraction 1 (`usePaymentFlowLogic`) → Task 2. ✓
- Spec §2 Extraction 2 (presentation components) → Tasks 3-7 (`RetryBanner`, `PaymentMethodGrid`, `TenderDraftPanel`, `QuickPayRow`, `OrderSummaryPanel`; spec listed `TenderRow` but the real code uses the UI primitive `TenderListBuilder` inline — kept inline in the orchestrator, no `TenderRow` needed; spec said "optional" for the others). ✓
- Spec §2 thin-orchestrator + `formatLabel` migration to local util → Task 1 (`format.ts`) + Task 8 Step 2. ✓
- Spec §3 every acceptance criterion → mirrored in Acceptance section + verified by Tasks 8/11. ✓
- Spec §4 existing tests stay green → Tasks 0/2/3/4/5/6/7/11 re-run; §4 bonus tests → Tasks 9/10. ✓
- Spec §5 hors scope (no logic change, no domain migration, no restyle, no CartItemRow dedup) → respected; INDEX §8 records the dedup as deferred. ✓
- Spec §6 risks (testid move, dispatchCheckout state capture, mock module resolution) → Invariants 1-5 + the logic-before-JSX ordering (Task 2 before Tasks 3-7) + the explicit import-path note (Invariant 3). ✓

**2. Placeholder scan** — One intentional, fully-explained gap remains in Task 7 Step 1: the `OrderSummaryPanel` prop types. The component body is shown complete; the prop-type lines are flagged as "do NOT invent — use the real exported types from `@/stores/cartStore`" with concrete guidance. This is NOT a "TBD" — it is a typed instruction to read the actual store exports (which vary and must not be guessed). Recorded as `DEV-REFACTOR-7-01` candidate in the INDEX. No other "TBD/TODO/implement later/add validation/handle edge cases" patterns present.

**3. Type consistency** — `usePaymentFlowLogic` return keys (Task 2 Step 1) are consumed by the orchestrator destructure (Task 2 Step 2) and component props (Tasks 3-7) with identical names: `checkoutPending` (renamed once from `checkout.isPending`, applied consistently), `selectedMethod`, `selectMethod`, `cashReceivedStr`, `setCashReceivedStr`, `isCashDraft`, `cashChange`, `draftTenderAmount`, `draftAmount`, `remaining`, `quickAmounts`, `draftValid`, `fastPathReady`, `total`, `cart`, `attachedCustomer`, `appliedPromotions`, `totals`, `lastError`, `splitOpen`, `setSplitOpen`, and all 7 handlers. `RetryBannerProps`, `PaymentMethodGridProps`, `TenderDraftPanelProps`, `QuickPayRowProps`, `OrderSummaryPanelProps` exported interfaces match exactly how the orchestrator passes them. `formatLabel` defined once (Task 1), imported by `TenderDraftPanel` + `QuickPayRow`. `METHODS`/`IconComponent` defined once (Task 4). No drift found.

---

## Execution Handoff

Plan complete and saved to `docs/workplan/plans/2026-06-01-pos-paymentterminal-refactor-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (a `pos-specialist` per extraction is ideal here), review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session via superpowers:executing-plans, batch execution with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.

Which approach?
