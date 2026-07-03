/// <reference types="@testing-library/jest-dom" />
// Spec A fix — a reopened FIRED order ("addition ouverte") can be put back on
// hold with no changes. After reopen the order sits on the terminal
// (pickedUpOrderId set, all lines locked); the draft Hold path is wrong (it
// would orphan the live DB row) and Send-to-Kitchen is a no-op with nothing new
// to fire. The "Hold" menu item must re-park it via hold_fired_order_v1, and be
// disabled while there are unfired new lines (Send to Kitchen fires + parks).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { holdFiredMutate } = vi.hoisted(() => ({
  holdFiredMutate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/heldOrders/hooks/useHeldOrdersQuery', () => ({
  useHeldOrdersQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/cart/hooks/useHoldFiredOrder', () => ({
  useHoldFiredOrder: () => ({ mutateAsync: holdFiredMutate, isPending: false }),
}));
vi.mock('@/features/discounts/hooks/useApplyCartDiscount', () => ({
  useApplyCartDiscount: () => ({
    discountModalOpen: false,
    pinModalOpen: false,
    base: 0,
    openDiscountModal: vi.fn(),
    closeDiscountModal: vi.fn(),
    onConfirm: vi.fn(),
    onRequireAuthorization: vi.fn(),
    onPinVerified: vi.fn(),
    onPinClose: vi.fn(),
    verifyFn: vi.fn(),
  }),
}));
vi.mock('@/features/discounts/hooks/useVerifyManagerPin', () => ({
  useVerifyManagerPin: () => vi.fn(),
}));
vi.mock('@/features/cart/hooks/useVoidServerOrder', () => ({
  useVoidServerOrder: () => vi.fn(),
}));
// Stub the heavy child buttons/modals so we only exercise BottomActionBar logic.
vi.mock('@/features/tables/components/TableSelectorButton', () => ({ TableSelectorButton: () => null }));
vi.mock('@/features/inbox/components/TabletInboxButton', () => ({ TabletInboxButton: () => null }));
vi.mock('@/features/cart/SendToKitchenButton', () => ({ SendToKitchenButton: () => null }));
vi.mock('@/features/cart/PrintBillButton', () => ({ PrintBillButton: () => null }));
vi.mock('@/features/cart/HeldOrdersModal', () => ({ HeldOrdersModal: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { BottomActionBar } from '@/features/cart/BottomActionBar';
import { useCartStore } from '@/stores/cartStore';

function wrap(n: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;
}

const REOPENED_ITEM = {
  id: 'item-1',
  product_id: 'prod-1',
  name: 'Latte',
  unit_price: 30000,
  quantity: 1,
  modifiers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

function seedReopenedFiredOrder(extraUnfired = false) {
  const items = extraUnfired
    ? [REOPENED_ITEM, { ...REOPENED_ITEM, id: 'item-2', name: 'Croissant' }]
    : [REOPENED_ITEM];
  useCartStore.setState({
    cart: { items, order_type: 'dine_in' },
    // Only the reopened line is locked; item-2 (if present) is a new unfired line.
    lockedItemIds: ['item-1'],
    printedItemIds: ['item-1'],
    attachedCustomer: null,
    pickedUpOrderId: 'fired-order-42',
    appliedPromotions: [],
    dismissedPromotionIds: new Set(),
    isOffline: false,
  } as never);
}

describe('BottomActionBar — re-hold a reopened fired order', () => {
  it('re-parks the fired order via hold_fired_order_v1 when nothing changed', async () => {
    seedReopenedFiredOrder();
    render(wrap(<BottomActionBar />));

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    const hold = screen.getByRole('menuitem', { name: /hold/i });
    expect(hold).not.toBeDisabled();
    fireEvent.click(hold);

    await waitFor(() => expect(holdFiredMutate).toHaveBeenCalledWith('fired-order-42'));
    // Terminal freed after the re-hold.
    expect(useCartStore.getState().pickedUpOrderId).toBeNull();
  });

  it('disables re-hold while there are unfired new lines (Send to Kitchen first)', () => {
    seedReopenedFiredOrder(true);
    render(wrap(<BottomActionBar />));

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    expect(screen.getByRole('menuitem', { name: /hold/i })).toBeDisabled();
  });
});
