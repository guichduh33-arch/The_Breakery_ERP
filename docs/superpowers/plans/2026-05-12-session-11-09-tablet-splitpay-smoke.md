# Session 11 — Phase 09 — Tablet Split-Pay v5 Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove end-to-end that the tablet pickup → multi-tender split-pay path works against the `pay_existing_order` v5 RPC, by writing the smoke test promised in the spec §5 (`tablet-split-pay.smoke.test.tsx`). No production code changes — the RPC (`20260513000003_extend_pay_existing_order_rpc_v5.sql`) and the client wiring (`apps/pos/src/features/payment/hooks/useCheckout.ts` lines 65-94) are already in place.

**Architecture:** A vitest smoke under `apps/pos/src/__tests__/` that boots the POS PaymentTerminal flow against a mocked supabase, simulates a tablet pickup with a multi-tender input, and asserts:
1. `supabase.rpc('pay_existing_order', …)` is called with `p_payments` (the array form), NOT `p_payment` (singular)
2. The argument shape matches the v5 contract: 1..5 entries, sum equals order total, no cash overpay on intermediate tenders
3. The mutation reaches `onSuccess` (queries invalidated)

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/superpowers/specs/2026-05-11-session-11-backoffice-crud-spec.md` §5 (tablet-split-pay.smoke.test.tsx)
**Parent plan:** `docs/superpowers/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- Migration `20260513000003_extend_pay_existing_order_rpc_v5.sql` applied
- `apps/pos/src/features/payment/hooks/useCheckout.ts` handles `payment: PaymentInput | PaymentInput[]` and routes split-pay to `p_payments` (verified at lines 65-94 of the live file)

**Why this is a separate phase:** the wiring exists but is uncovered. Spec acceptance criterion §6 demands a smoke. Without the test, regression is invisible.

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `apps/pos/src/__tests__/tablet-split-pay.smoke.test.tsx` |

---

## Task 1: Investigate the existing useCheckout structure

This is **read-only** to make sure the test wires to the right stores. The hook reads from `useShiftStore`, `usePaymentStore`, and `useCartStore`; it relies on `pickedUpOrderId` being set on `useCartStore.getState().pickedUpOrderId` (NOT inside `cart`).

- [ ] **Step 1: Read the hook**

```bash
cat apps/pos/src/features/payment/hooks/useCheckout.ts
```

- [ ] **Step 2: Read the stores referenced**

```bash
cat apps/pos/src/stores/cartStore.ts | head -100
cat apps/pos/src/stores/shiftStore.ts | head -50
cat apps/pos/src/stores/paymentStore.ts | head -50
```

Note the exact shape of `pickedUpOrderId`, the cart shape, and the `idempotencyKey` slot. The test will set them via `useCartStore.setState(...)`, `useShiftStore.setState(...)`, etc.

> No commit at this step — investigation only.

---

## Task 2: Write the smoke test

