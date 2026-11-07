import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as Ui from '@breakery/ui';
import { toast } from 'sonner';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { BottomActionBar } from '../BottomActionBar';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/discounts/hooks/useVerifyManagerPin', () => ({ useVerifyManagerPin: () => verify }));
vi.mock('@/features/settings/hooks/useTaxConfig', () => ({ useTaxConfig: () => ({ taxRate: 0.1, taxInclusive: true }) }));
vi.mock('@/features/settings/hooks/usePOSPresets', () => ({ usePOSPresets: () => ({ presets: { discountPresets: [] } }) }));
vi.mock('@/features/shift/hooks/useShift', () => ({ useCurrentShift: () => ({ isLoading: false }) }));
vi.mock('@/features/heldOrders/hooks/useHeldOrdersQuery', () => ({ useHeldOrdersQuery: () => ({ data: [] }) }));
vi.mock('../hooks/useHoldFiredOrder', () => ({ useHoldFiredOrder: () => ({ isPending: false }) }));
vi.mock('@/features/tables/hooks/useDineInTableGuard', () => ({ useDineInTableGuard: () => ({ modal: null }) }));
vi.mock('@/features/discounts/hooks/useApplyCartDiscount', () => ({ useApplyCartDiscount: () => ({ base: 0 }) }));
vi.mock('@/features/tables/components/TableSelectorButton', () => ({ TableSelectorButton: () => null }));
vi.mock('../SendToKitchenButton', () => ({ SendToKitchenButton: () => null }));
vi.mock('../PrintBillButton', () => ({ PrintBillButton: () => null }));
vi.mock('../PrintJobsPanel', () => ({ PrintJobsPanel: () => null }));
vi.mock('../HeldOrdersModal', () => ({ HeldOrdersModal: () => null }));
vi.mock('../CancelUnpaidOrderModal', () => ({ CancelUnpaidOrderModal: () => null }));
vi.mock('@breakery/ui', async (original) => ({ ...await original<typeof Ui>(),
  NumpadPin: ({ onSubmit }: { onSubmit: (pin: string) => void }) => <button onClick={() => onSubmit('123456')}>Confirm PIN</button>,
}));

const item = { id: 'line-1', product_id: 'product-1', name: 'Coffee', unit_price: 42000, quantity: 1, modifiers: [] };
function submitVoid() {
  render(<BottomActionBar />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('button', { name: 'Void order' }));
  fireEvent.change(screen.getByLabelText('Void reason'), { target: { value: 'Customer left' } });
  fireEvent.click(screen.getByText('Confirm PIN'));
}

beforeEach(() => {
  vi.clearAllMocks();
  verify.mockResolvedValue({ ok: true, userId: 'manager-1' });
  useCartStore.setState({ cart: { items: [item], order_type: 'take_out' }, pickedUpOrderId: null,
    offlineOrder: null, lockedItemIds: [], attachedCustomer: null });
  usePaymentStore.setState({ attempt: null, recoveryError: null });
});

describe('annulation du panier local', () => {
  it.each(['wrong_pin', 'permission_missing', 'account_locked', 'unknown'])('conserve le panier sur refus %s', async (error) => {
    verify.mockResolvedValue({ ok: false, error });
    submitVoid();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Void failed: Manager authorization failed'));
    expect(useCartStore.getState().cart.items).toEqual([item]);
    expect(screen.getByLabelText('Void reason')).toHaveValue('Customer left');
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('exige orders.void et vide le panier après autorisation', async () => {
    submitVoid();
    await waitFor(() => expect(useCartStore.getState().cart.items).toEqual([]));
    expect(verify).toHaveBeenCalledWith('123456', 'orders.void');
    expect(toast.info).toHaveBeenCalledWith('Order voided — Customer left');
  });

  it('préserve la commande hors ligne et sa file avant la vérification PIN', async () => {
    const offlineOrder = { clientUuid: 'offline-root', localNumber: 'LOCAL-001' };
    useCartStore.setState({ offlineOrder, lockedItemIds: ['line-1'] });
    submitVoid();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Void failed: Sync this offline order before cancelling it'));
    expect(verify).not.toHaveBeenCalled();
    expect(useCartStore.getState().offlineOrder).toEqual(offlineOrder);
    expect(useCartStore.getState().cart.items).toEqual([item]);
  });
});
