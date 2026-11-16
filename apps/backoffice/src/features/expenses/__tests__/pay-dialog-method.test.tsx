import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PayDialog } from '../components/PayDialog.js';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useExpenseActions.js', () => ({
 usePayExpense: () => ({ mutateAsync: mutate, isPending: false, error: null }),
}));
beforeEach(() => mutate.mockReset().mockResolvedValue({ status: 'paid' }));

describe('expense payment method at settlement', () => {
 it('does not submit while the invoice requirement is unresolved', () => {
  render(<PayDialog open expenseId="expense-1" recordedPaymentMethod="cash" invoiceBlocked onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Mark paid' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Mark paid' })); expect(mutate).not.toHaveBeenCalled();
 });
 it('rechecks the invoice guard when it changes while the payment dialog is open', async () => {
  const onClose=vi.fn();
  const view=render(<PayDialog open expenseId="expense-1" recordedPaymentMethod="cash" onClose={onClose} />);
  view.rerender(<PayDialog open expenseId="expense-1" recordedPaymentMethod="cash" invoiceBlocked onClose={onClose} />);
  fireEvent.click(screen.getByRole('button',{name:'Mark paid'}));expect(mutate).not.toHaveBeenCalled();
  view.rerender(<PayDialog open expenseId="expense-1" recordedPaymentMethod="cash" invoiceBlocked={false} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button',{name:'Mark paid'}));await waitFor(()=>expect(mutate).toHaveBeenCalledWith({id:'expense-1'}));
 });
 it.each([['cash','Cash'],['transfer','Bank transfer'],['card','Card']])(
  'keeps an approved %s expense on its recorded method', async (method,label) => {
   render(<PayDialog open expenseId="expense-1" recordedPaymentMethod={method} onClose={vi.fn()} />);
   expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
   expect(screen.getByText('Recorded payment method')).toBeInTheDocument();
   expect(screen.getByText(label)).toBeInTheDocument();
   fireEvent.click(screen.getByRole('button',{name:'Mark paid'}));
   await waitFor(() => expect(mutate).toHaveBeenCalledWith({ id:'expense-1' }));
  },
 );
 it('settles a credit expense with the default cash choice', async () => {
  render(<PayDialog open expenseId="expense-1" recordedPaymentMethod="credit" onClose={vi.fn()} />);
  expect(screen.getByRole('combobox')).toHaveValue('cash');
  fireEvent.click(screen.getByRole('button',{name:'Mark paid'}));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith({ id:'expense-1', paymentMethod:'cash' }));
 });
 it.each(['transfer','card'])('allows %s to settle a credit expense', async method => {
  render(<PayDialog open expenseId="expense-1" recordedPaymentMethod="credit" onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole('combobox'),{target:{value:method}});
  fireEvent.click(screen.getByRole('button',{name:'Mark paid'}));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith({ id:'expense-1',paymentMethod:method }));
 });
});
