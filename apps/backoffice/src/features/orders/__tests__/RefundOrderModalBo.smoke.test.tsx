// apps/backoffice/src/features/orders/__tests__/RefundOrderModalBo.smoke.test.tsx
//
// Lot 6c — la modale de refund BO applique la contrainte cross-shift :
//   · le cash n'est JAMAIS proposé (note explicite) ;
//   · store_credit exige un client rattaché ;
//   · une commande cash sans client ne peut pas être remboursée depuis le BO ;
//   · un refund non-cash / store_credit poste bien lignes + tender + motif.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/features/orders/hooks/useRefundOrder.js', () => ({
  useRefundOrder: () => ({ mutateAsync, isPending: false, error: null }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RefundOrderModalBo } from '../components/RefundOrderModalBo.js';

type Order = React.ComponentProps<typeof RefundOrderModalBo>['order'];

const baseItem = {
  id: 'i-1', product_id: 'p-1', name_snapshot: 'Latte',
  quantity: 2, unit_price: 50_000, line_total: 100_000,
  modifiers: null, is_cancelled: false, kitchen_status: null, qty_already_refunded: 0,
};

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o-1', order_number: 'ORD-001', status: 'paid', order_type: 'dine_in',
    table_number: null, created_at: '2026-05-22T10:00:00Z', paid_at: '2026-05-22T10:05:00Z',
    sent_to_kitchen_at: null, customer_id: 'cust-1', customer_name: 'Acme',
    served_by: null, served_by_name: 'Jo', subtotal: 100_000, discount_amount: 0,
    tax_amount: 9_000, total: 100_000,
    items: [{ ...baseItem }],
    payments: [{ id: 'pay-1', method: 'card', amount: 100_000, cash_received: null, change_given: null, paid_at: '2026-05-22T10:05:00Z', reference: null }],
    refunds: [], promotions: [], refunded_by_method: {}, total_refunded: 0,
    ...over,
  } as Order;
}

function renderModal(order: Order) {
  return render(<RefundOrderModalBo open order={order} onClose={vi.fn()} />);
}

describe('RefundOrderModalBo — cross-shift BO refund (lot 6c)', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ refund_number: 'REF-001' });
  });

  it('always shows the cash-unavailable note and never offers cash', () => {
    renderModal(makeOrder());
    expect(screen.getByText(/Cash refunds require an open register/i)).toBeInTheDocument();
    // Aucune option "Cash" dans le sélecteur de destination.
    expect(screen.queryByRole('option', { name: /^Cash\b/i })).toBeNull();
  });

  it('a cash-only order with no customer cannot be refunded from the back-office', () => {
    renderModal(makeOrder({
      customer_id: null, customer_name: null,
      payments: [{ id: 'pay-1', method: 'cash', amount: 100_000, cash_received: 100_000, change_given: 0, paid_at: '2026-05-22T10:05:00Z', reference: null }],
    }));
    expect(screen.getByText(/cannot be refunded from the back-office/i)).toBeInTheDocument();
    // store_credit désactivé faute de client.
    const sc = screen.getByRole('option', { name: /Store credit \(requires a customer\)/i }) as HTMLOptionElement;
    expect(sc.disabled).toBe(true);
    expect((screen.getByTestId('refund-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('routes a non-cash refund back to the original method with the picked lines', async () => {
    renderModal(makeOrder());
    // Card apparaît comme destination avec son reste disponible.
    expect(screen.getByRole('option', { name: /Card — .* available/i })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Increase Latte')); // qty 1 → Rp 50.000
    fireEvent.change(screen.getByTestId('refund-reason'), { target: { value: 'customer return' } });
    fireEvent.change(screen.getByTestId('refund-pin'), { target: { value: '123456' } });
    const submit = screen.getByTestId('refund-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'o-1',
      lines: [{ order_item_id: 'i-1', qty: 1 }],
      tenders: [{ method: 'card', amount: 50_000 }],
      reason: 'customer return',
      managerPin: '123456',
    }));
  });

  it('offers store credit as the escape hatch for a cash order with a customer', async () => {
    renderModal(makeOrder({
      payments: [{ id: 'pay-1', method: 'cash', amount: 100_000, cash_received: 100_000, change_given: 0, paid_at: '2026-05-22T10:05:00Z', reference: null }],
    }));
    const sc = screen.getByRole('option', { name: /^Store credit$/i }) as HTMLOptionElement;
    expect(sc.disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Increase Latte'));
    fireEvent.change(screen.getByTestId('refund-reason'), { target: { value: 'goodwill' } });
    fireEvent.change(screen.getByTestId('refund-pin'), { target: { value: '123456' } });
    const submit = screen.getByTestId('refund-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      tenders: [{ method: 'store_credit', amount: 50_000 }],
    }));
  });
});
