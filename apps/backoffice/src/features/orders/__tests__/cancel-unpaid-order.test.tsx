import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CancelUnpaidAttempt } from '../hooks/useCancelUnpaidOrder.js';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn<(args: { attempt: CancelUnpaidAttempt; managerPin: string }) => Promise<unknown>>(),
  refetch: vi.fn(),
  data: {
    id: 'order-1', updated_at: '2026-11-03T00:00:00Z', status: 'pending_payment',
    created_via: 'tablet', order_number: 'T-001', order_items: [
      { id: 'line-1', quantity: 2, is_locked: true, is_cancelled: false, kitchen_status: 'pending', name_snapshot: 'Croissant' },
    ],
  },
}));
vi.mock('../hooks/useCancelUnpaidOrder.js', () => ({
  useUnpaidOrderSnapshot: () => ({ data: mocks.data, refetch: mocks.refetch, isLoading: false, isFetching: false, isError: false }),
  useCancelUnpaidOrder: () => ({ mutateAsync: mocks.mutate, isPending: false }),
}));
import { CancelUnpaidOrderModal } from '../components/CancelUnpaidOrderModal.js';

function fillAndSubmit(): void {
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer left' } });
  fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Void unpaid order' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data.order_items[0]!.kitchen_status = 'pending';
  mocks.data.order_items[0]!.is_locked = true;
  mocks.mutate.mockResolvedValue({});
});

describe('Unpaid order cancellation from the back office', () => {
  it('requires PIN and reason, and accepts an explicit zero waste declaration', async () => {
    const close = vi.fn();
    render(<CancelUnpaidOrderModal open orderId="order-1" onClose={close} />);
    expect(screen.getByRole('button', { name: 'Void unpaid order' })).toBeDisabled();
    expect(screen.getByLabelText('Waste quantity (0–2)')).toHaveValue(2);
    fireEvent.change(screen.getByLabelText('Waste quantity (0–2)'), { target: { value: '0' } });
    fillAndSubmit();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.mutate.mock.calls[0]![0].attempt.losses).toEqual([{ id: 'line-1', waste_qty: 0 }]);
    expect(mocks.mutate.mock.calls[0]![0].managerPin).toBe('123456');
  });

  it('keeps the same attempt across a lost response, close and reopen', async () => {
    mocks.mutate.mockRejectedValue(new Error('network'));
    const close = vi.fn();
    const view = render(<CancelUnpaidOrderModal open orderId="order-1" onClose={close} />);
    fillAndSubmit();
    await screen.findByText(/Cancellation is not confirmed/);
    const first = mocks.mutate.mock.calls[0]![0].attempt;
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    view.rerender(<CancelUnpaidOrderModal open={false} orderId={null} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume unpaid void' }));
    expect(screen.getByLabelText('Manager PIN')).toHaveValue('');
    expect(screen.getByLabelText('Reason')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void unpaid order' }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    expect(mocks.mutate.mock.calls[1]![0].attempt).toBe(first);
  });

  it('requires an explicit refresh after a concurrent order change', async () => {
    mocks.mutate.mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }));
    render(<CancelUnpaidOrderModal open orderId="order-1" onClose={vi.fn()} />);
    fillAndSubmit();
    fireEvent.click(await screen.findByRole('button', { name: 'Review current order' }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Reason')).toBeEnabled();
  });

  it('does not retry a previous attempt against a different order', async () => {
    mocks.mutate.mockRejectedValue(new Error('network'));
    const view = render(<CancelUnpaidOrderModal open orderId="order-1" onClose={vi.fn()} />);
    fillAndSubmit();
    await screen.findByText(/Cancellation is not confirmed/);
    view.rerender(<CancelUnpaidOrderModal open orderId="order-2" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Void unpaid order' })).toBeDisabled();
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });

  it.each(['', '-1', '3'])('rejects the invalid waste quantity %s', (value) => {
    render(<CancelUnpaidOrderModal open orderId="order-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Waste quantity (0–2)'), { target: { value } });
    fillAndSubmit();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('explains the existing server restriction on served items', () => {
    mocks.data.order_items[0]!.kitchen_status = 'served';
    render(<CancelUnpaidOrderModal open orderId="order-1" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('A served item cannot be cancelled in this flow.');
    fillAndSubmit();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
