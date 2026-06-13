// apps/pos/src/features/payment/hooks/__tests__/usePaymentFlowLogic.test.ts
// Bonus unit coverage unlocked by the refactor: the derived flags
// (remaining / draftValid / fastPathReady / canProcess) in isolation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePaymentFlowLogic } from '../usePaymentFlowLogic';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';

// vi.hoisted so the mock fn keeps a stable ref (S39 lesson) and tests can
// program per-case resolutions/rejections.
const checkoutMock = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));
vi.mock('../useCheckout', () => ({ useCheckout: () => ({ mutateAsync: checkoutMock.mutateAsync, isPending: false }) }));
vi.mock('@/features/cart/hooks/useFireToStations', () => ({
  // mutateAsync must RESOLVE (the success path chains `.then()` on it).
  useFireToStations: () => ({ mutation: { mutateAsync: vi.fn().mockResolvedValue([]), isPending: false }, firableCount: 0 }),
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

describe('usePaymentFlowLogic — fatal error lifecycle on close (S43 P0-1b)', () => {
  beforeEach(() => {
    seedCartOneItem();
    checkoutMock.mutateAsync.mockReset();
    // Cash-exact fast path so handleProcess() ships a tender.
    usePaymentStore.setState({ isOpen: true, selectedMethod: 'cash', cashReceivedStr: '25000', tenders: [] });
  });

  it('close() clears a FATAL lastError (stale banner must not reappear on reopen)', async () => {
    checkoutMock.mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('discount_requires_authorizer'), {
        details: { error: 'discount_requires_authorizer' },
        status: 409,
      }),
    );
    const { result } = renderHook(() => usePaymentFlowLogic(), { wrapper });
    await act(async () => { await result.current.handleProcess(); });
    expect(result.current.lastError?.kind).toBe('fatal');

    act(() => { result.current.close(); });
    expect(result.current.lastError).toBeNull();
  });

  it('close() preserves a RETRYABLE lastError (keeps the retry affordance)', async () => {
    checkoutMock.mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('network_error'), { details: { error: 'network_error' } }),
    );
    const { result } = renderHook(() => usePaymentFlowLogic(), { wrapper });
    await act(async () => { await result.current.handleProcess(); });
    expect(result.current.lastError?.kind).toBe('retryable');

    act(() => { result.current.close(); });
    expect(result.current.lastError?.kind).toBe('retryable');
  });

  it('close() preserves an ALREADY_PAID lastError (cashier must dismiss it explicitly)', async () => {
    checkoutMock.mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('already_paid'), { details: { error: 'already_paid' } }),
    );
    const { result } = renderHook(() => usePaymentFlowLogic(), { wrapper });
    await act(async () => { await result.current.handleProcess(); });
    expect(result.current.lastError?.kind).toBe('already_paid');

    act(() => { result.current.close(); });
    expect(result.current.lastError?.kind).toBe('already_paid');
  });
});

describe('usePaymentFlowLogic — loyalty from server envelope (S44 D4)', () => {
  beforeEach(() => {
    seedCartOneItem();
    checkoutMock.mutateAsync.mockReset();
    usePaymentStore.setState({ isOpen: true, selectedMethod: 'cash', cashReceivedStr: '25000', tenders: [] });
  });

  it('success.pointsEarned + loyaltyBalanceAfter come from the server result, not a client recompute', async () => {
    // Server-resolved figures (DB tier × category multiplier). 73 ≠ any local
    // estimate for a 25 000 cart, so a client recompute would NOT produce 73.
    checkoutMock.mutateAsync.mockResolvedValueOnce({
      ok: true,
      order_id: 'o-1',
      order_number: '#0001',
      total: 25_000,
      tax_amount: 2_273,
      change_given: 0,
      loyalty_points_earned: 73,
      loyalty_balance_after: 666,
    });
    const { result } = renderHook(() => usePaymentFlowLogic(), { wrapper });
    await act(async () => { await result.current.handleProcess(); });
    expect(result.current.success?.pointsEarned).toBe(73);
    expect(result.current.success?.loyaltyBalanceAfter).toBe(666);
  });
});
