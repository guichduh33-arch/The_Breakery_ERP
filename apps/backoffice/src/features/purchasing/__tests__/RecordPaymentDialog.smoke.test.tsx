// apps/backoffice/src/features/purchasing/__tests__/RecordPaymentDialog.smoke.test.tsx
// Session 46 — R3: record-payment dialog behaviour.
// ADR-048 — la date réelle du décaissement est obligatoire, sans défaut.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecordPaymentDialog, type RecordPaymentDialogProps } from '../components/RecordPaymentDialog.js';

function setPaidAt(value = '2026-11-20T09:30'): void {
  fireEvent.change(screen.getByLabelText(/Paid at/i), { target: { value } });
}

describe('RecordPaymentDialog smoke', () => {
  it('does not submit while the invoice requirement is unresolved', () => {
    const onConfirm = vi.fn();
    render(<RecordPaymentDialog poNumber="PO-1" remainingDue={1000} invoiceBlocked onCancel={vi.fn()} onConfirm={onConfirm} />);
    setPaidAt();
    expect(screen.getByRole('button', { name: /Record payment/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i })); expect(onConfirm).not.toHaveBeenCalled();
  });

  it('requires the real payment date: empty by default, submit blocked until filled', () => {
    const onConfirm = vi.fn<RecordPaymentDialogProps['onConfirm']>().mockResolvedValue(undefined);
    render(<RecordPaymentDialog poNumber="PO-1" remainingDue={1000} onCancel={vi.fn()} onConfirm={onConfirm} />);
    const paidAt = screen.getByLabelText<HTMLInputElement>(/Paid at/i);
    expect(paidAt.value).toBe('');
    expect(paidAt).toBeRequired();
    expect(screen.getByText(/Required: the date the money actually left/i)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /Record payment/i });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onConfirm).not.toHaveBeenCalled();

    setPaidAt('2026-11-20T09:30');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onConfirm.mock.calls[0]![0].paidAt).toBe('2026-11-20T09:30');
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

    setPaidAt();
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
    setPaidAt();
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
    setPaidAt();
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }));
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }));
    expect(onConfirm.mock.calls[0]![0].idempotencyKey).toBe(onConfirm.mock.calls[1]![0].idempotencyKey);
  });
});
