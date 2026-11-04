import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApproveDialog } from '../components/ApproveDialog.js';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useExpenseActions.js', () => ({
  useApproveExpense: () => ({ mutateAsync: mutate, reset: vi.fn(), isPending: false, error: null }),
}));
beforeEach(() => mutate.mockReset().mockResolvedValue({ status: 'approved' }));
describe('cash expense invoice guard', () => {
  it('rechecks the invoice guard when it changes while the approval dialog is open', async () => {
    const onClose = vi.fn();
    const view = render(<ApproveDialog open expenseId="expense-1" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: '1234' } });
    view.rerender(<ApproveDialog open expenseId="expense-1" invoiceBlocked onClose={onClose} />);
    expect(screen.getByTestId('approve-submit-btn')).toBeDisabled();
    fireEvent.click(screen.getByTestId('approve-submit-btn')); expect(mutate).not.toHaveBeenCalled();
    view.rerender(<ApproveDialog open expenseId="expense-1" invoiceBlocked={false} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('approve-submit-btn'));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ id: 'expense-1', manager_pin: '1234' }));
  });
});
