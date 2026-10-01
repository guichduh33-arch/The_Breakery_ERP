import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as Ui from '@breakery/ui';
import type { CancelUnpaidAttempt } from '../hooks/useCancelUnpaidOrder';
const { mutate, refetch, data } = vi.hoisted(() => ({ mutate: vi.fn<(args: { attempt: CancelUnpaidAttempt; managerPin: string }) => Promise<unknown>>(), refetch: vi.fn(),
  data: { id: 'order-1', updated_at: '2026-09-30T00:00:00Z', status: 'pending_payment', created_via: 'pos', order_number: 'P-001',
    order_items: [{ id: 'line-1', quantity: 2, is_locked: true, is_cancelled: false, kitchen_status: 'pending', name_snapshot: 'Americano' }] } }));
vi.mock('../hooks/useUnpaidOrderSnapshot', () => ({ useUnpaidOrderSnapshot: () => ({ data, refetch, isLoading: false, isFetching: false, isError: false }) }));
vi.mock('../hooks/useCancelUnpaidOrder', () => ({ useCancelUnpaidOrder: () => ({ mutateAsync: mutate, isPending: false }) }));
vi.mock('@breakery/ui', async (original) => ({ ...await original<typeof Ui>(),
  NumpadPin: ({ onSubmit }: { onSubmit: (pin: string) => void }) => <button onClick={() => onSubmit('123456')}>Confirm manager PIN</button> }));
import { CancelUnpaidOrderModal } from '../CancelUnpaidOrderModal';

beforeEach(() => { vi.clearAllMocks(); data.order_items[0]!.kitchen_status = 'pending'; mutate.mockResolvedValue({}); });
describe('annulation impayée — déclaration manager', () => {
  it('préremplit la perte serveur, accepte zéro et exige une raison', async () => {
    const close = vi.fn();
    render(<CancelUnpaidOrderModal open orderId="order-1" onClose={close} />);
    expect(screen.getByLabelText('Waste quantity (0–2)')).toHaveValue(2);
    fireEvent.click(screen.getByText('Confirm manager PIN'));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Nothing prepared' } });
    fireEvent.change(screen.getByLabelText('Waste quantity (0–2)'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Confirm manager PIN'));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mutate.mock.calls[0]![0].attempt.losses).toEqual([{ id: 'line-1', waste_qty: 0 }]);
  });
  it('conserve snapshot et clé après réponse perdue et fermeture/réouverture', async () => {
    mutate.mockRejectedValue(new Error('network'));
    const close = vi.fn();
    const view = render(<CancelUnpaidOrderModal open orderId="order-1" onClose={close} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer left' } });
    fireEvent.click(screen.getByText('Confirm manager PIN'));
    await screen.findByText(/Cancellation is not confirmed/);
    const first = mutate.mock.calls[0]![0].attempt;
    fireEvent.click(screen.getByText('Close'));
    view.rerender(<CancelUnpaidOrderModal open={false} orderId="order-1" onClose={close} />);
    view.rerender(<CancelUnpaidOrderModal open orderId="order-1" onClose={close} />);
    fireEvent.click(screen.getByText('Confirm manager PIN'));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls[1]![0].attempt).toBe(first);
    expect(screen.getByLabelText('Reason')).toBeDisabled();
  });
  it('refuse la ligne servie avant tout appel', () => {
    data.order_items[0]!.kitchen_status = 'served';
    render(<CancelUnpaidOrderModal open orderId="order-1" onClose={vi.fn()} />);
    expect(screen.queryByText('Confirm manager PIN')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
  it('exige relecture explicite après changement serveur', async () => {
    mutate.mockRejectedValue(Object.assign(new Error('order_changed'), { status: 409 }));
    render(<CancelUnpaidOrderModal open orderId="order-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer left' } });
    fireEvent.click(screen.getByText('Confirm manager PIN'));
    fireEvent.click(await screen.findByText('Review current order'));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