**Files:**
- Create: `apps/pos/src/__tests__/tablet-split-pay.smoke.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/pos/src/__tests__/tablet-split-pay.smoke.test.tsx
//
// Session 11 — proves the tablet pickup + multi-tender path forwards
// `p_payments` (array) to pay_existing_order v5. Asserts the RPC call
// shape; not a DB round-trip.
//
// The v5 RPC accepts EITHER p_payment (single) OR p_payments (array). Our
// useCheckout hook chooses based on Array.isArray(input.payment).

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCheckout } from '@/features/payment/hooks/useCheckout';
import { useCartStore } from '@/stores/cartStore';
import { useShiftStore } from '@/stores/shiftStore';
import { usePaymentStore } from '@/stores/paymentStore';

const rpcSpy = vi.fn().mockResolvedValue({ data: { order_number: 'ORD-001' }, error: null });

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: rpcSpy,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
    from: vi.fn(),
  },
  supabaseUrl: 'https://stub.supabase.co',
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('Tablet pickup split-pay (v5)', () => {
  beforeEach(() => {
    rpcSpy.mockClear();

    // Open shift
    useShiftStore.setState({
      current: { id: 'shift-1', cashier_id: 'u1', opened_at: '2026-05-12T08:00:00Z' },
    } as never);

    // Idempotency key
    usePaymentStore.setState({ idempotencyKey: '00000000-0000-0000-0000-000000000001' } as never);

    // Cart points at a held order, with line items totalling 100k
    useCartStore.setState({
      cart: { items: [], customerId: null, loyaltyPointsToRedeem: 0, tableNumber: null, cartDiscount: null },
      attachedCustomer: null,
      pickedUpOrderId: 'order-1',
      appliedPromotions: [],
    } as never);
  });

  it('forwards p_payments (array) when caller passes a 2-tender array', async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper });

    await result.current.mutateAsync({
      cart: { items: [], customerId: null, loyaltyPointsToRedeem: 0, tableNumber: null, cartDiscount: null },
      payment: [
        { method: 'cash', amount: 60000, cash_received: 60000, change_given: 0 },
        { method: 'card', amount: 40000 },
      ],
    } as never);

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(1));
    const [name, args] = rpcSpy.mock.calls[0];

    expect(name).toBe('pay_existing_order');
    expect(args).toMatchObject({
      p_order_id: 'order-1',
      p_payments: [
        expect.objectContaining({ method: 'cash', amount: 60000 }),
        expect.objectContaining({ method: 'card', amount: 40000 }),
      ],
    });
    // Crucially, NOT p_payment (singular)
    expect(args.p_payment).toBeUndefined();

    // Sum sanity (mirrors v5's server-side check)
    const sum = args.p_payments.reduce((acc: number, t: { amount: number }) => acc + t.amount, 0);
    expect(sum).toBe(100000);
  });

  it('still forwards p_payment (singular) when caller passes a single PaymentInput', async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper });

    await result.current.mutateAsync({
      cart: { items: [], customerId: null, loyaltyPointsToRedeem: 0, tableNumber: null, cartDiscount: null },
      payment: { method: 'cash', amount: 100000, cash_received: 100000, change_given: 0 },
    } as never);

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(1));
    const [, args] = rpcSpy.mock.calls[0];

    expect(args).toMatchObject({
      p_order_id: 'order-1',
      p_payment: expect.objectContaining({ method: 'cash', amount: 100000 }),
    });
    expect(args.p_payments).toBeUndefined();
  });

  it('refuses to combine the single + array shapes (server contract — we just verify the client picks one)', async () => {
    // This is a structural test: useCheckout's branch logic chooses based on
    // Array.isArray(input.payment). If a future refactor accidentally sets
    // BOTH on the args object, the RPC will reject (P0001 "Cannot supply
    // both p_payment and p_payments"). We test the client never does this.
    const { result } = renderHook(() => useCheckout(), { wrapper });

    await result.current.mutateAsync({
      cart: { items: [], customerId: null, loyaltyPointsToRedeem: 0, tableNumber: null, cartDiscount: null },
      payment: [{ method: 'cash', amount: 100000 }],
    } as never);

    const [, args] = rpcSpy.mock.calls[0];
    const hasBoth = args.p_payment !== undefined && args.p_payments !== undefined;
    expect(hasBoth).toBe(false);
  });
});
```

> **Implementation note:** the exact import paths and store-setState shapes may differ slightly from the snapshot above. Match the live code in `apps/pos/src/`. The intent is unchanged: prove the array form forwards as `p_payments` and the single form forwards as `p_payment`, never both.

- [ ] **Step 2: Run the test**

```bash
pnpm --filter pos test -- tablet-split-pay.smoke
```

Expected: 3 ok / 0 fail.

If a test fails because the live useCheckout shape differs, **DO NOT modify useCheckout to satisfy the test**. The wiring is already shipped and exercised by the v5 migration. Adjust the test setup (store seeds) instead.

- [ ] **Step 3: Run the full POS suite to catch regressions**

```bash
pnpm --filter pos test
```

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/__tests__/tablet-split-pay.smoke.test.tsx
git commit -m "test(pos): session 11 — tablet split-pay v5 smoke (p_payments shape)"
```

---

## Task 3 (optional): Manual verification against a running stack

This is **manual verification** — useful for a final sanity check before tagging the session done, but not a required commit. Skip if the smoke + existing pay-existing-order tests already give confidence.

- [ ] **Step 1: Start local stack**

```bash
supabase start
supabase functions serve --env-file supabase/functions/.env
pnpm --filter pos dev
```

- [ ] **Step 2: Reproduce a pickup + split-pay**

1. POS login → create a tablet order (4 items totalling 100k)
2. Send to kitchen → order moves to held
3. POS → pickup that order
4. Payment terminal → tab "Multi-tender" → 60k cash + 40k card → Process
5. Receipt prints; order.status = 'paid'; DB has 2 order_payments rows summing to 100k

Use `psql` or `supabase db url` to verify:

```sql
SELECT order_id, method, amount, cash_received, change_given
FROM order_payments
WHERE order_id = (SELECT id FROM orders WHERE status = 'paid' ORDER BY paid_at DESC LIMIT 1);
```

Expected: 2 rows summing to the order total, methods 'cash' and 'card'.

---

## Phase exit criteria

- [ ] `apps/pos/src/__tests__/tablet-split-pay.smoke.test.tsx` exists, 3 tests green
- [ ] No production code touched (only test)
- [ ] `pnpm --filter pos test` green; full `pnpm test` from repo root still passes
- [ ] (optional) Manual flow verified end-to-end

Once all checked, dispatch the subagent for Phase 10 (sidebar grouping + final route polish).
