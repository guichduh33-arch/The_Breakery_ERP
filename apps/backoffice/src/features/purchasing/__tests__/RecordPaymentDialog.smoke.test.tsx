// apps/backoffice/src/features/purchasing/__tests__/RecordPaymentDialog.smoke.test.tsx
// Session 46 — R3: record-payment dialog behaviour.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecordPaymentDialog, type RecordPaymentDialogProps } from '../components/RecordPaymentDialog.js';

describe('RecordPaymentDialog smoke', () => {
  it('does not submit while the invoice requirement is unresolved', () => {
    const onConfirm = vi.fn();
    render(<RecordPaymentDialog poNumber="PO-1" remainingDue={1000} invoiceBlocked onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: /Record payment/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i })); expect(onConfirm).not.toHaveBeenCalled();
  });
  it('prefills the amount with the remaining due and submits with an idempotency key', () => {
    const onConfirm = vi.fn<RecordPaymentDialogProps['onConfirm']>().mockResolvedValue(undefined);
    render(
      <RecordPaymentDialog
        poNumber="PO-20260618-0001"
        remainingDue={50000}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const amount = screen.getByLabelText<HTMLInputElement>(/Amount/i);
    expect(amount.value).toBe('50000');

    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0]![0];
    expect(arg.amount).toBe(50000);
    expect(arg.method).toBe('transfer');
    expect(typeof arg.idempotencyKey).toBe('string');
    expect(arg.idempotencyKey.length).toBeGreaterThan(10);
  });

  it('disables submit on overpayment', () => {
    render(
      <RecordPaymentDialog
        poNumber="PO-1"
        remainingDue={1000}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '5000' } });
    expect(screen.getByText(/exceeds the remaining due/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record payment/i })).toBeDisabled();
  });

  it('keeps a stable idempotency key across re-submits', () => {
    const onConfirm = vi.fn<RecordPaymentDialogProps['onConfirm']>().mockResolvedValue(undefined);
    render(
      <RecordPaymentDialog
        poNumber="PO-1"
        remainingDue={2000}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }));
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }));
    expect(onConfirm.mock.calls[0]![0].idempotencyKey).toBe(onConfirm.mock.calls[1]![0].idempotencyKey);
  });
});
